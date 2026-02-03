const { isMainThread } = require('node:worker_threads')
const { getPresetOptions } = require('./presets')

const name = "Attack Berimond Kingdom"

if (isMainThread) {
    const presetOptions = getPresetOptions();
    module.exports = {
        name: name,
        description: "Automated Berimond Attack with Preset Support",
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
                label: "Auto Transfer Troops",
                description: "Automatically send troops from Kingdom 3",
                key: "transferWeakTroops",
                default: true
            },
            {
                type: "Text",
                label: "Transfer Aralığı (dakika)",
                description: "Krallık 3'ten asker transferi aralığı (0 = kapalı)",
                key: "transferInterval",
                default: "10"
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
            {
                type: "Checkbox",
                label: "Attack Courtyard",
                description: "Enable courtyard reinforcement attacks",
                key: "attackCourtyard",
                default: true
            },
            {
                type: "Text",
                label: "Boş Slota Maksimum Asker",
                description: "Preset'te boş slotlara otomatik doldurulacak maksimum asker sayısı (0 = limitsiz)",
                key: "maxAutoFillTroops",
                default: "0"
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
const { applyPreset } = require("../../plugins/attack/presets")
const { getCommanderStats } = require("../../getEquipment")
const units = require("../../items/units.json")
const pretty = require('pretty-time')

const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}
pluginOptions.useFeather ??= false
pluginOptions.useCoin ??= false
pluginOptions.transferWeakTroops ??= true
pluginOptions.transferInterval ??= "10"
pluginOptions.useTimeSkips ??= true
pluginOptions.attackLeft ??= true
pluginOptions.attackMiddle ??= true
pluginOptions.attackRight ??= true
pluginOptions.attackCourtyard ??= true
pluginOptions.maxAutoFillTroops ??= "0"
pluginOptions.useGamePreset ??= false
pluginOptions.presetID ??= 0
pluginOptions.maxWaves ??= 3

// Configuration warning for high wave counts with tool-only presets
if (pluginOptions.useGamePreset && pluginOptions.maxWaves > 2) {
    console.warn(`[${name}] ⚠️ Using presets with ${pluginOptions.maxWaves + 1} waves: Tool-only presets may trigger Error 313 (ATTACK_TOO_MANY_UNITS) due to auto-fill allocation.`);
    console.warn(`[${name}] ⚠️ Consider reducing maxWaves or using presets with troops pre-defined.`);
}

const kid = KingdomID.berimond
const eventID = 3
const minTroopCount = 30

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

/**
 * Helper function to count total units assigned in attackInfo
 * @param {Object} attackInfo - The attack info object
 * @returns {Number} Total number of units
 */
function countTotalUnits(attackInfo) {
    let total = 0;
    attackInfo.A.forEach(wave => {
        ['L', 'R', 'M'].forEach(side => {
            if (wave[side] && wave[side].U) {
                wave[side].U.forEach(slot => {
                    if (slot && slot[1]) total += slot[1];
                });
            }
        });
    });
    // Courtyard (RW)
    if (attackInfo.RW) {
        attackInfo.RW.forEach(slot => {
            if (slot && slot[1]) total += slot[1];
        });
    }
    return total;
}

/**
 * Calculate server hard limit for total units in attack
 * @param {Number} playerLevel - Player's level
 * @param {Number} targetLevel - Target's wall level
 * @param {Number} waveCount - Number of attack waves
 * @param {Object} commanderStats - Commander stats (including relic bonuses)
 * @returns {Number} Maximum safe total units (with 10% safety margin)
 */
function getServerHardLimit(playerLevel, targetLevel, waveCount, commanderStats) {
    // Base calculations from attack.js formulas
    const getMaxAttackers = (level) => level <= 69 ? Math.min(260, 5 * level + 8) : 320;
    const baseFlank = Math.floor(Math.ceil(0.2 * getMaxAttackers(targetLevel)));
    const baseFront = Math.floor(Math.ceil(getMaxAttackers(targetLevel) - 2 * baseFlank));

    // Apply commander relic bonuses
    const relicFlankBonus = (commanderStats.relicAttackUnitAmountFlank ?? 0) / 100;
    const relicFrontBonus = (commanderStats.relicAttackUnitAmountFront ?? 0) / 100;

    const maxFlank = Math.floor(baseFlank * (1 + relicFlankBonus));
    const maxFront = Math.floor(baseFront * (1 + relicFrontBonus));

    // Per-wave theoretical max (2 flanks + 1 front per wave)
    const perWaveTheoretical = (maxFlank * 2) + maxFront;

    // Courtyard theoretical max
    const courtyardTheoretical = Math.round(20 * Math.sqrt(playerLevel) + 50 + 20 * targetLevel);

    // Total theoretical maximum
    const totalTheoretical = (perWaveTheoretical * waveCount) + courtyardTheoretical;

    // Apply 10% safety margin to account for server-side variance
    const safeLimit = Math.floor(totalTheoretical * 0.90);

    return safeLimit;
}

/**
 * Setup wave slots based on wall level requirements
 * @param {Array} wallLevelRequirement - Array of level requirements for each slot
 * @param {Array} row - Target array to push slots into
 */
function setupWave(wallLevelRequirement, row) {
    wallLevelRequirement.forEach(levelReq => {
        row.push([-1, 0]);
    });
}

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

            // Transfer from Kingdom ID 3
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
                    let [kutResult, kutCode] = await waitForResult("kut", 10000);

                    // If transfer blocked, try to skip cooldown and retry
                    if (kutCode !== 0 && pluginOptions.useTimeSkips) {
                        console.log(`[${name}] Transfer blocked. Checking cooldown...`);

                        const kpi = await getKingdomInfoList();
                        let transferInfo = kpi.troopTransferList.find(e => e.kingdomID == kid);

                        if (transferInfo && transferInfo.remainingTime > 0) {
                            console.log(`[${name}] Found cooldown: ${transferInfo.remainingTime}s`);
                            console.log(`[${name}] Skipping cooldown with MS5...`);
                            await ClientCommands.getMinuteSkipKingdom("MS5", kid, KingdomSkipType.sendTroops)();

                            // Wait for server to update
                            await sleep(3000);

                            // Refresh kingdom info to ensure cooldown is cleared
                            await getKingdomInfoList();
                            await sleep(500);

                            // Retry transfer
                            console.log(`[${name}] Retrying transfer...`);
                            sendXT("kut", JSON.stringify({ SCID: sourceCastle.areaID, SKID: sourceKingdomID, TKID: kid, CID: -1, A: sendTroops }))
                            const retryResult = await waitForResult("kut", 10000);
                            kutCode = retryResult[1];

                            if (kutCode !== 0) {
                                console.log(`[${name}] Still blocked: Too many active movements (attacks/transfers). Waiting for some to complete...`);
                            }
                        }
                    }

                    if (kutCode !== 0) {
                        console.log(`[${name}] Transfer skipped. Will retry in next interval.`);
                        return;
                    }

                    if (pluginOptions.useTimeSkips) {
                        console.log(`[${name}] Transfer successful! Skipping travel time...`)
                        await sleep(2000);
                        console.log(`[${name}] Sending MS5 Skip...`)
                        const skipResult = await ClientCommands.getMinuteSkipKingdom("MS5", kid, KingdomSkipType.sendTroops)();
                        console.log(`[${name}] Travel skip completed.`);
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

        const dcl = await ClientCommands.getDetailedCastleList()();
        const castle = dcl.castles.find(a => a.kingdomID == kid)?.areaInfo.find(a => a.areaID == beriCastleArea.extraData[0]);

        if (castle) {
            cachedSourceCastle = castle;
        }
    } catch (e) { console.error(`[${name}] Inventory Sync Error:`, e); }
};

const startLogic = async () => {
    console.log(`[${name}] Logic Started.`)

    // Start Background Tasks
    transferTroopsLogic();
    syncInventoryLogic();

    const transferIntervalMinutes = Number(pluginOptions.transferInterval) || 10;
    setInterval(transferTroopsLogic, transferIntervalMinutes * 60 * 1000);
    setInterval(syncInventoryLogic, 5 * 1000);        // Every 5s

    await getKingdomInfoList();
    let resourceCastleList = await getResourceCastleList()
    let sourceCastleArea = resourceCastleList.castles.find(e => e.kingdomID == kid)?.areaInfo.find(e => e.type == AreaType.beriCastle);

    while (true) {
        try {
            if (!sourceCastleArea) {
                const rcl = await getResourceCastleList()
                sourceCastleArea = rcl.castles.find(e => e.kingdomID == kid)?.areaInfo.find(e => e.type == AreaType.beriCastle);
                if (!sourceCastleArea) { await sleep(10000); continue; }
            }

            // Use cached castle if available, otherwise fetch
            let sourceCastle = cachedSourceCastle;
            if (!sourceCastle) {
                sourceCastle = (await ClientCommands.getDetailedCastleList()())
                    .castles.find(a => a.kingdomID == kid)
                    ?.areaInfo.find(a => a.areaID == sourceCastleArea.extraData[0])
            }

            if (!sourceCastle) { await sleep(5000); continue; }

            let availableTroops = [];
            sourceCastle.unitInventory.forEach(u => {
                const unitInfo = units.find(obj => u.unitID == obj.wodID)
                if (!unitInfo || u.ammount <= 0) return;
                if (unitInfo.role == "melee" || unitInfo.role == "ranged") {
                    availableTroops.push([unitInfo, u.ammount]);
                }
            })

            let totalStrong = availableTroops.reduce((a, b) => a + b[1], 0);

            if (totalStrong < minTroopCount) {
                console.log(`[${name}] Not enough troops (${totalStrong}/${minTroopCount}). Checking inventory in 5s...`)
                await sleep(5000);
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
                const delayMs = randomDelay(2000, 3000);
                targetCache = null;
                sendXT("fnt", JSON.stringify({}))
                for (let i = 0; i < 3; i++) { if (targetCache) break; await new Promise(r => setTimeout(r, 500)); }
                if (!targetCache) return { result: "NO_TARGET" }
                await sleep(delayMs)

                const targetArea = (await ClientCommands.getAreaInfo(kid, targetCache.x, targetCache.y, targetCache.x, targetCache.y)()).areaInfo[0]
                if (!targetArea) return { result: "INVALID_TARGET" }

                // Max waves: frontend returns index (0-3), convert to count (1-4)
                const maxWaves = (pluginOptions.maxWaves !== undefined ? Number(pluginOptions.maxWaves) : 3) + 1;

                const attackInfo = getAttackInfo(kid, sourceCastleArea, targetArea, commander, 70, maxWaves, pluginOptions.useCoin)
                if (pluginOptions.useFeather) attackInfo.PTT = 2;

                // === PRESET LOGIC ===
                if (pluginOptions.useGamePreset) {
                    const presetResult = applyPreset(attackInfo, pluginOptions.presetID, maxWaves);
                    if (!presetResult.success) {
                        console.warn(`[${name}] Preset Error: ${presetResult.error}`);
                        return { result: presetResult.error };
                    }
                    console.log(`[${name}] Game Preset Applied: "${presetResult.presetName}" (Slot ${pluginOptions.presetID + 1}, Waves: ${maxWaves})`);

                    // Check if preset assigned any troops
                    let presetTroopCount = countTotalUnits(attackInfo);

                    // Always auto-fill empty slots (even if preset has some troops)
                    if (true) {
                        if (presetTroopCount <= 0) {
                            console.log(`[${name}] Preset has no troops, auto-filling with available units...`);
                        }

                        // Refresh inventory data
                        const freshSourceCastle = (await ClientCommands.getDetailedCastleList()())
                            .castles.find(a => a.kingdomID == kid)
                            .areaInfo.find(a => a.areaID == sourceCastleArea.extraData[0]);

                        // Build troop lists from FRESH inventory
                        const attackerMeleeTroops = []
                        const attackerRangeTroops = []

                        for (let i = 0; i < freshSourceCastle.unitInventory.length; i++) {
                            const unit = freshSourceCastle.unitInventory[i]
                            const unitInfo = units.find(obj => unit.unitID == obj.wodID)
                            if (unitInfo == undefined) continue

                            if (unitInfo.fightType == 0) {
                                if (unitInfo.role == "melee")
                                    attackerMeleeTroops.push([unitInfo, unit.ammount])
                                else if (unitInfo.role == "ranged")
                                    attackerRangeTroops.push([unitInfo, unit.ammount])
                            }
                        }

                        // Sort troops by amount (descending)
                        attackerMeleeTroops.sort((a, b) => b[1] - a[1]);
                        attackerRangeTroops.sort((a, b) => b[1] - a[1]);

                        let allTroopCount = 0
                        attackerRangeTroops.forEach(e => allTroopCount += e[1])
                        attackerMeleeTroops.forEach(e => allTroopCount += e[1])

                        if (allTroopCount < minTroopCount) {
                            console.warn(`[${name}] Not enough troops (${allTroopCount}/${minTroopCount})`);
                            return { result: "NO_MORE_TROOPS" };
                        }

                        // Auto-fill troops into empty unit slots
                        await sleep(boxMullerRandom(200, 400, 1))

                        const waveCount = maxWaves;
                        const doLeft = pluginOptions.attackLeft !== false;
                        const doRight = pluginOptions.attackRight !== false;
                        const doMiddle = pluginOptions.attackMiddle !== false;

                        // Recreate unit slots since preset cleared them
                        attackInfo.A.forEach((wave, waveIndex) => {
                            if (waveIndex >= waveCount) return;

                            // Only recreate unit slots if completely missing
                            if (wave.L.U.length === 0) {
                                setupWave([0, 13], wave.L.U);
                            }
                            if (wave.M.U.length === 0) {
                                setupWave([0, 0, 13, 13, 26, 26], wave.M.U);
                            }
                            if (wave.R.U.length === 0) {
                                setupWave([0, 13], wave.R.U);
                            }
                        });

                        // Recreate courtyard slots if needed
                        if (attackInfo.RW.length === 0) {
                            for (let i = 0; i < 8; i++) {
                                attackInfo.RW.push([-1, 0]);
                            }
                        }

                        // Fill each wave independently
                        attackInfo.A.forEach((wave, waveIndex) => {
                            if (waveIndex >= waveCount) return;

                            const commanderStats = getCommanderStats(commander)
                            let rawFlank = Math.floor(getAmountSoldiersFlank(70) * 1 + (commanderStats.relicAttackUnitAmountFlank ?? 0) / 100)
                            let rawFront = Math.floor(getAmountSoldiersFront(70) * 1 + (commanderStats.relicAttackUnitAmountFront ?? 0) / 100)

                            const maxTroopFlank = Math.max(0, rawFlank - (rawFlank > 15 ? 10 : 1))
                            const maxTroopFront = Math.max(0, rawFront - (rawFront > 15 ? 10 : 1))

                            if (doLeft) {
                                // Check if flank has tools but no troops
                                const hasTools = wave.L.T && wave.L.T.some(slot => slot && slot[0] !== -1 && slot[1] > 0);
                                const hasTroops = wave.L.U && wave.L.U.some(slot => slot && slot[0] !== -1 && slot[1] > 0);

                                // If has tools but no troops, reset slots for auto-fill
                                if (hasTools && !hasTroops && wave.L.U.length > 0) {
                                    wave.L.U.forEach(slot => {
                                        if (slot) {
                                            slot[0] = -1;
                                            slot[1] = 0;
                                        }
                                    });
                                }

                                let currentMax = maxTroopFlank;
                                // Apply user-defined auto-fill limit if set
                                const userLimit = Number(pluginOptions.maxAutoFillTroops) || 0;
                                if (userLimit > 0) {
                                    currentMax = Math.min(currentMax, userLimit);
                                }

                                wave.L.U.forEach((unitSlot, i) => {
                                    if (currentMax <= 0) return;
                                    let assigned = assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                        attackerMeleeTroops : attackerRangeTroops, currentMax);
                                    currentMax -= assigned;
                                });
                            }

                            if (doRight) {
                                // Check if flank has tools but no troops
                                const hasTools = wave.R.T && wave.R.T.some(slot => slot && slot[0] !== -1 && slot[1] > 0);
                                const hasTroops = wave.R.U && wave.R.U.some(slot => slot && slot[0] !== -1 && slot[1] > 0);

                                // If has tools but no troops, reset slots for auto-fill
                                if (hasTools && !hasTroops && wave.R.U.length > 0) {
                                    wave.R.U.forEach(slot => {
                                        if (slot) {
                                            slot[0] = -1;
                                            slot[1] = 0;
                                        }
                                    });
                                }

                                let currentMax = maxTroopFlank;
                                // Apply user-defined auto-fill limit if set
                                const userLimit = Number(pluginOptions.maxAutoFillTroops) || 0;
                                if (userLimit > 0) {
                                    currentMax = Math.min(currentMax, userLimit);
                                }

                                wave.R.U.forEach((unitSlot, i) => {
                                    if (currentMax <= 0) return;
                                    let assigned = assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                        attackerMeleeTroops : attackerRangeTroops, currentMax);
                                    currentMax -= assigned;
                                });
                            }

                            if (doMiddle) {
                                // Check if middle has tools but no troops
                                const hasTools = wave.M.T && wave.M.T.some(slot => slot && slot[0] !== -1 && slot[1] > 0);
                                const hasTroops = wave.M.U && wave.M.U.some(slot => slot && slot[0] !== -1 && slot[1] > 0);

                                // If has tools but no troops, reset slots for auto-fill
                                if (hasTools && !hasTroops && wave.M.U.length > 0) {
                                    wave.M.U.forEach(slot => {
                                        if (slot) {
                                            slot[0] = -1;
                                            slot[1] = 0;
                                        }
                                    });
                                }

                                let currentMax = maxTroopFront;
                                // Apply user-defined auto-fill limit if set
                                const userLimit = Number(pluginOptions.maxAutoFillTroops) || 0;
                                if (userLimit > 0) {
                                    currentMax = Math.min(currentMax, userLimit);
                                }

                                wave.M.U.forEach((unitSlot, i) => {
                                    if (currentMax <= 0) return;
                                    let assigned = assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                        attackerMeleeTroops : attackerRangeTroops, currentMax);
                                    currentMax -= assigned;
                                });
                            }
                        })

                        // Fill courtyard (if enabled)
                        if (pluginOptions.attackCourtyard !== false) {
                            let maxTroops = getMaxUnitsInReinforcementWave(playerInfo.level, 70);
                            attackInfo.RW.forEach((unitSlot, i) => {
                                if (maxTroops <= 0) return;
                                let attacker = i & 1 ?
                                    (attackerRangeTroops.length > 0 ? attackerRangeTroops : attackerMeleeTroops) :
                                    (attackerRangeTroops.length > 0 ? attackerRangeTroops : attackerMeleeTroops)

                                let assigned = assignUnit(unitSlot, attacker,
                                    Math.floor(maxTroops / 2));
                                maxTroops -= assigned;
                            });
                        } else {
                            // Clear courtyard array when disabled
                            attackInfo.RW = [];
                        }

                    }
                } else {
                    // === MANUAL MODE (No Preset) ===
                    const attackerMeleeTroops = []
                    const attackerRangeTroops = []
                    const attackerTools = []

                    sourceCastle.unitInventory.forEach(u => {
                        const unitInfo = units.find(obj => u.unitID == obj.wodID)
                        if (!unitInfo || u.ammount <= 0) return;

                        if (unitInfo.role == "melee")
                            attackerMeleeTroops.push([unitInfo, u.ammount])
                        else if (unitInfo.role == "ranged")
                            attackerRangeTroops.push([unitInfo, u.ammount])
                        else if (unitInfo.toolCategory)
                            attackerTools.push([unitInfo, u.ammount])
                    })

                    // Sort by power (Strongest first)
                    attackerMeleeTroops.sort((a, b) => Number(b[0].meleeAttack) - Number(a[0].meleeAttack))
                    attackerRangeTroops.sort((a, b) => Number(b[0].rangeAttack) - Number(a[0].rangeAttack))
                    attackerTools.sort((a, b) => b[1] - a[1])

                    let allTroopCount = 0
                    attackerRangeTroops.forEach(e => allTroopCount += e[1])
                    attackerMeleeTroops.forEach(e => allTroopCount += e[1])

                    if (allTroopCount < minTroopCount) {
                        console.warn(`[${name}] Not enough troops (${allTroopCount}/${minTroopCount})`);
                        return { result: "NO_MORE_TROOPS" };
                    }

                    await sleep(boxMullerRandom(200, 400, 1))

                    const waveCount = maxWaves;
                    const doLeft = pluginOptions.attackLeft !== false;
                    const doRight = pluginOptions.attackRight !== false;
                    const doMiddle = pluginOptions.attackMiddle !== false;

                    const commanderStats = getCommanderStats(commander)

                    // Fill Waves
                    attackInfo.A.forEach((wave, waveIndex) => {
                        if (waveIndex >= waveCount) return;

                        let rawFlank = Math.floor(getAmountSoldiersFlank(70) * 1 + (commanderStats.relicAttackUnitAmountFlank ?? 0) / 100)
                        let rawFront = Math.floor(getAmountSoldiersFront(70) * 1 + (commanderStats.relicAttackUnitAmountFront ?? 0) / 100)

                        const maxTroopFlank = Math.max(0, rawFlank - (rawFlank > 15 ? 10 : 1))
                        const maxTroopFront = Math.max(0, rawFront - (rawFront > 15 ? 10 : 1))

                        const maxToolsFlank = getTotalAmountToolsFlank(70, 0)
                        const maxToolsFront = getTotalAmountToolsFront(70)

                        // LEFT
                        if (doLeft) {
                            let toolsLeft = maxToolsFlank
                            wave.L.T.forEach(slot => toolsLeft -= assignUnit(slot, attackerTools, toolsLeft))

                            let troopsLeft = maxTroopFlank
                            wave.L.U.forEach(slot => {
                                if (troopsLeft <= 0) return;
                                troopsLeft -= assignUnit(slot, attackerRangeTroops.length > 0 ? attackerRangeTroops : attackerMeleeTroops, troopsLeft)
                            })
                        }

                        // MIDDLE
                        if (doMiddle) {
                            let toolsMid = maxToolsFront
                            wave.M.T.forEach(slot => toolsMid -= assignUnit(slot, attackerTools, toolsMid))

                            let troopsMid = maxTroopFront
                            wave.M.U.forEach(slot => {
                                if (troopsMid <= 0) return;
                                troopsMid -= assignUnit(slot, attackerRangeTroops.length > 0 ? attackerRangeTroops : attackerMeleeTroops, troopsMid)
                            })
                        }

                        // RIGHT
                        if (doRight) {
                            let toolsRight = maxToolsFlank
                            wave.R.T.forEach(slot => toolsRight -= assignUnit(slot, attackerTools, toolsRight))

                            let troopsRight = maxTroopFlank
                            wave.R.U.forEach(slot => {
                                if (troopsRight <= 0) return;
                                troopsRight -= assignUnit(slot, attackerRangeTroops.length > 0 ? attackerRangeTroops : attackerMeleeTroops, troopsRight)
                            })
                        }
                    });

                    // Fill courtyard (if enabled)
                    if (pluginOptions.attackCourtyard !== false) {
                        let maxTroops = getMaxUnitsInReinforcementWave(playerInfo.level, 70);
                        attackInfo.RW.forEach((unitSlot, i) => {
                            if (maxTroops <= 0) return;
                            let attacker = i & 1 ?
                                (attackerRangeTroops.length > 0 ? attackerRangeTroops : attackerMeleeTroops) :
                                (attackerRangeTroops.length > 0 ? attackerRangeTroops : attackerMeleeTroops)

                            let assigned = assignUnit(unitSlot, attacker,
                                Math.floor(maxTroops / 2));
                            maxTroops -= assigned;
                        })
                    } else {
                        // Clear courtyard array when disabled
                        attackInfo.RW = [];
                    }
                }

                // === GLOBAL UNIT LIMIT VALIDATION ===
                const commanderStats = getCommanderStats(commander);
                const serverHardLimit = getServerHardLimit(playerInfo.level, 70, maxWaves, commanderStats);
                let currentTotalUnits = countTotalUnits(attackInfo);

                if (currentTotalUnits > serverHardLimit) {
                    console.warn(`[${name}] ⚠️ Total units (${currentTotalUnits}) exceeds server limit (${serverHardLimit}). Reducing allocation...`);

                    const excessUnits = currentTotalUnits - serverHardLimit;
                    let unitsToReduce = excessUnits;

                    // Strategy 1: Reduce courtyard first (least impact on attack effectiveness)
                    let courtyardReduction = 0;
                    for (let i = attackInfo.RW.length - 1; i >= 0 && unitsToReduce > 0; i--) {
                        const slot = attackInfo.RW[i];
                        if (slot && slot[1] > 0) {
                            const reduction = Math.min(slot[1], unitsToReduce);
                            slot[1] -= reduction;
                            unitsToReduce -= reduction;
                            courtyardReduction += reduction;
                            if (slot[1] === 0) slot[0] = -1; // Clear empty slot
                        }
                    }

                    if (courtyardReduction > 0) {
                        console.log(`[${name}] 📉 Reduced courtyard by ${courtyardReduction} units`);
                    }

                    // Strategy 2: If still over, reduce wave allocations (back to front, right to left)
                    if (unitsToReduce > 0) {
                        let waveReduction = 0;
                        for (let waveIdx = attackInfo.A.length - 1; waveIdx >= 0 && unitsToReduce > 0; waveIdx--) {
                            const wave = attackInfo.A[waveIdx];
                            if (waveIdx >= maxWaves) continue;

                            // Reduce in order: Right -> Middle -> Left
                            for (const side of ['R', 'M', 'L']) {
                                if (!wave[side] || !wave[side].U) continue;
                                for (let slotIdx = wave[side].U.length - 1; slotIdx >= 0 && unitsToReduce > 0; slotIdx--) {
                                    const slot = wave[side].U[slotIdx];
                                    if (slot && slot[1] > 0) {
                                        const reduction = Math.min(slot[1], unitsToReduce);
                                        slot[1] -= reduction;
                                        unitsToReduce -= reduction;
                                        waveReduction += reduction;
                                        if (slot[1] === 0) slot[0] = -1; // Clear empty slot
                                    }
                                }
                            }
                        }

                        if (waveReduction > 0) {
                            console.log(`[${name}] 📉 Reduced waves by ${waveReduction} units`);
                        }
                    }

                    currentTotalUnits = countTotalUnits(attackInfo);
                    console.log(`[${name}] ✅ Final unit count after reduction: ${currentTotalUnits}/${serverHardLimit}`);
                }

                // === FINAL VALIDATION ===
                const finalTroopCount = countTotalUnits(attackInfo);
                if (finalTroopCount <= 0) {
                    console.warn(`[${name}] Skipped target - No troops assigned after fill attempt`)
                    return { result: "NO_TROOPS_ASSIGNED" }
                }

                // Send attack
                await areaInfoLock(() => sendXT("cra", JSON.stringify(attackInfo)))
                let [obj, r] = await waitForResult("cra", 10000, (o, res) => true)

                const executionDuration = ((Date.now() - executionStartTime) / 1000).toFixed(2);
                return { ...obj, result: r, executionDuration, soldierCount: finalTroopCount }
            })

            const duration = ((Date.now() - executionStartTime) / 1000).toFixed(2);

            if (attackInfoResult && attackInfoResult.result != 0) {
                if (attackInfoResult.result == 256) {
                    useCommander(commander.lordID)
                } else if (attackInfoResult.result == 101) {
                    freeCommander(commander.lordID);
                    sendXT("dcl", JSON.stringify({ CD: 1 }));
                    await sleep(5000);
                } else if (attackInfoResult.result == 313) {
                    console.error(`[${name}] ❌ Error 313: ATTACK_TOO_MANY_UNITS`);
                    console.error(`[${name}] This error indicates the total unit count exceeded server limits.`);
                    console.error(`[${name}] Troubleshooting steps:`);
                    console.error(`[${name}]   1. Reduce maxWaves in plugin settings`);
                    console.error(`[${name}]   2. Disable attackCourtyard if you only need wave attacks`);
                    console.error(`[${name}]   3. Check commander relic bonuses (high bonuses increase limits but may cause variance)`);
                    console.error(`[${name}]   4. If using tool-only presets, ensure auto-fill isn't over-allocating`);
                    console.error(`[${name}]   5. Consider using presets with troops pre-defined instead of relying on auto-fill`);
                    freeCommander(commander.lordID);
                    await sleep(30000); // 30s cooldown (config issue, don't retry immediately)
                } else if (attackInfoResult.result == "NO_TARGET") {
                    console.log(`[${name}] No target available. Waiting 5s...`)
                    freeCommander(commander.lordID);
                    await sleep(5000);
                } else if (attackInfoResult.result == "NO_MORE_TROOPS") {
                    console.warn(`[${name}] 🛑 Not enough troops. Checking inventory in 5s...`)
                    freeCommander(commander.lordID);
                    await sleep(5000);
                } else if (attackInfoResult.result == "NO_TROOPS_ASSIGNED") {
                    console.warn(`[${name}] No troops assigned. Waiting 5s...`)
                    freeCommander(commander.lordID);
                    await sleep(5000);
                } else {
                    console.warn(`[${name}] Error: ${attackInfoResult.result}`);
                    freeCommander(commander.lordID);
                }
            } else if (attackInfoResult && attackInfoResult.AAM) {
                const soldierCount = attackInfoResult.soldierCount || 0;
                console.info(`[${name}] Attack sent! Commander #${commander.lordPosition + 1} | Troops: ${soldierCount} | Setup: ${duration}s`)
                useCommander(commander.lordID)
            } else {
                freeCommander(commander.lordID)
            }

        } catch (e) {
            console.error(`[${name}] Error:`, e);
            if (commander?.lordID) freeCommander(commander.lordID);
            await sleep(5000)
        }
    }
}

events.on("load", startLogic)