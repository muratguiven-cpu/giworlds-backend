const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// MongoDB bağlantısı
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("MongoDB bağlandı"))
    .catch((err) => console.log("MongoDB bağlantı hatası:", err));

// Kullanıcı modeli
const User = mongoose.model("User", {
    username: String,
    password: String,
    money: Number
});

// Test
app.get("/", (req, res) => {
    res.send("GiWorlds backend çalışıyor");
});

// Kayıt
app.post("/api/register", async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.json({ success: false, message: "Eksik bilgi" });
        }

        const userExists = await User.findOne({ username });

        if (userExists) {
            return res.json({ success: false, message: "Kullanıcı var" });
        }

        const user = await User.create({
            username,
            password,
            money: 1000
        });

        res.json({
            success: true,
            user: {
                username: user.username,
                money: user.money
            }
        });

    } catch (error) {
        res.json({ success: false, message: "Kayıt hatası" });
    }
});

// Giriş
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
                money: user.money
            }
        });

    } catch (error) {
        res.json({ success: false, message: "Giriş hatası" });
    }
});

// Para kazanma
app.post("/api/work", async (req, res) => {
    try {
        const { username, amount } = req.body;

        const earnAmount = Number(amount) || 10;

        const user = await User.findOne({ username });

        if (!user) {
            return res.json({ success: false, message: "Kullanıcı bulunamadı" });
        }

        user.money += earnAmount;
        await user.save();

        res.json({
            success: true,
            money: user.money,
            user: {
                username: user.username,
                money: user.money
            }
        });

    } catch (error) {
        res.json({ success: false, message: "Para güncelleme hatası" });
    }
});

// Nakit kaydetme
app.post("/api/save-money", async (req, res) => {
    try {
        const { username, money } = req.body;

        const user = await User.findOne({ username });

        if (!user) {
            return res.json({ success: false, message: "Kullanıcı bulunamadı" });
        }

        user.money = Number(money) || 0;
        await user.save();

        res.json({
            success: true,
            money: user.money,
            user: {
                username: user.username,
                money: user.money
            }
        });

    } catch (error) {
        res.json({ success: false, message: "Kayıt hatası" });
    }
});

app.listen(PORT, () => {
    console.log("GiWorlds backend çalışıyor:", PORT);
});
