const { isMainThread } = require('node:worker_threads')

const name = "Attack Beri Camps"

if (isMainThread)
    return module.exports = {
        name: name,
        description: "Hits Beri Camps in Great Empire with full customization",
        pluginOptions: [
            {
                type: "Text",
                label: "Com White List",
                key: "commanderWhiteList"
            },
            { type: "Label", label: "Travel Settings" },
            {
                type: "Checkbox",
                label: "Use Feather (Travel Boost)",
                key: "useFeather",
                default: false
            },
            {
                type: "Checkbox",
                label: "Use Coin (Gold Horse)",
                key: "useCoin",
                default: false
            },
            { type: "Label", label: "Attack Settings" },
            {
                type: "Text",
                label: "Max Waves (1-4)",
                key: "attackWaves",
                default: "4"
            },
            {
                type: "Checkbox",
                label: "Attack Left Flank",
                key: "attackLeft",
                default: true
            },
            {
                type: "Checkbox",
                label: "Attack Middle",
                key: "attackMiddle",
                default: true
            },
            {
                type: "Checkbox",
                label: "Attack Right Flank",
                key: "attackRight",
                default: true
            },
            {
                type: "Checkbox",
                label: "Attack Courtyard",
                key: "attackCourtyard",
                default: true
            },
            { type: "Label", label: "Tool/Chest Settings" },
            {
                type: "Checkbox",
                label: "Lowest value chests first",
                key: "lowValueChests",
                default: false
            },
            {
                type: "Checkbox",
                label: "No event tools",
                key: "noEventTools",
                default: false
            },
            {
                type: "Checkbox",
                label: "Reputation mode",
                key: "reputation",
                default: false
            }
        ]
    }

const { Types, getResourceCastleList, ClientCommands, areaInfoLock, AreaType, spendSkip, KingdomID } = require('../../protocols')
const { waitToAttack, getAttackInfo, assignUnit, getTotalAmountToolsFlank, getTotalAmountToolsFront, getAmountSoldiersFlank, getAmountSoldiersFront, getMaxUnitsInReinforcementWave } = require("./attack")
const { movementEvents, waitForCommanderAvailable, freeCommander, useCommander } = require('../commander')
const { sendXT, waitForResult, xtHandler, events, playerInfo, botConfig } = require('../../ggebot')
const { getCommanderStats } = require('../../getEquipment')
const units = require('../../items/units.json')
const pretty = require('pretty-time')
const getAreaCached = require('../../getmap.js')
const err = require('../../err.json')

const pluginOptions = Object.assign(structuredClone(
    botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}),
    botConfig.plugins["attack"] ?? {})

// UI Seçenekleri (Varsayılanlar)
pluginOptions.attackLeft ??= true
pluginOptions.attackRight ??= true
pluginOptions.attackMiddle ??= true
pluginOptions.attackCourtyard ??= true
const maxWavesInput = parseInt(pluginOptions.attackWaves) || 4

const kid = KingdomID.greatEmpire
const type = AreaType.beriCamp
const minTroopCount = 100
const eventID = 85

const skipTarget = async AI => {
    while (AI.extraData[2] > 0) {
        let skip = spendSkip(AI.extraData[2])
        if (skip == undefined) break
        sendXT("msd", JSON.stringify({ X: AI.x, Y: AI.y, MID: -1, NID: -1, MST: skip, KID: `${kid}` }))
        let [obj, result] = await waitForResult("msd", 7000, (obj, result) => result != 0 || Types.GAAAreaInfo(obj.AI).type == type)
        if (Number(result) != 0) break
        Object.assign(AI, Types.GAAAreaInfo(obj.AI))
    }
}

let quit = false

events.on("eventStop", eventInfo => {
    if (eventInfo.EID != eventID) return
    if(quit) return
    console.log(`[${name}] Event ended.`)
    quit = true
})

events.on("eventStart", async eventInfo => {
    if(eventInfo.EID != eventID) return
    
    quit = false
    while (!quit) {
        let comList = undefined
        if (pluginOptions.commanderWhiteList && ![, "", 0].includes(pluginOptions.commanderWhiteList)) {
            const [start, end] = pluginOptions.commanderWhiteList.split("-").map(Number).map(a => a - 1)
            comList = Array.from({ length: end - start + 1 }, (_, i) => start + i)
        }

        const commander = await waitForCommanderAvailable(comList)
        try {
            const attackInfoResult = await waitToAttack(async () => {
                const sourceCastleArea = (await getResourceCastleList()).castles.find(e => e.kingdomID == kid)
                    .areaInfo.find(e => AreaType.mainCastle == e.type)

                const sourceCastle = (await ClientCommands.getDetailedCastleList()())
                    .castles.find(a => a.kingdomID == kid)
                    .areaInfo.find(a => a.areaID == sourceCastleArea.extraData[0])

                let gaa = await getAreaCached(kid, sourceCastleArea.x - 50, sourceCastleArea.y - 50,
                    sourceCastleArea.x + 50, sourceCastleArea.y + 50)

                let areaInfo = gaa.areaInfo.filter(ai => ai.type == type)
                    .sort((a, b) => Math.sqrt(Math.pow(sourceCastleArea.x - a.x, 2) + Math.pow(sourceCastleArea.y - a.y, 2)) -
                        Math.sqrt(Math.pow(sourceCastleArea.x - b.x, 2) + Math.pow(sourceCastleArea.y - b.y, 2)))
                    .sort((a, b) => a.extraData[2] > b.extraData[2])

                if (areaInfo.length === 0) throw "NO_TARGETS"

                const AI = areaInfo[0]
                await skipTarget(AI)

                const level = 70
                const attackInfo = getAttackInfo(kid, sourceCastleArea, AI, commander, level, maxWavesInput, pluginOptions.useCoin)

                // Tüy (Feather) kullanımı
                if (pluginOptions.useFeather) {
                    attackInfo.PTT = 2;
                }

                const attackerMeleeTroops = []
                const attackerRangeTroops = []
                const attackerWallTools = []
                const attackerShieldTools = []
                const attackerGateTools = []
                const attackerSpecialTools = []

                for (let i = 0; i < sourceCastle.unitInventory.length; i++) {
                    const unit = sourceCastle.unitInventory[i]
                    const unitInfo = units.find(obj => unit.unitID == obj.wodID)
                    if (unitInfo == undefined || unitInfo.wodID == 277) continue

                    if (unitInfo.typ == 'Attack') {
                         if (pluginOptions.noEventTools && unitInfo.pointBonus) continue;
                         if (unitInfo.wallBonus) attackerWallTools.push([unitInfo, unit.ammount])
                         else if (unitInfo.gateBonus) attackerGateTools.push([unitInfo, unit.ammount])
                         else if (unitInfo.defRangeBonus) attackerShieldTools.push([unitInfo, unit.ammount])
                         else attackerSpecialTools.push([unitInfo, unit.ammount])
                    }
                    else if (unitInfo.fightType == 0) {
                        if (unitInfo.role == "melee") attackerMeleeTroops.push([unitInfo, unit.ammount])
                        else if (unitInfo.role == "ranged") attackerRangeTroops.push([unitInfo, unit.ammount])
                    }
                }

                let allTroopCount = attackerRangeTroops.reduce((a,b)=>a+b[1],0) + attackerMeleeTroops.reduce((a,b)=>a+b[1],0)
                if (allTroopCount < minTroopCount) throw "NO_MORE_TROOPS"

                const sortTls = (l) => {
                    l.sort((a,b) => Number(b[0].pointBonus || 0) - Number(a[0].pointBonus || 0))
                    if (pluginOptions.lowValueChests) l.reverse()
                }
                sortTls(attackerWallTools); sortTls(attackerGateTools); sortTls(attackerShieldTools); sortTls(attackerSpecialTools);

                attackerMeleeTroops.sort((a, b) => Number(b[0].meleeAttack) - Number(a[0].meleeAttack))
                attackerRangeTroops.sort((a, b) => Number(b[0].rangeAttack) - Number(a[0].rangeAttack))

                attackInfo.A.forEach((wave, index) => {
                    const maxToolsFlank = getTotalAmountToolsFlank(level, 0)
                    const maxToolsFront = getTotalAmountToolsFront(level)
                    const commanderStats = getCommanderStats(commander)
                    const maxTroopFront = getAmountSoldiersFront(level) * 1 + (commanderStats.relicAttackUnitAmountFront ?? 0) / 100
                    const maxTroopFlank = getAmountSoldiersFlank(level) * 1 + (commanderStats.relicAttackUnitAmountFlank ?? 0) / 100
                    const toolLimit = 10

                    const fillTools = (slots, side) => {
                        let limit = side == 'flank' ? maxToolsFlank : maxToolsFront;
                        slots.forEach((slot, i) => {
                            if (limit <= 0) return;
                            let selected = (side == 'flank') ? (i == 0 ? attackerWallTools : attackerShieldTools) : (i == 0 ? attackerWallTools : (i == 1 ? attackerGateTools : attackerShieldTools));
                            if (selected.length == 0) selected = attackerSpecialTools;
                            limit -= assignUnit(slot, selected, Math.min(limit, toolLimit));
                        })
                    }

                    if (pluginOptions.attackLeft) {
                        let current = maxTroopFlank
                        wave.L.U.forEach(slot => current -= assignUnit(slot, attackerRangeTroops.length ? attackerRangeTroops : attackerMeleeTroops, current))
                        fillTools(wave.L.T, 'flank')
                    }
                    if (pluginOptions.attackRight) {
                        let current = maxTroopFlank
                        wave.R.U.forEach(slot => current -= assignUnit(slot, attackerRangeTroops.length ? attackerRangeTroops : attackerMeleeTroops, current))
                        fillTools(wave.R.T, 'flank')
                    }
                    if (pluginOptions.attackMiddle) {
                        let current = maxTroopFront
                        wave.M.U.forEach(slot => current -= assignUnit(slot, attackerRangeTroops.length ? attackerRangeTroops : attackerMeleeTroops, current))
                        fillTools(wave.M.T, 'front')
                    }
                })

                if (pluginOptions.attackCourtyard) {
                    let maxTroops = getMaxUnitsInReinforcementWave(playerInfo.level, level)
                    attackInfo.RW.forEach((unitSlot, i) => {
                        let attacker = i & 1 ? (attackerMeleeTroops.length > 0 ? attackerMeleeTroops : attackerRangeTroops) : (attackerRangeTroops.length > 0 ? attackerRangeTroops : attackerMeleeTroops)
                        maxTroops -= assignUnit(unitSlot, attacker, Math.floor(maxTroops / 2))
                    })
                }

                await areaInfoLock(() => sendXT("cra", JSON.stringify(attackInfo)))
                let [obj, r] = await waitForResult("cra", 10000)
                return { ...obj, result: r }
            })

            if (attackInfoResult.result != 0) {
                 if(attackInfoResult.result == 256) useCommander(commander.lordID) // LORD_IS_USED
            } else {
                 console.info(`[${name}] Attack sent to ${attackInfoResult.AAM.M.TA[1]}:${attackInfoResult.AAM.M.TA[2]}`)
            }
            freeCommander(commander.lordID)
            await new Promise(r => setTimeout(r, 4000))
        } catch (e) {
            freeCommander(commander.lordID)
            if (e === "NO_MORE_TROOPS") {
                 await new Promise(resolve => movementEvents.once("return", resolve))
            } else {
                 console.error(`[${name}] Error:`, e)
                 await new Promise(r => setTimeout(r, 5000))
            }
        }
    }
})
