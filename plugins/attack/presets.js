const { playerInfo } = require("../../ggebot")
const units = require("../../items/units.json")

/**
 * Returns the standard plugin options for enabling Game Presets.
 * @returns {Array} Array of option objects
 */
function getPresetOptions() {
    return [
        {
            type: "Checkbox",
            label: "Use Game Preset",
            key: "useGamePreset",
            default: false
        },
        {
            type: "Select",
            label: "Preset Slot",
            description: "Select which preset slot to use (1-8)",
            key: "presetID",
            default: 0,
            selection: [
                "Slot 1",
                "Slot 2",
                "Slot 3",
                "Slot 4",
                "Slot 5",
                "Slot 6",
                "Slot 7",
                "Slot 8"
            ]
        },
        {
            type: "Select",
            label: "Max Waves",
            key: "maxWaves",
            default: 3,
            selection: ["1", "2", "3", "4"]
        }
    ];
}

/**
 * Applies a game preset to the attackInfo object.
 * @param {Object} attackInfo - The attack protocol object (cra payload).
 * @param {String|Number} presetID - The ID of the preset to apply.
 * @param {Number} maxWaves - Maximum number of waves to fill (1-4).
 * @returns {Object} Result object { success: boolean, error?: string }
 */
function applyPreset(attackInfo, presetID, maxWaves) {
    if (!attackInfo || !attackInfo.A) return { success: false, error: "Invalid attackInfo" };

    // Backend uses 0-based IDs: Slot 1 = ID 0, Slot 2 = ID 1, etc.
    const pid = Number(presetID);
    const preset = playerInfo.presets ? playerInfo.presets.find(p => p.id == pid) : null;

    if (!preset) {
        return { success: false, error: "PRESET_NOT_FOUND" };
    }

    // console.log(`[Presets] Applying Preset [${preset.name}] (Slot ${preset.id}) - Max Waves: ${maxWaves}`);

    try {
        let armySetup = preset.army;
        if (typeof armySetup === 'string') {
            armySetup = JSON.parse(armySetup);
        }

        if (!Array.isArray(armySetup)) {
            return { success: false, error: "INVALID_PRESET_DATA" };
        }

        // Clear existing default setup in attackInfo for the waves we are about to fill
        // Note: We clear all because the preset might assume a clean slate
        attackInfo.A.forEach(w => { w.L.U = []; w.L.T = []; w.M.U = []; w.M.T = []; w.R.U = []; w.R.T = []; });

        // Mapping: [T_Mid, T_Left, T_Right, U_Mid, U_Left, U_Right]
        // Index 0-2: Tools
        // Index 3-5: Units
        // Side Order: Mid(M), Left(L), Right(R)
        const sides = ['M', 'L', 'R'];

        armySetup.forEach((slotData, index) => {
            if (!Array.isArray(slotData) || slotData.length === 0) return;

            // Presets usually define a single wave setup that repeats? 
            // Or does the game export all waves flattened? 
            // Based on previous code, it seemed to treat it as a template for *each* wave or just the first.
            // The previous code in berikingdom.js only applied it to `waveIdx = 0`. 
            // However, usually presets in GGE are "Wave independent" templates or specific wave setups.
            // If the user wants 4 waves of this preset, we should copy it to all waves.

            // For now, let's replicate the previous logic: It seemed to only fill wave 0.
            // WAIT, usually a preset is applied to ALL available waves in an auto-attacker context unless specified.
            // Let's iterate over `maxWaves` and apply this template.

            for (let waveIdx = 0; waveIdx < maxWaves; waveIdx++) {
                // 0-2: Tools, 3-5: Units
                const isUnitGroup = index >= 3;
                const sideIndex = index % 3;
                const sideKey = sides[sideIndex];

                // slotData: [id, count, id, count...]
                for (let k = 0; k < slotData.length; k += 2) {
                    const id = slotData[k];
                    const count = slotData[k + 1];
                    if (!id || !count) continue;

                    const itemDef = units.find(u => u.wodID == id);
                    if (!itemDef) continue;

                    // Verify if item matches the group type (Unit vs Tool) just to be safe, 
                    // though the index usually dictates it.
                    const isItemUnit = itemDef.role === 'melee' || itemDef.role === 'ranged';

                    // If we are in tool slots (0-2) but item is unit, or vice versa, skip?
                    // The previous logic didn't strictly enforce index-based type checking, it checked the itemDef.
                    // Let's stick to itemDef.

                    if (!attackInfo.A[waveIdx] || !attackInfo.A[waveIdx][sideKey]) continue;

                    const targetArr = isItemUnit ? attackInfo.A[waveIdx][sideKey].U : attackInfo.A[waveIdx][sideKey].T;
                    const slotLimit = isItemUnit ? 1 : 10; // 1 slot for units, 10 for tools

                    let placed = false;
                    for (let s = 0; s < slotLimit; s++) {
                        if (!targetArr[s]) {
                            targetArr[s] = [id, count];
                            placed = true;
                            break;
                        }
                    }
                }
            }
        });

        return { success: true, presetName: preset.name };

    } catch (e) {
        console.error(`[Presets] Error applying preset:`, e);
        return { success: false, error: "PRESET_APPLY_ERROR" };
    }
}

module.exports = {
    getPresetOptions,
    applyPreset
};
