// Server-side provider config and callers. Keys never reach the browser.

// OpenAI-compatible chat completions endpoint. OPENAI_BASE_URL accepts either a
// bare base (https://api.openai.com/v1) or a full /chat/completions URL, so any
// OpenAI-compatible provider works (OpenAI, Azure gateways, vLLM, OpenRouter, ...).
function chatCompletionsUrl(raw: string): string {
  const trimmed = raw.replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

// Hive's documented task API is v2 (per-project key, "Authorization: token <key>", multipart
// "media" field): https://docs.thehive.ai/reference/authentication
// HIVE_API_VERSION wins when set; otherwise the version is read from HIVE_API_URL, so a v2 URL
// never gets v3's Bearer auth. With neither set, use v2.
function hiveVersion(): "v2" | "v3" {
  const explicit = (process.env.HIVE_API_VERSION || "").trim().toLowerCase();
  if (explicit === "v2" || explicit === "v3") return explicit;
  return /\/api\/v3\//.test(process.env.HIVE_API_URL || "") ? "v3" : "v2";
}
function hiveDefaultUrl(): string {
  return hiveVersion() === "v2"
    ? "https://api.thehive.ai/api/v2/task/sync"
    : "https://api.thehive.ai/api/v3/hive/ai-generated-and-deepfake-content-detection";
}

// Getters, not constants: on Cloudflare Workers (OpenNext) process.env is filled from the
// Worker's secrets per request, so values must be read at call time, not at module load.
export const CFG = {
  // LLM: drafts the analysis on "Add a post" and coaches students' reasoning.
  get llmKey() { return process.env.OPENAI_API_KEY || ""; },
  // Must accept images: the "Add a post" analysis sends the uploaded picture. gpt-5.6-terra
  // matched slower models on image judgement in our benchmark at about 2.8 s per call.
  get llmModel() { return process.env.OPENAI_MODEL || "gpt-5.6-terra"; },
  get llmUrl() { return chatCompletionsUrl(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"); },
  // Hive: AI-generated image detection (also reports Content Credentials / C2PA).
  get hiveVersion() { return hiveVersion(); },
  get hiveKey() { return process.env.HIVE_API_KEY || ""; },
  get hiveUrl() { return process.env.HIVE_API_URL || hiveDefaultUrl(); },
  // Hive: AI-generated audio detection. Leave the audio key empty to reuse HIVE_API_KEY.
  get hiveAudioKey() { return process.env.HIVE_AUDIO_API_KEY || ""; },
  get hiveAudioUrl() { return process.env.HIVE_AUDIO_API_URL || process.env.HIVE_API_URL || hiveDefaultUrl(); },
  // OpenAI: AI-written text detection (LLM judgment). Reuses the OpenAI key and
  // endpoint above; OPENAI_TEXT_MODEL can point at a smarter model than OPENAI_MODEL.
  // gpt-4.1 (no hidden reasoning) was the fastest and most accurate on our hard cases,
  // including the Armenian decree post, at about 0.7 s per call.
  get textModel() { return process.env.OPENAI_TEXT_MODEL || "gpt-4.1"; },
};

export function providerStatus() {
  return {
    llm: !!CFG.llmKey,
    image: !!CFG.hiveKey,
    text: !!CFG.llmKey,
    audio: !!(CFG.hiveAudioKey || CFG.hiveKey),
  };
}

export interface LLMImage {
  media_type?: string;
  data: string; // base64, no data-url prefix
}

// Calls any OpenAI-compatible /chat/completions endpoint with text + optional
// inline images (data URLs), and returns the first JSON object found in the reply.
export async function callLLM(prompt: string, images: LLMImage[] = []): Promise<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [];
  for (const im of images) {
    content.push({ type: "image_url", image_url: { url: `data:${im.media_type || "image/jpeg"};base64,${im.data}` } });
  }
  content.push({ type: "text", text: prompt });

  const r = await fetch(CFG.llmUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${CFG.llmKey}`,
    },
    body: JSON.stringify({
      model: CFG.llmModel,
      // Current OpenAI models reject the legacy max_tokens; max_completion_tokens also covers
      // hidden reasoning tokens, so it gets headroom beyond the ~1k-token JSON answer.
      max_completion_tokens: 4000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Reply with only one valid JSON object, no other text." },
        { role: "user", content },
      ],
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg =
      (j as { error?: { message?: string } | string }).error instanceof Object
        ? (j as { error: { message?: string } }).error.message
        : ((j as { message?: string }).message ?? `LLM API error ${r.status}`);
    throw new Error(String(msg));
  }
  const choices = (j as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> }).choices || [];
  const raw = choices[0]?.message?.content;
  const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((b) => b.text || "").join("") : "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("The model did not return JSON");
  return JSON.parse(m[0]);
}

const HEADS = new Set([
  "ai_generated", "not_ai_generated", "deepfake", "not_deepfake", "none", "inconclusive", "real", "fake",
  "ai_generated_audio", "not_ai_generated_audio",
]);

export interface DetectionResult {
  ai: number;
  sources: Array<{ name: string; score: number }>;
  c2pa: string;
  aiText?: number;
  human?: number;
  label?: string;
}

type HiveClass = { class: string; score?: number; value?: number };

// Content Credentials (C2PA) sit at different depths in v2 and v3 replies.
function findC2PA(obj: unknown, depth = 0): string {
  if (!obj || typeof obj !== "object" || depth > 6) return "";
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (/c2pa/i.test(k) && v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const parts = [o.claim_generator, o.actions_software_agent, o.generator].filter((x): x is string => typeof x === "string" && !!x);
      if (parts.length) return parts.join(" · ");
    }
    const inner = findC2PA(v, depth + 1);
    if (inner) return inner;
  }
  return "";
}

// v3: { output: [ { classes: [ {class, value} ] } ] }
// v2: { status: [ { response: { output: [ { classes: [ {class, score} ] } ] } } ] }
export function parseHive(j: unknown): { ai: number; sources: Array<{ name: string; score: number }>; c2pa: string } {
  const v2 = (j as { status?: Array<{ response?: { output?: Array<{ classes?: HiveClass[] }> } }> })?.status?.[0]?.response;
  const outputs = (v2 ? v2.output : (j as { output?: Array<{ classes?: HiveClass[] }> })?.output) || [];
  if (!outputs.length) throw new Error("Unexpected Hive response. Check HIVE_API_KEY, HIVE_API_VERSION and HIVE_API_URL.");
  const score = (c: HiveClass) => (typeof c.value === "number" ? c.value : c.score) || 0;
  // Video and audio return one output per frame or segment: keep the most AI-like one.
  let best: HiveClass[] = [];
  let bestAi = -1;
  for (const o of outputs) {
    const classes = o.classes || [];
    const ai = Math.max(0, ...classes.filter((c) => c.class === "ai_generated" || c.class === "ai_generated_audio").map(score));
    if (ai > bestAi) { bestAi = ai; best = classes; }
  }
  const sources = best
    .filter((c) => !HEADS.has(c.class) && score(c) > 0.01)
    .sort((a, b) => score(b) - score(a))
    .slice(0, 3)
    .map((c) => ({ name: c.class, score: score(c) }));
  return { ai: Math.max(bestAi, 0), sources, c2pa: findC2PA(v2 || j) };
}

export async function callHive(
  buf: Uint8Array | ArrayBuffer,
  mediaType: string,
  filename: string,
  key: string,
  url: string
): Promise<{ ai: number; sources: Array<{ name: string; score: number }>; c2pa: string }> {
  let r: Response;
  if (CFG.hiveVersion === "v2") {
    const form = new FormData();
    form.append("media", new Blob([buf as BlobPart], { type: mediaType }), filename);
    r = await fetch(url, { method: "POST", headers: { authorization: `Token ${key}` }, body: form });
  } else {
    const b64 = Buffer.from(buf as ArrayBuffer).toString("base64");
    r = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ input: [{ media_base64: `data:${mediaType};base64,${b64}` }], media_metadata: true }),
    });
  }
  const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string; detail?: string };
  if (!r.ok) throw new Error(String(j.message || j.error || j.detail || `Hive API error ${r.status}`));
  return parseHive(j);
}

export async function callOpenAITextDetect(text: string): Promise<{ ai: number; human: number; label: string }> {
  const r = await fetch(CFG.llmUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${CFG.llmKey}` },
    body: JSON.stringify({
      model: CFG.textModel,
      // Reasoning models spend hidden tokens before answering, so leave headroom.
      max_completion_tokens: 2000,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You judge whether a text was written by an AI model, in any language. " +
            'Reply with only one valid JSON object: {"ai_probability": <number between 0 and 1>, "label": "ai"|"human"|"mixed"}.',
        },
        { role: "user", content: text },
      ],
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg =
      (j as { error?: { message?: string } | string }).error instanceof Object
        ? (j as { error: { message?: string } }).error.message
        : ((j as { message?: string }).message ?? `OpenAI API error ${r.status}`);
    throw new Error(String(msg));
  }
  const choices = (j as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> }).choices || [];
  const raw = choices[0]?.message?.content;
  const out = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((b) => b.text || "").join("") : "";
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("The model did not return JSON");
  const d = JSON.parse(m[0]) as { ai_probability?: number; label?: string };
  const ai = typeof d.ai_probability === "number" ? Math.max(0, Math.min(1, d.ai_probability)) : NaN;
  if (Number.isNaN(ai)) throw new Error(`Unexpected ${CFG.textModel} response: no ai_probability.`);
  return { ai: +ai.toFixed(4), human: +(1 - ai).toFixed(4), label: typeof d.label === "string" ? d.label : "" };
}
