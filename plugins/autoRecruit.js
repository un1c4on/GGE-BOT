const { isMainThread } = require('node:worker_threads')
const path = require('path')
const name = "autoRecruit"

if (isMainThread) {
    let barracksUnits = []
    try {
        const unitsData = require('../items/units.json')
        barracksUnits = unitsData
            .filter(u => u.name === "Barracks" && u.group === "Unit")
            .sort((a, b) => parseFloat(a.sortOrder || 0) - parseFloat(b.sortOrder || 0))
            .map(u => ({
                label: `${u.comment2 || u.type} (ID: ${u.wodID})`,
                value: u.wodID
            }))
    } catch (e) {
        console.error("[AutoRecruit] Gelişmiş birim listesi yüklenemedi, varsayılanlar kullanılıyor.", e.message)
        barracksUnits = [
            { label: "Spearman (602)", value: 602 },
            { label: "Bowman (608)", value: 608 }
        ]
    }

    module.exports = {
        name: name,
        description: "Auto recruits units and requests alliance help.",
        pluginOptions: [
            { type: "Select", label: "Unit", key: "unitID", default: 602, selection: barracksUnits },
            { type: "Checkbox", label: "Recruit Max Capacity", key: "recruitMax", default: false },
            { type: "Text", label: "Default Amount", key: "amount", default: 200 },
            { type: "Text", label: "Barracks Type IDs", key: "barracksTypes", default: "6" },
            { type: "MultiSelect", label: "Selected Units (Quick Select)", key: "selectedUnits", selection: barracksUnits, default: [] },
            {
                type: "TextArea",
                label: "Units Config (Advanced - JSON)",
                key: "unitsConfig",
                default: JSON.stringify([
                    { unitID: 602, amount: 200, enabled: true },
                    { unitID: 608, amount: 150, enabled: true }
                ], null, 2),
                rows: 8
            }
        ]
    }
    return
}


const { events, botConfig, sendXT, xtHandler, waitForResult, syncStatus } = require("../ggebot")
const { KingdomID } = require("../protocols.js")


const pluginOptions = botConfig.plugins[path.basename(__filename).slice(0, -3)] ??= {}
const unitID = Number(pluginOptions.unitID || 602)
const recruitMax = pluginOptions.recruitMax === true || String(pluginOptions.recruitMax) === "true"
const rawAmount = Number(pluginOptions.amount || 200)
const defaultAmount = rawAmount < 1 ? 200 : rawAmount // Relaxed constraint slightly but generally keep logical default
const barracksTypes = (pluginOptions.barracksTypes || "6").split(",").map(Number)
const selectedUnits = pluginOptions.selectedUnits || [] // Quick checkbox selection

// Advanced JSON config parsing
let unitsConfig = []
try {
    if (pluginOptions.unitsConfig && typeof pluginOptions.unitsConfig === 'string') {
        unitsConfig = JSON.parse(pluginOptions.unitsConfig)
        console.log(`[Otomatik Asker Basma] ✅ Units Config yüklendi:`, unitsConfig.length, 'birim')
    }
} catch (e) {
    console.error(`[Otomatik Asker Basma] ❌ Units Config JSON parse hatası:`, e.message)
    unitsConfig = []
}

// 🆕 Recruitment Logs (UI'a gönderilecek)
const recruitmentLogs = []
const MAX_LOGS = 50 // Son 50 log tut

function addRecruitmentLog(areaName, areaID, unitID, amount, success, message = '') {
    const timestamp = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

    recruitmentLogs.unshift({
        timestamp,
        areaName,
        areaID,
        unitID,
        amount,
        success,
        message
    })

    // Maksimum log sayısını aş, eskiyi sil
    if (recruitmentLogs.length > MAX_LOGS) {
        recruitmentLogs.pop()
    }

    // UI'a gönder
    syncStatus({ recruitmentLogs: [...recruitmentLogs] })
}

// 6 Saatlik Döngü (6 saat * 60 dk * 60 sn * 1000 ms)
const RECRUIT_INTERVAL = 6 * 60 * 60 * 1000
let recruitLoop

events.once("load", async () => {
    console.log(`[Otomatik Asker Basma] Başlatıldı. Default ID: ${unitID}, Max Modu: ${recruitMax ? 'AÇIK' : 'KAPALI'}, Default Miktar: ${defaultAmount}.`);

    // Seçilen birimleri logla (MultiSelect - Quick)
    if (selectedUnits && selectedUnits.length > 0) {
        console.log(`[Otomatik Asker Basma] 🎯 Quick Select Birimleri:`, selectedUnits.join(', '));
    }

    // JSON Config loglama (Advanced)
    if (unitsConfig && unitsConfig.length > 0) {
        const enabledUnits = unitsConfig.filter(u => u.enabled !== false)
        console.log(`[Otomatik Asker Basma] 📋 Advanced Config: ${enabledUnits.length}/${unitsConfig.length} aktif birim`);
        enabledUnits.forEach(u => {
            console.log(`   - Unit ${u.unitID}: ${u.amount === -1 ? 'MAX' : u.amount} adet`);
        });
    }

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
            if (c.AI) c.AI.forEach(a => areas.push({ AID: a.AID, KID: c.KID, KName: kName }));
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
    try {
        sendXT("jca", JSON.stringify({ CID: area.AID, KID: area.KID }));
        await new Promise(r => setTimeout(r, 2000));

        sendXT("spl", JSON.stringify({ LID: 0 }));
        const [splData, result] = await waitForResult("spl", 4000).catch(() => [null, -1]);

        if (splData && splData.PS && splData.PS.WID) {
            const type = splData.PS.TUA;
            const wid = splData.PS.WID;

            // Kışla kontrolü
            if (barracksTypes.includes(type)) {
                // Boş slot kontrolü
                const totalSlots = splData.QS ? splData.QS.length : 5;
                const occupiedSlots = splData.QS ? splData.QS.filter(slot => slot.P).length : 0;
                const freeSlots = totalSlots - occupiedSlots;

                console.log(`[Otomatik Asker Basma] 🏰 ${area.KName} - Kuyruk: ${occupiedSlots}/${totalSlots}, Boş Slot: ${freeSlots}`);

                if (freeSlots <= 0) {
                    console.log(`[Otomatik Asker Basma] ⏭️ ${area.KName} - Tüm slotlar dolu, atlanıyor`);
                    addRecruitmentLog(area.KName, area.AID, 0, 0, false, 'Tüm slotlar dolu');
                    return;
                }

                // Hangi birimi basacağız? (TEK BİRİM SEÇ)
                let unitToRecruit = null;
                let amountToRecruit = defaultAmount;
                let useMax = false;
                let source = '';

                // YOL 1: Advanced JSON Config
                if (unitsConfig && unitsConfig.length > 0) {
                    const enabledUnits = unitsConfig.filter(u => u.enabled !== false);
                    if (enabledUnits.length > 0) {
                        const unitConfig = enabledUnits[0];
                        unitToRecruit = unitConfig.unitID;

                        if (unitConfig.amount === -1) {
                            useMax = true;
                        } else {
                            amountToRecruit = unitConfig.amount || defaultAmount;
                        }
                        source = 'JSON Config';
                    }
                }

                // YOL 2: Quick Select
                if (!unitToRecruit && selectedUnits && selectedUnits.length > 0) {
                    unitToRecruit = selectedUnits[0];
                    useMax = recruitMax;
                    source = 'Quick Select';
                }

                // YOL 3: Default Fallback
                if (!unitToRecruit) {
                    unitToRecruit = unitID;
                    useMax = recruitMax;
                    source = 'Default';
                }

                console.log(`[Otomatik Asker Basma] 🎯 ${source}: Unit ${unitToRecruit} - ${freeSlots} slot doldurulacak`);

                // Tüm boş slotları AYNI BİRİMLE doldur
                let filledSlots = 0;
                for (let i = 0; i < freeSlots; i++) {
                    let finalAmount = amountToRecruit;

                    // MAX capacity gerekiyorsa
                    if (useMax) {
                        finalAmount = await getMaxCapacity();
                    }

                    recruitUnit(area.AID, wid, area.KID, area.KName, finalAmount, unitToRecruit);

                    const logType = useMax ? `[MAX: ${finalAmount}]` : `[Miktar: ${finalAmount}]`;
                    console.log(`[Otomatik Asker Basma] ✅ ${area.KName} Slot ${i + 1}: ${finalAmount} adet Unit ${unitToRecruit} basıldı. ${logType}`);

                    addRecruitmentLog(area.KName, area.AID, unitToRecruit, finalAmount, true, `${source} Slot ${i + 1} ${logType}`);

                    filledSlots++;
                    await new Promise(r => setTimeout(r, 500));
                }

                // Yardım isteği
                if (filledSlots > 0) {
                    sendXT("ahr", JSON.stringify({ ID: 0, T: 6 }));
                    console.log(`[Otomatik Asker Basma] 🤝 ${area.KName} - ${filledSlots} slot dolduruldu, yardım istendi`);
                }
            }
        }
    } catch (e) {
        console.error(`[Otomatik Asker Basma] Bölge işlem hatası (${area.AID}):`, e);
    }

    // Helper: Max capacity elde et
    async function getMaxCapacity() {
        return new Promise((resolve) => {
            let maxCap = defaultAmount;
            const timeout = setTimeout(() => {
                xtHandler.removeListener("rue", rueOnce);
                resolve(maxCap);
            }, 1500);

            const rueOnce = (data) => {
                if (data && data.NUA > 0) {
                    maxCap = data.NUA;
                    clearTimeout(timeout);
                    xtHandler.removeListener("rue", rueOnce);
                    resolve(maxCap);
                }
            };

            xtHandler.on("rue", rueOnce);
        });
    }
}

function recruitUnit(areaID, buildingID, kid, kingdomName, qty, unitIdOverride) {
    const finalUnitID = unitIdOverride !== undefined ? unitIdOverride : unitID;

    const params = {
        LID: 0,
        WID: buildingID,
        AMT: qty,
        PO: -1,
        PWR: 0,
        SK: finalUnitID,
        SID: kid,
        AID: areaID
    };

    console.log(`[Otomatik Asker Basma] 📤 bup komutu:`, JSON.stringify(params));
    sendXT("bup", JSON.stringify(params));
}