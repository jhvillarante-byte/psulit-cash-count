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
  Intrepid: "C06NARV9T1R",
};

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
  console.log("Login result:", JSON.stringify(data).slice(0, 200));
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

async function getSnapshot(device, token) {
  const regionUrl = device.appServerUrl;
  console.log("Trying snapshot for device:", device.alias, "region:", regionUrl);

  // Method 1: Direct snapshot endpoint
  const snapUrl = `${regionUrl}/snapshot?deviceId=${device.deviceId}&token=${token}`;
  try {
    const r = await fetch(snapUrl);
    if (r.ok && r.headers.get("content-type")?.includes("image")) {
      console.log("Method 1 success");
      return await r.buffer();
    }
    console.log("Method 1 status:", r.status, r.headers.get("content-type"));
  } catch(e) { console.log("Method 1 error:", e.message); }

  // Method 2: Passthrough getPreviewImageInfo
  try {
    const r = await fetch(`${regionUrl}?token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "passthrough",
        params: {
          deviceId: device.deviceId,
          requestData: JSON.stringify({
            method: "getPreviewImageInfo",
            params: {},
          }),
        },
      }),
    });
    const data = await r.json();
    console.log("Method 2 result:", JSON.stringify(data).slice(0, 300));
    const inner = JSON.parse(data?.result?.responseData || "{}");
    const imgUrl = inner?.result?.previewImage || inner?.result?.url;
    if (imgUrl) {
      const imgRes = await fetch(imgUrl);
      if (imgRes.ok) return await imgRes.buffer();
    }
  } catch(e) { console.log("Method 2 error:", e.message); }

  // Method 3: getMediaEncrypt for stream info
  try {
    const r = await fetch(`${regionUrl}?token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "passthrough",
        params: {
          deviceId: device.deviceId,
          requestData: JSON.stringify({
            method: "getLiveView",
            params: { channels: [0] },
          }),
        },
      }),
    });
    const data = await r.json();
    console.log("Method 3 result:", JSON.stringify(data).slice(0, 300));
  } catch(e) { console.log("Method 3 error:", e.message); }

  return null;
}

app.get("/tapo-devices", async (req, res) => {
  try {
    if (!TAPO_EMAIL || !TAPO_PASSWORD) return res.json({ ok: false, error: "Tapo credentials not configured" });
    const token = await getTapoToken();
    if (!token) return res.json({ ok: false, error: "Tapo login failed" });
    const devices = await getTapoDevices(token);
    res.json({ ok: true, devices: devices.map(d => ({ name: d.alias, id: d.deviceId, model: d.deviceModel, region: d.appServerUrl })) });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

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

app.post("/send-slack", async (req, res) => {
  try {
    const { branch, message } = req.body;
    const ok = await sendToSlack(branch, message);
    res.json({ ok });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post("/tapo-snapshot", async (req, res) => {
  try {
    const { branch, caption } = req.body;
    if (!TAPO_EMAIL || !TAPO_PASSWORD) return res.json({ ok: false, error: "Tapo credentials not set" });

    const token = await getTapoToken();
    if (!token) return res.json({ ok: false, error: "Tapo login failed" });

    const devices = await getTapoDevices(token);
    const cameraName = BRANCH_CAMERAS[branch];
    const device = devices.find(d => d.alias === cameraName);

    if (!device) return res.json({ ok: false, error: `Camera "${cameraName}" not found. Available: ${devices.map(d=>d.alias).join(", ")}` });

    console.log("Getting snapshot for:", cameraName);
    const snapBuffer = await getSnapshot(device, token);

    if (snapBuffer && snapBuffer.length > 500) {
      const form = new FormData();
      form.append("chat_id", CHAT_ID);
      form.append("caption", caption || `📸 CCTV Snapshot — ${branch} — ${cameraName}`);
      form.append("photo", snapBuffer, { filename: "snapshot.jpg", contentType: "image/jpeg" });
      const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { method: "POST", body: form });
      const data = await r.json();
      console.log("Telegram photo result:", JSON.stringify(data).slice(0, 200));
      return res.json({ ok: data.ok, method: "snapshot", camera: cameraName });
    }

    // Fallback message
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text: `📹 CCTV: ${cameraName} (${branch})\n⚠️ Auto-snapshot unavailable — verify on Tapo app\n${caption}` }),
    });
    const data = await r.json();
    res.json({ ok: data.ok, method: "fallback", camera: cameraName });

  } catch (e) {
    console.log("Snapshot error:", e.message);
    res.json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Psulit Cash Count Backend running on port ${PORT}`));
