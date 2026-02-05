/**
 * GGE-BOT Logger Module
 * Renkli log sistemi + spam onleme
 */

// ANSI Renk Kodlari
const Colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',   // INFO
    yellow: '\x1b[33m',  // WARN
    red: '\x1b[31m',     // ERROR
    cyan: '\x1b[36m',    // Timestamp
    dim: '\x1b[2m'
}

// Log seviyeleri
const LogLevel = {
    INFO: 0,
    WARN: 1,
    ERROR: 2
}

// Spam onleme icin son mesaj takibi
let lastWarnMessage = null
let lastWarnTime = 0

/**
 * Renkli log mesaji formatla
 * @param {string} msg - Mesaj
 * @param {number} level - Log seviyesi (0=INFO, 1=WARN, 2=ERROR)
 * @param {string} botName - Bot ismi
 * @returns {string} Formatli mesaj
 */
function formatColoredLog(msg, level, botName) {
    let color
    let prefix

    switch (level) {
        case LogLevel.ERROR:
            color = Colors.red
            prefix = '🛑'
            break
        case LogLevel.WARN:
            color = Colors.yellow
            prefix = '⚠️'
            break
        case LogLevel.INFO:
        default:
            color = Colors.green
            prefix = '✅'
            break
    }

    return `${color}[${botName}] ${prefix} ${msg}${Colors.reset}`
}

/**
 * Spam kontrolu - ayni WARN mesaji tekrar gelirse bastir
 * @param {string} msg - Mesaj
 * @param {number} level - Log seviyesi
 * @returns {boolean} true = logla, false = bastir
 */
function shouldLog(msg, level) {
    // ERROR ve INFO her zaman loglanir
    if (level !== LogLevel.WARN) {
        return true
    }

    // WARN icin spam kontrolu
    const now = Date.now()

    // Ayni mesaj 60 saniye icinde tekrar geldiyse bastir
    if (lastWarnMessage === msg && (now - lastWarnTime) < 60000) {
        return false
    }

    // Yeni mesaj veya sure doldu - guncelle ve logla
    lastWarnMessage = msg
    lastWarnTime = now
    return true
}

/**
 * Spam sayacini sifirla (asker bulundu vs. durumlarinda)
 */
function resetWarnSpam() {
    lastWarnMessage = null
    lastWarnTime = 0
}

module.exports = {
    Colors,
    LogLevel,
    formatColoredLog,
    shouldLog,
    resetWarnSpam
}
