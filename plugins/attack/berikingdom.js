const { isMainThread } = require('node:worker_threads')

const name = "Attack Berimond Kingdom"

if (isMainThread)
    return module.exports = {
        name: name,
        description: "Hits khan camps (NOT RESPONSIBLE)",
        pluginOptions: [
            {
                type: "Text",
                label: "Com White List",
                key: "commanderWhiteList"
            },
            {
                type: "Checkbox",
                label: "Lowest value chests first",
                key: "lowValueChests",
                default: false
            },
            {
                type: "Checkbox",
                label: "Use Coin",
                key: "useCoin",
                default: false
            },
            {
                type: "Checkbox",
                label: "Buy Tools",
                key: "buyTools",
                default: true
            },
            {
                type: "Checkbox",
                label: "Send Troops over",
                key: "sendTroopsOver",
                default: true
            },
            {
                type: "Checkbox",
                label: "No Event Tools",
                key: "noEventTools",
                default: false
            }
        ]
    }

const { Types, getResourceCastleList, ClientCommands, areaInfoLock, AreaType, KingdomID, getKingdomInfoList, KingdomSkipType, spendSkip } = require('../../protocols')
const { waitToAttack, getAttackInfo, assignUnit, getTotalAmountToolsFlank, getTotalAmountToolsFront, getAmountSoldiersFlank } = require("../../plugins/attack/attack")
const { movementEvents, waitForCommanderAvailable, useCommander, freeCommander } = require("../../plugins/commander")
const { sendXT, waitForResult, xtHandler, events, botConfig } = require("../../ggebot")
const err = require('../../err.json')
const units = require("../../items/units.json")
const pretty = require('pretty-time')

const pluginOptions = Object.assign(structuredClone(
    botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}),
    botConfig.plugins["attack"] ?? {})

const kid = KingdomID.berimond
const type = AreaType.watchTower
const level = 60
const minTroopCount = 32
const eventID = 3

xtHandler.on("dcl", obj => {
    const castleProd = Types.DetailedCastleList(obj)
        .castles?.find(a => a.kingdomID == kid)?.areaInfo?.find(a => a.areaID == sourceCastleArea.extraData[0])
    if(!castleProd)
        return
    if (0 &&
        castleProd.wood &&
        castleProd.stone) {
        // castleProd.getProductionData.buildSpeedBoost
        // sendXT("eup", JSON.stringify({OID:24, PWR:0, PO:-1}))
        // sendXT("msb", JSON.stringify({OID:24, MST:MS4})
    }
    // castleProd.getProductionData.maxAuxilariesTroops
    // castleProd.unitInventory.forEach(e => {

    // })
    //How many we got?
})
let quit = false
events.on("eventStop", eventInfo => {
    if (eventInfo.EID != eventID)
        return
    
    if(quit)
        return

    console.log(`[${name}] Shutting down reason: Event ended.`)
    quit = true
})
events.on("eventStart", async eventInfo => {
    if(eventInfo.EID != eventID)
        return
    
    const kingdomInfoList = await getKingdomInfoList()
    const resourceCastleList = await getResourceCastleList()
    const mainCastleAreaID = Number(resourceCastleList.castles.find(e => e.kingdomID == KingdomID.greatEmpire)
        .areaInfo.find(e => e.type == AreaType.mainCastle)
        .extraData[0])

    if (!kingdomInfoList.unlockInfo.find(e => e.kingdomID == KingdomID.berimond)?.isUnlocked) {
        //W:10k S:10k main

        const dcl = await ClientCommands.getDetailedCastleList()()
        const mainCastleResources = dcl.castles.find(e => e.kingdomID == KingdomID.greatEmpire)
            .areaInfo.find(e => e.areaID == mainCastleAreaID)

        if (mainCastleResources.wood < 9000 || mainCastleResources.stone < 9000)
            return console.warn("Could not open berimond need 10k stone/wood!")

        sendXT("fsc", JSON.stringify({ ID: 2, PWR: 0, OC2: 0, SID: 10 }))
        await waitForResult("fjf", 1000 * 10)
    }
    else if(pluginOptions.sendTroopsOver) {
        let remainingTime = kingdomInfoList.troopTransferList.find(e =>
            e.kingdomID == KingdomID.berimond)?.remainingTime

        while (remainingTime) {
            remainingTime = (await ClientCommands.getMinuteSkipKingdom(spendSkip(remainingTime), kid, KingdomSkipType.sendTroops)())
                .troopTransferList.find(e => e.kingdomID == KingdomID.berimond)?.remainingTime
        }
    }

    const sourceCastleArea = (await getResourceCastleList()).castles.find(e => e.kingdomID == kid)
        .areaInfo.find(e => e.type == AreaType.beriCastle);

    quit = false
    while (!quit) {
        let comList = undefined
        if (![, "", 0].includes(pluginOptions.commanderWhiteList)) {
            const [start, end] = pluginOptions.commanderWhiteList.split("-").map(Number).map(a => a - 1);
            comList = Array.from({ length: end - start + 1 }, (_, i) => start + i);
        }

        const commander = await waitForCommanderAvailable(comList, 
            commander =>
                !((commander.EQ[3] ?? [])[5]?.every(([id, _]) => id == 121 ? false : true)) ?? true)
        try {
            const attackInfo = await waitToAttack(async () => {
                const sourceCastle = (await ClientCommands.getDetailedCastleList()())
                    .castles.find(a => a.kingdomID == kid)
                    .areaInfo.find(a => a.areaID == sourceCastleArea.extraData[0])

                sendXT("fnm", JSON.stringify({ T: type, KID: kid, LMIN: -1, LMAX: -1, NID: -801 }))

                const AI = (await waitForResult("fnm", 8500, (obj, result) => {
                    if (result != 0)
                        return false

                    if (obj.gaa.KID != kid)
                        return false

                    if (obj.gaa.AI[0][0] != type)
                        return false

                    return true
                }))[0].gaa.AI[0];

                const attackInfo = getAttackInfo(kid, sourceCastleArea, Types.GAAAreaInfo(AI), commander, level, undefined, pluginOptions.useCoin)

                const attackerMeleeTroops = []
                const attackerRangeTroops = []
                const attackerBerimondTools = []
                const attackerWallBerimondTools = []
                const attackerGateBerimondTools = []
                const attackerShieldBerimondTools = []
                const attackerBannerKhanTools = []

                const attackerWallTools = []
                const attackerShieldTools = []

                for (let i = 0; i < sourceCastle.unitInventory.length; i++) {
                    const unit = sourceCastle.unitInventory[i];
                    const unitInfo = units.find(obj => unit.unitID == obj.wodID)
                    if (unitInfo == undefined)
                        continue
                    if(unitInfo.wodID == 277)
                        continue

                    else if (unitInfo.pointBonus != undefined && !pluginOptions.noEventTools) {
                        if (unitInfo.gateBonus)
                            attackerGateBerimondTools.push([unitInfo, unit.ammount])
                        else if (unitInfo.wallBonus)
                            attackerWallBerimondTools.push([unitInfo, unit.ammount])
                        else if (unitInfo.defRangeBonus)
                            attackerShieldBerimondTools.push([unitInfo, unit.ammount])
                        else
                            attackerBerimondTools.push([unitInfo, unit.ammount])
                    }
                    else if (unitInfo.pointBonus == undefined && 
                        unitInfo.toolCategory &&
                    unitInfo.usageEventID  == undefined &&
                    unitInfo.allowedToAttack  == undefined &&
                    unitInfo.typ == 'Attack' &&
                    unitInfo.amountPerWave == undefined
                    ) {
                        if (unitInfo.wallBonus)
                            attackerWallTools.push([unitInfo, unit.ammount])
                        else if (unitInfo.defRangeBonus)
                            attackerShieldTools.push([unitInfo, unit.ammount])
                    }
                    else if (unitInfo.fightType == 0) {
                        if (unitInfo.role == "melee")
                            attackerMeleeTroops.push([unitInfo, unit.ammount])
                        else if (unitInfo.role == "ranged")
                            attackerRangeTroops.push([unitInfo, unit.ammount])
                    }
                }

                let allTroopCount = 0

                attackerRangeTroops.forEach(e => allTroopCount += e[1])
                attackerMeleeTroops.forEach(e => allTroopCount += e[1])

                if (allTroopCount < minTroopCount) {
                    if(!pluginOptions.sendTroopsOver)
                        throw "NO_MORE_TROOPS"

                    sendXT("fuc", JSON.stringify({CID: sourceCastleArea.extraData[0]}))
                    let troopSendLimit = (await waitForResult("fuc", 1000 * 10))[0].FUC
                    if (troopSendLimit > 80) {
                        const detailedCastleList = await ClientCommands.getDetailedCastleList()()

                        const dcl = await ClientCommands.getDetailedCastleList()()
                        const mainCastleResources = dcl.castles.find(e => e.kingdomID == KingdomID.greatEmpire)
                            .areaInfo.find(e => e.areaID == mainCastleAreaID)
                        detailedCastleList.castles.find(e => e.kingdomID == KingdomID.greatEmpire).areaInfo
                            .find(e => e.areaInfo)

                        let attackerMeleeTroops = []
                        let attackerRangeTroops = []
                        for (let i = 0; i < mainCastleResources.unitInventory.length; i++) {
                            const unit = mainCastleResources.unitInventory[i];
                            const unitInfo = units.find(obj => unit.unitID == obj.wodID)
                            if (unitInfo == undefined)
                                continue

                            if (unitInfo.fightType == 0 && 
                                unitInfo.meadSupply == undefined && 
                                unitInfo.beefSupply == undefined &&
                                unit.ammount >= 32) {
                                if (unitInfo.role == "melee")
                                    attackerMeleeTroops.push([unitInfo, unit.ammount])
                                else if (unitInfo.role == "ranged")
                                    attackerRangeTroops.push([unitInfo, unit.ammount])
                            }
                        }
                        let sendTroops = []
                        for (let i = 0; i < 10; i++) {
                            const unitSlot = [-1, 0]
                            troopSendLimit -= assignUnit(unitSlot, 
                                attackerRangeTroops.length != 0 ? attackerRangeTroops : attackerMeleeTroops, 
                                troopSendLimit)
                            
                            sendTroops.push(unitSlot)
                                
                            if(troopSendLimit == 0)
                                break
                        }
                        if (!sendTroops.every(e => e[0] == -1)) {
                            sendXT("kut", JSON.stringify({ 
                                SCID: mainCastleAreaID, 
                                SKID: 0, 
                                TKID: 10, 
                                CID: -1, 
                                A: sendTroops
                            }))
                            let [obj, r] = await waitForResult("kut", 1000 * 10) //TODO: LOCK
                            if(r) {
                                console.log(`[${name}] Failed to send troops over`)
                                return
                            }
                            let remainingTime = Types.KingdomInfo(obj.kpi)
                                .troopTransferList.find(e => e.kingdomID == KingdomID.berimond)?.remainingTime
                            while(remainingTime) {
                                remainingTime = (await ClientCommands.getMinuteSkipKingdom(spendSkip(remainingTime), kid, KingdomSkipType.sendTroops)())
                                .troopTransferList.find(e => e.kingdomID == KingdomID.berimond)?.remainingTime
                            }
                            console.log(`[${name}] Moved troops over`)
                            return
                        }
                    }
                    throw "NO_MORE_TROOPS"
                }

                attackerBerimondTools.sort((a, b) =>
                    Number(b[0].pointBonus) - Number(a[0].pointBonus))
                attackerGateBerimondTools.sort((a, b) =>
                    Number(b[0].pointBonus) - Number(a[0].pointBonus))
                attackerWallBerimondTools.sort((a, b) =>
                    Number(b[0].pointBonus) - Number(a[0].pointBonus))
                attackerShieldBerimondTools.sort((a, b) =>
                    Number(b[0].pointBonus) - Number(a[0].pointBonus))

                if (pluginOptions.lowValueChests) {
                    attackerBannerKhanTools.reverse()
                    attackerBerimondTools.reverse()
                    attackerGateBerimondTools.reverse()
                    attackerWallBerimondTools.reverse()
                    attackerShieldBerimondTools.reverse()
                }
                
                attackerWallTools.sort((a, b) =>
                    Number(a[0].wallBonus) - Number(b[0].wallBonus))

                attackerShieldTools.sort((a, b) =>
                    Number(a[0].defRangeBonus) - Number(b[0].defRangeBonus))

                attackerWallBerimondTools.push(...attackerWallTools)
                attackerShieldBerimondTools.push(...attackerShieldTools)
                if (pluginOptions.buyTools) {
                    if (attackerWallBerimondTools.length == 0) {
                        sendXT("sbp", JSON.stringify({ PID: 28, BT: 0, TID: 27, AMT: 300, KID: 10, AID: -1, PC2: -1, BA: 0, PWR: 0, _PO: -1 }))
                        let [_, r] = await waitForResult("sbp", 1000 * 10, (obj, r) => {
                            if (r != 0)
                                return true
                            if (obj.PID == 28 &&
                                obj.AMT == 300)
                                return true
                        })

                        if (r != 0)
                            throw "Couldn't gather tools"
                    }
                    if (attackerShieldBerimondTools.length == 0) {
                        sendXT("sbp", JSON.stringify({ PID: 36, BT: 0, TID: 27, AMT: 300, KID: 10, AID: -1, PC2: -1, BA: 0, PWR: 0, _PO: -1 }))
                        let [_, r] = await waitForResult("sbp", 1000 * 10, (obj, r) => {
                            if (r != 0)
                                return true
                            if (obj.PID == 36 &&
                                obj.AMT == 300)
                                return true
                        })

                        if (r != 0)
                            throw "Couldn't gather tools"
                    }
                }
                if(attackerWallBerimondTools.length == 0 || attackerShieldBerimondTools.length == 0) {
                    if(!pluginOptions.buyTools)
                        throw "NO_MORE_TOOLS"
                    
                    return
                }
                
                attackInfo.A.forEach((wave, index) => {
                    const maxToolsFlank = getTotalAmountToolsFlank(level, 0)
                    const maxToolsFront = getTotalAmountToolsFront(level)

                    const desiredToolCount = attackerBerimondTools.length == 0 ? 20 : 10
                    const maxTroopFlank = getAmountSoldiersFlank(level)

                    let maxTools = maxToolsFlank
                    if (index == 0) {
                        wave.L.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, i == 0 ?
                                attackerWallBerimondTools : attackerShieldBerimondTools, Math.min(maxTools, desiredToolCount)))

                        maxTools = maxToolsFlank
                        wave.R.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, i == 0 ?
                                attackerWallBerimondTools : attackerShieldBerimondTools, Math.min(maxTools, desiredToolCount)))

                        maxTools = maxToolsFront
                        wave.M.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, i == 0 ? attackerWallBerimondTools :
                                i == 1 ? attackerGateBerimondTools : attackerShieldBerimondTools, Math.min(maxTools, desiredToolCount)))

                        let maxTroops = maxTroopFlank

                        wave.L.U.forEach((unitSlot, i) =>
                            maxTroops -= assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                attackerMeleeTroops : attackerRangeTroops, maxTroops))
                        maxTroops = maxTroopFlank
                    }
                    else {
                        const selectTool = i => {
                            let tools = attackerBerimondTools
                            if (tools.length == 0) {
                                if (i == 0) {
                                    tools = attackerWallBerimondTools
                                    if (tools.length == 0)
                                        tools = attackerShieldBerimondTools
                                }
                                else if (i == 1) {
                                    tools = attackerShieldBerimondTools
                                    if (tools.length == 0)
                                        tools = attackerWallBerimondTools
                                }
                                if (i == 2) {
                                    tools = attackerGateBerimondTools
                                    if (tools.length == 0)
                                        tools = attackerWallBerimondTools
                                    if (tools.length == 0)
                                        tools = attackerShieldBerimondTools
                                }
                            }
                            return tools
                        }

                        wave.L.U.forEach((unitSlot, i) =>
                            assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                attackerMeleeTroops : attackerRangeTroops, 1))

                        wave.L.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, selectTool(0), maxTools))
                        maxTools = maxToolsFlank
                        wave.R.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, selectTool(1), maxTools))
                        maxTools = maxToolsFront
                        wave.M.T.forEach((unitSlot, i) =>
                            maxTools -= assignUnit(unitSlot, selectTool(2), maxTools))
                    }
                });

                await areaInfoLock(() => sendXT("cra", JSON.stringify(attackInfo)))

                let [obj, r] = await waitForResult("cra", 1000 * 10, (obj, result) => {
                    if (result != 0)
                        return true

                    if (obj.AAM.M.KID != kid || obj.AAM.M.TA[0] != type)
                        return false
                    return true
                })
                return { ...obj, result: r }
            })

            if (!attackInfo) {
                freeCommander(commander.lordID)
                continue
            }
            if (attackInfo.result != 0)
                throw err[attackInfo.result]

            console.info(`[${name}] Hitting target C${attackInfo.AAM.UM.L.VIS + 1} ${attackInfo.AAM.M.TA[1]}:${attackInfo.AAM.M.TA[2]} ${pretty(Math.round(1000000000 * Math.abs(Math.max(0, attackInfo.AAM.M.TT - attackInfo.AAM.M.PT))), 's') + " till impact"}`)
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
                    break
                case "LORD_IS_USED":
                    useCommander(commander.lordID)
                case "COOLING_DOWN":
                case "TIMED_OUT":
                case "CANT_START_NEW_ARMIES":
                    break
                default:
                    console.error(e)
                    quit = true
            }
        }
    }
})