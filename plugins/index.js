const path = require('node:path');
const fs = require("fs")
const ggeConfig = require("../ggeConfig.json")

const dir = fs.readdirSync(__dirname, {recursive : true})

const plugins = new Array(dir.length - 1)

dir.forEach(file => {
    if(file == path.basename(__filename))
        return
    
    // Exclude helper files/libraries from being loaded as plugins
    const lowerFile = file.toLowerCase();
    if (lowerFile.endsWith('presets.js') || 
        lowerFile.includes('shared') || 
        lowerFile.endsWith('attack.js')) // attack.js is a library, not a plugin
        return

    let pathSeperator = '/'
    if(process.platform == "win32")
         pathSeperator = '\\'

    if(fs.lstatSync(__dirname + pathSeperator + file).isDirectory())
        return 
    //Ew hacky...
    if((!ggeConfig.discordToken || !ggeConfig.discordClientId) && file.includes("discord"))
        return    

    if(path.extname(file) != ".js")
        return

    plugins.push([`plugins/${file.slice(0, -3)}`, require(path.join(__dirname, file))])
})

module.exports = plugins