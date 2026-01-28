const { Sequelize } = require('sequelize');

const sequelize = new Sequelize('ggebot_db', 'un1c4on', 'un1c4on', {
  host: 'localhost',
  port: 5433, 
  dialect: 'postgres',
  logging: false,
  pool: {
    max: 20,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});

module.exports = sequelize;
