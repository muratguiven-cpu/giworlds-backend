const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();

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
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, sessions: {}, otp: {} }, null, 2));
  }
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
function cleanSave(save, nick) {
  const safe = save && typeof save === 'object' ? save : {};
  safe.player = nick || safe.player || '';
  safe.updatedAt = Date.now();
  return safe;
}

function requireBrevoConfig() {
  const required = ['BREVO_API_KEY', 'MAIL_FROM'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error('Brevo API ayarları eksik: ' + missing.join(', '));
  if (!String(process.env.BREVO_API_KEY).startsWith('xkeysib-')) {
    throw new Error('BREVO_API_KEY yanlış tipte. API key xkeysib- ile başlamalı.');
  }
}

async function sendOtpMail(to, otp) {
  requireBrevoConfig();
  const appName = process.env.MAIL_APP_NAME || 'GiWorlds';
  const senderName = process.env.MAIL_FROM_NAME || appName;
  const senderEmail = process.env.MAIL_FROM;

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'api-key': process.env.BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: to }],
      subject: appName + ' tek kullanımlık giriş kodu',
      textContent: `Merhaba,\n\n${appName} tek kullanımlık giriş kodunuz: ${otp}\n\nBu kod 5 dakika geçerlidir. Bu işlemi siz yapmadıysanız bu maili dikkate almayın.`,
      htmlContent: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827"><h2>${appName} Tek Kullanımlık Giriş</h2><p>Giriş kodunuz:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${otp}</p><p>Bu kod <b>5 dakika</b> geçerlidir.</p><p>Bu işlemi siz yapmadıysanız bu maili dikkate almayın.</p></div>`
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Brevo API hata ${response.status}: ${text}`);
  }
  return text;
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const db = readDb();
  const email = db.sessions[token];
  if (!token || !email || !db.users[email]) {
    return res.status(401).json({ ok: false, error: 'Oturum bulunamadı. Tekrar giriş yap.' });
  }
  req.db = db; req.email = email; req.user = db.users[email]; req.token = token;
  next();
}

app.get('/', (req, res) => res.json({ ok: true, name: 'GiWorlds Backend', message: 'Backend çalışıyor.' }));
app.get('/api/health', (req, res) => res.json({
  ok: true,
  name: 'GiWorlds Backend',
  brevoConfigured: Boolean(process.env.BREVO_API_KEY && process.env.MAIL_FROM),
  otpLogin: true
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

// 1) OTP kodu gönderir
app.post('/api/forgot/request', async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const db = readDb();
  if (!db.users[email]) return res.status(404).json({ ok: false, error: 'Bu mail adresiyle kayıt bulunamadı.' });
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  try {
    await sendOtpMail(email, otp);
    db.otp[email] = { otp, expires: Date.now() + 5 * 60 * 1000, sentAt: Date.now(), used: false };
    writeDb(db);
    res.json({ ok: true, message: 'Tek kullanımlık giriş kodu mail adresine gönderildi. Kod 5 dakika geçerlidir.' });
  } catch (err) {
    console.error('GiWorlds OTP mail gönderilemedi:', err.message);
    res.status(500).json({ ok: false, error: 'Mail gönderilemedi. Brevo API ayarlarını kontrol et.' });
  }
});

function verifyOtpAndLogin(email, otp) {
  const db = readDb();
  const user = db.users[email];
  const row = db.otp[email];
  if (!user) return { status: 404, body: { ok: false, error: 'Hesap bulunamadı.' } };
  if (!row || row.used || Date.now() > row.expires || row.otp !== String(otp || '').trim()) {
    return { status: 400, body: { ok: false, error: 'Tek kullanımlık kod hatalı veya süresi dolmuş.' } };
  }
  row.used = true;
  const token = makeToken();
  db.sessions[token] = email;
  delete db.otp[email];
  writeDb(db);
  return { status: 200, body: { ok: true, token, user: { email, nick: user.nick }, save: user.save || null } };
}

// 2) OTP kodunu doğrular ve kullanıcıyı oyuna giriş yaptırır
app.post('/api/otp/login', (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const otp = req.body && (req.body.otp || req.body.code);
  const result = verifyOtpAndLogin(email, otp);
  res.status(result.status).json(result.body);
});

// Frontend eski endpoint kullanırsa da OTP ile giriş yapsın.
app.post('/api/forgot/verify', (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const otp = req.body && (req.body.otp || req.body.code);
  const result = verifyOtpAndLogin(email, otp);
  res.status(result.status).json(result.body);
});

// Eski şifre yenileme sistemi de kalsın: yeni şifre verilirse şifre değiştirir.
app.post('/api/forgot/reset', (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const { otp, code, newPassword } = req.body || {};
  const finalOtp = otp || code;
  const db = readDb();
  const row = db.otp[email];
  if (!db.users[email]) return res.status(404).json({ ok: false, error: 'Hesap bulunamadı.' });
  if (!row || row.used || Date.now() > row.expires || row.otp !== String(finalOtp || '').trim()) {
    return res.status(400).json({ ok: false, error: 'Tek kullanımlık kod hatalı veya süresi dolmuş.' });
  }
  if (!newPassword || String(newPassword).length < 6) {
    // Yeni şifre yoksa OTP ile direkt giriş yaptır.
    const result = verifyOtpAndLogin(email, finalOtp);
    return res.status(result.status).json(result.body);
  }
  db.users[email].pass = hashPassword(newPassword);
  row.used = true;
  delete db.otp[email];
  const token = makeToken();
  db.sessions[token] = email;
  writeDb(db);
  res.json({ ok: true, token, user: { email, nick: db.users[email].nick }, save: db.users[email].save || null });
});

app.listen(PORT, () => {
  ensureDb();
  console.log(`GiWorlds Backend çalışıyor: http://localhost:${PORT}`);
});
