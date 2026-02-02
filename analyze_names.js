
const fs = require('fs');
const units = JSON.parse(fs.readFileSync('/home/un1c4on/GGE-BOT/items/units.json', 'utf8'));

const names = {};
units.forEach(u => {
    names[u.name] = (names[u.name] || 0) + 1;
});

console.log(JSON.stringify(names, null, 2));
