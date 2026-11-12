// FakeSpotter Arena: a tiny server that serves the app and keeps API keys secret.
// Needs Node.js 18 or newer. No npm packages required.
// Start: node server.js   (then open http://localhost:3000)

const http = require("http");
const fs = require("fs");
const path = require("path");

// ---------- 1. Settings: read .env (KEY=value lines) ----------
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const val = m[2].replace(/^["']|["']$/g, "");
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
}
loadEnv(path.join(__dirname, ".env"));

const CFG = {
  port: Number(process.env.PORT || 3000),
  // The AI that writes the draft analysis on "Add a post" and coaches students' reasoning.
  // Set ONE of these: OPENAI_API_KEY (GPT) or ANTHROPIC_API_KEY (Claude). If both are set, LLM_PROVIDER picks.
  llmProvider: (process.env.LLM_PROVIDER || "").toLowerCase(),
  openaiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  openaiUrl: process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions",
  anthropicKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
  anthropicUrl: process.env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages",
  // Hive: AI-generated image detection (also reports Content Credentials / C2PA).
  hiveKey: process.env.HIVE_API_KEY || "",
  // v3 = self-serve "Service API Keys" (default). v2 = older enterprise project keys.
  hiveVersion: (process.env.HIVE_API_VERSION || "v3").toLowerCase(),
  hiveUrl: process.env.HIVE_API_URL || ((process.env.HIVE_API_VERSION || "v3").toLowerCase() === "v2" ? "https://api.thehive.ai/api/v2/task/sync" : "https://api.thehive.ai/api/v3/hive/ai-generated-and-deepfake-content-detection"),
  // Hive: AI-generated audio detection (Hive issues a separate key per project).
  hiveAudioKey: process.env.HIVE_AUDIO_API_KEY || "",
  hiveAudioUrl: process.env.HIVE_AUDIO_API_URL || "",
  // GPTZero: AI-written text detection.
  gptzeroKey: process.env.GPTZERO_API_KEY || "",
  gptzeroUrl: process.env.GPTZERO_API_URL || "https://api.gptzero.me/v2/predict/text"
};

// ---------- 2. Providers ----------
function llmName() {
  if (CFG.llmProvider === "openai" && CFG.openaiKey) return "GPT";
  if (CFG.llmProvider === "anthropic" && CFG.anthropicKey) return "Claude";
  if (CFG.openaiKey) return "GPT";
  if (CFG.anthropicKey) return "Claude";
  return "";
}
function extractJSON(text, who) {
  const m = String(text || "").match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`${who} did not return JSON`);
  return JSON.parse(m[0]);
}
async function callGPT(prompt, images) {
  const content = [{ type: "text", text: prompt }];
  for (const im of images || []) content.push({ type: "image_url", image_url: { url: `data:${im.media_type || "image/jpeg"};base64,${im.data}` } });
  const r = await fetch(CFG.openaiUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${CFG.openaiKey}` },
    body: JSON.stringify({
      model: CFG.openaiModel,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: "Reply with only one valid JSON object, no other text." }, { role: "user", content }]
    })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || `OpenAI API error ${r.status}`);
  return extractJSON(j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content, "GPT");
}
async function callLLM(prompt, images) { return llmName() === "GPT" ? callGPT(prompt, images) : callClaude(prompt, images); }
async function callClaude(prompt, images) {
  const content = [];
  for (const im of images || []) content.push({ type: "image", source: { type: "base64", media_type: im.media_type || "image/jpeg", data: im.data } });
  content.push({ type: "text", text: prompt });
  const r = await fetch(CFG.anthropicUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": CFG.anthropicKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: CFG.anthropicModel, max_tokens: 1200, system: "Reply with only one valid JSON object, no other text.", messages: [{ role: "user", content }] })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || `Claude API error ${r.status}`);
  const text = (j.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  return extractJSON(text, "Claude");
}

const HEADS = new Set(["ai_generated", "not_ai_generated", "deepfake", "not_deepfake", "none", "inconclusive", "real", "fake", "ai_generated_audio", "not_ai_generated_audio"]);
function findC2PA(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 6) return "";
  for (const [k, v] of Object.entries(obj)) {
    if (/c2pa/i.test(k) && v && typeof v === "object") {
      const parts = [v.claim_generator, v.actions_software_agent, v.generator].filter(x => typeof x === "string" && x);
      if (parts.length) return parts.join(" · ");
    }
    const inner = findC2PA(v, depth + 1); if (inner) return inner;
  }
  return "";
}
function parseHive(j) {
  // v3: { output: [ { classes: [ {class, value} ] } ], metadata }   v2: { status: [ { response: { output: [ { classes: [ {class, score} ] } ] } } ] }
  const v2 = j && j.status && j.status[0] && j.status[0].response;
  const outputs = (v2 ? v2.output : j && j.output) || [];
  if (!outputs.length) throw new Error("Unexpected Hive response. Check your key and HIVE_API_VERSION / HIVE_API_URL in .env.");
  // For video or audio, take the frame with the highest AI score.
  const score = c => (typeof c.value === "number" ? c.value : c.score) || 0;
  let best = null, bestAi = -1;
  for (const o of outputs) {
    const classes = o.classes || [];
    const ai = Math.max(...classes.filter(c => c.class === "ai_generated" || c.class === "ai_generated_audio").map(score), 0);
    if (ai > bestAi) { bestAi = ai; best = classes; }
  }
  const sources = (best || []).filter(c => !HEADS.has(c.class) && score(c) > 0.01).sort((a, b) => score(b) - score(a)).slice(0, 3).map(c => ({ name: c.class, score: score(c) }));
  return { ai: Math.max(bestAi, 0), sources, c2pa: findC2PA(v2 || j) };
}
async function callHive(buf, mediaType, filename, key, url) {
  let r;
  if (CFG.hiveVersion === "v2") {
    const form = new FormData();
    form.append("media", new Blob([buf], { type: mediaType }), filename);
    r = await fetch(url, { method: "POST", headers: { authorization: `Token ${key}` }, body: form });
  } else {
    r = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ input: [{ media_base64: `data:${mediaType};base64,${buf.toString("base64")}` }], media_metadata: true })
    });
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.message || j.error || j.detail || `Hive API error ${r.status}`).toString());
  return parseHive(j);
}

async function callGPTZero(text) {
  const r = await fetch(CFG.gptzeroUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": CFG.gptzeroKey },
    body: JSON.stringify({ document: text })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error || j.message || `GPTZero API error ${r.status}`).toString());
  const d = (j.documents && j.documents[0]) || {};
  const cp = d.class_probabilities || {};
  const ai = cp.ai != null ? cp.ai : d.completely_generated_prob;
  if (typeof ai !== "number") throw new Error("Unexpected GPTZero response. Check GPTZERO_API_URL.");
  return { ai, human: cp.human != null ? cp.human : 1 - ai, label: d.predicted_class || "" };
}

// ---------- 3. HTTP server ----------
const PUBLIC = path.join(__dirname, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json" };

function send(res, code, obj) { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); }
function readJSON(req, limit = 15 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > limit) { reject(new Error("Request too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (e) { reject(new Error("Bad JSON")); } });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/api/config" && req.method === "GET") {
      return send(res, 200, { llm: !!llmName(), llmName: llmName() || "AI", image: !!CFG.hiveKey, text: !!CFG.gptzeroKey, audio: !!(CFG.hiveAudioKey || CFG.hiveKey) });
    }
    if (url.pathname === "/api/llm" && req.method === "POST") {
      if (!llmName()) return send(res, 503, { code: "not_configured", message: "Set OPENAI_API_KEY or ANTHROPIC_API_KEY in .env" });
      const body = await readJSON(req);
      const json = await callLLM(String(body.prompt || "").slice(0, 20000), (body.images || []).slice(0, 4));
      return send(res, 200, { json });
    }
    if (url.pathname === "/api/detect" && req.method === "POST") {
      const body = await readJSON(req);
      if (body.type === "text") {
        if (!CFG.gptzeroKey) return send(res, 503, { message: "Set GPTZERO_API_KEY in .env" });
        const r = await callGPTZero(String(body.text || "").slice(0, 50000));
        return send(res, 200, { kind: "text", provider: "GPTZero", src: "gptzero_live", ...r });
      }
      if (body.type === "image" || body.type === "audio") {
        const key = body.type === "audio" ? (CFG.hiveAudioKey || CFG.hiveKey) : CFG.hiveKey;
        const endpoint = body.type === "audio" ? (CFG.hiveAudioUrl || CFG.hiveUrl) : CFG.hiveUrl;
        if (!key) return send(res, 503, { message: `Set ${body.type === "audio" ? "HIVE_AUDIO_API_KEY" : "HIVE_API_KEY"} in .env` });
        if (!body.data) return send(res, 400, { message: "No file was sent." });
        const buf = Buffer.from(body.data, "base64");
        const r = await callHive(buf, body.media_type || "application/octet-stream", body.filename || (body.type === "audio" ? "audio" : "image.jpg"), key, endpoint);
        return send(res, 200, { kind: body.type, provider: "Hive", src: "hive_live", ...r });
      }
      return send(res, 400, { message: "Unknown type" });
    }
    // static files
    let file = path.normalize(path.join(PUBLIC, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    send(res, 502, { message: e.message || "Server error" });
  }
});

server.listen(CFG.port, () => {
  console.log(`FakeSpotter Arena running at http://localhost:${CFG.port}`);
  console.log(`  AI analysis + coach:       ${llmName() ? "on (" + llmName() + ", " + (llmName() === "GPT" ? CFG.openaiModel : CFG.anthropicModel) + ")" : "off (set OPENAI_API_KEY or ANTHROPIC_API_KEY)"}`);
  console.log(`  Hive image detector:       ${CFG.hiveKey ? "on" : "off (set HIVE_API_KEY)"}`);
  console.log(`  Hive audio detector:       ${CFG.hiveAudioKey || CFG.hiveKey ? "on" : "off (set HIVE_AUDIO_API_KEY)"}`);
  console.log(`  GPTZero text detector:     ${CFG.gptzeroKey ? "on" : "off (set GPTZERO_API_KEY)"}`);
});
