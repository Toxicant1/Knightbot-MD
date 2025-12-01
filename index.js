/**
 * UNKNOWN BOT - A WhatsApp Bot
 * Copyright (c) 2025 Ishaq Ibrahim
 * 
 * This program is free software under the MIT License.
 * Credits:
 * - Baileys Library by @adiwajshing
 * - Pair Code implementation inspired by TechGod143 & DGXEON
 */

require('./settings')
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const chalk = require('chalk')
const path = require('path')
const axios = require('axios')
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main')
const PhoneNumber = require('awesome-phonenumber')
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif')
const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetch, await, sleep, reSize } = require('./lib/myfunc')
const { 
    default: makeWASocket,
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    generateForwardMessageContent,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    generateMessageID,
    downloadContentFromMessage,
    jidDecode,
    proto,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    delay
} = require("@whiskeysockets/baileys")
const NodeCache = require("node-cache")
const pino = require("pino")
const readline = require("readline")

// ======== GLOBALS ========
global.botname = "UNKNOWN BOT"
global.themeemoji = "•"
let phoneNumber = "254741819582"
let owner = JSON.parse(fs.readFileSync('./data/owner.json'))

const settings = require('./settings')
const pairingCode = !!phoneNumber || process.argv.includes("--pairing-code")
const useMobile = process.argv.includes("--mobile")

// ======= Readline for interactive pairing if needed =======
const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
const question = (text) => rl ? new Promise(resolve => rl.question(text, resolve)) : Promise.resolve(settings.ownerNumber || phoneNumber)

// ======= Store for caching messages, contacts, and chats =======
const store = {
    messages: {},
    contacts: {},
    chats: {},
    groupMetadata: async (jid) => ({}),
    bind(ev) {
        ev.on('messages.upsert', ({ messages }) => {
            messages.forEach(msg => {
                if (msg.key && msg.key.remoteJid) {
                    this.messages[msg.key.remoteJid] = this.messages[msg.key.remoteJid] || {}
                    this.messages[msg.key.remoteJid][msg.key.id] = msg
                }
            })
        })
        ev.on('contacts.update', contacts => {
            contacts.forEach(contact => {
                if (contact.id) this.contacts[contact.id] = contact
            })
        })
        ev.on('chats.set', chats => this.chats = chats)
    },
    loadMessage: async (jid, id) => this.messages[jid]?.[id] || null
}

// ======= Start Bot =======
async function startUnknownBot() {
    const { version } = await fetchLatestBaileysVersion()
    const msgRetryCounterCache = new NodeCache()
    const { state, saveCreds } = await useMultiFileAuthState('./session')

    const UnknownBot = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: !pairingCode,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" }))
        },
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        getMessage: async key => (await store.loadMessage(jidNormalizedUser(key.remoteJid), key.id))?.message || "",
        msgRetryCounterCache
    })

    store.bind(UnknownBot.ev)

    // ===== Message Handler =====
    UnknownBot.ev.on('messages.upsert', async chatUpdate => {
        try {
            const mek = chatUpdate.messages[0]
            if (!mek.message) return
            mek.message = Object.keys(mek.message)[0] === 'ephemeralMessage' ? mek.message.ephemeralMessage.message : mek.message
            if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                await handleStatus(UnknownBot, chatUpdate)
                return
            }
            await handleMessages(UnknownBot, chatUpdate, true)
        } catch (err) {
            console.error("Error in messages.upsert:", err)
        }
    })

    // ===== Decode JID & Get Name =====
    UnknownBot.decodeJid = jid => {
        if (!jid) return jid
        if (/:\d+@/gi.test(jid)) {
            let decode = jidDecode(jid) || {}
            return decode.user && decode.server ? decode.user + '@' + decode.server : jid
        } else return jid
    }

    UnknownBot.getName = async (jid, withoutContact = false) => {
        let id = UnknownBot.decodeJid(jid)
        if (id.endsWith("@g.us")) {
            let meta = store.contacts[id] || await UnknownBot.groupMetadata(id) || {}
            return meta.name || meta.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international')
        }
        let v = store.contacts[id] || {}
        return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international')
    }

    UnknownBot.public = true
    UnknownBot.serializeM = m => smsg(UnknownBot, m, store)

    // ===== Pairing Code Handling =====
    if (pairingCode && !UnknownBot.authState.creds.registered) {
        if (useMobile) throw new Error('Cannot use pairing code with mobile api')
        let phone = global.phoneNumber || await question(chalk.greenBright(`Enter your WhatsApp number (no + or spaces): `))
        phone = phone.replace(/[^0-9]/g, '')
        if (!PhoneNumber('+' + phone).isValid()) {
            console.log(chalk.red('Invalid phone number!'))
            process.exit(1)
        }
        setTimeout(async () => {
            try {
                let code = await UnknownBot.requestPairingCode(phone)
                code = code?.match(/.{1,4}/g)?.join("-") || code
                console.log(chalk.bgGreen(`Your Pairing Code: ${code}`))
            } catch (error) {
                console.error('Failed to request pairing code:', error)
            }
        }, 2000)
    }

    // ===== Connection Events =====
    UnknownBot.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update
        if (connection === "open") {
            console.log(chalk.greenBright(`🤖 UNKNOWN BOT Connected Successfully!`))
            console.log(chalk.blueBright(`Owner: ${owner}`))
        }
        if (connection === "close" && lastDisconnect?.error?.output?.statusCode !== 401) {
            startUnknownBot()
        }
    })

    UnknownBot.ev.on('creds.update', saveCreds)
    UnknownBot.ev.on('group-participants.update', async update => await handleGroupParticipantUpdate(UnknownBot, update))

    return UnknownBot
}

// ===== Start the bot =====
startUnknownBot().catch(err => {
    console.error('Fatal Error:', err)
    process.exit(1)
})

// ===== Hot Reload =====
let file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log(chalk.redBright(`Reloading ${__filename}...`))
    delete require.cache[file]
    require(file)
})