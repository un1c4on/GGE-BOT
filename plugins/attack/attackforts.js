const { isMainThread } = require('node:worker_threads')
const { getPresetOptions } = require('./presets')

const name = "Attack Aqua Forts"

if (isMainThread) {
    const presetOptions = getPresetOptions();
    return module.exports = {
        name: name,
        pluginOptions: [
            {
                type: "Select",
                label: "Max Waves",
                description: "Maximum number of attack waves",
                key: "maxWaves",
                selection: [
                    "1 Wave",
                    "2 Waves",
                    "3 Waves",
                    "4 Waves"
                ],
                default: 0
            },
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
                label: "Easy forts only",
                description: "Only attack easy difficulty forts",
                key: "easyfortsonly",
                default: false
            },
            {
                type: "Checkbox",
                label: "Add worser forts",
                description: "Include lower level forts in rotation",
                key: "addworserforts",
                default: false
            },
            {
                type: "Checkbox",
                label: "Buy Coins",
                description: "Auto-purchase coins with aqua",
                key: "buycoins",
                default: false
            },
            {
                type: "Checkbox",
                label: "Buy Deco",
                description: "Auto-purchase decorations with aqua",
                key: "buydeco",
                default: false
            },
            ...presetOptions
        ]
    }
}

const { getCommanderStats } = require("../../getEquipment")
const { Types, getResourceCastleList, ClientCommands, areaInfoLock, AreaType, KingdomID } = require('../../protocols')
const { waitToAttack, getAttackInfo, assignUnit, getAmountSoldiersFlank, sleep, boxMullerRandom } = require("./attack")
const { movementEvents, waitForCommanderAvailable, freeCommander, useCommander } = require("../commander")
const { sendXT, waitForResult, xtHandler, botConfig, events } = require("../../ggebot")
const { applyPreset } = require("../../plugins/attack/presets")
const getAreaCached = require('../../getmap.js')
const err = require("../../err.json")
const units = require("../../items/units.json")
const pretty = require('pretty-time')

const minTroopCount = 100

function spiralCoordinates(n) {
    if (n === 0) return { x: 0, y: 0 }

    const k = Math.ceil((Math.sqrt(n + 1) - 1) / 2)
    const layerStart = (2 * (k - 1) + 1) ** 2
    const offset = n - layerStart
    const sideLength = 2 * k
    const side = Math.floor(offset / sideLength)
    const posInSide = offset % sideLength

    let x, y

    switch (side) {
        case 0:
            x = k
            y = -k + 1 + posInSide
            break
        case 1:
            x = k - 1 - posInSide
            y = k
            break
        case 2:
            x = -k
            y = k - 1 - posInSide
            break
        case 3:
            x = -k + 1 + posInSide
            y = -k
            break
    }

    return { x, y }
}

const pluginOptions =
    botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}

pluginOptions.useGamePreset ??= false;
pluginOptions.presetID ??= "0";
// Default to 1 wave (index 0) if not set
pluginOptions.maxWaves = pluginOptions.maxWaves !== undefined ? Number(pluginOptions.maxWaves) : 0;

const kid = KingdomID.stormIslands
const type = AreaType.stormTower

events.once("load", async () => {
    let allowedLevels = [
        9,
        8,
        7,
        14,
        13,
        12,
    ]

    const sourceCastleArea = (await getResourceCastleList()).castles.find(e => e.kingdomID == kid)
        .areaInfo.find(e => e.type == AreaType.externalKingdom);

    xtHandler.on("dcl", obj => {
        const castleProd = Types.DetailedCastleList(obj)
            .castles.find(a => a.kingdomID == kid)
            .areaInfo.find(a => a.areaID == sourceCastleArea.extraData[0])

        if (pluginOptions["buycoins"]) {
            if (castleProd.aqua > 500000) {
                castleProd.aqua -= 500000
                sendXT("sbp", JSON.stringify({ "PID": 2798, "BT": 3, "TID": -1, "AMT": 1, "KID": 4, "AID": -1, "PC2": -1, "BA": 0, "PWR": 0, "_PO": -1 }))
                console.info(`[${name}] Buying Coins`)
            }
        }
        if (pluginOptions["buydeco"]) {
            if (castleProd.aqua > 500000) {
                castleProd.aqua -= 500000
                sendXT("sbp", JSON.stringify({ "PID": 3117, "BT": 3, "TID": -1, "AMT": 1, "KID": 4, "AID": -1, "PC2": -1, "BA": 0, "PWR": 0, "_PO": -1 }))
                console.info(`[${name}] Buying Deco`)
            }
        }
    })
    if (pluginOptions["easyfortsonly"])
        allowedLevels = [9, 8, 7]

    if (pluginOptions["addworserforts"])
        allowedLevels.push(11, 10)

    let towerTime = new WeakMap()
    let sortedAreaInfo = []
    const movements = []

    xtHandler.on("gam", obj => {
        const movementsGAA = Types.GetAllMovements(obj)
        movementsGAA?.movements.forEach(movement => {
            if (kid != movement.movement.kingdomID)
                return

            const targetAttack = movement.movement.targetAttack

            if (type != targetAttack.type)
                return

            if (movements.find(e => e.x == targetAttack.x && e.y == targetAttack.y))
                return

            movements.push(targetAttack)
        })
    })
    movementEvents.on("return", movementInfo => {
        const sourceAttack = movementInfo.movement.movement.sourceAttack
        if (kid != movementInfo.movement.movement.kingdomID ||
            type != sourceAttack.type)
            return

        let index = movements.findIndex(e => e.x == sourceAttack.x && e.y == sourceAttack)
        if (index == -1)
            return
        movements.splice(index, 1)
    })

    const sendHit = async () => {
        let comList = undefined
        if (![, ""].includes(pluginOptions.commanderWhiteList)) {
            const [start, end] = pluginOptions.commanderWhiteList.split("-").map(Number).map(a => a - 1);
            comList = Array.from({ length: end - start + 1 }, (_, i) => start + i)
        }

        const commander = await waitForCommanderAvailable(comList, undefined,
            (a, b) => getCommanderStats(b).relicLootBonus - getCommanderStats(a).relicLootBonus)

        try {
            const attackInfo = await waitToAttack(async () => {
                const executionStartTime = Date.now();

                // Human-like hesitation (2-3 seconds)
                await sleep(boxMullerRandom(2000, 3000, 1));

                const sourceCastle = (await ClientCommands.getDetailedCastleList()())
                    .castles.find(a => a.kingdomID == kid)
                    .areaInfo.find(a => a.areaID == sourceCastleArea.extraData[0])
                let index = -1
                const timeSinceEpoch = Date.now()
                for (let i = 0; i < sortedAreaInfo.length; i++) {
                    const areaInfo = sortedAreaInfo[i]

                    if (movements.find(e => e.x == areaInfo.x && e.y == areaInfo.y))
                        continue

                    let time = towerTime.get(areaInfo) - timeSinceEpoch
                    if (time > 0)
                        continue

                    Object.assign(areaInfo,
                        (await ClientCommands.getAreaInfo(kid, areaInfo.x, areaInfo.y, areaInfo.x, areaInfo.y)())
                            .areaInfo[0])

                    if (!allowedLevels.includes(areaInfo.extraData[2])) {
                        continue
                    }

                    towerTime.set(areaInfo, timeSinceEpoch + areaInfo.extraData[5] * 1000)
                    if (areaInfo.extraData[3] > 0)
                        continue
                    if (towerTime.get(areaInfo) - Date.now() > 0)
                        continue

                    index = i
                    break
                }
                if (index == -1)
                    return

                let AI = sortedAreaInfo.splice(index, 1)[0]

                let toLevel = {
                    7: 60,
                    8: 70,
                    9: 80,
                    10: 40,
                    11: 50,
                    12: 60,
                    13: 70,
                    14: 80,
                }
                const level = toLevel[AI.extraData[2]]

                // maxWaves: 0 -> 1 wave, 1 -> 2 waves, etc.
                const maxWaves = pluginOptions.maxWaves + 1;
                const attackInfo = getAttackInfo(kid, sourceCastleArea, AI, commander, level, maxWaves, pluginOptions.useCoin)

                attackInfo.LP = 3

                // --- PRESET LOGIC ---
                if (pluginOptions.useGamePreset) {
                    const presetResult = applyPreset(attackInfo, pluginOptions.presetID, maxWaves);
                    if (!presetResult.success) {
                        console.warn(`[${name}] Preset Error: ${presetResult.error}`);
                        throw "PRESET_ERROR: " + presetResult.error;
                    }
                    console.log(`[${name}] Game Preset Applied (ID: ${pluginOptions.presetID}, Waves: ${maxWaves})`);
                } else {
                    const attackerMeleeTroops = []
                    const attackerRangeTroops = []

                    for (let i = 0; i < sourceCastle.unitInventory.length; i++) {
                        const unit = sourceCastle.unitInventory[i]
                        const unitInfo = units.find(obj => unit.unitID == obj.wodID)
                        if (unitInfo == undefined)
                            continue

                        if (unitInfo.fightType == 0) {
                            if (unitInfo.role == "melee")
                                attackerMeleeTroops.push([unitInfo, unit.ammount])
                            else if (unitInfo.role == "ranged")
                                attackerRangeTroops.push([unitInfo, unit.ammount])
                        }
                    }

                    let allTroopCount = 0

                    attackerRangeTroops.forEach(e => allTroopCount += e[1])
                    attackerMeleeTroops.forEach(e => allTroopCount += e[1])

                    if (allTroopCount < minTroopCount)
                        throw "NO_MORE_TROOPS"

                    attackInfo.A.forEach((wave, i) => {
                        // Seçilen dalga sayısını geçme
                        if (i >= maxWaves)
                            return
                        const commanderStats = getCommanderStats(commander)
                        const maxTroopFlank = getAmountSoldiersFlank(level) * 1 + (commanderStats.relicAttackUnitAmountFlank ?? 0) / 100

                        let maxTroops = maxTroopFlank

                        wave.L.U.forEach((unitSlot, i) =>
                            maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                                attackerRangeTroops : attackerMeleeTroops, maxTroops))
                        maxTroops = maxTroopFlank
                        wave.R.U.forEach((unitSlot, i) =>
                            maxTroops -= assignUnit(unitSlot, attackerMeleeTroops.length <= 0 ?
                                attackerRangeTroops : attackerMeleeTroops, maxTroops))
                    })
                }

                await areaInfoLock(() => sendXT("cra", JSON.stringify(attackInfo)))

                let [obj, r] = await waitForResult("cra", 1000 * 10, (obj, result) => {
                    if (result != 0)
                        return true

                    if (obj.AAM.M.KID != kid || obj.AAM.M.TA[1] != AI.x || obj.AAM.M.TA[2] != AI.y)
                        return false
                    return true
                })

                const executionDuration = ((Date.now() - executionStartTime) / 1000).toFixed(2);
                return { ...obj, result: r, executionDuration }
            })

            if (!attackInfo) {
                freeCommander(commander.lordID)
                return false
            }
            if (attackInfo.result != 0)
                throw err[attackInfo.result]

            console.info(`[${name}] Hitting target C${attackInfo.AAM.UM.L.VIS + 1} ${attackInfo.AAM.M.TA[1]}:${attackInfo.AAM.M.TA[2]} ${pretty(Math.round(1000000000 * Math.abs(Math.max(0, attackInfo.AAM.M.TT - attackInfo.AAM.M.PT))), 's') + " till impact"} (Setup: ${attackInfo.executionDuration}s)`)
            return true
        } catch (e) {
            freeCommander(commander.lordID)
            switch (e) {
                case "NO_MORE_TROOPS":
                    await new Promise(resolve => movementEvents.on("return", function self(movementInfo) {
                        if (movementInfo.movement.movement.kingdomID != kid)
                            return
                        if (movementInfo.movement.movement.targetAttack.extraData[0] != sourceCastleArea.extraData[0])
                            return

                        movementEvents.off("return", self)
                        resolve()
                    }))
                    return true
                case "LORD_IS_USED":
                    useCommander(commander.lordID)
                case "COOLING_DOWN":
                case "TIMED_OUT":
                case "CANT_START_NEW_ARMIES":
                    return true
                default:
                    throw e
            }
        }
    }
    // ... Spiral döngüsü aynı kaldı ...
    done:
    for (let i = 0, j = 0; i < 13 * 13; i++) {
        let rX, rY
        let rect
        do {

            ({ x: rX, y: rY } = spiralCoordinates(j++))
            rX *= 100
            rY *= 100

            rect = {
                x: sourceCastleArea.x + rX - 50,
                y: sourceCastleArea.y + rY - 50,
                w: sourceCastleArea.x + rX + 50,
                h: sourceCastleArea.y + rY + 50
            }
            if (j > Math.pow(13 * 13, 2))
                break done
        } while ((sourceCastleArea.x + rX) <= -50 || (sourceCastleArea.y + rY) <= -50 || (sourceCastleArea.x + rX) >= (1286 + 50) || (sourceCastleArea.y + rY) >= (1286 + 50))
        rect.x = rect.x < 0 ? 0 : rect.x
        rect.y = rect.y < 0 ? 0 : rect.y
        rect.w = rect.w < 0 ? 0 : rect.w
        rect.h = rect.h < 0 ? 0 : rect.h
        rect.x = rect.x > 1286 ? 1286 : rect.x
        rect.y = rect.y > 1286 ? 1286 : rect.y
        rect.w = rect.w > 1286 ? 1286 : rect.w
        rect.h = rect.h > 1286 ? 1286 : rect.h
        let gaa = await getAreaCached(kid, rect.x, rect.y, rect.w, rect.h)

        let areaInfo = gaa.areaInfo.filter(ai => ai.type == type)
            .sort((a, b) => {
                let d1 = Math.sqrt(Math.pow(sourceCastleArea.x - a.x, 2) + Math.pow(sourceCastleArea.y - a.y, 2))
                let d2 = Math.sqrt(Math.pow(sourceCastleArea.x - b.x, 2) + Math.pow(sourceCastleArea.y - b.y, 2))
                if (d1 < d2)
                    return -1
                if (d1 > d2)
                    return 1
            })
        const timeSinceEpoch = Date.now()
        areaInfo.forEach(ai =>
            towerTime.set(ai, timeSinceEpoch + ai.extraData[5] * 1000))

        sortedAreaInfo = sortedAreaInfo.concat(areaInfo)
        sortedAreaInfo.sort((a, b) => {
            if ((a.extraData[2] % 10) > (b.extraData[2] % 10))
                return -1
            if ((a.extraData[2] % 10) < (b.extraData[2] % 10))
                return 1
            //hits left
            if (a.extraData[4] < b.extraData[4])
                return -1
            if (a.extraData[4] > b.extraData[4])
                return 1

            return 0
        })
        while (await sendHit());
    }

    while (true) {
        let minimumTimeTillHit = Infinity

        for (let i = 0; i < sortedAreaInfo.length; i++) {
            const areaInfo = sortedAreaInfo[i]

            if (!allowedLevels.includes(areaInfo.extraData[2]))
                if ((towerTime.get(areaInfo) - Date.now()) <= 0)
                    continue

            if (!movements.find(movement => movement.x == areaInfo.x && movement.y == areaInfo.y))
                minimumTimeTillHit = Math.min(minimumTimeTillHit, towerTime.get(areaInfo))
        }

        let time = (Math.max(0, minimumTimeTillHit - Date.now()))
        console.info(`[${name}] Waiting ${Math.round(time / 1000)} for next possible fortress hit`)
        await new Promise(r => setTimeout(r, time).unref())

        while (await sendHit());
    }
})