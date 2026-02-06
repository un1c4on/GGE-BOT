const { isMainThread } = require('node:worker_threads')
const name = "Fortress Hit"

if (isMainThread)
    return module.exports = {
        name: name,
        hidden: true
    }

const { Types, getResourceCastleList, ClientCommands, areaInfoLock, AreaType, spendSkip } = require('../../protocols')
const { waitToAttack, getAttackInfo, assignUnit, getAmountSoldiersFlank, getAmountSoldiersFront, getMaxUnitsInReinforcementWave, boxMullerRandom, sleep, incrementAttackCounter, hasReachedAttackLimit, getCurrentAttackCount } = require("./attack.js")
const { movementEvents, waitForCommanderAvailable, freeCommander, useCommander } = require("../commander")
const { sendXT, waitForResult, xtHandler, botConfig, playerInfo } = require("../../ggebot")
const { applyPreset, clampPresetTroops } = require("../../plugins/attack/presets")
const getAreaCached = require('../../getmap.js')
const err = require("../../err.json")

const units = require("../../items/units.json")
const pretty = require('pretty-time')

const minTroopCount = 50

const troopBlackList = [277]//, 34, 35]

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
async function barronHit(name, type, kid, options) {
    setTimeout(() => {
        console.log(`[${name}] 3-hour cycle reached. Exiting for restart.`);
        process.exit(0);
    }, 3 * 60 * 60 * 1000);

    function getLevel(victorys, kid) {
        function getKingdomOffset(e) {
            let t = 0
            switch (e) {
                case 0:
                    t = 1
                    break
                case 2:
                    t = 20
                    break
                case 1:
                    t = 35
                    break
                case 3:
                    t = 45
            }
            return t
        }
        var n = getKingdomOffset(kid)
        return (0 | Math.floor(1.9 * Math.pow(Math.abs(victorys), .555))) + n
    }
    let pluginOptions = {}
    Object.assign(pluginOptions, botConfig.plugins["attack"] ?? {})
    Object.assign(pluginOptions, options ?? {})

    // Defaults for preset options
    pluginOptions.useGamePreset ??= false;
    pluginOptions.presetID ??= 0;
    pluginOptions.maxWaves ??= 3; // Default index 3 (becomes 4 waves after +1)
    pluginOptions.maxTroopsLeft ??= "0";
    pluginOptions.maxTroopsMiddle ??= "0";
    pluginOptions.maxTroopsRight ??= "0";
    pluginOptions.maxTroopsCourtyard ??= "0";

    let towerTime = new WeakMap()
    let tooManyUnitsErrorCount = 0 // ATTACK_TOO_MANY_UNITS hata sayacı
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
    let skipTarget = async (AI) => {
        while (AI.extraData[2] > 0) {
            let skip = spendSkip(AI.extraData[2])

            if (skip == undefined)
                throw new Error("Couldn't find skip")

            sendXT("msd", JSON.stringify({ X: AI.x, Y: AI.y, MID: -1, NID: -1, MST: skip, KID: `${kid}` }))
            let [obj2, result2] = await waitForResult("msd", 7000, (obj, result) => {
                if (result != 0)
                    return true

                if (obj.AI[0] != AI.type ||
                    obj.AI[6] != kid ||
                    obj.AI[1] != AI.x ||
                    obj.AI[2] != AI.y)
                    return false
                return true
            })

            if (Number(result2) != 0)
                break

            Object.assign(AI, Types.GAAAreaInfo(obj2.AI))
        }
    }
    movementEvents.on("return", movementInfo => {
        const sourceAttack = movementInfo.movement.movement.sourceAttack
        if (kid != movementInfo.movement.movement.kingdomID ||
            type != sourceAttack.type)
            return

        let index = movements.findIndex(e => e.x == sourceAttack.x && e.y == sourceAttack)
        if (index == -1)
            return

        movements.splice(index, 1)
        skipTarget(sourceAttack)
    })
    const sourceCastleArea = (await getResourceCastleList()).castles.find(e => e.kingdomID == kid)
        .areaInfo.find(e => [AreaType.externalKingdom, AreaType.mainCastle].includes(e.type));

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

    const sendHit = async () => {
        let comList = undefined
        if (![, 0, ""].includes(pluginOptions.commanderWhiteList)) {
            const [start, end] = pluginOptions.commanderWhiteList.split("-").map(Number).map(a => a - 1)
            comList = Array.from({ length: end - start + 1 }, (_, i) => start + i)
        }

        const commander = await waitForCommanderAvailable(comList)
        const hasShieldMadiens = !(((commander.EQ[3] ?? [])[5]?.every(([id, _]) => id == 121 ? false : true)) ?? true)
        try {
            const attackInfo = await waitToAttack(async () => {
                const executionStartTime = Date.now() // Start timer for "human" interaction

                const sourceCastle = (await ClientCommands.getDetailedCastleList()())
                    .castles.find(a => a.kingdomID == kid)
                    .areaInfo.find(a => a.areaID == sourceCastleArea.extraData[0])
                let index = -1
                const timeSinceEpoch = Date.now()
                for (let i = 0; i < sortedAreaInfo.length; i++) {
                    const oldAreaInfo = sortedAreaInfo[i]

                    if (movements.find(e => e.x == oldAreaInfo.x && e.y == oldAreaInfo.y))
                        continue

                    let time = towerTime.get(oldAreaInfo) - timeSinceEpoch
                    if (!options.useTimeSkips && time > 0)
                        continue

                    const areaInfo = (await ClientCommands.getAreaInfo(kid, oldAreaInfo.x, oldAreaInfo.y, oldAreaInfo.x, oldAreaInfo.y)()).areaInfo[0]

                    Object.assign(oldAreaInfo, areaInfo)
                    towerTime.set(oldAreaInfo, timeSinceEpoch + oldAreaInfo.extraData[2] * 1000)

                    if (!options.useTimeSkips && towerTime.get(oldAreaInfo) - Date.now() > 0)
                        continue

                    index = i
                    break
                }
                if (index == -1)
                    return

                let AI = sortedAreaInfo.splice(index, 1)[0]

                // Simulating: Clicking on target (Reaction time ~300ms-600ms)
                await sleep(boxMullerRandom(300, 600, 1))

                await skipTarget(AI)

                // Simulating: Opening Attack Dialog (Animation wait ~400ms-800ms)
                await sleep(boxMullerRandom(400, 800, 1))

                const level = getLevel(AI.extraData[1], kid)

                // Select returns index (0=>"1", 1=>"2", 2=>"3", 3=>"4"), add +1 for actual wave count
                const maxWaves = (pluginOptions.maxWaves !== undefined ? Number(pluginOptions.maxWaves) : 3) + 1;
                const attackInfo = getAttackInfo(kid, sourceCastleArea, AI, commander, level, maxWaves, pluginOptions.useCoin)

                // --- PRESET LOGIC ---
                if (pluginOptions.useGamePreset) {
                    const presetResult = applyPreset(attackInfo, pluginOptions.presetID, maxWaves);
                    if (!presetResult.success) {
                        console.warn(`[${name}] Preset Error: ${presetResult.error}`);
                        throw "PRESET_ERROR: " + presetResult.error;
                    }
                    console.log(`[${name}] Game Preset Applied: "${presetResult.presetName}" (Slot ${pluginOptions.presetID + 1}, Waves: ${maxWaves})`);

                    // Clamp preset troops to current level's max capacity
                    const presetMaxFlank = getAmountSoldiersFlank(level);
                    const presetMaxFront = getAmountSoldiersFront(level);
                    if (clampPresetTroops(attackInfo, presetMaxFront, presetMaxFlank)) {
                        console.warn(`[${name}] Preset asker sayilari mevcut kapasiteye gore sinirlandirildi (Front: ${presetMaxFront}, Flank: ${presetMaxFlank})`);
                    }

                    // Check if preset assigned any troops (it might only have tools)
                    let presetTroopCount = countTotalUnits(attackInfo);

                    if (presetTroopCount <= 0) {
                        // Preset has only tools, no units - auto-fill with available troops
                        console.log(`[${name}] Preset has no troops, auto-filling with available units...`);

                        // Refresh inventory data to get current troop counts (important after previous attacks)
                        const freshSourceCastle = (await ClientCommands.getDetailedCastleList()())
                            .castles.find(a => a.kingdomID == kid)
                            .areaInfo.find(a => a.areaID == sourceCastleArea.extraData[0]);

                        // Safe coordinate access
                        const cX = freshSourceCastle.coordinates ? freshSourceCastle.coordinates.x : (freshSourceCastle.x || '?');
                        const cY = freshSourceCastle.coordinates ? freshSourceCastle.coordinates.y : (freshSourceCastle.y || '?');

                        // Build troop lists from FRESH inventory
                        const attackerMeleeTroops = []
                        const attackerRangeTroops = []

                        for (let i = 0; i < freshSourceCastle.unitInventory.length; i++) {
                            const unit = freshSourceCastle.unitInventory[i]
                            const unitInfo = units.find(obj => unit.unitID == obj.wodID)
                            if (unitInfo == undefined)
                                continue

                            if (unitInfo.fightType == 0) {
                                if (troopBlackList.includes(unitInfo.wodID))
                                    continue
                                if (unitInfo.role == "melee")
                                    attackerMeleeTroops.push([unitInfo, unit.ammount])
                                else if (unitInfo.role == "ranged")
                                    attackerRangeTroops.push([unitInfo, unit.ammount])
                            }
                        }

                        // Sort troops by amount (descending) to use largest stacks first
                        // This prevents fragmentation and issues with very small unit counts
                        attackerMeleeTroops.sort((a, b) => b[1] - a[1]);
                        attackerRangeTroops.sort((a, b) => b[1] - a[1]);

                        let allTroopCount = 0
                        attackerRangeTroops.forEach(e => allTroopCount += e[1])
                        attackerMeleeTroops.forEach(e => allTroopCount += e[1])

                        console.log(`[${name}] 📊 Envanter: ${allTroopCount} asker (${attackerMeleeTroops.length} melee tipi, ${attackerRangeTroops.length} ranged tipi)`)

                        // Debug: Show which unit IDs we have
                        if (attackerRangeTroops.length > 0) {
                            const rangedIDs = attackerRangeTroops.map(([unitInfo, amount]) => `${unitInfo.wodID}:${amount}`).join(', ');
                            console.log(`[${name}] 🎯 Ranged askerler: ${rangedIDs}`);
                        }
                        if (attackerMeleeTroops.length > 0) {
                            const meleeIDs = attackerMeleeTroops.map(([unitInfo, amount]) => `${unitInfo.wodID}:${amount}`).join(', ');
                            console.log(`[${name}] ⚔️  Melee askerler: ${meleeIDs}`);
                        }

                        if (allTroopCount < minTroopCount)
                            throw "NO_MORE_TROOPS"

                        // Auto-fill troops into empty unit slots
                        await sleep(boxMullerRandom(200, 400, 1))

                        const waveCount = maxWaves;
                        const doLeft = pluginOptions.attackLeft !== false;
                        const doRight = pluginOptions.attackRight !== false;
                        const doMiddle = pluginOptions.attackMiddle !== false;
                        const doCourtyard = pluginOptions.attackCourtyard !== false;

                        // Recreate unit slots since preset cleared them
                        const setupWave = (wallLevelRequirement, row) =>
                            wallLevelRequirement.every(e =>
                                e <= level ? row.push([-1, 0]) : false)

                        attackInfo.A.forEach((wave, waveIndex) => {
                            if (waveIndex >= waveCount) return;

                            // Only recreate unit slots, keep existing tool slots
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

                        // Kullanıcı limitleri
                        const userLimitLeft = Number(pluginOptions.maxTroopsLeft) || 0;
                        const userLimitMiddle = Number(pluginOptions.maxTroopsMiddle) || 0;
                        const userLimitRight = Number(pluginOptions.maxTroopsRight) || 0;
                        const userLimitCourtyard = Number(pluginOptions.maxTroopsCourtyard) || 0;

                        // Fill each wave independently - SMART ALLOCATION
                        // Küçük limitli kanatları önce doldur, böylece büyük limitli kanat kalan askerleri alır
                        attackInfo.A.forEach((wave, waveIndex) => {
                            if (waveIndex >= waveCount) return;

                            const maxTroopFlank = getAmountSoldiersFlank(level)
                            const maxTroopFront = getAmountSoldiersFront(level)

                            // Kanatları hazırla (aktif olanlar)
                            const flanks = [];

                            if (doLeft) {
                                const limit = userLimitLeft > 0 ? Math.min(maxTroopFlank, userLimitLeft) : maxTroopFlank;
                                flanks.push({ side: 'L', slots: wave.L.U, limit: limit });
                            }

                            if (doMiddle) {
                                const limit = userLimitMiddle > 0 ? Math.min(maxTroopFront, userLimitMiddle) : maxTroopFront;
                                flanks.push({ side: 'M', slots: wave.M.U, limit: limit });
                            }

                            if (doRight) {
                                const limit = userLimitRight > 0 ? Math.min(maxTroopFlank, userLimitRight) : maxTroopFlank;
                                flanks.push({ side: 'R', slots: wave.R.U, limit: limit });
                            }

                            // Küçük limitten büyüğe sırala (önce küçük limitli kanatlar doldurulur)
                            flanks.sort((a, b) => a.limit - b.limit);

                            // Sırayla doldur
                            flanks.forEach(flank => {
                                let currentMax = flank.limit;
                                flank.slots.forEach((unitSlot, i) => {
                                    if (currentMax <= 0) return;
                                    let assigned = assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                        attackerMeleeTroops : attackerRangeTroops, currentMax);
                                    currentMax -= assigned;
                                });
                            });

                            // Devre dışı kanatları temizle
                            if (!doLeft) { wave.L.U = []; wave.L.T = []; }
                            if (!doMiddle) { wave.M.U = []; wave.M.T = []; }
                            if (!doRight) { wave.R.U = []; wave.R.T = []; }
                        })

                        if (doCourtyard) {
                            let maxTroops = getMaxUnitsInReinforcementWave(playerInfo.level, level);
                            if (userLimitCourtyard > 0) maxTroops = Math.min(maxTroops, userLimitCourtyard);
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
                            attackInfo.RW = [];
                        }
                    }
                } else {
                    // --- MANUAL MODE (No Preset) ---
                    const attackerMeleeTroops = []
                    const attackerRangeTroops = []

                    for (let i = 0; i < sourceCastle.unitInventory.length; i++) {
                        const unit = sourceCastle.unitInventory[i]
                        const unitInfo = units.find(obj => unit.unitID == obj.wodID)
                        if (unitInfo == undefined)
                            continue

                        if (unitInfo.fightType == 0) {
                            if (troopBlackList.includes(unitInfo.wodID))
                                continue
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

                    // Simulating: Selecting Units and filling waves (Cognitive processing ~100ms per wave/calculation)
                    await sleep(boxMullerRandom(200, 400, 1))

                    // Get user options, defaulting to full attack if not set
                    // maxWaves is 0-based index (0=1 wave, 1=2 waves, etc.), convert to count
                    const waveCount = maxWaves; // Already converted to count in line 212
                    const doLeft = pluginOptions.attackLeft !== false;
                    const doRight = pluginOptions.attackRight !== false;
                    const doMiddle = pluginOptions.attackMiddle !== false;
                    const doCourtyard = pluginOptions.attackCourtyard !== false;

                    // Kullanıcı limitleri
                    const userLimitLeft = Number(pluginOptions.maxTroopsLeft) || 0;
                    const userLimitMiddle = Number(pluginOptions.maxTroopsMiddle) || 0;
                    const userLimitRight = Number(pluginOptions.maxTroopsRight) || 0;
                    const userLimitCourtyard = Number(pluginOptions.maxTroopsCourtyard) || 0;

                    // Küçük limitli kanatları önce doldur
                    attackInfo.A.forEach((wave, waveIndex) => {
                        if (waveIndex >= waveCount) return;

                        const maxTroopFlank = getAmountSoldiersFlank(level)
                        const maxTroopFront = getAmountSoldiersFront(level)

                        // Kanatları hazırla (aktif olanlar)
                        const flanks = [];

                        if (doLeft) {
                            const limit = userLimitLeft > 0 ? Math.min(maxTroopFlank, userLimitLeft) : maxTroopFlank;
                            flanks.push({ side: 'L', slots: wave.L.U, limit: limit });
                        }

                        if (doMiddle) {
                            const limit = userLimitMiddle > 0 ? Math.min(maxTroopFront, userLimitMiddle) : maxTroopFront;
                            flanks.push({ side: 'M', slots: wave.M.U, limit: limit });
                        }

                        if (doRight) {
                            const limit = userLimitRight > 0 ? Math.min(maxTroopFlank, userLimitRight) : maxTroopFlank;
                            flanks.push({ side: 'R', slots: wave.R.U, limit: limit });
                        }

                        // Küçük limitten büyüğe sırala (önce küçük limitli kanatlar doldurulur)
                        flanks.sort((a, b) => a.limit - b.limit);

                        // Sırayla doldur
                        flanks.forEach(flank => {
                            let currentMax = flank.limit;
                            flank.slots.forEach((unitSlot, i) => {
                                if (currentMax <= 0) return;
                                let assigned = assignUnit(unitSlot, attackerRangeTroops.length <= 0 ?
                                    attackerMeleeTroops : attackerRangeTroops, currentMax);
                                currentMax -= assigned;
                            });
                        });

                        // Devre dışı kanatları temizle
                        if (!doLeft) { wave.L.U = []; wave.L.T = []; }
                        if (!doMiddle) { wave.M.U = []; wave.M.T = []; }
                        if (!doRight) { wave.R.U = []; wave.R.T = []; }
                    })


                    if (doCourtyard) {
                        let maxTroops = getMaxUnitsInReinforcementWave(playerInfo.level, level);
                        if (userLimitCourtyard > 0) maxTroops = Math.min(maxTroops, userLimitCourtyard);
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
                        attackInfo.RW = [];
                    }
                }

                // --- FINAL VALIDATION (Both Preset and Manual) ---
                const finalTroopCount = countTotalUnits(attackInfo);
                if (finalTroopCount <= 0) {
                    console.warn(`[${name}] Skipped target at ${AI.x}:${AI.y} (Level ${level}) - No troops assigned after fill attempt`)
                    return { result: 0, executionDuration: 0 }
                }

                // Final hesitation before clicking "Attack" (Human verification/hesitation ~2000ms-3000ms)
                await sleep(boxMullerRandom(2000, 3000, 1))

                await areaInfoLock(() => sendXT("cra", JSON.stringify(attackInfo)))

                let [obj, r] = await waitForResult("cra", 1000 * 10, (obj, result) => {
                    if (result != 0)
                        return true

                    if (obj.AAM.M.KID != kid || obj.AAM.M.TA[1] != AI.x || obj.AAM.M.TA[2] != AI.y)
                        return false
                    return true
                })

                const executionDuration = ((Date.now() - executionStartTime) / 1000).toFixed(2);
                obj.executionDuration = executionDuration; // Pass it out
                obj.soldierCount = finalTroopCount;

                return { ...obj, result: r, executionDuration }
            })

            if (!attackInfo) {
                freeCommander(commander.lordID)
                return false
            }
            if (attackInfo.result != 0)
                throw err[attackInfo.result]

            // If target was skipped (no AAM), just continue
            if (!attackInfo.AAM) {
                return true
            }

            const kingdomNames = { 0: "Great Empire", 1: "Burning Sands", 2: "Everwinter Glacier", 3: "Fire Peaks", 4: "Storm Islands" }
            const kingdomName = kingdomNames[kid] || `Kingdom ${kid}`;
            const soldierCount = attackInfo.soldierCount;

            // Saldiri sayacini artir
            const currentHits = incrementAttackCounter()

            console.info(`[${name}] Hitting target C${attackInfo.AAM.UM.L.VIS + 1} ${attackInfo.AAM.M.TA[1]}:${attackInfo.AAM.M.TA[2]} in ${kingdomName} | Troops: ${soldierCount} | Hits: ${currentHits} | Prep: ${attackInfo.executionDuration}s | ${pretty(Math.round(1000000000 * Math.abs(Math.max(0, attackInfo.AAM.M.TT - attackInfo.AAM.M.PT))), 's') + " till impact"}`)

            // Hedef limite ulasildi mi kontrol et
            if (hasReachedAttackLimit()) {
                const targetHits = parseInt(pluginOptions.attackLimitTarget) || 0
                console.warn(`[${name}] Hedef saldiri limitine ulasildi (${currentHits}/${targetHits}). Saldiri durduruluyor.`)
                return false // Saldiri dongusunu durdur
            }

            return true
        } catch (e) {
            freeCommander(commander.lordID)
            switch (e) {
                case "NO_MORE_TROOPS":
                    // Sarı log - tek sefer göster, sonra sessiz 5sn tarama
                    console.warn(`[${name}] Envanterde asker yok, bekleniyor...`)
                    // Sessiz döngü: 5 saniyede bir envanter kontrolü
                    while (true) {
                        await sleep(5 * 1000) // 5 saniye bekle
                        const checkCastle = (await ClientCommands.getDetailedCastleList()())
                            .castles.find(a => a.kingdomID == kid)
                            ?.areaInfo.find(a => a.areaID == sourceCastleArea.extraData[0])
                        if (checkCastle && checkCastle.unitInventory) {
                            let totalTroops = 0
                            checkCastle.unitInventory.forEach(u => {
                                const unitInfo = units.find(obj => u.unitID == obj.wodID)
                                if (unitInfo && unitInfo.fightType == 0 && !troopBlackList.includes(unitInfo.wodID)) {
                                    totalTroops += u.ammount
                                }
                            })
                            if (totalTroops >= minTroopCount) {
                                break // Asker bulundu, döngüden çık
                            }
                        }
                    }
                    return true // Saldırıya devam
                case "LORD_IS_USED":
                    useCommander(commander.lordID)
                case "COOLING_DOWN":
                case "TIMED_OUT":
                    return true
                case "MISSING_UNITS":
                    // Kırmızı log - CRA sunucu tarafından reddedildi
                    console.error(`[${name}] Asker veya alet eksik, saldırı durduruluyor 3 dakika`)
                    await sleep(3 * 60 * 1000) // 3 dakika bekle
                    return true // Retry
                case "ATTACK_TOO_MANY_UNITS":
                    tooManyUnitsErrorCount++
                    console.warn(`[${name}] Çok fazla asker hatası (${tooManyUnitsErrorCount}/2), hedef atlanıyor`)
                    if (tooManyUnitsErrorCount >= 2) {
                        console.error(`[${name}] 2 kez ATTACK_TOO_MANY_UNITS hatası alındı, bot kapatılıyor...`)
                        process.exit(1)
                    }
                    return true
                case "CANT_START_NEW_ARMIES":
                default:
                    throw e
            }
        }
    }
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

        let areaInfo = gaa.areaInfo.filter(ai => ai.type == type).sort((a, b) => {
            let d1 = Math.sqrt(Math.pow(sourceCastleArea.x - a.x, 2) + Math.pow(sourceCastleArea.y - a.y, 2))
            let d2 = Math.sqrt(Math.pow(sourceCastleArea.x - b.x, 2) + Math.pow(sourceCastleArea.y - b.y, 2))
            if (d1 < d2)
                return -1
            if (d1 > d2)
                return 1
        })
        const timeSinceEpoch = Date.now()
        areaInfo.forEach(ai =>
            towerTime.set(ai, timeSinceEpoch + ai.extraData[2] * 1000))

        sortedAreaInfo = sortedAreaInfo.concat(areaInfo)

        while (await sendHit());
    }

    sortedAreaInfo.sort((a, b) => {
        let d1 = Math.sqrt(Math.pow(sourceCastleArea.x - a.x, 2) + Math.pow(sourceCastleArea.y - a.y, 2))
        let d2 = Math.sqrt(Math.pow(sourceCastleArea.x - b.x, 2) + Math.pow(sourceCastleArea.y - b.y, 2))
        return d1 - d2
    })

    while (true) {
        let minimumTimeTillHit = Infinity
        sortedAreaInfo.forEach(e =>
            minimumTimeTillHit = Math.min(minimumTimeTillHit, towerTime.get(e)))

        await new Promise(r => setTimeout(r, (Math.max(0, minimumTimeTillHit - Date.now()))).unref())

        while (await sendHit());
    }
}

module.exports = barronHit