const { isMainThread } = require('node:worker_threads')
const { getPresetOptions } = require('./presets')

const name = "Attack Berimond Kingdom"

if (isMainThread) {
    const presetOptions = getPresetOptions();
    module.exports = {
        name: name,
        description: "Hardcoded Attack + Fixed Transfer Logic",
        pluginOptions: [
            {
                type: "Text",
                label: "Com White List",
                description: "Commander range (e.g., 1-3 for commanders 1,2,3)",
                key: "commanderWhiteList"
            },
            { type: "Label", label: "Attack Settings" },
            {
                type: "Checkbox",
                label: "Auto Transfer Troops (Every 15m)",
                description: "Automatically send troops from Kingdom 3",
                key: "transferWeakTroops",
                default: true
            },
            {
                type: "Checkbox",
                label: "Smart Unit Replacement",
                description: "If the planned unit is missing, replace with the strongest available unit of the same role.",
                key: "smartUnitReplacement",
                default: true
            },
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
            { type: "Label", label: "Horse Settings" },
            {
                type: "Checkbox",
                label: "Use Time Skips",
                description: "Skip travel and transfer cooldowns",
                key: "useTimeSkips",
                default: true
            },
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
            ...presetOptions
        ]
    }
    return;
}

console.log(`[${name}] Plugin Loaded!`)

const { Types, getResourceCastleList, ClientCommands, areaInfoLock, AreaType, KingdomID, getKingdomInfoList, KingdomSkipType, spendSkip } = require('../../protocols')
const { waitToAttack, getAttackInfo, assignUnit, getAmountSoldiersFlank, getAmountSoldiersFront, getTotalAmountToolsFlank, getTotalAmountToolsFront, getMaxUnitsInReinforcementWave, sleep, boxMullerRandom } = require("../../plugins/attack/attack")
const { waitForCommanderAvailable, freeCommander, useCommander, movementEvents } = require("../../plugins/commander")
const { sendXT, waitForResult, xtHandler, events, botConfig, playerInfo } = require("../../ggebot")
const { applyPreset } = require("../../plugins/attack/presets") // NEW IMPORT
const units = require("../../items/units.json")
const pretty = require('pretty-time')

const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}
pluginOptions.useFeather ??= false
pluginOptions.useCoin ??= false
pluginOptions.transferWeakTroops ??= true
pluginOptions.useTimeSkips ??= true
pluginOptions.smartUnitReplacement ??= true
pluginOptions.attackLeft ??= true
pluginOptions.attackMiddle ??= true
pluginOptions.attackRight ??= true
pluginOptions.useGamePreset ??= false
pluginOptions.presetID ??= "0"
pluginOptions.maxWaves ??= 3

const kid = KingdomID.berimond
const eventID = 3

let targetCache = null

xtHandler.on("fnt", (obj, result) => {
    if (obj.X && obj.Y) targetCache = { x: obj.X, y: obj.Y, type: obj.T || 17 }
    if (obj.TX && obj.TY) targetCache = { x: obj.TX, y: obj.TY, type: obj.T || 17 }
    if (obj.targets && obj.targets[0]) targetCache = { x: obj.targets[0].X, y: obj.targets[0].Y, type: obj.targets[0].T || 17 }
})

xtHandler.on("aci", (obj, result) => {
    if (obj.TX && obj.TY) targetCache = { x: obj.TX, y: obj.TY, type: 17 }
})

xtHandler.on("sne", obj => {
    if (!obj.MSG) return;
    obj.MSG.forEach(message => { if (message[1] == 67) sendXT("dms", JSON.stringify({ MID: message[0] })) });
})

const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

// --- TRANSFER LOGIC ---
const transferTroopsLogic = async () => {
    if (!pluginOptions.transferWeakTroops) return;

    try {
        console.log(`[${name}] Transfer Check Initiated...`)
        const kpi = await getKingdomInfoList()
        let transferInfo = kpi.troopTransferList.find(e => e.kingdomID == kid)

        if (transferInfo && transferInfo.remainingTime > 0) {
            if (pluginOptions.useTimeSkips) {
                const skip = spendSkip(transferInfo.remainingTime);
                if (skip) {
                    console.log(`[${name}] Skipping transfer cooldown...`)
                    transferInfo = (await ClientCommands.getMinuteSkipKingdom(skip, kid, KingdomSkipType.sendTroops)())
                        .troopTransferList.find(e => e.kingdomID == kid)
                } else return;
            } else return;
        }

        const rcl = await getResourceCastleList();
        const beriCastle = rcl.castles.find(e => e.kingdomID == kid)?.areaInfo.find(e => e.type == AreaType.beriCastle);
        if (!beriCastle) return;

        sendXT("fuc", JSON.stringify({ CID: beriCastle.extraData[0] }))
        let fucRes = await waitForResult("fuc", 5000)
        let troopSendLimit = fucRes[0]?.FUC || 0

        if (troopSendLimit > 0) {
            sendXT("dcl", JSON.stringify({ CD: 1 }))
            await waitForResult("dcl", 5000)
            await sleep(1000);
            const dcl = await ClientCommands.getDetailedCastleList()()

            // --- TEMPORARY: TRANSFER FROM KINGDOM ID 3 ---
            const sourceKingdomID = 3;
            const sourceCastleList = dcl.castles.find(e => e.kingdomID == sourceKingdomID);
            let sourceCastle = sourceCastleList?.areaInfo[0];

            if (sourceCastle) {
                console.log(`[${name}] Kingdom ${sourceKingdomID} Castle found (ID:${sourceCastle.areaID}). Selecting troops...`)
                let transferCandidates = []
                sourceCastle.unitInventory.forEach(u => {
                    const unitInfo = units.find(obj => u.unitID == obj.wodID)
                    if (!unitInfo || u.ammount < 10) return;
                    if (unitInfo.role == "melee" || unitInfo.role == "ranged") {
                        const power = Math.max(Number(unitInfo.meleeAttack || 0), Number(unitInfo.rangeAttack || 0));
                        if (power > 100) transferCandidates.push([unitInfo, u.ammount]);
                    }
                })

                transferCandidates.sort((a, b) => {
                    const pA = Math.max(Number(a[0].meleeAttack || 0), Number(a[0].rangeAttack || 0));
                    const pB = Math.max(Number(b[0].meleeAttack || 0), Number(b[0].rangeAttack || 0));
                    return pA - pB;
                })

                let sendTroops = []; let limit = troopSendLimit;
                let logDetails = [];

                for (let i = 0; i < 10; i++) {
                    let slot = [-1, 0];
                    let assigned = assignUnit(slot, transferCandidates, limit);
                    limit -= assigned;
                    if (slot[0] != -1) {
                        sendTroops.push(slot);
                        logDetails.push(`ID ${slot[0]}: ${slot[1]}`);
                    }
                    if (limit <= 0) break;
                }

                if (sendTroops.length > 0) {
                    console.log(`[${name}] Sending Transfer from K${sourceKingdomID}: [${logDetails.join(", ")}]`)
                    sendXT("kut", JSON.stringify({ SCID: sourceCastle.areaID, SKID: sourceKingdomID, TKID: kid, CID: -1, A: sendTroops }))
                    await waitForResult("kut", 10000);

                    if (pluginOptions.useTimeSkips) {
                        console.log(`[${name}] Waiting 2s before skip...`)
                        await sleep(2000);
                        console.log(`[${name}] Sending MS5 Skip...`)
                        await ClientCommands.getMinuteSkipKingdom("MS5", kid, KingdomSkipType.sendTroops)();
                    }
                }
            } else {
                console.error(`[${name}] Kingdom ${sourceKingdomID} Castle not found in updated DCL!`)
            }
        }
    } catch (e) { console.error(`[${name}] Transfer Error:`, e) }
}

// --- INVENTORY SYNC LOGIC ---
let cachedSourceCastle = null;

const syncInventoryLogic = async () => {
    try {
        const rcl = await getResourceCastleList();
        const beriCastleArea = rcl.castles.find(e => e.kingdomID == kid)?.areaInfo.find(e => e.type == AreaType.beriCastle);

        if (!beriCastleArea) return;

        // Fetch detailed info
        const dcl = await ClientCommands.getDetailedCastleList()();
        const castle = dcl.castles.find(a => a.kingdomID == kid)?.areaInfo.find(a => a.areaID == beriCastleArea.extraData[0]);

        if (castle) {
            cachedSourceCastle = castle; // Update global cache for attack loop
            const { syncStatus } = require("../../ggebot");

            let inventoryForUI = [];
            castle.unitInventory.forEach(u => {
                const unitInfo = units.find(obj => u.unitID == obj.wodID)
                if (!unitInfo || u.ammount <= 0) return;
                inventoryForUI.push({
                    wodID: u.unitID,
                    count: u.ammount,
                    category: (unitInfo.role == "melee" || unitInfo.role == "ranged") ? 'unit' : 'tool'
                });
            });
        }
    } catch (e) { console.error(`[${name}] Inventory Sync Error:`, e); }
};

const startLogic = async () => {
    console.log(`[${name}] Logic Started.`)

    // 1. Start Background Tasks
    // Run immediately
    transferTroopsLogic();
    syncInventoryLogic();

    // Set Intervals
    setInterval(transferTroopsLogic, 15 * 60 * 1000); // Every 15m
    setInterval(syncInventoryLogic, 30 * 1000);       // Every 30s

    await getKingdomInfoList();
    let resourceCastleList = await getResourceCastleList()
    let sourceCastleArea = resourceCastleList.castles.find(e => e.kingdomID == kid)?.areaInfo.find(e => e.type == AreaType.beriCastle);

    while (true) {
        try {
            // Ensure we have the target castle area info
            if (!sourceCastleArea) {
                const rcl = await getResourceCastleList()
                sourceCastleArea = rcl.castles.find(e => e.kingdomID == kid)?.areaInfo.find(e => e.type == AreaType.beriCastle);
                if (!sourceCastleArea) { await sleep(10000); continue; }
            }

            // Use the cached castle data from syncLogic if available, otherwise fetch
            let sourceCastle = cachedSourceCastle;
            if (!sourceCastle) {
                // Fallback if sync hasn't run yet
                sourceCastle = (await ClientCommands.getDetailedCastleList()())
                    .castles.find(a => a.kingdomID == kid)
                    ?.areaInfo.find(a => a.areaID == sourceCastleArea.extraData[0])
            }

            if (!sourceCastle) { await sleep(5000); continue; }

            let availableTroops = [];
            let inventoryLog = [];

            sourceCastle.unitInventory.forEach(u => {
                const unitInfo = units.find(obj => u.unitID == obj.wodID)
                if (!unitInfo || u.ammount <= 0) return;
                if (unitInfo.role == "melee" || unitInfo.role == "ranged") {
                    availableTroops.push([unitInfo, u.ammount]);
                    inventoryLog.push(`${u.unitID}: ${u.ammount}`);
                }
            })

            let totalStrong = availableTroops.reduce((a, b) => a + b[1], 0);

            if (totalStrong < 30) {
                console.log(`[${name}] Not enough troops (${totalStrong}/30). Waiting 15s...`)
                await sleep(15000);
                continue;
            }

            let comList = undefined
            if (pluginOptions.commanderWhiteList && pluginOptions.commanderWhiteList.length > 0) {
                const [start, end] = pluginOptions.commanderWhiteList.split("-").map(Number).map(a => a - 1);
                comList = Array.from({ length: end - start + 1 }, (_, i) => start + i);
            }
            const commander = await waitForCommanderAvailable(comList)

            const executionStartTime = Date.now();
            const attackInfoResult = await waitToAttack(async () => {
                const delayMs = randomDelay(1000, 3000);
                targetCache = null;
                sendXT("fnt", JSON.stringify({}))
                for (let i = 0; i < 10; i++) { if (targetCache) break; await new Promise(r => setTimeout(r, 500)); }
                if (!targetCache) return { result: "NO_TARGET" }
                await sleep(delayMs)

                const targetArea = (await ClientCommands.getAreaInfo(kid, targetCache.x, targetCache.y, targetCache.x, targetCache.y)()).areaInfo[0]
                if (!targetArea) return { result: "INVALID_TARGET" }

                // FIX: Request configured waves (Frontend returns index 0-3, so add 1)
                // If undefined, default to 4 waves (index 3)
                const maxWaves = (pluginOptions.maxWaves !== undefined ? Number(pluginOptions.maxWaves) : 3) + 1;

                const attackInfo = getAttackInfo(kid, sourceCastleArea, targetArea, commander, 70, maxWaves, pluginOptions.useCoin)
                if (pluginOptions.useFeather) attackInfo.PTT = 2;

                // --- DYNAMIC ATTACK BUILDER ---
                if (pluginOptions.useGamePreset) {
                    const presetResult = applyPreset(attackInfo, pluginOptions.presetID, maxWaves);
                    if (!presetResult.success) {
                        console.warn(`[${name}] Preset Error: ${presetResult.error}`);
                        return { result: presetResult.error };
                    }
                    console.log(`[${name}] Game Preset Applied (ID: ${pluginOptions.presetID}, Waves: ${maxWaves})`);
                } else {
                    // --- AUTOMATIC FALLBACK ATTACK ---
                    // Respects: attackLeft, attackMiddle, attackRight

                    // 1. Gather Units & Tools
                    let attackerMeleeTroops = []
                    let attackerRangeTroops = []
                    let attackerTools = []

                    sourceCastle.unitInventory.forEach(u => {
                        const unitInfo = units.find(obj => u.unitID == obj.wodID)
                        if (!unitInfo || u.ammount <= 0) return;

                        if (unitInfo.role == "melee")
                            attackerMeleeTroops.push([unitInfo, u.ammount])
                        else if (unitInfo.role == "ranged")
                            attackerRangeTroops.push([unitInfo, u.ammount])
                        else if (unitInfo.toolCategory) // General tool check
                            attackerTools.push([unitInfo, u.ammount])
                    })

                    // Sort by power (Strongest first)
                    attackerMeleeTroops.sort((a, b) => Number(b[0].meleeAttack) - Number(a[0].meleeAttack))
                    attackerRangeTroops.sort((a, b) => Number(b[0].rangeAttack) - Number(a[0].rangeAttack))

                    // Simple tool sort logic 
                    attackerTools.sort((a, b) => b[1] - a[1])

                    const commanderStats = getCommanderStats(commander)

                    // 2. Fill Waves
                    attackInfo.A.forEach((wave, waveIndex) => {
                        const maxTroopFlank = getAmountSoldiersFlank(70) + (commanderStats.relicAttackUnitAmountFlank ?? 0) / 100
                        const maxTroopFront = getAmountSoldiersFront(70) + (commanderStats.relicAttackUnitAmountFront ?? 0) / 100
                        // Tools: approximate limit per slot
                        const maxToolsFlank = getTotalAmountToolsFlank(70, 0)
                        const maxToolsFront = getTotalAmountToolsFront(70)

                        // We use a simplified filling strategy here similar to other plugins:
                        // Fill tools first, then troops.

                        // --- LEFT ---
                        if (pluginOptions.attackLeft) {
                            let toolsLeft = maxToolsFlank
                            wave.L.T.forEach(slot => toolsLeft -= assignUnit(slot, attackerTools, toolsLeft))

                            let troopsLeft = maxTroopFlank
                            wave.L.U.forEach(slot => {
                                troopsLeft -= assignUnit(slot, attackerRangeTroops.length > 0 ? attackerRangeTroops : attackerMeleeTroops, troopsLeft)
                            })
                        }

                        // --- MIDDLE ---
                        if (pluginOptions.attackMiddle) {
                            let toolsMid = maxToolsFront
                            wave.M.T.forEach(slot => toolsMid -= assignUnit(slot, attackerTools, toolsMid))

                            let troopsMid = maxTroopFront
                            wave.M.U.forEach(slot => {
                                troopsMid -= assignUnit(slot, attackerRangeTroops.length > 0 ? attackerRangeTroops : attackerMeleeTroops, troopsMid)
                            })
                        }

                        // --- RIGHT ---
                        if (pluginOptions.attackRight) {
                            let toolsRight = maxToolsFlank
                            wave.R.T.forEach(slot => toolsRight -= assignUnit(slot, attackerTools, toolsRight))

                            let troopsRight = maxTroopFlank
                            wave.R.U.forEach(slot => {
                                troopsRight -= assignUnit(slot, attackerRangeTroops.length > 0 ? attackerRangeTroops : attackerMeleeTroops, troopsRight)
                            })
                        }
                    });
                }

                // Validation: Check if we actually added any soldiers?
                let totalSoldiersSent = 0;
                attackInfo.A.forEach(wave => {
                    ['L', 'M', 'R'].forEach(side => {
                        if (wave[side].U[0] && wave[side].U[0][1] > 0) totalSoldiersSent += wave[side].U[0][1];
                    })
                });

                if (totalSoldiersSent < 10) {
                    console.warn(`[${name}] Attack plan resulted in too few troops (${totalSoldiersSent}). Check inventory or settings.`);
                    return { result: "MISSING_ITEMS" };
                }

                await areaInfoLock(() => sendXT("cra", JSON.stringify(attackInfo)))
                let [obj, r] = await waitForResult("cra", 10000, (o, res) => true)

                return { ...obj, result: r }
            })

            const duration = ((Date.now() - executionStartTime) / 1000).toFixed(2);

            if (attackInfoResult && attackInfoResult.result != 0) {
                if (attackInfoResult.result == 256) useCommander(commander.lordID)
                else if (attackInfoResult.result == 101) {
                    console.warn(`[${name}] Sync error. 1m cooldown.`)
                    freeCommander(commander.lordID); sendXT("dcl", JSON.stringify({ CD: 1 })); await sleep(60000);
                } else {
                    console.warn(`[${name}] Error: ${attackInfoResult.result}`); freeCommander(commander.lordID);
                }
            } else if (attackInfoResult) {
                console.info(`[${name}] Attack sent! Lord ${commander.lordID} (Setup: ${duration}s)`)
                useCommander(commander.lordID)
            } else {
                freeCommander(commander.lordID)
            }

        } catch (e) { console.error(`[${name}] Error:`, e); freeCommander(commander?.lordID); await sleep(5000) }
    }
}

events.on("load", startLogic)