const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

// 🔐 Gmail SMTP
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
  user: process.env.MAIL_USER,
  pass: process.env.MAIL_PASS,
}
});

// TEST endpoint
app.get("/", (req, res) => {
  res.send("Backend çalışıyor 🚀");
});

// 📩 Mail gönderme endpointi
app.post("/send-mail", async (req, res) => {
  const { to } = req.body;

  const kod = Math.floor(100000 + Math.random() * 900000);

  try {
    await transporter.sendMail({
      from: `"GiWorlds" <muratguiven@gmail.com>`,
      to,
      subject: "GiWorlds Şifre Kodu",
      text: `Şifre sıfırlama kodun: ${kod}`,
    });

    console.log("MAIL GÖNDERİLDİ:", to, kod);

    res.json({
      success: true,
      message: "Mail gönderildi",
      kod, // test için gösteriyoruz
    });
  } catch (err) {
    console.log("HATA:", err);

    res.json({
      success: false,
      message: "Mail gönderilemedi",
      error: err.message,
    });
  }
});

app.listen(3000, () => {
  console.log("Server çalışıyor: http://localhost:3000");
});
