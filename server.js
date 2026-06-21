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

// Camera to use per branch for cash count snapshot
const BRANCH_CAMERAS = {
  Solaire: "SolaireCam01",
  Alphaland: "Alphaland_psulit_vault",
  Intrepid: "Intrepid Camera",
};

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => res.json({ status: "Psulit Cash Count Backend running ✅" }));

async function getTapoToken() {
  const res = await fetch("https://wap.tplinkcloud.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      method: "login",
      params: {
        appType: "Tapo_Android",
        cloudPassword: TAPO_PASSWORD,
        cloudUserName: TAPO_EMAIL,
        terminalUUID: "psulit-cash-count-backend",
      },
    }),
  });
  const data = await res.json();
  return data?.result?.token || null;
}

async function getTapoDevices(token) {
  const res = await fetch(`https://wap.tplinkcloud.com?token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: "getDeviceList", params: {} }),
  });
  const data = await res.json();
  return data?.result?.deviceList || [];
}

async function getTapoSnapshot(device, token) {
  try {
    const regionUrl = `${device.appServerUrl}?token=${token}`;

    // Request snapshot URL via passthrough
    const res = await fetch(regionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "passthrough",
        params: {
          deviceId: device.deviceId,
          requestData: JSON.stringify({
            method: "getVideoCapability",
            params: {},
          }),
        },
      }),
    });

    // Use the TP-Link stream snapshot endpoint
    const snapshotUrl = `https://storage.tplinkcloud.com/v1/devices/${device.deviceId}/snapshot?token=${token}`;
    const snapRes = await fetch(snapshotUrl);
    if (snapRes.ok) {
      const buffer = await snapRes.buffer();
      return buffer;
    }

    // Alternative: try direct stream API
    const streamRes = await fetch(regionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "passthrough",
        params: {
          deviceId: device.deviceId,
          requestData: JSON.stringify({
            method: "getMediaEncrypt",
            params: {},
          }),
        },
      }),
    });

    return null;
  } catch (e) {
    console.log("Snapshot error:", e.message);
    return null;
  }
}

// List devices
app.get("/tapo-devices", async (req, res) => {
  try {
    if (!TAPO_EMAIL || !TAPO_PASSWORD) return res.json({ ok: false, error: "Tapo credentials not configured" });
    const token = await getTapoToken();
    if (!token) return res.json({ ok: false, error: "Tapo login failed — check credentials" });
    const devices = await getTapoDevices(token);
    res.json({ ok: true, devices: devices.map(d => ({ name: d.alias, id: d.deviceId, model: d.deviceModel, region: d.appServerUrl })) });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

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

// Send photo to Telegram (manual upload fallback)
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

// Auto-snapshot from Tapo and send to Telegram
app.post("/tapo-snapshot", async (req, res) => {
  try {
    const { branch, caption } = req.body;
    if (!TAPO_EMAIL || !TAPO_PASSWORD) return res.json({ ok: false, error: "Tapo credentials not set" });

    const token = await getTapoToken();
    if (!token) return res.json({ ok: false, error: "Tapo login failed" });

    const devices = await getTapoDevices(token);
    const cameraName = BRANCH_CAMERAS[branch];
    const device = devices.find(d => d.alias === cameraName);

    if (!device) return res.json({ ok: false, error: `Camera "${cameraName}" not found` });

    // Try to get snapshot buffer
    const snapBuffer = await getTapoSnapshot(device, token);

    if (snapBuffer && snapBuffer.length > 1000) {
      // Send snapshot to Telegram
      const form = new FormData();
      form.append("chat_id", CHAT_ID);
      form.append("caption", caption || `📸 CCTV Snapshot — ${branch} — ${cameraName}`);
      form.append("photo", snapBuffer, { filename: "snapshot.jpg", contentType: "image/jpeg" });
      const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { method: "POST", body: form });
      const data = await r.json();
      return res.json({ ok: data.ok, method: "snapshot", camera: cameraName });
    }

    // Fallback: send camera info as text if snapshot fails
    const fallbackMsg = `📹 CCTV Auto-capture attempted\n📷 Camera: ${cameraName}\n🏦 Branch: ${branch}\n⚠️ Live snapshot unavailable — please verify manually on Tapo app`;
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text: caption + "\n\n" + fallbackMsg }),
    });
    const data = await r.json();
    res.json({ ok: data.ok, method: "fallback", camera: cameraName });

  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Psulit Cash Count Backend running on port ${PORT}`));
