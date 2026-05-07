const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || 'giworlds';

let db;

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

async function connectDb() {
  if (db) return db;
  if (!MONGODB_URI) throw new Error('MONGODB_URI eksik. Render Environment içine MongoDB bağlantı linkini ekle.');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db(DB_NAME);
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
  await db.collection('sessions').createIndex({ token: 1 }, { unique: true });
  await db.collection('sessions').createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
  await db.collection('otps').createIndex({ email: 1 }, { unique: true });
  await db.collection('otps').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 60 });
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
function cleanSave(save, nick) {
  const safe = save && typeof save === 'object' ? save : {};
  safe.player = nick || safe.player || '';
  safe.updatedAt = Date.now();
  return safe;
}

async function sendOtpMail(to, otp) {
  const apiKey = process.env.BREVO_API_KEY;
  const fromEmail = process.env.MAIL_FROM || process.env.MAIL_USER;
  const fromName = process.env.MAIL_FROM_NAME || 'GiWorlds';
  const appName = process.env.MAIL_APP_NAME || 'GiWorlds';
  if (!apiKey) throw new Error('BREVO_API_KEY eksik.');
  if (!fromEmail) throw new Error('MAIL_FROM eksik.');

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      sender: { name: fromName, email: fromEmail },
      to: [{ email: to }],
      subject: appName + ' şifre yenileme kodu',
      textContent: `Merhaba,\n\n${appName} şifre yenileme kodunuz: ${otp}\n\nBu kod 5 dakika geçerlidir.`,
      htmlContent: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827"><h2>${appName} Şifre Yenileme</h2><p>Tek kullanımlık şifre yenileme kodunuz:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${otp}</p><p>Bu kod <b>5 dakika</b> geçerlidir.</p></div>`
    })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Brevo API hata ${response.status}: ${body}`);
  }
}

async function auth(req, res, next) {
  try {
    const database = await connectDb();
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ ok: false, error: 'Oturum bulunamadı. Tekrar giriş yap.' });

    const session = await database.collection('sessions').findOne({ token });
    if (!session) return res.status(401).json({ ok: false, error: 'Oturum bulunamadı. Tekrar giriş yap.' });

    const user = await database.collection('users').findOne({ email: session.email });
    if (!user) return res.status(401).json({ ok: false, error: 'Kullanıcı bulunamadı. Tekrar giriş yap.' });

    req.db = database;
    req.email = session.email;
    req.user = user;
    next();
  } catch (err) {
    console.error('Auth hata:', err.message);
    res.status(500).json({ ok: false, error: 'Sunucu oturum kontrolü yapamadı.' });
  }
}

app.get('/', (req, res) => res.json({ ok: true, name: 'GiWorlds Backend', message: 'Backend çalışıyor. Veriler MongoDB üzerinde kalıcı saklanır.' }));
app.get('/api/health', async (req, res) => {
  try {
    await connectDb();
    res.json({
      ok: true,
      name: 'GiWorlds Backend',
      storage: 'mongodb',
      mongodbConfigured: Boolean(process.env.MONGODB_URI),
      brevoConfigured: Boolean(process.env.BREVO_API_KEY && (process.env.MAIL_FROM || process.env.MAIL_USER))
    });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post('/api/register', async (req, res) => {
  try {
    const database = await connectDb();
    const { nick, password, save } = req.body || {};
    const email = normalizeEmail(req.body && req.body.email);
    if (!nick || String(nick).trim().length < 2) return res.status(400).json({ ok: false, error: 'Nickname en az 2 karakter olmalı.' });
    if (!email.includes('@')) return res.status(400).json({ ok: false, error: 'Geçerli mail adresi yaz.' });
    if (!password || String(password).length < 6) return res.status(400).json({ ok: false, error: 'Şifre en az 6 karakter olmalı.' });
    if (await database.collection('users').findOne({ email })) return res.status(409).json({ ok: false, error: 'Bu mail adresiyle zaten kayıt var.' });

    const cleanNick = String(nick).trim();
    const user = { email, nick: cleanNick, pass: hashPassword(password), save: cleanSave(save, cleanNick), createdAt: Date.now(), updatedAt: Date.now() };
    await database.collection('users').insertOne(user);
    const token = makeToken();
    await database.collection('sessions').insertOne({ token, email, createdAt: new Date() });
    res.json({ ok: true, token, user: { email, nick: cleanNick }, save: user.save });
  } catch (err) { console.error('Register hata:', err.message); res.status(500).json({ ok: false, error: 'Kayıt oluşturulamadı.' }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const database = await connectDb();
    const email = normalizeEmail(req.body && req.body.email);
    const password = req.body && req.body.password;
    const user = await database.collection('users').findOne({ email });
    if (!user || !verifyPassword(password, user.pass)) return res.status(401).json({ ok: false, error: 'Mail adresi veya şifre hatalı.' });
    const token = makeToken();
    await database.collection('sessions').insertOne({ token, email, createdAt: new Date() });
    res.json({ ok: true, token, user: { email, nick: user.nick }, save: user.save || null });
  } catch (err) { console.error('Login hata:', err.message); res.status(500).json({ ok: false, error: 'Giriş yapılamadı.' }); }
});

app.post('/api/save', auth, async (req, res) => {
  try {
    const save = cleanSave(req.body && req.body.save, req.user.nick);
    await req.db.collection('users').updateOne({ email: req.email }, { $set: { save, updatedAt: Date.now() } });
    res.json({ ok: true, savedAt: save.updatedAt });
  } catch (err) { console.error('Save hata:', err.message); res.status(500).json({ ok: false, error: 'Oyun kaydedilemedi.' }); }
});

app.post('/api/load', auth, async (req, res) => {
  res.json({ ok: true, user: { email: req.email, nick: req.user.nick }, save: req.user.save || null });
});


const leaderboardProductPrices = [
  [199.99,299.99,399.99],
  [999.99,1299.99,1599.99],
  [4999.99,7999.99,11999.99],
  [24999.99,39999.99,59999.99],
  [99999.99,149999.99,199999.99],
  [499999.99,799999.99,1199999.99]
];
function rankNumber(v) {
  v = Number(v);
  return Number.isFinite(v) ? v : 0;
}
function companyValueFromSave(save) {
  const companies = Array.isArray(save && save.companies) ? save.companies : [];
  return companies.reduce((total, c, i) => {
    if (!c || typeof c !== 'object') return total;
    let value = rankNumber(c.value);
    if (Array.isArray(c.staff)) value += c.staff.reduce((s, n) => s + rankNumber(n) * 1000, 0);
    if (Array.isArray(c.inventory)) {
      const prices = leaderboardProductPrices[i] || [];
      value += c.inventory.reduce((s, n, pi) => s + rankNumber(n) * rankNumber(prices[pi]), 0);
    }
    return total + value;
  }, 0);
}
function leaderboardSnapshot(user) {
  const save = user && user.save && typeof user.save === 'object' ? user.save : {};
  const price = rankNumber(save.price) || 6749;
  const wealth = rankNumber(save.cash) + rankNumber(save.bank) + (rankNumber(save.gold) * price) + companyValueFromSave(save);
  return {
    nick: String(user.nick || save.player || 'Oyuncu'),
    wealth,
    tax: rankNumber(save.taxPaid),
    work: rankNumber(save.workCount),
    updatedAt: rankNumber(user.updatedAt || save.updatedAt || user.createdAt)
  };
}
async function leaderboardHandler(req, res) {
  try {
    const database = await connectDb();
    const users = await database.collection('users')
      .find({}, { projection: { _id: 0, nick: 1, save: 1, createdAt: 1, updatedAt: 1 } })
      .toArray();

    const rows = users.map(leaderboardSnapshot).filter(row => row.nick && row.nick !== 'Oyuncu');
    const byWealth = rows.slice().sort((a, b) => b.wealth - a.wealth);
    const byTax = rows.slice().sort((a, b) => b.tax - a.tax);
    const byWork = rows.slice().sort((a, b) => b.work - a.work);

    res.json({
      ok: true,
      wealth: byWealth,
      tax: byTax,
      work: byWork,
      count: rows.length,
      updatedAt: Date.now()
    });
  } catch (err) {
    console.error('Leaderboard hata:', err.message);
    res.status(500).json({ ok: false, error: 'Sıralama alınamadı.' });
  }
}
app.get('/api/leaderboard', leaderboardHandler);
app.post('/api/leaderboard', leaderboardHandler);

app.post('/api/forgot/request', async (req, res) => {
  try {
    const database = await connectDb();
    const email = normalizeEmail(req.body && req.body.email);
    if (!await database.collection('users').findOne({ email })) return res.status(404).json({ ok: false, error: 'Bu mail adresiyle kayıt bulunamadı.' });
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
    const database = await connectDb();
    const email = normalizeEmail(req.body && req.body.email);
    const { otp, newPassword } = req.body || {};
    const user = await database.collection('users').findOne({ email });
    if (!user) return res.status(404).json({ ok: false, error: 'Hesap bulunamadı.' });

    const row = await database.collection('otps').findOne({ email });
    if (!row || Date.now() > new Date(row.expiresAt).getTime() || row.otp !== String(otp || '')) {
      return res.status(400).json({ ok: false, error: 'Tek kullanımlık şifre hatalı veya süresi dolmuş.' });
    }
    if (!newPassword || String(newPassword).length < 6) return res.status(400).json({ ok: false, error: 'Yeni şifre en az 6 karakter olmalı.' });

    await database.collection('users').updateOne({ email }, { $set: { pass: hashPassword(newPassword), updatedAt: Date.now() } });
    await database.collection('otps').deleteOne({ email });
    res.json({ ok: true });
  } catch (err) { console.error('Reset hata:', err.message); res.status(500).json({ ok: false, error: 'Şifre yenilenemedi.' }); }
});

app.post('/api/forgot/verify-login', async (req, res) => {
  try {
    const database = await connectDb();
    const email = normalizeEmail(req.body && req.body.email);
    const { otp } = req.body || {};
    const user = await database.collection('users').findOne({ email });
    if (!user) return res.status(404).json({ ok: false, error: 'Hesap bulunamadı.' });

    const row = await database.collection('otps').findOne({ email });
    if (!row || Date.now() > new Date(row.expiresAt).getTime() || row.otp !== String(otp || '')) {
      return res.status(400).json({ ok: false, error: 'Tek kullanımlık şifre hatalı veya süresi dolmuş.' });
    }
    await database.collection('otps').deleteOne({ email });
    const token = makeToken();
    await database.collection('sessions').insertOne({ token, email, createdAt: new Date() });
    res.json({ ok: true, token, user: { email, nick: user.nick }, save: user.save || null });
  } catch (err) { console.error('OTP login hata:', err.message); res.status(500).json({ ok: false, error: 'OTP ile giriş yapılamadı.' }); }
});

connectDb()
  .then(() => app.listen(PORT, () => console.log(`GiWorlds Backend çalışıyor: http://localhost:${PORT} | MongoDB aktif`)))
  .catch((err) => { console.error('MongoDB bağlantı hatası:', err.message); process.exit(1); });
