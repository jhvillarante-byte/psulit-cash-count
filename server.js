const express = require("express");
const multer = require("multer");
const fetch = require("node-fetch");
const FormData = require("form-data");
const cors = require("cors");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const BOT_TOKEN = "8840495574:AAGMVmeIaEkokunOERmSM6Niv9EKqL2zwJg";
const CHAT_ID = "-4680237259";
const TAPO_EMAIL = process.env.TAPO_EMAIL;
const TAPO_PASSWORD = process.env.TAPO_PASSWORD;
const SLACK_TOKEN = process.env.SLACK_TOKEN;

const SLACK_CHANNELS = {
  Solaire: "C0B734364T0",
  Alphaland: "C06NDDD1D0U",
};

const BRANCH_CAMERAS = {
  Solaire: "SolaireCam01",
  Alphaland: "Alphaland_psulit_vault",
};

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => res.json({ status: "Psulit Cash Count Backend running ✅" }));

async function sendToSlack(branch, message) {
  try {
    const channelId = SLACK_CHANNELS[branch];
    if (!channelId || !SLACK_TOKEN) return false;
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SLACK_TOKEN}`
      },
      body: JSON.stringify({
        channel: channelId,
        text: message,
        username: "Psulit Cash Count",
        icon_emoji: ":bank:"
      })
    });
    const data = await res.json();
    console.log("Slack result:", JSON.stringify(data).slice(0, 200));
    return data.ok;
  } catch(e) {
    console.log("Slack error:", e.message);
    return false;
  }
}

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

const MANAGER_USER_ID = "U0B8SV8CG9L"; // Corporate Psulit DM

app.post("/send-slack", async (req, res) => {
  try {
    const { branch, message, breakdown } = req.body;
    const channelId = SLACK_CHANNELS[branch];
    if (!channelId || !SLACK_TOKEN) return res.json({ ok: false, error: "No channel or token" });

    // Send summary to channel
    const r1 = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SLACK_TOKEN}` },
      body: JSON.stringify({ channel: channelId, text: message })
    });
    const d1 = await r1.json();
    if (!d1.ok) return res.json({ ok: false, error: d1.error });

    // Send full breakdown as DM to manager only
    if (breakdown) {
      await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SLACK_TOKEN}` },
        body: JSON.stringify({ channel: MANAGER_USER_ID, text: breakdown })
      });
    }

    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post("/send-photo", upload.single("photo"), async (req, res) => {
  try {
    const { caption } = req.body;
    const form = new FormData();
    form.append("chat_id", CHAT_ID);
    form.append("caption", caption || "Cash Count Photo");
    form.append("photo", req.file.buffer, { filename: "cashcount.jpg", contentType: req.file.mimetype });
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { method: "POST", body: form });
    const data = await r.json();
    res.json({ ok: data.ok });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Psulit Cash Count Backend running on port ${PORT}`));
