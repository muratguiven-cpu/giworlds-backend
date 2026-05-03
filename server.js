const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

let users = [];

// Kayıt
app.post("/api/register", (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.json({ success: false, message: "Eksik bilgi" });
    }

    const userExists = users.find(u => u.username === username);
    if (userExists) {
        return res.json({ success: false, message: "Kullanıcı var" });
    }

    users.push({
        username,
        password,
        money: 1000
    });

    res.json({ success: true });
});

// Giriş
app.post("/api/login", (req, res) => {
    const { username, password } = req.body;

    const user = users.find(u => u.username === username && u.password === password);

    if (!user) {
        return res.json({ success: false, message: "Hatalı giriş" });
    }

    res.json({ success: true, user });
});

// Para kazanma
app.post("/api/work", (req, res) => {
    const { username } = req.body;

    const user = users.find(u => u.username === username);

    if (!user) return res.json({ success: false });

    user.money += 10;

    res.json({ success: true, money: user.money });
});

app.listen(3000, () => {
    console.log("GiWorlds backend çalışıyor");
});
