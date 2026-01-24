const { isMainThread } = require('node:worker_threads')

const name = "Smart Support"
if (isMainThread) {
    module.exports = {
        name: name,
        description: "Tüm krallıklardaki askerleri belirlenen hedeflere boşaltır.",
        pluginOptions: [
            // --- GENERAL SETTINGS ---
            { type: "Label", label: "Genel Ayarlar" },
            { type: "Text", label: "Destek Süresi (Saat - Max 12)", key: "supportDuration", default: "1" },
            { type: "Text", label: "Minimum Asker Sayısı", key: "minAmount", default: "10" },

            // --- KINGDOM TABLE ---
            { type: "Label", label: "Krallık Hedefleri" },
            {
                type: "Table",
                // Table structure is processed as 4 columns by pluginsTable.js
                row: ["Krallık", "Aktif", "Hedef X", "Hedef Y"],
                data: [
                    // GREEN
                    { type: "Label", label: "Yeşil", key: "lbl_gr" },
                    { type: "Checkbox", label: "", key: "activeGreen", default: false },
                    { type: "Text", label: "X", key: "targetX_Green", default: "" },
                    { type: "Text", label: "Y", key: "targetY_Green", default: "" },

                    // GLACIER
                    { type: "Label", label: "Buzul", key: "lbl_gl" },
                    { type: "Checkbox", label: "", key: "activeGlacier", default: false },
                    { type: "Text", label: "X", key: "targetX_Glacier", default: "" },
                    { type: "Text", label: "Y", key: "targetY_Glacier", default: "" },

                    // SAND
                    { type: "Label", label: "Çöl", key: "lbl_sa" },
                    { type: "Checkbox", label: "", key: "activeSand", default: false },
                    { type: "Text", label: "X", key: "targetX_Sand", default: "" },
                    { type: "Text", label: "Y", key: "targetY_Sand", default: "" },

                    // FIRE
                    { type: "Label", label: "Ateş", key: "lbl_fi" },
                    { type: "Checkbox", label: "", key: "activeFire", default: false },
                    { type: "Text", label: "X", key: "targetX_Fire", default: "" },
                    { type: "Text", label: "Y", key: "targetY_Fire", default: "" }
                ]
            }
        ]
    }
    return
}

const { botConfig, events, sendXT, waitForResult } = require('../ggebot')
const { ClientCommands, KingdomID } = require('../protocols')
const { waitToAttack } = require('./attack/attack')
const { waitForCommanderAvailable, freeCommander } = require('./commander')
const err = require('../err.json')

let unitsDB = []
try {
    unitsDB = require('../items/units.json')
} catch (e) {
    console.warn(`[${name}] Warning: units.json not found or could not be loaded.`)
}

const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ??= {}

const KINGDOMS = [
    { id: KingdomID.greatEmpire, name: "Great Empire", key: "Green" },
    { id: KingdomID.everWinterGlacier, name: "Everwinter Glacier", key: "Glacier" },
    { id: KingdomID.burningSands, name: "Burning Sands", key: "Sand" },
    { id: KingdomID.firePeaks, name: "Fire Peaks", key: "Fire" }
]

async function findCastleID(kingdomId, x, y) {
    try {
        const getAreaFunc = ClientCommands.getAreaInfo(kingdomId, x, y, x, y)
        const response = await getAreaFunc() 
        if (response && response.ownerInfo && response.ownerInfo.length > 0) {
            return response.ownerInfo[0].ownerID
        }
    } catch (e) {
        console.error(`[${name}] ID Lookup Error (KID:${kingdomId} X:${x} Y:${y}):`, e)
    }
    return null
}

async function processKingdom(kingdomConfig) {
    const kName = kingdomConfig.name
    const kKey = kingdomConfig.key
    const kID = kingdomConfig.id

    // Read Settings
    const isActive = pluginOptions[`active${kKey}`]
    const targetX = parseInt(pluginOptions[`targetX_${kKey}`])
    const targetY = parseInt(pluginOptions[`targetY_${kKey}`])
    const minAmount = parseInt(pluginOptions.minAmount) || 10
    
    // Resolve Duration Setting
    const duration = Math.max(1, parseInt(pluginOptions.supportDuration) || 1);

    if (!isActive) return;
    if (isNaN(targetX) || isNaN(targetY)) return;

    console.log(`[${name}] >>> Processing ${kName} (Target: ${targetX}:${targetY}) Duration: ${duration} Hours`)

    const targetPlayerID = await findCastleID(kID, targetX, targetY)
    if (!targetPlayerID) {
        console.error(`[${name}] ${kName} Target ID not found!`)
        return
    }

    const detailedCastleList = await ClientCommands.getDetailedCastleList()()
    const kingdomData = detailedCastleList.castles.find(c => c.kingdomID === kID)
    
    if (!kingdomData || !kingdomData.areaInfo) return

    const resourceCastleList = await require('../protocols').getResourceCastleList()
    const resourceKingdom = resourceCastleList.castles.find(c => c.kingdomID === kID)

    for (const castle of kingdomData.areaInfo) {
        // Find Castle Coordinates
        let myX = 0, myY = 0

        const match = resourceKingdom && resourceKingdom.areaInfo ? resourceKingdom.areaInfo.find(c => c.areaID === castle.areaID) : null
        
        if (castle.x && castle.y) {
            myX = castle.x; myY = castle.y
        } else if (match) { 
            myX = match.x; myY = match.y 
        }

        if (!myX || !myY) {
            // Process skipped if coordinates not found (log can be added)
        }

        // --- ADVANCED TROOP SELECTION ---

        const unitsToSend = []
        let totalTroops = 0

        for (const slot of castle.unitInventory) {
            const unitInfo = unitsDB.find(u => u.wodID == slot.unitID)
            
            // ONLY those with 'melee' or 'ranged' role
            const hasSoldierRole = unitInfo && (unitInfo.role === "melee" || unitInfo.role === "ranged");

            if (hasSoldierRole && slot.ammount > 0) {
                unitsToSend.push([slot.unitID, slot.ammount])
                totalTroops += slot.ammount
            }
        }

        if (totalTroops < minAmount) continue

        console.log(`[${name}] Starting Operation: Castle ID:${castle.areaID} -> ${totalTroops} Troops`)

        await waitToAttack(async () => {
            const commander = await waitForCommanderAvailable()
            if (!commander) return

            let success = false
            try {
                if (myX && myY) {
                    sendXT("sdi", JSON.stringify({ "TX": targetX, "TY": targetY, "SX": myX, "SY": myY }))
                    await new Promise(r => setTimeout(r, 500));
                }

                const supportPacket = {
                    "SID": castle.areaID,
                    "TX": targetX,
                    "TY": targetY,
                    "LID": commander.lordID,
                    "WT": duration, // Real Time
                    "HBW": -1,
                    "BPC": 0,
                    "PTT": 1, 
                    "SD": 0, 
                    "A": unitsToSend
                }

                sendXT("cds", JSON.stringify(supportPacket))

                const [res, code] = await waitForResult("cds", 8000)
                if (code == 0) {
                    success = true
                    console.log(`[${name}] SUCCESS: ${kName} (ID:${castle.areaID}) -> Duration: ${duration} Hours`)
                }

            } catch (e) {
                console.error(`[${name}] Error:`, e)
            } finally {
                if (!success) freeCommander(commander.lordID)
            }
        })
        await new Promise(r => setTimeout(r, 1000)); 
    }
}

async function startFullSupportTask() {
    console.log(`[${name}] --- SUPPORT TASK STARTED ---`)
    for (const kingdom of KINGDOMS) {
        await processKingdom(kingdom)
    }
    console.log(`[${name}] --- SUPPORT TASK FINISHED ---`)
}

events.on("load", () => {
    setTimeout(startFullSupportTask, 5000)
})