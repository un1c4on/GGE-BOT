const { User, sequelize } = require('../database/models');
const { Op } = require('sequelize');

const args = process.argv.slice(2);
const command = args[0];

async function listUsers() {
    const users = await User.findAll({
        order: [['createdAt', 'DESC']]
    });
    
    console.log('\n--- KULLANICI LİSTESİ ---');
    console.log('ID | Kullanıcı Adı | Email | Rol | Abonelik Bitiş');
    console.log('-'.repeat(60));
    
    users.forEach(u => {
        const subDate = u.subscription_end_date ? new Date(u.subscription_end_date).toLocaleDateString('tr-TR') : 'YOK (Pasif)';
        const status = (u.subscription_end_date && new Date(u.subscription_end_date) > new Date()) ? '✅ AKTİF' : '❌ PASİF';
        console.log(`${u.id} | ${u.username} | ${u.email} | ${u.role} | ${subDate} ${status}`);
    });
    console.log('\n');
}

async function addSubscription(username, days) {
    if (!username || !days) {
        console.log('Kullanım: node scripts/admin.js add <username> <gun_sayisi>');
        return;
    }

    const user = await User.findOne({ where: { username } });
    if (!user) {
        console.error('❌ Kullanıcı bulunamadı!');
        return;
    }

    let newDate = new Date();
    // Eğer kullanıcının zaten devam eden bir aboneliği varsa, onun üzerine ekle
    if (user.subscription_end_date && new Date(user.subscription_end_date) > new Date()) {
        newDate = new Date(user.subscription_end_date);
    }

    newDate.setDate(newDate.getDate() + parseInt(days));
    
    await user.update({ subscription_end_date: newDate });
    console.log(`✅ ${user.username} için abonelik uzatıldı.`);
    console.log(`📅 Yeni Bitiş Tarihi: ${newDate.toLocaleDateString('tr-TR')}`);
}

async function main() {
    try {
        if (command === 'list') {
            await listUsers();
        } else if (command === 'add') {
            await addSubscription(args[1], args[2]);
        } else {
            console.log('Komutlar:');
            console.log('  node scripts/admin.js list             -> Kullanıcıları listeler');
            console.log('  node scripts/admin.js add <user> <gun> -> Kullanıcıya süre ekler');
        }
    } catch (error) {
        console.error('Hata:', error);
    } finally {
        // DB bağlantısını kapatmazsak script asılı kalır
        // Ancak Sequelize connection pool kullandığı için process.exit gerekebilir
        process.exit();
    }
}

main();
