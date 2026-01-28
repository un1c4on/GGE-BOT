# GGE-BOT Mimarisi ve Analiz Raporu

## 1. Yönetici Özeti (Executive Summary)
Bu proje, **Goodgame Empire** adlı tarayıcı oyunu için geliştirilmiş, Node.js tabanlı otomasyon botudur. Mevcut durumda, tek bir sunucuda çalışıp, `Worker Threads` kullanarak birden fazla oyun hesabını (bot instance) eşzamanlı yönetebilen, ancak verileri yerel dosya sistemi (JSON) ve basit bir SQLite yapısında tutan bir sistemdir.

Hedeflenen yeni mimari, 100+ kullanıcıyı destekleyecek, veri güvenliğini ve tutarlılığını sağlayacak **SaaS (Software as a Service)** yapısına dönüşümdür.

## 2. Mevcut Teknoloji Yığını (Current Tech Stack)
*   **Çalışma Ortamı (Runtime):** Node.js
*   **Dil:** JavaScript (CommonJS modülleri)
*   **Veritabanı (Mevcut):** `node:sqlite` (DatabaseSync) - Sadece Kullanıcı yönetimi için basit kullanım.
*   **Bot Mimarisi:**
    *   **Main Thread:** Web sunucusu (Express), Discord Botu, Kullanıcı Yönetimi.
    *   **Worker Threads:** Her oyun hesabı (Bot) izole bir iş parçacığında çalışır (`ggebot.js`).
*   **İletişim:**
    *   **Oyun Sunucusu:** WebSocket (`ws`), Özel `XT` protokolü.
    *   **Web Arayüzü:** REST API (Express) + React (Frontend).
    *   **Main <-> Worker:** `parentPort.postMessage`.
*   **Kütüphaneler:** `discord.js` (Discord Entegrasyonu), `express`, `ws`, `xml2js`, `sharp`.

## 3. İş Mantığı ve Özellikler (Business Logic & Features)
Bot, modüler bir "Plugin" yapısına sahiptir. Her özellik `plugins/` altında ayrı modüller halindedir:

### Temel Özellikler:
1.  **Saldırı Otomasyonu (`plugins/attack/`):**
    *   Baron, Kule, Kale, Nomad, Samuray gibi farklı hedeflere otomatik saldırı.
    *   `sharedBarronAttackLogic.js` gibi paylaşılan mantık dosyaları mevcut.
2.  **Kaynak Yönetimi:**
    *   `Ressend.js`: Kaynak gönderme/taşıma.
    *   `feast.js`: Şölen (Feast) yönetimi.
3.  **Harita ve İstihbarat:**
    *   `getmap.js`, `getregions.js`: Harita verilerini çekme ve analiz etme.
4.  **İletişim:**
    *   Discord entegrasyonu ile oyun içi olayları (saldırı geldiğinde uyarı vb.) Discord kanalına bildirme.

## 4. Veri Mimarisi ve Sorunlar (Data Architecture & Challenges)

### Mevcut Yapı:
*   **Kullanıcılar:** `user.db` (SQLite) içinde `Users` (Ana Hesap) ve `SubUsers` (Oyun Hesapları) tabloları var.
*   **Bot Ayarları:** `SubUsers` tablosundaki `plugins` sütununda **JSON String** olarak saklanıyor.
*   **Global Ayarlar:** `ggeConfig.json` dosyasında (Dosya sistemi bağımlılığı).
*   **Oyun Verileri:** `items/` klasörü altında JSON dosyaları olarak statik veri tutuluyor.

### Ölçeklenme Sorunları (100+ Kullanıcı için):
1.  **Veritabanı Kilidi:** `node:sqlite` senkron (`DatabaseSync`) çalışıyor olabilir, bu yüksek yük altında Main Thread'i bloklayabilir.
2.  **Worker Kaynak Tüketimi:** Her bot için bir Worker Thread açmak, 100 kullanıcıda sunucu RAM'ini (özellikle Chrome V8 instance'ları yüzünden) tüketebilir.
3.  **Durum Yönetimi (State):** Botun anlık durumu (şu an saldırıyor mu, beklemede mi) sadece Worker'ın belleğinde. Sunucu kapanırsa durum kaybolur.
4.  **Oturum (Session):** Web arayüzü ile sunucu arasındaki oturum yönetimi şu an net değil, JWT veya güvenli bir Session yapısı şart.

## 5. Yeni Mimari İçin Gereksinimler (Requirements for New Architecture)

Yapay Zeka Mimarı (Architect AI) için tasarım hedefleri:

1.  **Veritabanı Yükseltmesi:**
    *   `Users` ve `SubUsers` tablolarını koruyarak **PostgreSQL**'e geçiş.
    *   `plugins` sütunundaki JSON verisini, sorgulanabilir (Queryable) ilişkisel tablolara veya `JSONB` yapısına dönüştürme.
    *   Statik oyun verilerinin (Items, Units) veritabanına taşınması veya Redis gibi bir önbellekte tutulması.

2.  **Oturum Yönetimi (Session Management):**
    *   Express + `express-session` (PostgreSQL store ile) veya **JWT** tabanlı kimlik doğrulama.
    *   Web arayüzü (React) ile güvenli iletişim.

3.  **Ölçeklenebilirlik (Scalability):**
    *   **Kuyruk Sistemi (Queue):** Saldırı emirleri veya ağır işlemlerin Redis/BullMQ gibi bir kuyruk sistemine alınması.
    *   **Cluster Modu:** Node.js'in tek thread limitini aşmak için PM2 veya Node Cluster kullanımı (Worker Thread'lerin yanı sıra).

4.  **Kod Refactoring:**
    *   `main.js` içindeki veritabanı erişim kodlarının bir **Data Access Layer (DAL)** veya **ORM (Sequelize/Prisma)** katmanına taşınması.
    *   JSON dosyasına yazma işlemlerinin tamamen kaldırılması.
