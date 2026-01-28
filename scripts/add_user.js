const { User } = require('../database/models');

async function addUser() {
  try {
    const newUser = await User.create({
      username: 'un1c4on1',
      email: 'un1c4on1@ggebot.com',
      password_hash: 'un1c4on1',
      role: 'customer'
    });
    console.log('✅ İkinci kullanıcı başarıyla oluşturuldu!');
    console.log('Kullanıcı Adı: un1c4on1');
    console.log('Şifre: un1c4on1');
    process.exit(0);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      console.log('ℹ️ Bu kullanıcı zaten mevcut.');
    } else {
      console.error('❌ Hata:', error);
    }
    process.exit(1);
  }
}

addUser();
