const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'giworlds';

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

let client;
let db;
async function getDb() {
  if (db) return db;
  if (!MONGODB_URI) throw new Error('MONGODB_URI eksik. Render Environment içine MONGODB_URI ekle.');
  client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db(MONGODB_DB);
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
  await db.collection('sessions').createIndex({ token: 1 }, { unique: true });
  await db.collection('sessions').createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
  await db.collection('otps').createIndex({ email: 1 }, { unique: true });
  await db.collection('otps').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  return db;
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
function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function safeNum(v, fallback = 0) {
  v = Number(v);
  return Number.isFinite(v) ? v : fallback;
}

const companyDefs = [
  { products: [["Oyun",199.99],["Yazılım",299.99],["Yapay Zeka",399.99]] },
  { products: [["Tarımcılık",999.99],["Hayvancılık",1299.99],["Temiz Su",1499.99]] },
  { products: [["Otonom Dron",4999.99],["Robotik Üretim",6999.99],["Veri Merkezi",9999.99]] },
  { products: [["Enerji Santrali",29999.99],["Uzay Parçası",49999.99],["Akıllı Şehir Sistemi",69999.99]] },
  { products: [["Küresel Lojistik",99999.99],["Mega Fabrika",149999.99],["Yapay Zeka Ağı",199999.99]] },
  { products: [["Uzay Madenciliği Yatırımı",499999.99],["Uzay Turizmi Yatırımı",799999.99],["Uzayda Kolonileşme Yatırımı",1199999.99]] }
];

function getCompanyValueFromSave(save) {
  const companies = Array.isArray(save && save.companies) ? save.companies : [];
  return companies.reduce((sum, c, i) => {
    if (!c || typeof c !== 'object') return sum;
    const base = safeNum(c.value, 0);
    const staff = Array.isArray(c.staff) ? c.staff.reduce((s, n) => s + safeNum(n, 0) * 1000, 0) : 0;
    const inventory = Array.isArray(c.inventory) ? c.inventory.reduce((s, count, pi) => {
      const price = companyDefs[i] && companyDefs[i].products[pi] ? companyDefs[i].products[pi][1] : 0;
      return s + safeNum(count, 0) * price;
    }, 0) : 0;
    return sum + base + staff + inventory;
  }, 0);
}
function getSnapshot(user) {
  const save = (user && user.save && typeof user.save === 'object') ? user.save : {};
  const nick = String(user.nick || save.player || 'Oyuncu').trim() || 'Oyuncu';
  const wealth = safeNum(save.cash, 0) + safeNum(save.bank, 0) + safeNum(save.gold, 0) * safeNum(save.price, 6749) + getCompanyValueFromSave(save);
  const tax = safeNum(save.taxPaid, 0);
  const work = safeNum(save.workCount, 0);
  return { nick, wealth, tax, work, updatedAt: safeNum(save.updatedAt || user.updatedAt || user.createdAt || 0, 0), countryCode: String(save.countryCode || 'GW'), countryName: String(save.countryName || 'GiWorld') };
}
function cleanSave(save, nick) {
  const safe = (save && typeof save === 'object') ? save : {};
  safe.player = nick || safe.player || '';
  safe.updatedAt = Date.now();
  return safe;
}

async function sendOtpMail(to, otp) {
  const key = process.env.BREVO_API_KEY;
  const from = process.env.MAIL_FROM;
  const fromName = process.env.MAIL_FROM_NAME || 'GiWorlds';
  const appName = process.env.MAIL_APP_NAME || 'GiWorlds';
  if (!key || !from) throw new Error('Brevo API ayarları eksik: BREVO_API_KEY ve MAIL_FROM gerekli.');
  const payload = {
    sender: { name: fromName, email: from },
    to: [{ email: to }],
    subject: appName + ' şifre yenileme kodu',
    textContent: `Merhaba,\n\n${appName} şifre yenileme kodunuz: ${otp}\n\nBu kod 5 dakika geçerlidir. Bu işlemi siz yapmadıysanız bu maili dikkate almayın.`,
    htmlContent: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827"><h2>${appName} Şifre Yenileme</h2><p>Tek kullanımlık şifre yenileme kodunuz:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${otp}</p><p>Bu kod <b>5 dakika</b> geçerlidir.</p><p>Bu işlemi siz yapmadıysanız bu maili dikkate almayın.</p></div>`
  };
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': key },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error('Brevo API hata ' + response.status + ': ' + text);
  }
}

async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ ok: false, error: 'Oturum bulunamadı. Tekrar giriş yap.' });
    const database = await getDb();
    const session = await database.collection('sessions').findOne({ token });
    if (!session || !session.email) return res.status(401).json({ ok: false, error: 'Oturum bulunamadı. Tekrar giriş yap.' });
    const user = await database.collection('users').findOne({ email: session.email });
    if (!user) return res.status(401).json({ ok: false, error: 'Oturum bulunamadı. Tekrar giriş yap.' });
    req.db = database;
    req.email = session.email;
    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    console.error('Auth hata:', err.message);
    res.status(500).json({ ok: false, error: 'Sunucu oturum kontrolünde hata oluştu.' });
  }
}

app.get('/', (req, res) => res.json({ ok: true, name: 'GiWorlds Backend', message: 'Backend çalışıyor. MongoDB kalıcı kayıt ve gerçek leaderboard aktif.' }));

app.get('/api/time', (req, res) => {
  const now = new Date();
  res.json({
    ok: true,
    serverTime: now.toISOString(),
    timestamp: now.getTime(),
    timezone: 'Europe/Istanbul',
    source: 'render-server'
  });
});

app.get('/api/health', async (req, res) => {
  try {
    const database = await getDb();
    await database.command({ ping: 1 });
    res.json({ ok: true, name: 'GiWorlds Backend', mongodb: true, leaderboard: true });
  } catch (err) {
    res.status(500).json({ ok: false, mongodb: false, error: err.message });
  }
});

app.post('/api/register', async (req, res) => {
  try {
    const { nick, password, save } = req.body || {};
    const email = normalizeEmail(req.body && req.body.email);
    if (!nick || String(nick).trim().length < 2) return res.status(400).json({ ok: false, error: 'Nickname en az 2 karakter olmalı.' });
    if (!validEmail(email)) return res.status(400).json({ ok: false, error: 'Geçerli mail adresi yaz.' });
    if (!password || String(password).length < 6) return res.status(400).json({ ok: false, error: 'Şifre en az 6 karakter olmalı.' });
    const database = await getDb();
    const existing = await database.collection('users').findOne({ email });
    if (existing) return res.status(409).json({ ok: false, error: 'Bu mail adresiyle zaten kayıt var.' });
    const pass = hashPassword(password);
    const now = Date.now();
    const user = { email, nick: String(nick).trim(), pass, save: cleanSave(save, String(nick).trim()), createdAt: now, updatedAt: now };
    await database.collection('users').insertOne(user);
    const token = makeToken();
    await database.collection('sessions').insertOne({ token, email, createdAt: new Date() });
    res.json({ ok: true, token, user: { email, nick: user.nick }, save: user.save });
  } catch (err) {
    console.error('Register hata:', err.message);
    res.status(500).json({ ok: false, error: 'Kayıt oluşturulamadı.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body && req.body.email);
    const password = req.body && req.body.password;
    const database = await getDb();
    const user = await database.collection('users').findOne({ email });
    if (!user || !verifyPassword(password, user.pass)) return res.status(401).json({ ok: false, error: 'Mail adresi veya şifre hatalı.' });
    const token = makeToken();
    await database.collection('sessions').insertOne({ token, email, createdAt: new Date() });
    res.json({ ok: true, token, user: { email, nick: user.nick }, save: user.save || null });
  } catch (err) {
    console.error('Login hata:', err.message);
    res.status(500).json({ ok: false, error: 'Giriş yapılamadı.' });
  }
});

app.post('/api/save', auth, async (req, res) => {
  try {
    const save = cleanSave(req.body && req.body.save, req.user.nick);
    await req.db.collection('users').updateOne({ email: req.email }, { $set: { save, updatedAt: Date.now() } });
    res.json({ ok: true, savedAt: save.updatedAt });
  } catch (err) {
    console.error('Save hata:', err.message);
    res.status(500).json({ ok: false, error: 'Oyun kaydı sunucuya yazılamadı.' });
  }
});

app.post('/api/load', auth, async (req, res) => {
  res.json({ ok: true, user: { email: req.email, nick: req.user.nick }, save: req.user.save || null });
});

app.post('/api/leaderboard', async (req, res) => {
  try {
    const database = await getDb();
    const users = await database.collection('users').find({}, { projection: { email: 0, pass: 0 } }).toArray();
    const snapshots = users.map(getSnapshot).filter(x => x.nick && x.nick !== 'Oyuncu');
    const byNick = new Map();
    for (const item of snapshots) {
      const key = item.nick.toLowerCase();
      const old = byNick.get(key);
      if (!old || item.updatedAt > old.updatedAt) byNick.set(key, item);
    }
    const unique = Array.from(byNick.values());
    const sortTake = (field) => unique.slice().sort((a, b) => safeNum(b[field], 0) - safeNum(a[field], 0)).slice(0, 100);
    res.json({
      ok: true,
      wealth: sortTake('wealth'),
      tax: sortTake('tax'),
      work: sortTake('work'),
      updatedAt: Date.now()
    });
  } catch (err) {
    console.error('Leaderboard hata:', err.message);
    res.status(500).json({ ok: false, error: 'Sıralama verisi alınamadı.' });
  }
});

app.post('/api/forgot/request', async (req, res) => {
  try {
    const email = normalizeEmail(req.body && req.body.email);
    const database = await getDb();
    const user = await database.collection('users').findOne({ email });
    if (!user) return res.status(404).json({ ok: false, error: 'Bu mail adresiyle kayıt bulunamadı.' });
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    await sendOtpMail(email, otp);
    await database.collection('otps').updateOne(
      { email },
      { $set: { email, otp, expiresAt: new Date(Date.now() + 5 * 60 * 1000), sentAt: new Date() } },
      { upsert: true }
    );
    res.json({ ok: true, message: 'Tek kullanımlık kod mail adresine gönderildi.' });
  } catch (err) {
    console.error('GiWorlds OTP mail gönderilemedi:', err.message);
    res.status(500).json({ ok: false, error: 'Mail gönderilemedi. Brevo API ayarlarını kontrol et.' });
  }
});

app.post('/api/forgot/reset', async (req, res) => {
  try {
    const email = normalizeEmail(req.body && req.body.email);
    const { otp, newPassword } = req.body || {};
    const database = await getDb();
    const user = await database.collection('users').findOne({ email });
    if (!user) return res.status(404).json({ ok: false, error: 'Hesap bulunamadı.' });
    const row = await database.collection('otps').findOne({ email });
    if (!row || row.expiresAt.getTime() < Date.now() || row.otp !== String(otp || '')) return res.status(400).json({ ok: false, error: 'Tek kullanımlık şifre hatalı veya süresi dolmuş.' });
    if (!newPassword || String(newPassword).length < 6) return res.status(400).json({ ok: false, error: 'Yeni şifre en az 6 karakter olmalı.' });
    await database.collection('users').updateOne({ email }, { $set: { pass: hashPassword(newPassword), updatedAt: Date.now() } });
    await database.collection('otps').deleteOne({ email });
    res.json({ ok: true });
  } catch (err) {
    console.error('Reset hata:', err.message);
    res.status(500).json({ ok: false, error: 'Şifre yenilenemedi.' });
  }
});

app.listen(PORT, async () => {
  console.log(`GiWorlds Backend çalışıyor: http://localhost:${PORT}`);
  try {
    await getDb();
    console.log('MongoDB bağlantısı başarılı. Kalıcı kayıt ve gerçek leaderboard aktif.');
  } catch (err) {
    console.error('MongoDB bağlantı hatası:', err.message);
  }
});
