const { isMainThread } = require('node:worker_threads')

const name = "Attack Fortress (Burning Sands)"

if (isMainThread) {
    const { getPresetOptions } = require('./presets')
    return module.exports = {
        name: name,
        description: "Hits fortresses",
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
            ...getPresetOptions()
        ]
    }
}

const { AreaType, KingdomID } = require('../../protocols')
const { botConfig, events } = require('../../ggebot.js')
const fortressHit = require('./sharedFortressAttackLogic.js')

const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}
const kid = KingdomID.burningSands
const level = 44

events.on("load", () =>
    fortressHit(name, kid, level, pluginOptions))