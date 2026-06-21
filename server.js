const express = require("express");
const multer = require("multer");
const fetch = require("node-fetch");
const FormData = require("form-data");
const cors = require("cors");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const BOT_TOKEN = "8840495574:AAGMVmeIaEkokunOERmSM6Niv9EKqL2zwJg";
const CHAT_ID = "-4680237259";

app.use(cors());
app.use(express.json());

// Health check
app.get("/", (req, res) => res.json({ status: "Psulit Cash Count Backend running" }));

// Send text report to Telegram
app.post("/send-report", async (req, res) => {
  try {
    const { message } = req.body;
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text: message }),
    });
    const data = await r.json();
    res.json({ ok: data.ok });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Send photo + caption to Telegram
app.post("/send-photo", upload.single("photo"), async (req, res) => {
  try {
    const { caption } = req.body;
    const form = new FormData();
    form.append("chat_id", CHAT_ID);
    form.append("caption", caption || "Cash Count Photo");
    form.append("photo", req.file.buffer, {
      filename: req.file.originalname || "cashcount.jpg",
      contentType: req.file.mimetype,
    });
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      body: form,
    });
    const data = await r.json();
    res.json({ ok: data.ok });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
