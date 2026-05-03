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

app.get("/", (req, res) => {
    res.send("GiWorlds backend çalışıyor");
});

app.post("/api/register", async (req, res) => {
    try {
        const { username, password, nick } = req.body;

        if (!username || !password) {
            return res.json({ success: false, message: "Eksik bilgi" });
        }

        const userExists = await User.findOne({ username });
        if (userExists) {
            return res.json({ success: false, message: "Kullanıcı var" });
        }

        const initialState = {
            player: nick || username.split("@")[0] || "Oyuncu",
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

        const user = await User.create({
            username,
            password,
            nick: initialState.player,
            money: 1000,
            gameState: initialState
        });

        res.json({
            success: true,
            user: {
                username: user.username,
                nick: user.nick,
                money: user.money,
                gameState: user.gameState
            }
        });

    } catch (error) {
        console.error(error);
        res.json({ success: false, message: "Kayıt hatası" });
    }
});

app.post("/api/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        const user = await User.findOne({ username, password });
        if (!user) {
            return res.json({ success: false, message: "Hatalı giriş" });
        }

        res.json({
            success: true,
            user: {
                username: user.username,
                nick: user.nick,
                money: user.money,
                gameState: user.gameState || {}
            }
        });

    } catch (error) {
        console.error(error);
        res.json({ success: false, message: "Giriş hatası" });
    }
});

app.post("/api/save", async (req, res) => {
    try {
        const { username, gameState } = req.body;

        if (!username) {
            return res.json({ success: false, message: "username eksik" });
        }

        const state = gameState && typeof gameState === "object" ? gameState : {};
        state.lastSavedAt = Date.now();

        const user = await User.findOneAndUpdate(
            { username },
            {
                $set: {
                    money: Number(state.cash) || 0,
                    nick: state.player || "Oyuncu",
                    gameState: state,
                    updatedAt: new Date()
                }
            },
            { new: true }
        );

        if (!user) {
            return res.json({ success: false, message: "Kullanıcı bulunamadı" });
        }

        res.json({ success: true });

    } catch (error) {
        console.error(error);
        res.json({ success: false, message: "Kaydetme hatası" });
    }
});

app.post("/api/load", async (req, res) => {
    try {
        const { username } = req.body;

        if (!username) {
            return res.json({ success: false, message: "username eksik" });
        }

        const user = await User.findOne({ username });
        if (!user) {
            return res.json({ success: false, message: "Kullanıcı bulunamadı" });
        }

        res.json({
            success: true,
            user: {
                username: user.username,
                nick: user.nick,
                money: user.money,
                gameState: user.gameState || {}
            }
        });

    } catch (error) {
        console.error(error);
        res.json({ success: false, message: "Yükleme hatası" });
    }
});

app.post("/api/work", async (req, res) => {
    try {
        const { username, amount } = req.body;
        const earnAmount = Number(amount) || 10;

        const user = await User.findOne({ username });
        if (!user) {
            return res.json({ success: false, message: "Kullanıcı bulunamadı" });
        }

        const state = user.gameState || {};
        state.cash = Number(state.cash || user.money || 0) + earnAmount;
        state.workCount = Number(state.workCount || 0) + 1;
        state.lastSavedAt = Date.now();

        user.money = state.cash;
        user.gameState = state;
        await user.save();

        res.json({
            success: true,
            money: user.money,
            user: {
                username: user.username,
                nick: user.nick,
                money: user.money,
                gameState: user.gameState || {}
            }
        });

    } catch (error) {
        console.error(error);
        res.json({ success: false, message: "Para güncelleme hatası" });
    }
});

app.post("/api/save-money", async (req, res) => {
    try {
        const { username, money } = req.body;

        const user = await User.findOne({ username });
        if (!user) {
            return res.json({ success: false, message: "Kullanıcı bulunamadı" });
        }

        const state = user.gameState || {};
        state.cash = Number(money) || 0;
        state.lastSavedAt = Date.now();

        user.money = state.cash;
        user.gameState = state;
        await user.save();

        res.json({ success: true, money: user.money });

    } catch (error) {
        console.error(error);
        res.json({ success: false, message: "Kayıt hatası" });
    }
});

app.listen(PORT, () => {
    console.log("GiWorlds backend çalışıyor:", PORT);
});
