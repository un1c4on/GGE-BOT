/**
 * Migration: Add is_locked column to GameAccounts
 * Run with: node database/migrations/add_is_locked.js
 */

const sequelize = require('../db');

async function migrate() {
    try {
        console.log('Starting migration: add_is_locked to GameAccounts...');

        await sequelize.query(`
            ALTER TABLE "GameAccounts"
            ADD COLUMN IF NOT EXISTS "is_locked" BOOLEAN DEFAULT false;
        `);

        console.log('Migration completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();
