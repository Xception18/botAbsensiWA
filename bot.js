const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ======== KONFIGURASI =========
const CONFIG = {
    BASE_URL: "https://naradaya.adhimix.web.id/",
    USERNAME: "11235",  // <-- ganti username
    PASSWORD: "sep",    // <-- ganti password
    
    PAGI_START: [7, 0],    // 07:00
    PAGI_END: [7, 45],     // 07:45
    SORE_START: [17, 10],  // 17:10
    SORE_END: [18, 0],     // 18:00
    
    LOG_FILE: "absensi_log.txt",
    ADMIN_NUMBERS: ["6281225334049@c.us"], // <-- ganti dengan nomor admin
    
    MAX_RETRY: 540,
    RETRY_DELAY: 30000, // 30 detik dalam ms
    REQUEST_TIMEOUT: 30000 // 30 detik dalam ms
};

// Status global
let TUNDA_ABSENSI = false;
let TANGGAL_TUNDA = null;
let client = null;
let absensiInterval = null;

// ======== INISIALISASI WHATSAPP CLIENT =========
function initWhatsAppClient() {
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        }
    });

    client.on('qr', (qr) => {
        console.log('QR Code received, scan please!');
        qrcode.generate(qr, { small: true });
        tulisLog('[WHATSAPP] QR Code generated. Please scan with your phone.');
    });

    client.on('ready', () => {
        console.log('WhatsApp Client is ready!');
        tulisLog('[WHATSAPP] Client terhubung dan siap digunakan!');
        
        // Kirim notifikasi ke admin
        sendToAdmins('🤖 *Bot Absensi Aktif*\n\nBot WhatsApp untuk absensi otomatis telah aktif dan siap digunakan!\n\nKetik *!help* untuk melihat perintah yang tersedia.');
        
        // Mulai proses absensi otomatis
        startAbsensiProcess();
    });

    // ===== FIX: Hanya satu event listener untuk message =====
    client.on('message', async (message) => {
        // Debug logs
        console.log(`[DEBUG] Pesan masuk dari: ${message.from}`);
        console.log(`[DEBUG] Isi pesan: ${message.body}`);
        console.log(`[DEBUG] Is from admin: ${CONFIG.ADMIN_NUMBERS.includes(message.from)}`);
        tulisLog(`[MESSAGE] Dari: ${message.from}, Isi: ${message.body}`);
        
        // Handle message
        await handleMessage(message);
    });

    // ===== FIX: Hanya satu event listener untuk disconnected =====
    client.on('disconnected', (reason) => {
        console.log('[DEBUG] WhatsApp disconnected:', reason);
        tulisLog(`[WHATSAPP] Client terputus: ${reason}`);
    });

    client.on('auth_failure', (msg) => {
        console.error('[ERROR] Authentication failure:', msg);
        tulisLog(`[WHATSAPP] Autentikasi gagal: ${msg}`);
    });

    client.initialize();
}

// ======== HANDLER PESAN WHATSAPP =========
async function handleMessage(message) {
    try {
        const isAdmin = CONFIG.ADMIN_NUMBERS.includes(message.from);
        
        console.log(`[DEBUG] Processing message - isAdmin: ${isAdmin}`);
        
        // Hanya respon dari admin
        if (!isAdmin) {
            console.log(`[DEBUG] Message ignored - not from admin`);
            return;
        }
        
        const text = message.body.toLowerCase().trim();
        console.log(`[DEBUG] Command text: ${text}`);
        
        if (text.startsWith('!')) {
            const command = text.substring(1);
            console.log(`[DEBUG] Executing command: ${command}`);
            tulisLog(`[COMMAND] Admin menjalankan perintah: ${command}`);
            
            switch (command) {
                case 'help':
                    await handleHelpCommand(message);
                    break;
                    
                case 'status':
                    await handleStatusCommand(message);
                    break;
                    
                case 'tunda':
                    await handleTundaCommand(message);
                    break;
                    
                case 'batal':
                    await handleBatalCommand(message);
                    break;
                    
                case 'test':
                    await handleTestCommand(message);
                    break;
                    
                case 'log':
                    await handleLogCommand(message);
                    break;
                    
                case 'restart':
                    await handleRestartCommand(message);
                    break;
                    
                case 'cek':
                    await handleCekAbsensiCommand(message);
                    break;
                    
                default:
                    await message.reply('❌ Perintah tidak dikenali. Ketik *!help* untuk melihat perintah yang tersedia.');
            }
        }
    } catch (error) {
        console.error('[ERROR] Error handling message:', error);
        tulisLog(`[ERROR] Error handling message: ${error.message}`);
        try {
            await message.reply('❌ Terjadi kesalahan saat memproses perintah.');
        } catch (replyError) {
            console.error('[ERROR] Failed to send error reply:', replyError);
        }
    }
}

// ======== HANDLER PERINTAH =========
async function handleHelpCommand(message) {
    const helpText = `🤖 *Bot Absensi Otomatis - Panduan*

*Perintah yang tersedia:*

📊 *!status* - Lihat status bot dan absensi
⏸️ *!tunda* - Tunda absensi hari ini  
▶️ *!batal* - Batalkan tunda absensi
🔍 *!test* - Test koneksi internet
📋 *!log* - Lihat log terbaru (10 baris)
🔄 *!restart* - Restart proses absensi
✅ *!cek* - Cek status absensi hari ini
❓ *!help* - Tampilkan bantuan ini

*Jadwal Absensi:*
🌅 Pagi: 07:00 - 07:45
🌆 Sore: 17:10 - 18:00

Bot akan otomatis melakukan absensi pada jam yang telah ditentukan (hari Senin-Sabtu).`;

    await message.reply(helpText);
}

async function handleStatusCommand(message) {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    
    let statusText = `📊 *Status Bot Absensi*\n\n`;
    statusText += `🕐 Waktu: ${now.toLocaleString('id-ID')}\n`;
    statusText += `📅 Tanggal: ${today}\n`;
    statusText += `🤖 Status Bot: Aktif ✅\n\n`;
    
    if (TUNDA_ABSENSI && TANGGAL_TUNDA) {
        statusText += `⏸️ *ABSENSI DITUNDA*\n`;
        statusText += `📅 Tanggal Tunda: ${TANGGAL_TUNDA}\n\n`;
    } else {
        statusText += `▶️ Absensi Normal ✅\n\n`;
    }
    
    // Cek status absensi hari ini
    try {
        const status = await cekStatusAbsensi();
        if (status) {
            statusText += `*Status Absensi Hari Ini:*\n`;
            statusText += `🌅 Jam Datang: ${status.jam_datang || 'Belum'}\n`;
            statusText += `🌆 Jam Pulang: ${status.jam_pulang || 'Belum'}\n`;
        }
    } catch (error) {
        statusText += `❌ Gagal cek status absensi: ${error.message}\n`;
    }
    
    await message.reply(statusText);
}

async function handleTundaCommand(message) {
    const today = new Date().toISOString().split('T')[0];
    TANGGAL_TUNDA = today;
    TUNDA_ABSENSI = true;
    
    tulisLog(`[TUNDA] Absensi hari ini (${today}) ditunda via WhatsApp`);
    
    const replyText = `⏸️ *Absensi Ditunda*\n\n📅 Tanggal: ${today}\n✅ Absensi hari ini telah ditunda.\n\nKetik *!batal* untuk membatalkan tunda.`;
    await message.reply(replyText);
    
    // Kirim notifikasi ke admin lain
    sendToAdmins(`⏸️ Absensi ditunda oleh admin untuk tanggal ${today}`, message.from);
}

async function handleBatalCommand(message) {
    if (TUNDA_ABSENSI) {
        const tanggalBatal = TANGGAL_TUNDA;
        TUNDA_ABSENSI = false;
        TANGGAL_TUNDA = null;
        
        tulisLog(`[BATAL] Tunda absensi dibatalkan via WhatsApp`);
        
        const replyText = `▶️ *Tunda Absensi Dibatalkan*\n\n📅 Tanggal: ${tanggalBatal}\n✅ Absensi kembali normal.`;
        await message.reply(replyText);
        
        // Kirim notifikasi ke admin lain
        sendToAdmins(`▶️ Tunda absensi dibatalkan oleh admin`, message.from);
    } else {
        await message.reply('ℹ️ Tidak ada tunda absensi yang aktif.');
    }
}

async function handleTestCommand(message) {
    await message.reply('🔍 Sedang test koneksi internet...');
    
    try {
        const isConnected = await cekKoneksiInternet();
        if (isConnected) {
            await message.reply('✅ Koneksi internet OK');
        } else {
            await message.reply('❌ Tidak ada koneksi internet');
        }
    } catch (error) {
        await message.reply(`❌ Error test koneksi: ${error.message}`);
    }
}

async function handleLogCommand(message) {
    try {
        if (fs.existsSync(CONFIG.LOG_FILE)) {
            const logContent = fs.readFileSync(CONFIG.LOG_FILE, 'utf8');
            const lines = logContent.split('\n').filter(line => line.trim());
            const lastLines = lines.slice(-10).join('\n');
            
            const logText = `📋 *Log Terbaru (10 baris):*\n\n\`\`\`${lastLines}\`\`\``;
            await message.reply(logText);
        } else {
            await message.reply('📋 File log belum ada.');
        }
    } catch (error) {
        await message.reply(`❌ Error membaca log: ${error.message}`);
    }
}

async function handleRestartCommand(message) {
    await message.reply('🔄 Restart proses absensi...');
    
    try {
        if (absensiInterval) {
            clearInterval(absensiInterval);
        }
        startAbsensiProcess();
        await message.reply('✅ Proses absensi berhasil direstart.');
    } catch (error) {
        await message.reply(`❌ Error restart: ${error.message}`);
    }
}

async function handleCekAbsensiCommand(message) {
    await message.reply('🔍 Sedang cek status absensi...');
    
    try {
        const status = await cekStatusAbsensi();
        if (status) {
            const statusText = `✅ *Status Absensi Hari Ini:*\n\n🌅 Jam Datang: ${status.jam_datang || 'Belum absen'}\n🌆 Jam Pulang: ${status.jam_pulang || 'Belum absen'}`;
            await message.reply(statusText);
        } else {
            await message.reply('❌ Gagal mengambil data absensi. Periksa koneksi internet.');
        }
    } catch (error) {
        await message.reply(`❌ Error cek absensi: ${error.message}`);
    }
}

// ======== FUNGSI UTILITY =========
function tulisLog(pesan) {
    const waktu = new Date().toLocaleString('id-ID');
    const logMessage = `[${waktu}] ${pesan}`;
    
    try {
        fs.appendFileSync(CONFIG.LOG_FILE, logMessage + '\n', 'utf8');
    } catch (error) {
        console.error('Error writing to log file:', error);
    }
    
    console.log(logMessage);
}

function sendToAdmins(message, excludeNumber = null) {
    if (!client) return;
    
    CONFIG.ADMIN_NUMBERS.forEach(adminNumber => {
        if (adminNumber !== excludeNumber) {
            client.sendMessage(adminNumber, message).catch(error => {
                tulisLog(`[ERROR] Gagal kirim pesan ke admin ${adminNumber}: ${error.message}`);
            });
        }
    });
}

function randomJam(startTuple, endTuple) {
    const today = new Date();
    const startTime = new Date(today);
    startTime.setHours(startTuple[0], startTuple[1], 0, 0);
    
    const endTime = new Date(today);
    endTime.setHours(endTuple[0], endTuple[1], 0, 0);
    
    const deltaSeconds = Math.floor((endTime - startTime) / 1000);
    const randomSeconds = Math.floor(Math.random() * deltaSeconds);
    
    return new Date(startTime.getTime() + (randomSeconds * 1000));
}

async function cekKoneksiInternet() {
    try {
        await axios.get('https://8.8.8.8', { timeout: 5000 });
        return true;
    } catch (error) {
        try {
            await axios.get(CONFIG.BASE_URL, { timeout: 10000 });
            return true;
        } catch (error2) {
            return false;
        }
    }
}

async function executeWithRetry(func, maxRetry = CONFIG.MAX_RETRY) {
    for (let attempt = 0; attempt < maxRetry; attempt++) {
        try {
            return await func();
        } catch (error) {
            tulisLog(`[RETRY] Attempt ${attempt + 1}/${maxRetry} failed: ${error.message}`);
            
            if (attempt < maxRetry - 1) {
                await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
            } else {
                tulisLog(`[FAILED] Gagal setelah ${maxRetry} percobaan`);
                return null;
            }
        }
    }
}

function cekTundaAbsensi() {
    const today = new Date().toISOString().split('T')[0];
    
    if (TUNDA_ABSENSI && TANGGAL_TUNDA === today) {
        return true;
    }
    
    // Reset tunda jika tanggalnya sudah lewat
    if (TANGGAL_TUNDA && today > TANGGAL_TUNDA) {
        TUNDA_ABSENSI = false;
        TANGGAL_TUNDA = null;
        tulisLog('[INFO] Reset status tunda karena tanggal sudah lewat');
    }
    
    return false;
}

// ======== FUNGSI ABSENSI =========
async function cekStatusAbsensi() {
    return await executeWithRetry(async () => {
        // Login dulu
        const loginData = {
            login: CONFIG.USERNAME,
            password: CONFIG.PASSWORD
        };
        
        const loginResponse = await axios.post(
            CONFIG.BASE_URL + 'login/confirm',
            new URLSearchParams(loginData),
            {
                timeout: CONFIG.REQUEST_TIMEOUT,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }
        );
        
        if (loginResponse.data.includes('gagal')) {
            throw new Error('Login gagal saat cek status absensi');
        }
        
        // Ambil cookie dari login
        const cookies = loginResponse.headers['set-cookie'];
        
        // Ambil data history absensi
        const historyResponse = await axios.get(
            CONFIG.BASE_URL + 'absensi/history/kemarin',
            {
                timeout: CONFIG.REQUEST_TIMEOUT,
                headers: { 'Cookie': cookies?.join('; ') || '' }
            }
        );
        
        const data = historyResponse.data;
        const today = new Date().toISOString().split('T')[0];
        
        // Cari data hari ini
        for (const record of data) {
            const tanggalRecord = record.tanggal?.split(' ')[0];
            if (tanggalRecord === today) {
                return {
                    jam_datang: record.jam_datang,
                    jam_pulang: record.jam_pulang
                };
            }
        }
        
        return { jam_datang: null, jam_pulang: null };
    });
}

async function loginDanAbsen(sesi) {
    return await executeWithRetry(async () => {
        const loginData = {
            login: CONFIG.USERNAME,
            password: CONFIG.PASSWORD
        };
        
        const loginResponse = await axios.post(
            CONFIG.BASE_URL + 'login/confirm',
            new URLSearchParams(loginData),
            {
                timeout: CONFIG.REQUEST_TIMEOUT,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }
        );
        
        if (loginResponse.data.includes('gagal')) {
            throw new Error(`Login gagal untuk sesi ${sesi}`);
        }
        
        tulisLog(`[SUCCESS] Login sukses untuk sesi ${sesi}`);
        
        // Ambil cookie dari login
        const cookies = loginResponse.headers['set-cookie'];
        
        // Lakukan absensi
        const absenResponse = await axios.post(
            CONFIG.BASE_URL + 'absensi/hit',
            {},
            {
                timeout: CONFIG.REQUEST_TIMEOUT,
                headers: { 'Cookie': cookies?.join('; ') || '' }
            }
        );
        
        tulisLog(`[RESPONSE] Response absensi (${sesi}): ${absenResponse.data}`);
        
        // Kirim notifikasi ke admin
        sendToAdmins(`✅ *Absensi ${sesi} Berhasil*\n\n🕐 Waktu: ${new Date().toLocaleString('id-ID')}\n📋 Response: ${absenResponse.data}`);
        
        return true;
    });
}

// ======== PROSES ABSENSI HARIAN =========
async function absensiHarian() {
    // Cek apakah absensi ditunda
    if (cekTundaAbsensi()) {
        tulisLog('[TUNDA] Absensi hari ini ditunda. Skip absensi.');
        return;
    }
    
    const now = new Date();
    const hari = now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const hariAllowed = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    
    if (!hariAllowed.includes(hari)) {
        tulisLog(`[SKIP] Hari ini (${hari}) bukan jadwal absensi.`);
        return;
    }
    
    tulisLog(`[INFO] Hari ini: ${hari}`);
    
    // Cek koneksi internet
    if (!(await cekKoneksiInternet())) {
        tulisLog('[WARNING] Tidak ada koneksi internet, akan retry nanti...');
        sendToAdmins('⚠️ *Peringatan*\n\nTidak ada koneksi internet. Absensi akan diulang nanti.');
        return;
    }
    
    // Cek status absensi saat ini
    const status = await cekStatusAbsensi();
    if (!status) {
        tulisLog('[ERROR] Tidak dapat mengecek status absensi karena masalah jaringan, skip hari ini');
        sendToAdmins('❌ *Error*\n\nGagal mengecek status absensi karena masalah jaringan.');
        return;
    }
    
    const jamDatang = status.jam_datang;
    const jamPulang = status.jam_pulang;
    
    const waktuPagi = randomJam(CONFIG.PAGI_START, CONFIG.PAGI_END);
    const waktuSore = randomJam(CONFIG.SORE_START, CONFIG.SORE_END);
    
    tulisLog(`[SCHEDULE] Jadwal absen pagi: ${waktuPagi.toLocaleTimeString()}`);
    tulisLog(`[SCHEDULE] Jadwal absen sore: ${waktuSore.toLocaleTimeString()}`);
    
    // Kirim jadwal ke admin
    sendToAdmins(`📅 *Jadwal Absensi Hari Ini*\n\n🌅 Absen Pagi: ${waktuPagi.toLocaleTimeString()}\n🌆 Absen Sore: ${waktuSore.toLocaleTimeString()}\n\nStatus saat ini:\n🌅 Jam Datang: ${jamDatang || 'Belum'}\n🌆 Jam Pulang: ${jamPulang || 'Belum'}`);
    
    // Logika absensi berdasarkan status
    if (!jamDatang) {
        // Belum absen masuk
        await waitAndExecute(waktuPagi, () => loginDanAbsen('Pagi'));
        
        // Setelah absen pagi, tunggu absen sore
        if (!cekTundaAbsensi()) {
            await waitAndExecute(waktuSore, () => loginDanAbsen('Sore'));
        }
    } else if (jamDatang && !jamPulang) {
        // Sudah absen masuk, belum pulang
        tulisLog(`[WAITING] Sudah absen masuk (${jamDatang}), menunggu waktu absen sore...`);
        await waitAndExecute(waktuSore, () => loginDanAbsen('Sore'));
    } else {
        // Sudah lengkap
        tulisLog(`[COMPLETE] Sudah absen lengkap - Masuk: ${jamDatang}, Pulang: ${jamPulang}`);
        sendToAdmins(`✅ *Absensi Lengkap*\n\n🌅 Jam Datang: ${jamDatang}\n🌆 Jam Pulang: ${jamPulang}`);
    }
}

async function waitAndExecute(targetTime, action) {
    const now = new Date();
    const waitTime = targetTime.getTime() - now.getTime();
    
    if (waitTime > 0) {
        tulisLog(`[WAITING] Menunggu ${Math.round(waitTime / 60000)} menit...`);
        
        setTimeout(async () => {
            if (!cekTundaAbsensi()) {
                try {
                    await action();
                } catch (error) {
                    tulisLog(`[ERROR] Gagal eksekusi absensi: ${error.message}`);
                    sendToAdmins(`❌ *Error Absensi*\n\n${error.message}`);
                }
            }
        }, waitTime);
    } else {
        // Waktu sudah lewat, eksekusi langsung jika belum ditunda
        if (!cekTundaAbsensi()) {
            try {
                await action();
            } catch (error) {
                tulisLog(`[ERROR] Gagal eksekusi absensi: ${error.message}`);
                sendToAdmins(`❌ *Error Absensi*\n\n${error.message}`);
            }
        }
    }
}

function startAbsensiProcess() {
    // Jalankan absensi harian setiap hari jam 00:05
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 5, 0, 0);
    
    const timeUntilTomorrow = tomorrow.getTime() - now.getTime();
    
    // Jalankan sekali saat startup jika belum jam 00:05 hari ini
    const today0005 = new Date(now);
    today0005.setHours(0, 5, 0, 0);
    
    if (now.getTime() > today0005.getTime()) {
        // Sudah lewat jam 00:05 hari ini, jalankan absensi
        setTimeout(() => {
            absensiHarian().catch(error => {
                tulisLog(`[ERROR] Error absensi harian: ${error.message}`);
            });
        }, 5000); // Delay 5 detik untuk stabilitas
    }
    
    // Set interval harian
    setTimeout(() => {
        absensiHarian().catch(error => {
            tulisLog(`[ERROR] Error absensi harian: ${error.message}`);
        });
        
        // Set interval setiap 24 jam
        absensiInterval = setInterval(() => {
            absensiHarian().catch(error => {
                tulisLog(`[ERROR] Error absensi harian: ${error.message}`);
            });
        }, 24 * 60 * 60 * 1000);
        
    }, timeUntilTomorrow);
    
    tulisLog('[INFO] Proses absensi otomatis telah dijalankan');
}

// ======== MAIN FUNCTION =========
async function main() {
    tulisLog('[START] Bot WhatsApp absensi otomatis dimulai.');
    
    try {
        initWhatsAppClient();
    } catch (error) {
        tulisLog(`[ERROR] Gagal inisialisasi WhatsApp client: ${error.message}`);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    tulisLog('[SHUTDOWN] Bot dihentikan oleh user');
    if (client) {
        client.destroy();
    }
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    tulisLog(`[CRITICAL] Uncaught exception: ${error.message}`);
    console.error(error);
});

process.on('unhandledRejection', (reason, promise) => {
    tulisLog(`[CRITICAL] Unhandled rejection: ${reason}`);
    console.error(reason);
});

// Mulai bot
main().catch(error => {
    tulisLog(`[CRITICAL] Error starting bot: ${error.message}`);
    console.error(error);
    process.exit(1);
});

module.exports = {
    main,
    initWhatsAppClient,
    CONFIG
};