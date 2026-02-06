const { DataTypes } = require('sequelize');
const sequelize = require('./db');

// 1. KULLANICI
const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  username: { type: DataTypes.STRING, allowNull: false, unique: true },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  password_hash: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.ENUM('admin', 'customer'), defaultValue: 'customer' },
  subscription_end_date: { type: DataTypes.DATE },
  discordUserId: { type: DataTypes.STRING },
  discordGuildId: { type: DataTypes.STRING }
}, { timestamps: true });

// 2. OYUN HESABI (SubUsers karşılığı)
const GameAccount = sequelize.define('GameAccount', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  game_server: { type: DataTypes.STRING, allowNull: false },
  game_username: { type: DataTypes.STRING, allowNull: false },
  game_password_encrypted: { type: DataTypes.TEXT, allowNull: false },
  is_active: { type: DataTypes.BOOLEAN, defaultValue: false },
  is_running: { type: DataTypes.BOOLEAN, defaultValue: false },
  is_locked: { type: DataTypes.BOOLEAN, defaultValue: false } // Kale kilitli mi (değiştirilemez)
}, {
  timestamps: true,
  indexes: [{ unique: true, fields: ['game_server', 'game_username'] }]
});

// 3. BOT AYARLARI
const BotConfig = sequelize.define('BotConfig', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  plugin_name: { type: DataTypes.STRING, allowNull: false },
  is_enabled: { type: DataTypes.BOOLEAN, defaultValue: false },
  settings: { type: DataTypes.JSONB, defaultValue: {} }
}, {
  timestamps: true,
  indexes: [{ unique: true, fields: ['GameAccountId', 'plugin_name'] }]
});

// 4. LOGLAR
const BotLog = sequelize.define('BotLog', {
  id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
  action_type: { type: DataTypes.STRING },
  message: { type: DataTypes.TEXT },
  details: { type: DataTypes.JSONB }
}, { timestamps: true, updatedAt: false });

// İLİŞKİLER
User.hasOne(GameAccount, { onDelete: 'CASCADE' }); // 1 Kullanıcı = 1 Kale
GameAccount.belongsTo(User);

GameAccount.hasMany(BotConfig, { onDelete: 'CASCADE' });
BotConfig.belongsTo(GameAccount);

GameAccount.hasMany(BotLog, { onDelete: 'CASCADE' });
BotLog.belongsTo(GameAccount);

module.exports = { sequelize, User, GameAccount, BotConfig, BotLog };