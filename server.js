const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 3000;

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB bağlandı"))
  .catch((err) => console.log("MongoDB bağlantı hatası:", err));

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  nick: { type: String, default: "Oyuncu" },
  money: { type: Number, default: 1000 },
  gameState: { type: Object, default: {} },
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);

function publicUser(user){
  return {
    username: user.username,
    nick: user.nick || (user.gameState && user.gameState.player) || "Oyuncu",
    money: Number(user.money || 0),
    gameState: user.gameState || {}
  };
}

function calcWealth(state, user){
  state = state || {};
  const cash = Number(state.cash ?? user.money ?? 0);
  const bank = Number(state.bank || 0);
  const gold = Number(state.gold || 0);
  const price = Number(state.price || 6749);
  let companyValue = 0;
  if(Array.isArray(state.companies)){
    companyValue = state.companies.reduce((sum,c)=>sum+Number((c&&c.value)||0),0);
  }
  return cash + bank + (gold * price) + companyValue;
}

app.get("/", (req, res) => {
  res.send("GiWorlds backend çalışıyor");
});

app.post("/api/register", async (req, res) => {
  try {
    const { username, password, nick } = req.body;
    if (!username || !password) return res.json({ success:false, message:"Eksik bilgi" });

    const userExists = await User.findOne({ username });
    if (userExists) return res.json({ success:false, message:"Kullanıcı var" });

    const cleanNick = (nick && String(nick).trim()) || username.split("@")[0] || "Oyuncu";
    const initialState = {
      player: cleanNick,
      cash: 1000,
      bank: 0,
      gold: 0,
      price: 6749,
      income: 0,
      expense: 0,
      taxPaid: 0,
      workCount: 0,
      companies: [],
      cooldownEnds: {},
      active: null,
      lastSavedAt: Date.now()
    };

    const user = await User.create({ username, password, nick: cleanNick, money: 1000, gameState: initialState });
    res.json({ success:true, user: publicUser(user) });
  } catch (error) {
    console.error(error);
    res.json({ success:false, message:"Kayıt hatası" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username, password });
    if (!user) return res.json({ success:false, message:"Hatalı giriş" });

    const state = user.gameState || {};
    if((!user.nick || user.nick === "Oyuncu") && state.player && state.player !== "Oyuncu"){
      user.nick = state.player;
      await user.save();
    }
    res.json({ success:true, user: publicUser(user) });
  } catch (error) {
    console.error(error);
    res.json({ success:false, message:"Giriş hatası" });
  }
});

app.post("/api/save", async (req, res) => {
  try {
    const { username, gameState } = req.body;
    if (!username) return res.json({ success:false, message:"username eksik" });

    const user = await User.findOne({ username });
    if (!user) return res.json({ success:false, message:"Kullanıcı bulunamadı" });

    const state = gameState && typeof gameState === "object" ? gameState : {};
    state.lastSavedAt = Date.now();

    const finalNick = state.player && state.player !== "Oyuncu" ? state.player : (user.nick || "Oyuncu");
    state.player = finalNick;

    user.money = Number(state.cash) || 0;
    user.nick = finalNick;
    user.gameState = state;
    user.updatedAt = new Date();
    await user.save();

    res.json({ success:true, user: publicUser(user) });
  } catch (error) {
    console.error(error);
    res.json({ success:false, message:"Kaydetme hatası" });
  }
});

app.post("/api/load", async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.json({ success:false, message:"username eksik" });
    const user = await User.findOne({ username });
    if (!user) return res.json({ success:false, message:"Kullanıcı bulunamadı" });
    res.json({ success:true, user: publicUser(user) });
  } catch (error) {
    console.error(error);
    res.json({ success:false, message:"Yükleme hatası" });
  }
});

app.post("/api/update-nick", async (req, res) => {
  try {
    const { username, nick } = req.body;
    const cleanNick = String(nick || "").trim();
    if (!username || cleanNick.length < 2) return res.json({ success:false, message:"Nickname eksik" });
    const user = await User.findOne({ username });
    if (!user) return res.json({ success:false, message:"Kullanıcı bulunamadı" });
    const state = user.gameState || {};
    state.player = cleanNick;
    state.lastSavedAt = Date.now();
    user.nick = cleanNick;
    user.gameState = state;
    user.updatedAt = new Date();
    await user.save();
    res.json({ success:true, user: publicUser(user) });
  } catch (error) {
    console.error(error);
    res.json({ success:false, message:"Nickname kaydedilemedi" });
  }
});

app.get("/api/leaderboard", async (req, res) => {
  try {
    const users = await User.find({}).lean();
    const rows = users.map(u => {
      const state = u.gameState || {};
      const nick = (u.nick && u.nick !== "Oyuncu") ? u.nick : (state.player || "Oyuncu");
      return {
        nick,
        wealth: calcWealth(state, u),
        tax: Number(state.taxPaid || 0),
        work: Number(state.workCount || 0)
      };
    }).filter(x => x.nick && x.nick !== "Oyuncu");

    const sortBy = (field) => rows.slice().sort((a,b)=>Number(b[field]||0)-Number(a[field]||0)).slice(0,50);
    res.json({ success:true, leaderboard:{ wealth:sortBy("wealth"), tax:sortBy("tax"), work:sortBy("work") } });
  } catch (error) {
    console.error(error);
    res.json({ success:false, message:"Sıralama alınamadı" });
  }
});

app.post("/api/work", async (req, res) => {
  try {
    const { username, amount } = req.body;
    const earnAmount = Number(amount) || 10;
    const user = await User.findOne({ username });
    if (!user) return res.json({ success:false, message:"Kullanıcı bulunamadı" });
    const state = user.gameState || {};
    state.cash = Number(state.cash || user.money || 0) + earnAmount;
    state.workCount = Number(state.workCount || 0) + 1;
    state.player = state.player && state.player !== "Oyuncu" ? state.player : (user.nick || "Oyuncu");
    state.lastSavedAt = Date.now();
    user.money = state.cash;
    user.nick = state.player;
    user.gameState = state;
    await user.save();
    res.json({ success:true, money:user.money, user:publicUser(user) });
  } catch (error) {
    console.error(error);
    res.json({ success:false, message:"Para güncelleme hatası" });
  }
});

app.post("/api/save-money", async (req, res) => {
  try {
    const { username, money } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.json({ success:false, message:"Kullanıcı bulunamadı" });
    const state = user.gameState || {};
    state.cash = Number(money) || 0;
    state.player = state.player && state.player !== "Oyuncu" ? state.player : (user.nick || "Oyuncu");
    state.lastSavedAt = Date.now();
    user.money = state.cash;
    user.nick = state.player;
    user.gameState = state;
    await user.save();
    res.json({ success:true, money:user.money, user:publicUser(user) });
  } catch (error) {
    console.error(error);
    res.json({ success:false, message:"Kayıt hatası" });
  }
});

app.listen(PORT, () => {
  console.log("GiWorlds backend çalışıyor:", PORT);
});
