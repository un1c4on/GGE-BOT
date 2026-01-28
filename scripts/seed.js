const { sequelize, User, GameAccount, BotConfig } = require('../database/models');

async function seed() {
  try {
    // Veritabanını sıfırla ve tabloları oluştur
    await sequelize.sync({ force: true });
    console.log('Veritabanı tabloları oluşturuldu.');

    // 1. Web Kullanıcısını Oluştur (SaaS Müşterisi)
    const webUser = await User.create({
      username: 'un1c4on',
      email: 'un1c4on@ggebot.com', // Fake email
      password_hash: 'un1c4on', // Düz metin şifre (Test için)
      role: 'admin',
      subscription_end_date: new Date(new Date().setFullYear(new Date().getFullYear() + 1)) // 1 yıl üyelik
    });
    console.log(`Web kullanıcısı oluşturuldu: ${webUser.username}`);

    // 2. Oyun Hesabını Oluştur (Botun gireceği hesap)
    const gameAccount = await GameAccount.create({
      UserId: webUser.id, // Web kullanıcısına bağla
      game_server: '10', // TR1 sunucusunun gerçek ID'si 10'dur
      game_username: 'p.uzm.cvş',
      game_password_encrypted: 'Matrix61.0', // Düz metin şifre (Test için)
      is_active: true,
      is_running: false
    });
    console.log(`Oyun hesabı eklendi: ${gameAccount.game_username} (${gameAccount.game_server})`);

    // 3. Örnek Bot Ayarı (Opsiyonel - Boş kalmasın diye)
    await BotConfig.create({
      GameAccountId: gameAccount.id,
      plugin_name: 'attack',
      is_enabled: true,
      settings: {
        target_mode: 'baron',
        min_level: 70,
        units: { spearman: 50, archer: 50 }
      }
    });
    console.log('Varsayılan saldırı ayarları eklendi.');

    console.log('✅ Kurulum tamamlandı! Botu başlatmaya hazırsın.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Hata oluştu:', error);
    process.exit(1);
  }
}

seed();
