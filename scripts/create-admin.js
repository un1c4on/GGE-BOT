/**
 * Admin Kullanıcı Oluşturma
 * Kullanım: node scripts/create-admin.js <username> <email> <password>
 */

const { User } = require('../database/models');
const bcrypt = require('bcrypt');

async function createAdmin() {
    const [,, username, email, password] = process.argv;

    if (!username || !email || !password) {
        console.log('Kullanım: node scripts/create-admin.js <username> <email> <password>');
        console.log('Örnek: node scripts/create-admin.js admin admin@example.com SecurePass123');
        process.exit(1);
    }

    try {
        // Email veya username zaten var mı kontrol et
        const existing = await User.findOne({
            where: {
                [require('sequelize').Op.or]: [
                    { username },
                    { email }
                ]
            }
        });

        if (existing) {
            console.error('❌ Bu username veya email zaten kayıtlı!');
            process.exit(1);
        }

        // Şifreyi hashle (eğer bcrypt kullanılıyorsa)
        let passwordHash = password;
        try {
            passwordHash = await bcrypt.hash(password, 10);
        } catch (e) {
            console.log('⚠️  bcrypt bulunamadı, düz şifre kullanılıyor (güvenli değil!)');
        }

        const user = await User.create({
            username,
            email,
            password_hash: passwordHash,
            role: 'admin',
            subscription_end_date: new Date(new Date().setFullYear(new Date().getFullYear() + 1))
        });

        console.log(`✅ Admin kullanıcı oluşturuldu!`);
        console.log(`   Username: ${user.username}`);
        console.log(`   Email: ${user.email}`);
        console.log(`   Role: ${user.role}`);
        console.log(`   Subscription: 1 yıl`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Hata:', error.message);
        process.exit(1);
    }
}

createAdmin();
