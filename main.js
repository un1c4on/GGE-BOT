const path = require('path')
const crypto = require('crypto')
const undici = require('undici')
const fs = require('fs/promises')
const http = require('node:http')
const express = require('express')
const https = require('node:https')
const bodyParser = require('body-parser')
const { WebSocketServer } = require("ws")
const {parseStringPromise} = require('xml2js')
const { Worker } = require('node:worker_threads')
const { Client, Events, GatewayIntentBits, PermissionFlagsBits } = require('discord.js')
const ErrorType = require('./errors.json')
const ActionType = require('./actions.json')

const { User: DBUser, GameAccount, BotConfig, sequelize, BotLog } = require('./database/models');
const { I18n } = require('i18n')
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');

const i18n = new I18n({
  locales: ['en', 'de', 'ar', 'fi', 'he', 'hu', 'pl', 'ro', 'tr'],
  directory: path.join(__dirname, 'website', 'public', 'locales')
})

const clientOptions = { 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildIntegrations,
  ]
}

const client = new Client(clientOptions)

const ggeConfigExample = `{
    "webPort" : "3001",
    "fontPath" : "",
    "privateKey" : "",
    "cert" : "",
    "signupToken" : "",
    "discordToken" : "",
    "discordClientId" : "",
    "discordClientSecret" : "",
    "timeoutMultiplier" : 1
}`

const loggedInUsers = {}
const botMap = new Map()

class User {
  constructor(obj) {
    if (obj == undefined) return
    this.id = obj.id ? Number(obj.id) : null
    this.state = obj.is_active ? 1 : (obj.state ?? 0)
    this.name = obj.name || obj.game_username || ""
    this.pass = obj.pass || obj.game_password_encrypted || ""
    this.server = obj.server || obj.game_server || "10"
    this.plugins = obj.plugins || {}
    
    if (obj.BotConfigs) {
      this.plugins = {}
      obj.BotConfigs.forEach(config => {
        this.plugins[config.plugin_name] = { 
          ...(typeof config.settings === 'object' ? config.settings : {}), 
          state: config.is_enabled 
        };
      });
    }
    this.externalEvent = !!(obj.externalEvent)
  }
}

const addUser = async (userId, user) => {
  return await GameAccount.create({
    UserId: userId,
    game_server: String(user.server || '10'),
    game_username: user.name,
    game_password_encrypted: user.pass,
    is_active: false
  });
}

const getSpecificUser = async (userId, user) => {
  if (isNaN(user.id)) return null;
  const row = await GameAccount.findOne({
    where: { 
      id: user.id,
      UserId: userId // Sadece bu kullanıcıya ait olan hesabı getir (IDOR Koruması)
    },
    include: [BotConfig, DBUser]
  });
  return row ? new User(row.get({ plain: true })) : null;
}

const changeUser = async (userId, user) => {
  if (isNaN(user.id)) return null;
  const gameAcc = await GameAccount.findOne({
    where: { 
      id: user.id,
      UserId: userId // Sadece bu kullanıcıya ait olan hesabı güncelle (IDOR Koruması)
    }
  });
  if (!gameAcc) return null;

  const updateData = {
// ... (bu kısım aynı kalacak)
    game_username: user.name,
    is_active: user.state == 1,
    game_server: user.server || '10'
  };

  if (user.pass && user.pass !== 'null' && user.pass !== '') {
    updateData.game_password_encrypted = user.pass;
  }

  await gameAcc.update(updateData);

  for (const [pluginName, pluginData] of Object.entries(user.plugins || {})) {
    await BotConfig.upsert({
      GameAccountId: gameAcc.id,
      plugin_name: pluginName,
      is_enabled: pluginData.state,
      settings: pluginData
    });
  }

  const updated = await GameAccount.findOne({
    where: { id: user.id },
    include: [BotConfig, DBUser]
  });
  return new User(updated.get({ plain: true }));
}

const removeUser = async (userId, user) => {
  if (isNaN(user.id)) return;
  await GameAccount.destroy({ where: { id: user.id, UserId: userId } });
}

const getUser = async userId => {
  if (userId && isNaN(userId)) return [];
  const where = userId ? { UserId: userId } : {};
  const rows = await GameAccount.findAll({
    where,
    include: [BotConfig, DBUser]
  });
  return rows.map(e => new User(e.get({ plain: true })));
}

async function start() {
  try { await fs.access('./ggeConfig.json') }
  catch { await fs.writeFile('./ggeConfig.json', ggeConfigExample); console.info(i18n.__('ggeConfigGenerated')) }
  
  const ggeConfig = JSON.parse((await fs.readFile('./ggeConfig.json')).toString())
  ggeConfig.webPort ??= '3001'

  if (ggeConfig.cert) await fs.access(ggeConfig.cert)
  if (ggeConfig.privateKey) await fs.access(ggeConfig.privateKey)

  let certFound = !!(ggeConfig.privateKey && ggeConfig.cert)
  let hasDiscord = !!(ggeConfig.discordToken && ggeConfig.discordClientId)

  let needLang = false
  async function getItemsJSON() {
    const response = await fetch('https://empire-html5.goodgamestudios.com/default/items/ItemsVersion.properties')
    const str = await response.text()
    let str2 = undefined
    try { str2 = (await fs.readFile('./ItemsVersion.properties')).toString() } catch {}
    let needItems = needLang = str != str2
    try { await fs.access('./items') } catch { needItems = true; await fs.mkdir('./items') }
    if (needItems) {
      await fs.writeFile('./ItemsVersion.properties', str)
      const response = await fetch(`https://empire-html5.goodgamestudios.com/default/items/items_v${str.match(new RegExp(/(?!.*=).*/))[0]}.json`)
      for (const [key, value] of Object.entries(await response.json())) {
        if (!/^[A-Za-z\_]+$/.test(key)) continue
        await fs.writeFile(`./items/${key}.json`, JSON.stringify(value))
      }
    }
  }

  async function getLangJSON() {
    try { await fs.access('./lang.json') } catch { needLang = true }
    if (needLang) {
      const response = await fetch('https://empire-html5.goodgamestudios.com/config/languages/4018/en.json')
      const str = await response.text()
      await fs.writeFile('./lang.json', str)
    }
  }
  async function getServerXML() {
    try { await fs.access('./1.xml') } catch { needLang = true }
    if (needLang) {
      const response = await fetch('https://empire-html5.goodgamestudios.com/config/network/1.xml')
      const str = await response.text()
      await fs.writeFile('./1.xml', str)
    }
  }

  await getItemsJSON(); await getLangJSON(); await getServerXML()

  const instances = []
  const xml = await parseStringPromise((await fs.readFile('./1.xml')).toString())
  xml.network.instances[0].instance.forEach(e => 
    instances.push({ gameURL: e.server[0], gameServer: e.zone[0], gameID: e['$'].value }))

  let pluginData = require('./plugins')
  try { pluginData = pluginData.concat(require('./plugins-extra')) } catch {}

  const plugins = pluginData
    .filter(e => !e[1].hidden)
    .map(e => ({ key: path.basename(e[0]), filename: e[0], name: e[1].name, description: e[1].description, force: e[1].force, pluginOptions: e[1]?.pluginOptions }))
    .sort((a, b) => (a.force ?? 0) - (b.force ?? 0))

  const loginCheck = async userId => {
    if (!userId || isNaN(userId)) return false;
    return !!(await DBUser.findByPk(userId));
  }

  const app = express()
  app.use(bodyParser.urlencoded({ extended: true }))
  
  const sessionMiddleware = session({
    store: new pgSession({ 
      pool: new Pool({
        user: 'un1c4on',
        password: 'un1c4on',
        host: 'localhost',
        port: 5433,
        database: 'ggebot_db'
      }), 
      tableName: 'session', 
      createTableIfMissing: true 
    }),
    secret: 'cok-gizli-super-guvenli-anahtar-1234',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, secure: false }
  });
  app.use(sessionMiddleware)
  app.use(express.static('website/build'))

  app.get('/', (_, res) => res.redirect('/index.html'))
  app.get('/lang.json', (_, res) => { res.setHeader('Access-Control-Allow-Origin', '*'); res.sendFile('lang.json', { root: '.' }) })
  app.get('/1.xml', (_, res) => { res.setHeader('Access-Control-Allow-Origin', '*'); res.sendFile('1.xml', { root: "." }) })
  
  app.post('/api', bodyParser.json(), async (req, res) => {
    let json = req.body
    res.setHeader('Content-Type', 'application/json')
    if (json.id == 0) {
      const row = await DBUser.findOne({ where: { username: json.email_name } })
      if (row && json.password === row.password_hash) {
        req.session.userId = row.id; req.session.save();
        return res.send(JSON.stringify({ id: 0, r: 0, uuid: row.id }))
      }
      return res.send(JSON.stringify({ id: 0, r: 1, error: 'Invalid login details.' }))
    }
    else if (json.id == 1) {
      if (json.token != ggeConfig.signupToken) return res.send(JSON.stringify({ id: 0, r: 1, error: 'Invalid Sign up details.' }))
      try {
        const newUser = await DBUser.create({ username: json.username, email: json.username + "@example.com", password_hash: json.password })
        res.send(JSON.stringify({ r: 0, uuid: newUser.id }))
      } catch (err) { res.send(JSON.stringify({ r: 1 })); console.error(err) }
    }
  })

  async function createBot(userId, user, messageBuffer, messageBufferCount) {
    messageBuffer ??= []; messageBufferCount ??= 0
    if (user.id && botMap.get(user.id)) throw Error(i18n.__("gameAccountSessionAlreadyInUse"))
    let data = structuredClone(user)
    const discordData = undefined
    plugins.forEach(plugin => plugin.force ? (data.plugins[plugin.key] ??= {}).state = true : undefined)
    plugins.forEach(plugin => data.plugins[plugin.key]?.state ? data.plugins[plugin.key].filename = plugin.filename : undefined)
    const instance = instances.find(e => Number(e.gameID) == data.server)
    data.gameURL ??= instance?.gameURL; data.gameServer ??= instance?.gameServer; data.gameID ??= instance?.gameID

    const worker = new Worker('./ggebot.js', { workerData: { ...data, discordData } })
    worker.messageBuffer = messageBuffer; worker.messageBufferCount = messageBufferCount
    if (user.id) botMap.set(user.id, worker)

    const onTerminate = async () => {
      if (botMap.get(user.id) == worker) {
        botMap.set(user.id, undefined)
        const u = await getSpecificUser(userId, user)
        if (u && u.state == 1) {
          setTimeout(async () => {
            const u2 = await getSpecificUser(userId, user)
            if (u2 && u2.state == 1) createBot(userId, u2, worker.messageBuffer, worker.messageBufferCount)
          }, 10000)
        }
      }
    }
    worker.on('message', async obj => {
      switch (obj[0]) {
        case ActionType.KillBot:
          await GameAccount.update({ is_active: false }, { where: { id: user.id } })
          removeBot(user.id)
          loggedInUsers[userId]?.forEach(async ({ws}) => ws.send(JSON.stringify([ErrorType.Success, ActionType.GetUsers, [await getUser(userId), plugins]])))
          break
        case ActionType.GetLogs:
          worker.messageBuffer[worker.messageBufferCount] = obj[1]
          worker.messageBufferCount = (worker.messageBufferCount + 1) % 25
          loggedInUsers[userId]?.forEach(o => o.viewedUser == user.id ? o.ws.send(JSON.stringify([ErrorType.Success, ActionType.GetLogs, [worker.messageBuffer, worker.messageBufferCount]])) : undefined)
          break
        case ActionType.StatusUser:
          obj[1].id = user.id
          loggedInUsers[userId]?.forEach(o => o.ws.send(JSON.stringify([ErrorType.Success, ActionType.StatusUser, obj[1]])))
          break
        case ActionType.RemoveUser:
          worker.off('exit', onTerminate); await removeUser(userId, user)
          break
        case ActionType.SetUser:
          await GameAccount.update({ game_password_encrypted: obj[1] }, { where: { id: user.id } })
          break
      }
    })
    worker.on('exit', onTerminate)
    await new Promise(resolve => {
      const func = obj => { if (obj[0] == ActionType.Started) { resolve(); worker.off('message', func) } }
      worker.on('message', func); worker.once('exit', resolve)
    })
    return worker
  }

  const removeBot = id => {
    const worker = botMap.get(id)
    if (worker) { botMap.delete(id); worker.terminate() }
  }

  const allUsers = await getUser()
  for (const u of allUsers) { if (u.state != 0) createBot(u.UserId, u) }

  const wss = new WebSocketServer({ noServer: true })
  const options = {}
  if (certFound) {
    options.key = await fs.readFile(ggeConfig.privateKey, 'utf8')
    options.cert = await fs.readFile(ggeConfig.cert, 'utf8')
  }

  const server = (certFound ? https : http).createServer(options, app).listen(ggeConfig.webPort)
  server.on('upgrade', (req, socket, head) => {
    sessionMiddleware(req, {}, () => {
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
    })
  })

  wss.addListener('connection', async (ws, req) => {
    let userId = req.session?.userId || req.headers.cookie?.split('; ').find(e => e.startsWith('uuid='))?.substring(5, Infinity)
    
    const refreshUsers = async () => {
        if (!userId || isNaN(userId)) return;
        ws.send(JSON.stringify([ErrorType.Success, ActionType.GetUsers, [await getUser(userId), plugins]]))
    }

    if (!userId || isNaN(userId) || !(await loginCheck(userId))) return ws.send(JSON.stringify([ErrorType.Unauthenticated, ActionType.GetUUID, {}]))
    
    loggedInUsers[userId] ??= []; loggedInUsers[userId].push({ ws })
    await refreshUsers()

    ws.addListener('message', async event => {
      let [_, action, obj] = JSON.parse(event.toString())
      switch (action) {
        case ActionType.GetUsers: await refreshUsers(); break
        case ActionType.AddUser: await addUser(userId, new User(obj)); await refreshUsers(); break
        case ActionType.RemoveUser:
          for (const u of obj) { try { await removeUser(userId, u) } catch (e) { console.warn(e) } }
          await refreshUsers(); break
        case ActionType.SetUser:
          const activePluginCount = Object.keys(obj.plugins || {}).length;
          console.debug(`[${obj.name}] Received SetUser. Active plugins: ${activePluginCount}`);
          let oldU = await getSpecificUser(userId, new User(obj))
          let newU = await changeUser(userId, new User(obj))
          if (!newU) return
          if (newU.state == 0) { try { removeBot(newU.id) } catch (e) {} }
          else {
            let w = botMap.get(newU.id)
            if (!w) await createBot(userId, newU)
            else {
              let restarted = false
              for (const [k, v] of Object.entries(oldU.plugins)) {
                if (newU.plugins[k].state != v.state) { restarted = true; removeBot(newU.id); await createBot(userId, newU, w.messageBuffer, w.messageBufferCount); break }
              }
              if (!restarted) {
                let d = structuredClone(newU)
                plugins.forEach(p => p.force ? (d.plugins[p.key] ??= {}).state = true : void 0)
                plugins.forEach(p => d.plugins[p.key]?.state ? d.plugins[p.key].filename = p.filename : void 0)
                w.postMessage([ActionType.SetPluginOptions, d])
              }
            }
          }
          loggedInUsers[userId]?.forEach(async ({ ws }) => ws.send(JSON.stringify([ErrorType.Success, ActionType.GetUsers, [await getUser(userId), plugins]])))
          break
        case ActionType.GetLogs:
          if (!obj) { loggedInUsers[userId].find(o => o.ws == ws).viewedUser = undefined; break }
          const u = new User(obj); const w = botMap.get(u.id)
          if (!w) return ws.send(JSON.stringify([ErrorType.Generic, ActionType.GetLogs, {}]))
          let lUser = loggedInUsers[userId].find(o => o.ws == ws)
          lUser.viewedUser = u.id
          lUser.ws.send(JSON.stringify([ErrorType.Success, ActionType.GetLogs, [w.messageBuffer, w.messageBufferCount]]))
          break
      }
    })
    ws.addListener('close', () => {
      if (!userId) return
      let idx = loggedInUsers[userId]?.findIndex(o => o.ws == ws)
      if (idx > -1) loggedInUsers[userId].splice(idx, 1)
      if (loggedInUsers[userId]?.length == 0) delete loggedInUsers[userId]
    })
  })
  console.info(i18n.__("started"))
}

start()
module.exports = { loggedInUsers, botMap, changeUser, getUser, removeUser }