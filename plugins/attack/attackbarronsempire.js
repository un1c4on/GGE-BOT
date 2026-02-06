const { isMainThread } = require('node:worker_threads')

const name = "Attack Barrons (Great Empire)"
if (isMainThread) {
    const { getPresetOptions } = require('./presets')
    return module.exports = {
        name: name,
        description: "Hits Barrons",
        pluginOptions: [
            // ═══════════════════════════════════════
            // KOMUTAN AYARLARI
            // ═══════════════════════════════════════
            { type: "Label", label: "⚔️ Komutan Ayarları" },
            {
                type: "Text",
                label: "Komutan Listesi",
                description: "Kullanılacak komutan aralığı (örn: 1-3)",
                key: "commanderWhiteList"
            },

            // ═══════════════════════════════════════
            // SALDIRI POZİSYONLARI
            // ═══════════════════════════════════════
            { type: "Label", label: "🎯 Saldırı Pozisyonları" },
            {
                type: "Checkbox",
                label: "Sol Kanat",
                description: "Sol kanattan saldırı yap",
                key: "attackLeft",
                default: true
            },
            {
                type: "Text",
                label: "Sol Max Asker",
                description: "Sol kanat maksimum asker (0 = limitsiz)",
                key: "maxTroopsLeft",
                default: "0"
            },
            {
                type: "Checkbox",
                label: "Orta Cephe",
                description: "Ortadan saldırı yap",
                key: "attackMiddle",
                default: true
            },
            {
                type: "Text",
                label: "Orta Max Asker",
                description: "Orta cephe maksimum asker (0 = limitsiz)",
                key: "maxTroopsMiddle",
                default: "0"
            },
            {
                type: "Checkbox",
                label: "Sağ Kanat",
                description: "Sağ kanattan saldırı yap",
                key: "attackRight",
                default: true
            },
            {
                type: "Text",
                label: "Sağ Max Asker",
                description: "Sağ kanat maksimum asker (0 = limitsiz)",
                key: "maxTroopsRight",
                default: "0"
            },
            {
                type: "Checkbox",
                label: "Avlu Takviyesi",
                description: "Avluya takviye askeri gönder",
                key: "attackCourtyard",
                default: true
            },
            {
                type: "Text",
                label: "Avlu Max Asker",
                description: "Avlu maksimum asker (0 = limitsiz)",
                key: "maxTroopsCourtyard",
                default: "0"
            },

            // ═══════════════════════════════════════
            // ÖN AYAR (PRESET)
            // ═══════════════════════════════════════
            ...getPresetOptions(),

            // ═══════════════════════════════════════
            // SÜREGEÇ AYARLARI
            // ═══════════════════════════════════════
            { type: "Label", label: "⏱️ Süregeç Ayarları" },
            {
                type: "Checkbox",
                label: "Süregeç Kullan",
                description: "Seyahat bekleme süresini atla",
                key: "useTimeSkips",
                default: false
            },

            // ═══════════════════════════════════════
            // AT AYARLARI
            // ═══════════════════════════════════════
            { type: "Label", label: "🐴 At Ayarları" },
            {
                type: "Checkbox",
                label: "Tüy Kullan",
                description: "Seyahat hızı artırıcısı kullan",
                key: "useFeather",
                default: false
            },
            {
                type: "Checkbox",
                label: "Altın Kullan",
                description: "Hızlı asker toplanması için altın at kullan",
                key: "useCoin",
                default: false
            }
        ]
    }
}
const { botConfig, events } = require("../../ggebot")
const { KingdomID, AreaType } = require('../../protocols.js')
const commonAttack = require('./sharedBarronAttackLogic.js')

const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ??= {}

events.on("load", () => commonAttack(name, AreaType.barron, KingdomID.greatEmpire, pluginOptions))