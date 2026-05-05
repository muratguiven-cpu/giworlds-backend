const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

app.use(cors({
  origin: function(origin, callback) {
    const allowed = [
      'https://giworlds.com',
      'https://www.giworlds.com',
      'http://giworlds.com',
      'http://www.giworlds.com',
      'http://localhost:5000',
      'http://localhost:3000'
    ];
    if (!origin || allowed.includes(origin)) return callback(null, true);
    return callback(null, true);
  },
  credentials: false
}));
app.use(express.json({ limit: '10mb' }));

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, sessions: {}, otp: {} }, null, 2));
}
function readDb() {
  ensureDb();
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { users: {}, sessions: {}, otp: {} }; }
}
function writeDb(db) {
  ensureDb();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 64, 'sha512').toString('hex');
  return { salt, hash };
}
function verifyPassword(password, record) {
  if (!record || !record.salt || !record.hash) return false;
  return hashPassword(password, record.salt).hash === record.hash;
}
function makeToken() { return crypto.randomBytes(32).toString('hex'); }

function requireBrevoConfig() {
  const required = ['BREVO_API_KEY', 'MAIL_FROM'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error('Brevo API ayarları eksik: ' + missing.join(', '));
  }
}

async function sendOtpMail(to, otp) {
  requireBrevoConfig();

  const appName = process.env.MAIL_APP_NAME || 'GiWorlds';
  const senderName = process.env.MAIL_FROM_NAME || 'GiWorlds';
  const fromEmail = process.env.MAIL_FROM;

  const payload = {
    sender: { name: senderName, email: fromEmail },
    to: [{ email: to }],
    subject: appName + ' şifre yenileme kodu',
    textContent: `Merhaba,\n\n${appName} şifre yenileme kodunuz: ${otp}\n\nBu kod 5 dakika geçerlidir. Bu işlemi siz yapmadıysanız bu maili dikkate almayın.`,
    htmlContent: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827"><h2>${appName} Şifre Yenileme</h2><p>Tek kullanımlık şifre yenileme kodunuz:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${otp}</p><p>Bu kod <b>5 dakika</b> geçerlidir.</p><p>Bu işlemi siz yapmadıysanız bu maili dikkate almayın.</p></div>`
  };

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Brevo API hata ${response.status}: ${text}`);
  }

  console.log('GiWorlds OTP Brevo API ile gönderildi:', to);
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const db = readDb();
  const email = db.sessions[token];
  if (!token || !email || !db.users[email]) return res.status(401).json({ ok: false, error: 'Oturum bulunamadı. Tekrar giriş yap.' });
  req.db = db; req.email = email; req.user = db.users[email]; req.token = token;
  next();
}
function cleanSave(save, nick) {
  const safe = save && typeof save === 'object' ? save : {};
  safe.player = nick || safe.player || '';
  safe.updatedAt = Date.now();
  return safe;
}

app.get('/', (req, res) => res.json({
  ok: true,
  name: 'GiWorlds Backend',
  message: 'Backend çalışıyor. Oyun arayüzü Natro üzerindedir.'
}));
app.get('/api/health', (req, res) => res.json({
  ok: true,
  name: 'GiWorlds Backend',
  mailMode: 'brevo_api',
  brevoConfigured: Boolean(process.env.BREVO_API_KEY && process.env.MAIL_FROM)
}));

app.post('/api/register', (req, res) => {
  const { nick, password, save } = req.body || {};
  const email = normalizeEmail(req.body && req.body.email);
  if (!nick || String(nick).trim().length < 2) return res.status(400).json({ ok: false, error: 'Nickname en az 2 karakter olmalı.' });
  if (!email.includes('@')) return res.status(400).json({ ok: false, error: 'Geçerli mail adresi yaz.' });
  if (!password || String(password).length < 6) return res.status(400).json({ ok: false, error: 'Şifre en az 6 karakter olmalı.' });
  const db = readDb();
  if (db.users[email]) return res.status(409).json({ ok: false, error: 'Bu mail adresiyle zaten kayıt var.' });
  const pass = hashPassword(password);
  db.users[email] = { email, nick: String(nick).trim(), pass, save: cleanSave(save, String(nick).trim()), createdAt: Date.now() };
  const token = makeToken(); db.sessions[token] = email;
  writeDb(db);
  res.json({ ok: true, token, user: { email, nick: db.users[email].nick }, save: db.users[email].save });
});

app.post('/api/login', (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const password = req.body && req.body.password;
  const db = readDb();
  const user = db.users[email];
  if (!user || !verifyPassword(password, user.pass)) return res.status(401).json({ ok: false, error: 'Mail adresi veya şifre hatalı.' });
  const token = makeToken(); db.sessions[token] = email;
  writeDb(db);
  res.json({ ok: true, token, user: { email, nick: user.nick }, save: user.save || null });
});

app.post('/api/save', auth, (req, res) => {
  req.user.save = cleanSave(req.body && req.body.save, req.user.nick);
  req.db.users[req.email] = req.user;
  writeDb(req.db);
  res.json({ ok: true, savedAt: req.user.save.updatedAt });
});

app.post('/api/load', auth, (req, res) => {
  res.json({ ok: true, user: { email: req.email, nick: req.user.nick }, save: req.user.save || null });
});

app.post('/api/forgot/request', async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const db = readDb();
  if (!db.users[email]) return res.status(404).json({ ok: false, error: 'Bu mail adresiyle kayıt bulunamadı.' });
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  try {
    await sendOtpMail(email, otp);
    db.otp[email] = { otp, expires: Date.now() + 5 * 60 * 1000, sentAt: Date.now() };
    writeDb(db);
    res.json({ ok: true, message: 'Tek kullanımlık kod mail adresine gönderildi.' });
  } catch (err) {
    console.error('GiWorlds OTP mail gönderilemedi:', err.message);
    res.status(500).json({ ok: false, error: 'Mail gönderilemedi. Brevo API ayarlarını kontrol et.' });
  }
});

app.post('/api/forgot/reset', (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const { otp, newPassword } = req.body || {};
  const db = readDb();
  const row = db.otp[email];
  if (!db.users[email]) return res.status(404).json({ ok: false, error: 'Hesap bulunamadı.' });
  if (!row || Date.now() > row.expires || row.otp !== String(otp || '')) return res.status(400).json({ ok: false, error: 'Tek kullanımlık şifre hatalı veya süresi dolmuş.' });
  if (!newPassword || String(newPassword).length < 6) return res.status(400).json({ ok: false, error: 'Yeni şifre en az 6 karakter olmalı.' });
  db.users[email].pass = hashPassword(newPassword);
  delete db.otp[email];
  writeDb(db);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  ensureDb();
  console.log(`GiWorlds Backend çalışıyor: http://localhost:${PORT}`);
});
