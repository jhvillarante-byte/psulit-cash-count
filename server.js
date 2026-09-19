const express = require("express");
const multer = require("multer");
const fetch = require("node-fetch");
const FormData = require("form-data");
const cors = require("cors");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Telegram config comes from env vars so the bot token is not in the repo.
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
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


// ── TELLER AUTH ───────────────────────────────────
// PINs come from the TELLER_PINS_JSON env var so they are never in the repo.
// Format: {"3571":{"name":"Irene Maligat","branches":["Solaire"]}, ...}
// An empty or missing "branches" array means the teller may use any branch.
let TELLER_PINS = {};
try {
  TELLER_PINS = JSON.parse(process.env.TELLER_PINS_JSON || "{}");
} catch (e) {
  console.error("TELLER_PINS_JSON is not valid JSON — teller login will reject all PINs.");
  TELLER_PINS = {};
}

const sessions = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function newToken() {
  return require("crypto").randomBytes(24).toString("hex");
}

function requireSession(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) return null;
  return session;
}

app.post("/auth/session", (req, res) => {
  const pin = String((req.body && req.body.pin) || "").trim();
  if (!/^\d{4}$/.test(pin)) {
    return res.status(400).json({ ok: false, error: "Valid 4-digit PIN required." });
  }
  if (!Object.keys(TELLER_PINS).length) {
    return res.status(500).json({ ok: false, error: "Teller PINs are not configured on the server." });
  }
  const teller = TELLER_PINS[pin];
  if (!teller) {
    return res.status(401).json({ ok: false, error: "Incorrect PIN." });
  }
  const token = newToken();
  sessions.set(token, {
    teller: teller.name,
    branches: teller.branches || [],
    expires: Date.now() + SESSION_TTL_MS,
  });
  res.json({
    ok: true,
    token,
    teller: teller.name,
    branches: teller.branches || [],
  });
});

// Clear expired sessions hourly so the map cannot grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions) if (s.expires < now) sessions.delete(token);
}, 60 * 60 * 1000);

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
  if (!BOT_TOKEN || !CHAT_ID) return res.json({ ok: false, error: "Telegram is not configured on the server." });
  if (!requireSession(req)) return res.status(401).json({ ok: false, error: "Session expired. Please log in again." });
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
  if (!requireSession(req)) return res.status(401).json({ ok: false, error: "Session expired. Please log in again." });
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

    // Send full summary + breakdown as DM to manager
    if (breakdown) {
      // Send summary to DM first
      const dmR = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SLACK_TOKEN}` },
        body: JSON.stringify({ channel: MANAGER_USER_ID, text: message })
      });
      const dmD = await dmR.json();
      // Send breakdown as thread reply to DM
      if (dmD.ok && dmD.ts) {
        await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SLACK_TOKEN}` },
          body: JSON.stringify({ channel: MANAGER_USER_ID, text: breakdown, thread_ts: dmD.ts })
        });
      }
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
