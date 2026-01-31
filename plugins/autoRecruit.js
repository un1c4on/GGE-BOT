const { isMainThread } = require('node:worker_threads')
const name = "AutoRecruit"

if (isMainThread) {
    module.exports = {
        name: name,
        description: "Auto recruits units and requests alliance help.",
        pluginOptions: [
            { type: "Text", label: "Unit ID (SK)", key: "unitID", default: 73 },
            { type: "Text", label: "Default Amount", key: "amount", default: 200 },
            { type: "Text", label: "Barracks Type IDs", key: "barracksTypes", default: "6" }
        ]
    }
    return
}

const { events, botConfig, sendXT, xtHandler, waitForResult } = require("../ggebot")
const { KingdomID } = require("../protocols.js")

const pluginOptions = botConfig.plugins[require('path').basename(__filename).slice(0, -3)] ??= {}
const unitID = Number(pluginOptions.unitID || 73)
const rawAmount = Number(pluginOptions.amount || 200)
const defaultAmount = rawAmount < 200 ? 200 : rawAmount
const barracksTypes = (pluginOptions.barracksTypes || "6").split(",").map(Number)

// 6 Saatlik Döngü (6 saat * 60 dk * 60 sn * 1000 ms)
const RECRUIT_INTERVAL = 6 * 60 * 60 * 1000
let recruitLoop

events.once("load", async () => {
    // Logları Türkçe tutmaya devam ediyorum, sadece arayüz anahtarları İngilizce oldu.
    console.log(`[Otomatik Asker Basma] Başlatıldı. Asker: ${unitID}, Hedef Miktar: ${defaultAmount}.`);
    setTimeout(runCycle, 10000); 
    recruitLoop = setInterval(runCycle, RECRUIT_INTERVAL)
})

events.on("unload", () => {
    if (recruitLoop) clearInterval(recruitLoop)
})

async function runCycle() {
    console.log(`[Otomatik Asker Basma] Döngü başlatılıyor...`);
    
    try {
        sendXT("dcl", JSON.stringify({ CD: 1 }));
        const [dclData, _] = await waitForResult("dcl", 5000).catch(() => [null, -1]);
        
        if (!dclData || !dclData.C) {
            console.warn(`[Otomatik Asker Basma] Kale listesi alınamadı.`);
            return;
        }

        const areas = [];
        dclData.C.forEach(c => {
            const kName = KingdomID[c.KID] || `Krallık ${c.KID}`;
            if(c.AI) c.AI.forEach(a => areas.push({ AID: a.AID, KID: c.KID, KName: kName }));
        });

        console.log(`[Otomatik Asker Basma] Toplam ${areas.length} bölge bulundu. Sırayla işleniyor...`);

        for (const area of areas) {
            await processArea(area);
            await new Promise(r => setTimeout(r, 3000));
        }
        
        console.log(`[Otomatik Asker Basma] Döngü tamamlandı.`);

    } catch (error) {
        console.error(`[Otomatik Asker Basma] Döngü Hatası:`, error);
    }
}

async function processArea(area) {
    let recruitAmount = defaultAmount;
    let usedMax = false;

    const rueListener = (data) => {
        if (data && data.NUA > 0) {
            recruitAmount = data.NUA;
            usedMax = true;
        }
    };

    try {
        xtHandler.on("rue", rueListener);
        sendXT("jca", JSON.stringify({ CID: area.AID, KID: area.KID }));
        
        await new Promise(r => setTimeout(r, 2000));

        sendXT("spl", JSON.stringify({ LID: 0 }));
        const [splData, result] = await waitForResult("spl", 4000).catch(() => [null, -1]);

        if (splData && splData.PS && splData.PS.WID) {
            const type = splData.PS.TUA;
            const wid = splData.PS.WID;

            if (barracksTypes.includes(type)) {
                recruitUnit(area.AID, wid, area.KID, area.KName, recruitAmount);
                sendXT("ahr", JSON.stringify({ ID: 0, T: 6 }));
                
                const logType = usedMax ? '[MAX KAPASİTE]' : `[VARSAYILAN: ${defaultAmount}]`;
                console.log(`[Otomatik Asker Basma] ${area.KName} (${area.AID}): ${recruitAmount} asker basıldı ve yardım istendi. ${logType}`);

                await new Promise(r => setTimeout(r, 1000));
            }
        }

    } catch (e) {
    } finally {
        xtHandler.removeListener("rue", rueListener);
    }
}

function recruitUnit(areaID, buildingID, kid, kingdomName, qty) {
    const params = {
        LID: 0,
        WID: buildingID,
        AMT: qty,
        PO: -1,
        PWR: 0,
        SK: unitID,
        SID: kid,
        AID: areaID
    };
    sendXT("bup", JSON.stringify(params));
}