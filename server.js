const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
const fetch = require("node-fetch");
const FormData = require("form-data");
const cors = require("cors");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.CASH_COUNT_TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || process.env.CASH_COUNT_TELEGRAM_CHAT_ID;
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

const allowedOrigin = process.env.CASH_COUNT_FRONTEND_ORIGIN || "https://psulit-cash-count.netlify.app";
app.set("trust proxy", 1);
app.use(cors({ origin: allowedOrigin }));
app.use(express.json());

const sessions = new Map();
const failedPinAttempts = new Map();
const PIN_WINDOW_MS = 15 * 60 * 1000;
const PIN_MAX_FAILURES = 5;
const pinSalt = process.env.CASH_COUNT_PIN_HASH_SALT || "";
let tellerPinHashes = [];
try { tellerPinHashes = JSON.parse(process.env.CASH_COUNT_TELLER_PIN_HASHES || "[]"); } catch (_) { tellerPinHashes = []; }

function hashPin(pin) {
  return crypto.scryptSync(String(pin), pinSalt, 32).toString("hex");
}
function issueSession(req, res) {
  const pin = String(req.body?.pin || "");
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const attempt = failedPinAttempts.get(ip);
  if (attempt && now - attempt.startedAt < PIN_WINDOW_MS && attempt.failures >= PIN_MAX_FAILURES) return res.status(429).json({ ok: false, error: "Too many failed PIN attempts. Try again later." });
  if (attempt && now - attempt.startedAt >= PIN_WINDOW_MS) failedPinAttempts.delete(ip);
  if (!/^\d{4}$/.test(pin) || !pinSalt || !tellerPinHashes.length) {
    recordFailedPinAttempt(ip, now);
    return res.status(401).json({ ok: false, error: "Invalid PIN" });
  }
  const candidate = hashPin(pin);
  const match = tellerPinHashes.find(entry => {
    if (!/^[0-9a-f]{64}$/i.test(String(entry.hash || ""))) return false;
    return crypto.timingSafeEqual(Buffer.from(entry.hash, "hex"), Buffer.from(candidate, "hex"));
  });
  if (!match) {
    recordFailedPinAttempt(ip, now);
    return res.status(401).json({ ok: false, error: "Invalid PIN" });
  }
  failedPinAttempts.delete(ip);
  const token = crypto.randomBytes(32).toString("base64url");
  sessions.set(token, { ...match, expiresAt: Date.now() + 2 * 60 * 60 * 1000 });
  res.json({ ok: true, token, teller: match.name, branches: match.branches || [] });
}
function recordFailedPinAttempt(ip, now) {
  const existing = failedPinAttempts.get(ip);
  if (!existing || now - existing.startedAt >= PIN_WINDOW_MS) failedPinAttempts.set(ip, { startedAt: now, failures: 1 });
  else existing.failures += 1;
}
app.post("/auth/session", issueSession);
function requireSession(req, res, next) {
  const token = req.get("Authorization")?.replace(/^Bearer\s+/i, "") || req.get("X-Cash-Count-Session");
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) return res.status(401).json({ ok: false, error: "Cash Count session required" });
  req.cashCountSession = session;
  next();
}

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

app.post("/send-report", requireSession, async (req, res) => {
  try {
    const { message } = req.body;
    if (!BOT_TOKEN || !CHAT_ID) return res.json({ ok: false, error: "Telegram is not configured" });
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

app.post("/send-slack", requireSession, async (req, res) => {
  try {
    const { branch, message, breakdown } = req.body;
    if (req.cashCountSession.branches?.length && !req.cashCountSession.branches.includes(branch)) return res.status(403).json({ ok: false, error: "Branch not authorized" });
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

app.post("/send-photo", requireSession, upload.single("photo"), async (req, res) => {
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

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Psulit Cash Count Backend running on port ${PORT}`));
}

module.exports = { app, hashPin, resetAuthState: () => { sessions.clear(); failedPinAttempts.clear(); } };
