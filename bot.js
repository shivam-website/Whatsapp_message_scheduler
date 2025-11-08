const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const app = express();
const PORT = 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('.'));

// Store scheduled messages
const SCHEDULES_FILE = 'schedules.json';

// Load existing schedules
function loadSchedules() {
    try {
        if (fs.existsSync(SCHEDULES_FILE)) {
            const data = fs.readFileSync(SCHEDULES_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading schedules:', error);
    }
    return [];
}

// Save schedules to file
function saveSchedules(schedules) {
    try {
        fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving schedules:', error);
        return false;
    }
}

// Initialize WhatsApp client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// Generate QR code
client.on('qr', (qr) => {
    console.log('Scan this QR code with your WhatsApp:');
    qrcode.generate(qr, { small: true });
});

// Client ready
client.on('ready', () => {
    console.log('WhatsApp client is ready!');
    startScheduler();
});

// Initialize
let schedules = loadSchedules();
let isClientReady = false;

// Start message scheduler
function startScheduler() {
    isClientReady = true;
    console.log('Starting message scheduler...');
    
    // Check schedules every minute
    cron.schedule('* * * * *', async () => {
        const now = new Date();
        const currentTime = now.toLocaleString('en-US', { 
            timeZone: 'Asia/Kolkata',
            hour12: false 
        }).replace(',', '');
        
        console.log(`Checking schedules at: ${currentTime}`);
        
        for (let i = schedules.length - 1; i >= 0; i--) {
            const schedule = schedules[i];
            const scheduleTime = new Date(schedule.timestamp);
            
            if (now >= scheduleTime && !schedule.sent) {
                try {
                    // Validate phone number format
                    let phoneNumber = schedule.phone;
                    if (!phoneNumber.includes('@c.us')) {
                        // Remove any non-digit characters and add country code if missing
                        phoneNumber = phoneNumber.replace(/\D/g, '');
                        if (!phoneNumber.startsWith('91') && phoneNumber.length === 10) {
                            phoneNumber = '91' + phoneNumber;
                        }
                        phoneNumber += '@c.us';
                    }
                    
                    // Send message
                    const chat = await client.getChatById(phoneNumber);
                    await chat.sendMessage(schedule.message);
                    
                    console.log(`Message sent to ${schedule.phone}: ${schedule.message}`);
                    
                    // Mark as sent
                    schedules[i].sent = true;
                    schedules[i].sentAt = new Date().toISOString();
                    saveSchedules(schedules);
                    
                } catch (error) {
                    console.error(`Failed to send message to ${schedule.phone}:`, error);
                }
            }
        }
        
        // Clean up old sent messages (older than 24 hours)
        const oneDayAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
        schedules = schedules.filter(schedule => 
            !schedule.sent || new Date(schedule.timestamp) > oneDayAgo
        );
        saveSchedules(schedules);
    });
}

// API Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Get all schedules
app.get('/schedules', (req, res) => {
    res.json(schedules);
});

// Add new schedule
app.post('/schedule', (req, res) => {
    const { phone, message, datetime } = req.body;
    
    if (!phone || !message || !datetime) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const timestamp = new Date(datetime).getTime();
    if (isNaN(timestamp)) {
        return res.status(400).json({ error: 'Invalid date format' });
    }
    
    const newSchedule = {
        id: Date.now().toString(),
        phone: phone,
        message: message,
        timestamp: new Date(datetime).toISOString(),
        scheduledFor: datetime,
        sent: false,
        createdAt: new Date().toISOString()
    };
    
    schedules.push(newSchedule);
    
    if (saveSchedules(schedules)) {
        res.json({ success: true, schedule: newSchedule });
    } else {
        res.status(500).json({ error: 'Failed to save schedule' });
    }
});

// Delete schedule
app.delete('/schedule/:id', (req, res) => {
    const id = req.params.id;
    const initialLength = schedules.length;
    
    schedules = schedules.filter(schedule => schedule.id !== id);
    
    if (schedules.length < initialLength) {
        saveSchedules(schedules);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Schedule not found' });
    }
});

// Get bot status
app.get('/status', (req, res) => {
    res.json({
        ready: isClientReady,
        schedulesCount: schedules.length,
        pendingSchedules: schedules.filter(s => !s.sent).length
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Admin panel running at http://localhost:${PORT}`);
    console.log('Initializing WhatsApp client...');
    client.initialize();
});