
const fs = require('fs');
const units = JSON.parse(fs.readFileSync('/home/un1c4on/GGE-BOT/items/units.json', 'utf8'));

const barracksUnits = units.filter(u => u.name === "Barracks");
console.log(`Found ${barracksUnits.length} barracks units.`);

const summary = barracksUnits.map(u => ({
    wodID: u.wodID,
    type: u.type,
    comment2: u.comment2
}));

console.log(JSON.stringify(summary, null, 2));
