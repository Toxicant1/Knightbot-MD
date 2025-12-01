const settings = require('./settings');
require('./config.js');
const fs = require('fs');
const { isBanned } = require('./lib/isBanned');
const { storeMessage, handleMessageRevocation } = require('./commands/antidelete');
const { Antilink } = require('./lib/antilink');
const { handleBadwordDetection } = require('./lib/antibadword');
const isAdmin = require('./lib/isAdmin');
const { incrementMessageCount, topMembers } = require('./commands/topmembers');
const { handleChatbotResponse, handleChatbotCommand } = require('./commands/chatbot');
const { addCommandReaction } = require('./lib/reactions');

// Command imports simplified
const commandMap = {
    '.help': require('./commands/help'),
    '.menu': require('./commands/help'),
    '.bot': require('./commands/help'),
    '.list': require('./commands/help'),
    '.sticker': require('./commands/sticker'),
    '.s': require('./commands/sticker'),
    '.ping': require('./commands/ping'),
    '.alive': require('./commands/alive'),
    '.topmembers': require('./commands/topmembers').topMembers,
    // ... add all other commands here
};

const channelInfo = {
    contextInfo: {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '120363161513685998@newsletter',
            newsletterName: 'KnightBot MD',
            serverMessageId: -1
        }
    }
};

async function handleMessages(sock, messageUpdate) {
    try {
        const { messages, type } = messageUpdate;
        if (type !== 'notify') return;

        const message = messages[0];
        if (!message?.message) return;

        const chatId = message.key.remoteJid;
        const senderId = message.key.participant || message.key.remoteJid;
        const isGroup = chatId.endsWith('@g.us');

        const userMessage = (
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            message.message?.imageMessage?.caption ||
            message.message?.videoMessage?.caption ||
            ''
        ).toLowerCase().trim();

        const rawText = message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            message.message?.imageMessage?.caption ||
            message.message?.videoMessage?.caption ||
            '';

        // Store message for antidelete
        storeMessage(message);

        // Handle message revocation
        if (message.message?.protocolMessage?.type === 0) {
            await handleMessageRevocation(sock, message);
            return;
        }

        // Skip banned users
        if (isBanned(senderId) && !userMessage.startsWith('.unban')) return;

        if (!message.key.fromMe) incrementMessageCount(chatId, senderId);

        // Handle bad words & antispam first
        if (isGroup && userMessage) {
            await handleBadwordDetection(sock, chatId, message, userMessage, senderId);
            await Antilink(message, sock);
        }

        // Process commands
        if (!userMessage.startsWith('.')) {
            if (isGroup && userMessage) await handleChatbotResponse(sock, chatId, message, userMessage, senderId);
            return;
        }

        // Owner-only commands
        const ownerCommands = ['.mode', '.autostatus', '.antidelete', '.cleartmp', '.setpp', '.clearsession', '.areact', '.autoreact'];
        if (ownerCommands.some(cmd => userMessage.startsWith(cmd)) && !message.key.fromMe) {
            await sock.sendMessage(chatId, { text: '❌ Owner-only command!', ...channelInfo });
            return;
        }

        // Admin-only commands
        const adminCommands = ['.mute', '.unmute', '.ban', '.unban', '.promote', '.demote', '.kick', '.tagall', '.antilink'];
        let isSenderAdmin = false;
        let isBotAdmin = false;
        if (isGroup && adminCommands.some(cmd => userMessage.startsWith(cmd))) {
            const adminStatus = await isAdmin(sock, chatId, senderId, message);
            isSenderAdmin = adminStatus.isSenderAdmin;
            isBotAdmin = adminStatus.isBotAdmin;

            if (!isBotAdmin) {
                await sock.sendMessage(chatId, { text: 'Bot must be admin for this command.', ...channelInfo }, { quoted: message });
                return;
            }
        }

        // Execute command
        for (const cmd in commandMap) {
            if (userMessage.startsWith(cmd)) {
                await commandMap[cmd](sock, chatId, message, rawText);
                await addCommandReaction(sock, message);
                return;
            }
        }

    } catch (error) {
        console.error('❌ Error in handleMessages:', error);
        if (message?.key?.remoteJid) {
            await sock.sendMessage(message.key.remoteJid, { text: '❌ Failed to process your command.', ...channelInfo });
        }
    }
}

async function handleGroupParticipantUpdate(sock, update) {
    try {
        const { id, participants, action, author } = update;
        if (!id.endsWith('@g.us')) return;

        const { handlePromotionEvent, handleDemotionEvent } = require('./commands/promote');

        if (action === 'promote') return await handlePromotionEvent(sock, id, participants, author);
        if (action === 'demote') return await handleDemotionEvent(sock, id, participants, author);

        const data = JSON.parse(fs.readFileSync('./data/userGroupData.json'));

        if (action === 'add' && await require('./lib/index').isWelcomeOn(id)) {
            const groupMetadata = await sock.groupMetadata(id);
            const groupName = groupMetadata.subject;
            const welcomeData = data.welcome[id] || {};
            const welcomeMessage = welcomeData.message || 'Welcome {user} to {group} 🎉';
            const channelId = welcomeData.channelId || '120363161513685998@newsletter';

            for (const participant of participants) {
                const user = participant.split('@')[0];
                const formatted = welcomeMessage.replace('{user}', `@${user}`).replace('{group}', groupName);
                await sock.sendMessage(id, {
                    text: formatted,
                    mentions: [participant],
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: channelId,
                            newsletterName: 'KnightBot MD',
                            serverMessageId: -1
                        }
                    }
                });
            }
        }

        if (action === 'remove' && await require('./lib/index').isGoodByeOn(id)) {
            const groupMetadata = await sock.groupMetadata(id);
            const groupName = groupMetadata.subject;
            const goodbyeData = data.goodbye[id] || {};
            const goodbyeMessage = goodbyeData.message || 'Goodbye {user} 👋';
            const channelId = goodbyeData.channelId || '120363161513685998@newsletter';

            for (const participant of participants) {
                const user = participant.split('@')[0];
                const formatted = goodbyeMessage.replace('{user}', `@${user}`).replace('{group}', groupName);
                await sock.sendMessage(id, {
                    text: formatted,
                    mentions: [participant],
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: channelId,
                            newsletterName: 'KnightBot MD',
                            serverMessageId: -1
                        }
                    }
                });
            }
        }

    } catch (error) {
        console.error('❌ Error in handleGroupParticipantUpdate:', error);
    }
}

module.exports = { handleMessages, handleGroupParticipantUpdate };