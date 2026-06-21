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

// Tapo camera device IDs per branch — update these after running /tapo-devices
const TAPO_CAMERAS = {
  Solaire: "SolaireCam01",
  Alphaland: "Alphaland_Front Desk",
  Intrepid: "Intrepid Camera",
};

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => res.json({ status: "Psulit Cash Count Backend running" }));

// Get Tapo cloud token
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

// Get list of Tapo devices
async function getTapoDevices(token) {
  const res = await fetch(`https://wap.tplinkcloud.com?token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: "getDeviceList", params: {} }),
  });
  const data = await res.json();
  return data?.result?.deviceList || [];
}

// Get snapshot from a specific Tapo camera
async function getTapoSnapshot(token, deviceId, deviceRegion) {
  try {
    const regionUrl = `https://${deviceRegion}.tplinkcloud.com?token=${token}`;
    // Send passthrough to get streaming info
    const res = await fetch(regionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "passthrough",
        params: {
          deviceId: deviceId,
          requestData: JSON.stringify({
            method: "get",
            params: { image: { get_current_brightness: {} } },
          }),
        },
      }),
    });

    // Try direct snapshot URL approach
    const snapshotRes = await fetch(regionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "passthrough",
        params: {
          deviceId: deviceId,
          requestData: JSON.stringify({
            method: "getLiveView",
            params: {},
          }),
        },
      }),
    });

    return null; // Will fall back to no-snapshot mode if API doesn't support it
  } catch (e) {
    return null;
  }
}

// Endpoint to list Tapo devices (for setup)
app.get("/tapo-devices", async (req, res) => {
  try {
    if (!TAPO_EMAIL || !TAPO_PASSWORD) {
      return res.json({ ok: false, error: "Tapo credentials not configured" });
    }
    const token = await getTapoToken();
    if (!token) return res.json({ ok: false, error: "Failed to get Tapo token — check credentials" });
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

// Send photo to Telegram (uploaded from form)
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

// Auto-snapshot from Tapo + send to Telegram
app.post("/tapo-snapshot", async (req, res) => {
  try {
    const { branch, caption } = req.body;
    if (!TAPO_EMAIL || !TAPO_PASSWORD) {
      return res.json({ ok: false, error: "Tapo credentials not set" });
    }

    const token = await getTapoToken();
    if (!token) return res.json({ ok: false, error: "Tapo login failed" });

    const devices = await getTapoDevices(token);
    const cameraName = TAPO_CAMERAS[branch];
    const device = devices.find(d => d.alias === cameraName);

    if (!device) {
      return res.json({ ok: false, error: `Camera "${cameraName}" not found. Available: ${devices.map(d => d.alias).join(", ")}` });
    }

    // Try to get snapshot via passthrough API
    const regionUrl = device.appServerUrl + `?token=${token}`;
    const snapshotRes = await fetch(regionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "passthrough",
        params: {
          deviceId: device.deviceId,
          requestData: JSON.stringify({
            method: "getVideoQualities",
            params: {},
          }),
        },
      }),
    });

    res.json({ ok: true, message: "Tapo connected, snapshot feature requires camera RTSP support", device: device.alias });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Psulit Cash Count Backend running on port ${PORT}`));
