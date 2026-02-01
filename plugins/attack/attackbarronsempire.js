const { isMainThread } = require('node:worker_threads')

const name = "Attack Barrons (Great Empire)"
if (isMainThread) {
    const { getPresetOptions } = require('./presets')
    return module.exports = {
        name: name,
        description: "Hits Barrons",
        pluginOptions: [
            {
                type: "Text",
                label: "Com White List",
                description: "Commander range (e.g., 1-3 for commanders 1,2,3)",
                key: "commanderWhiteList"
            },
            { type: "Label", label: "Horse Settings" },
            {
                type: "Checkbox",
                label: "Use Feather",
                description: "Use travel speed boosts",
                key: "useFeather",
                default: false
            },
            {
                type: "Checkbox",
                label: "Use Coin",
                description: "Use fast recruitment",
                key: "useCoin",
                default: false
            },
            {
                type: "Checkbox",
                label: "Use Time Skips",
                description: "Skip travel time",
                key: "useTimeSkips",
                default: false
            },
            { type: "Label", label: "Attack Settings" },
            {
                type: "Checkbox",
                label: "Attack Left Flank",
                description: "Enable attacks on left side",
                key: "attackLeft",
                default: true
            },
            {
                type: "Checkbox",
                label: "Attack Middle",
                description: "Enable attacks on center",
                key: "attackMiddle",
                default: true
            },
            {
                type: "Checkbox",
                label: "Attack Right Flank",
                description: "Enable attacks on right side",
                key: "attackRight",
                default: true
            },
            {
                type: "Checkbox",
                label: "Attack Courtyard",
                description: "Enable courtyard attacks",
                key: "attackCourtyard",
                default: true
            },
            {
                type: "Text",
                label: "Max Waves",
                description: "Maximum number of attack waves",
                key: "attackWaves",
                default: ""
            },
            ...getPresetOptions()
        ]
    }
}
const { botConfig, events } = require("../../ggebot")
const { KingdomID, AreaType } = require('../../protocols.js')
const commonAttack = require('./sharedBarronAttackLogic.js')

const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ??= {}

events.on("load", () => commonAttack(name, AreaType.barron, KingdomID.greatEmpire, pluginOptions))