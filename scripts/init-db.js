/**
 * Güvenli Veritabanı Başlatma
 * - Mevcut verileri SİLMEZ
 * - Eksik tabloları oluşturur
 * - Eksik column'ları ekler
 *
 * Kullanım: node scripts/init-db.js
 */

const { sequelize, User, GameAccount, BotConfig, BotLog } = require('../database/models');

async function initDatabase() {
    try {
        console.log('🔄 Veritabanı bağlantısı kontrol ediliyor...');
        await sequelize.authenticate();
        console.log('✅ Veritabanı bağlantısı başarılı!');

        console.log('🔄 Tablolar senkronize ediliyor (alter mode)...');
        // alter: true - Mevcut verileri korur, sadece eksik column'ları ekler
        // UYARI: Column tipi değişirse sorun çıkabilir
        await sequelize.sync({ alter: true });
        console.log('✅ Tablolar senkronize edildi!');

        // Tablo durumunu göster
        const userCount = await User.count();
        const gameAccountCount = await GameAccount.count();
        const botConfigCount = await BotConfig.count();

        console.log('\n📊 Veritabanı Durumu:');
        console.log(`   Users: ${userCount}`);
        console.log(`   GameAccounts: ${gameAccountCount}`);
        console.log(`   BotConfigs: ${botConfigCount}`);

        // Admin kullanıcı yoksa uyar
        if (userCount === 0) {
            console.log('\n⚠️  Hiç kullanıcı yok! İlk admin kullanıcıyı oluşturmak için:');
            console.log('   node scripts/create-admin.js <username> <email> <password>');
        }

        console.log('\n✅ Veritabanı hazır!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Hata:', error.message);
        process.exit(1);
    }
}

initDatabase();
