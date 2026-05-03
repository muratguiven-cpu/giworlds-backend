const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_THIS_SECRET_IN_PRODUCTION';
const FRONTEND_DIR = process.env.FRONTEND_DIR || path.join(__dirname, '..', 'frontend');
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'users.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: {} }, null, 2));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(express.static(FRONTEND_DIR));

function readDb() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { users: {} }; }
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function cleanNick(value) {
  return String(value || '').trim().replace(/[<>]/g, '').slice(0, 24);
}

function publicUser(user) {
  return {
    username: user.username,
    email: user.username,
    nick: user.nick,
    gameState: user.gameState || {}
  };
}

app.get('/api/health', (req, res) => {
  res.json({ success: true, app: 'GiWorlds' });
});

app.post('/api/register', async (req, res) => {
  const username = cleanEmail(req.body.username || req.body.email);
  const password = String(req.body.password || '');
  const nick = cleanNick(req.body.nick || req.body.nickname);

  if (!username.includes('@')) return res.status(400).json({ success: false, message: 'Geçerli mail adresi gerekli.' });
  if (password.length < 6) return res.status(400).json({ success: false, message: 'Şifre en az 6 karakter olmalı.' });
  if (nick.length < 2) return res.status(400).json({ success: false, message: 'Nickname en az 2 karakter olmalı.' });

  const db = readDb();
  if (db.users[username]) return res.status(409).json({ success: false, message: 'Bu mail adresi zaten kayıtlı.' });

  const duplicateNick = Object.values(db.users).some(u => String(u.nick || '').toLowerCase() === nick.toLowerCase());
  if (duplicateNick) return res.status(409).json({ success: false, message: 'Bu nickname kullanılıyor.' });

  const passwordHash = await bcrypt.hash(password, 12);
  const now = Date.now();
  db.users[username] = {
    username,
    nick,
    passwordHash,
    createdAt: now,
    updatedAt: now,
    gameState: {
      cash: 1000,
      bank: 0,
      gold: 0,
      price: 6749,
      income: 0,
      expense: 0,
      taxPaid: 0,
      workCount: 0,
      player: nick,
      companies: [],
      lastSavedAt: now
    }
  };
  writeDb(db);

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ success: true, token, user: publicUser(db.users[username]) });
});

app.post('/api/login', async (req, res) => {
  const username = cleanEmail(req.body.username || req.body.email);
  const password = String(req.body.password || '');
  const db = readDb();
  const user = db.users[username];

  if (!user) return res.status(401).json({ success: false, message: 'Mail veya şifre hatalı.' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ success: false, message: 'Mail veya şifre hatalı.' });

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ success: true, token, user: publicUser(user) });
});

app.post('/api/save', (req, res) => {
  const username = cleanEmail(req.body.username || req.body.email);
  const gameState = req.body.gameState || {};
  const db = readDb();
  const user = db.users[username];

  if (!user) return res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı.' });

  const lockedNick = user.nick;
  user.gameState = {
    ...gameState,
    player: lockedNick,
    lastSavedAt: Date.now()
  };
  user.updatedAt = Date.now();
  writeDb(db);
  res.json({ success: true });
});

app.get('/api/leaderboard', (req, res) => {
  const db = readDb();
  const players = Object.values(db.users).map(user => {
    const g = user.gameState || {};
    const cash = Number(g.cash || 0);
    const bank = Number(g.bank || 0);
    const gold = Number(g.gold || 0);
    const price = Number(g.price || 6749);
    const wealth = Number(g.wealth || (cash + bank + gold * price));
    return {
      nick: user.nick,
      wealth,
      tax: Number(g.taxPaid || 0),
      work: Number(g.workCount || 0)
    };
  }).filter(p => p.nick && p.nick !== 'Oyuncu');

  const sortBy = key => [...players].sort((a, b) => Number(b[key] || 0) - Number(a[key] || 0)).slice(0, 100);
  res.json({
    success: true,
    leaderboard: {
      wealth: sortBy('wealth'),
      tax: sortBy('tax'),
      work: sortBy('work')
    }
  });
});

app.post('/api/forgot-password', (req, res) => {
  res.status(501).json({
    success: false,
    message: 'Mail ile şifre sıfırlama için SMTP servisi bağlanmalıdır. Eski şifre mail ile gönderilmez.'
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`GiWorlds backend çalışıyor: http://localhost:${PORT}`);
});
