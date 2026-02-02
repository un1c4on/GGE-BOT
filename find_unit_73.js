
const fs = require('fs');
const units = JSON.parse(fs.readFileSync('/home/un1c4on/GGE-BOT/items/units.json', 'utf8'));

const u73 = units.find(u => u.wodID == 73);
console.log("Unit 73:", u73);

const nonBarracksUnits = units.filter(u => u.name === "Barracks" && u.group !== "Unit");
console.log("Non-Unit Barracks items:", nonBarracksUnits.length);
