const { isMainThread } = require('node:worker_threads')

const name = "Attack Berimond Kingdom"

if (isMainThread) {
    module.exports = {
        name: name,
        description: "Hardcoded Attack + Fixed Transfer Logic",
        pluginOptions: [
            {
                type: "Text",
                label: "Com White List",
                key: "commanderWhiteList"
            },
            {
                type: "Checkbox",
                label: "Auto Transfer Troops (Every 15m)",
                key: "transferWeakTroops",
                default: true
            },
            {
                type: "Checkbox",
                label: "Use Time Skips",
                key: "useTimeSkips",
                default: true
            },
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
            }
        ]
    }
    return; 
}

console.log(`[${name}] Plugin Loaded!`)

const { Types, getResourceCastleList, ClientCommands, areaInfoLock, AreaType, KingdomID, getKingdomInfoList, KingdomSkipType, spendSkip } = require('../../protocols')
const { waitToAttack, getAttackInfo, assignUnit, getAmountSoldiersFlank, getAmountSoldiersFront, getTotalAmountToolsFlank, getTotalAmountToolsFront, getMaxUnitsInReinforcementWave, sleep, boxMullerRandom } = require("../../plugins/attack/attack")
const { waitForCommanderAvailable, freeCommander, useCommander, movementEvents } = require("../../plugins/commander")
const { sendXT, waitForResult, xtHandler, events, botConfig, playerInfo } = require("../../ggebot")
const units = require("../../items/units.json")
const pretty = require('pretty-time')

const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ?? {}
pluginOptions.useFeather ??= false
pluginOptions.useCoin ??= false
pluginOptions.transferWeakTroops ??= true
pluginOptions.useTimeSkips ??= true

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

const localInventoryAdjustment = new Map(); 
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

        sendXT("fuc", JSON.stringify({CID: beriCastle.extraData[0]}))
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
                       const power = Math.max(Number(unitInfo.meleeAttack||0), Number(unitInfo.rangeAttack||0));
                       if (power > 100) transferCandidates.push([unitInfo, u.ammount]);
                   }
                })

                transferCandidates.sort((a, b) => {
                    const pA = Math.max(Number(a[0].meleeAttack||0), Number(a[0].rangeAttack||0));
                    const pB = Math.max(Number(b[0].meleeAttack||0), Number(b[0].rangeAttack||0));
                    return pA - pB;
                })

                let sendTroops = []; let limit = troopSendLimit;
                let logDetails = [];

                for(let i=0; i<10; i++) { 
                    let slot = [-1, 0]; 
                    let assigned = assignUnit(slot, transferCandidates, limit);
                    limit -= assigned; 
                    if (slot[0] != -1) {
                        sendTroops.push(slot);
                        logDetails.push(`ID ${slot[0]}: ${slot[1]}`);
                    }
                    if(limit <= 0) break;
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
    } catch(e) { console.error(`[${name}] Transfer Error:`, e) }
}

const startLogic = async () => {
    console.log(`[${name}] Logic Started.`)
    await transferTroopsLogic(); 
    setInterval(transferTroopsLogic, 15 * 60 * 1000);

    await getKingdomInfoList(); 
    let resourceCastleList = await getResourceCastleList()
    let sourceCastleArea = resourceCastleList.castles.find(e => e.kingdomID == kid)?.areaInfo.find(e => e.type == AreaType.beriCastle);

    while (true) {
        try {
            if (!sourceCastleArea) {
                 const rcl = await getResourceCastleList()
                 sourceCastleArea = rcl.castles.find(e => e.kingdomID == kid)?.areaInfo.find(e => e.type == AreaType.beriCastle);
                 if(!sourceCastleArea) { await sleep(10000); continue; }
            }

            const sourceCastle = (await ClientCommands.getDetailedCastleList()())
                .castles.find(a => a.kingdomID == kid)
                .areaInfo.find(a => a.areaID == sourceCastleArea.extraData[0])

            sourceCastle.unitInventory.forEach(u => {
                if (localInventoryAdjustment.has(u.unitID)) {
                    u.ammount -= localInventoryAdjustment.get(u.unitID);
                    if(u.ammount < 0) u.ammount = 0;
                }
            });

            let availableTroops = [];
            let inventoryLog = [];

            sourceCastle.unitInventory.forEach(u => {
                const unitInfo = units.find(obj => u.unitID == obj.wodID)
                if (!unitInfo || u.ammount <= 0) return;
                if (unitInfo.role == "melee" || unitInfo.role == "ranged") {
                    availableTroops.push([unitInfo, u.ammount]);
                    inventoryLog.push(`${u.unitID}: ${u.ammount}`);
                }
            });

            let totalStrong = availableTroops.reduce((a,b)=>a+b[1],0);
            if (inventoryLog.length > 0) console.log(`[${name}] Inventory: [${inventoryLog.join(", ")}] (Total: ${totalStrong})`)

            // MINIMUM 30 ASKER ŞARTI (Saldırı için)
            if (totalStrong < 30) {
                console.log(`[${name}] Not enough troops (${totalStrong}/30). Waiting 30s...`)
                await sleep(30000); // 30 Saniye bekleme
                continue;
            }

            if (totalStrong < 60) {
                console.log(`[${name}] Low troops (${totalStrong}). Waiting...`)
                await sleep(30000); // 30 Saniye bekleme
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
                for(let i=0; i<10; i++) { if(targetCache) break; await new Promise(r => setTimeout(r, 500)); }
                if (!targetCache) return { result: "NO_TARGET" }
                await sleep(delayMs) 

                const targetArea = (await ClientCommands.getAreaInfo(kid, targetCache.x, targetCache.y, targetCache.x, targetCache.y)()).areaInfo[0]
                if(!targetArea) return { result: "INVALID_TARGET" }

                const attackInfo = getAttackInfo(kid, sourceCastleArea, targetArea, commander, 70, 1, pluginOptions.useCoin)
                if (pluginOptions.useFeather) attackInfo.PTT = 2;

                const findUnit = (id) => sourceCastle.unitInventory.find(u => u.unitID == id);
                const t651 = findUnit(651); const t776 = findUnit(776); const t16 = findUnit(16); const t775 = findUnit(775);
                
                availableTroops.sort((a, b) => Math.max(Number(b[0].meleeAttack||0), Number(b[0].rangeAttack||0)) - Math.max(Number(a[0].meleeAttack||0), Number(a[0].rangeAttack||0)));
                let fakeTroops = [...availableTroops].reverse();

                if (!t651 || t651.ammount < 10 || !t776 || t776.ammount < 20 || !t16 || t16.ammount < 55 || !t775 || t775.ammount < 15) return { result: "MISSING_ITEMS" }

                const wave = attackInfo.A[0];
                wave.L.T[0] = [651, 10]; wave.L.T[1] = [776, 20]; assignUnit(wave.L.U[0], availableTroops, 54);
                wave.R.T[0] = [16, 30]; assignUnit(wave.R.U[0], fakeTroops, 1);
                wave.M.T[0] = [16, 25]; wave.M.T[1] = [775, 15]; assignUnit(wave.M.U[0], fakeTroops, 1);

                const usedUnits = {};
                const track = (slot) => { if (slot[0] != -1) usedUnits[slot[0]] = (usedUnits[slot[0]] || 0) + slot[1]; };
                track(wave.L.U[0]); track(wave.R.U[0]); track(wave.M.U[0]);

                await areaInfoLock(() => sendXT("cra", JSON.stringify(attackInfo)))
                let [obj, r] = await waitForResult("cra", 10000, (o, res) => true)
                if (r == 0) {
                    for (const [id, amount] of Object.entries(usedUnits)) {
                        localInventoryAdjustment.set(Number(id), (localInventoryAdjustment.get(Number(id)) || 0) + amount);
                    }
                }
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