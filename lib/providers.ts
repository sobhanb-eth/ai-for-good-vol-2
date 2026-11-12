// Server-side provider config and callers. Keys never reach the browser.

// OpenAI-compatible chat completions endpoint. OPENAI_BASE_URL accepts either a
// bare base (https://api.openai.com/v1) or a full /chat/completions URL, so any
// OpenAI-compatible provider works (OpenAI, Azure gateways, vLLM, OpenRouter, ...).
function chatCompletionsUrl(raw: string): string {
  const trimmed = raw.replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

export const CFG = {
  // LLM: drafts the analysis on "Add a post" and coaches students' reasoning.
  llmKey: process.env.OPENAI_API_KEY || "",
  llmModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  llmUrl: chatCompletionsUrl(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"),
  // Hive: AI-generated image detection (also reports Content Credentials / C2PA).
  hiveKey: process.env.HIVE_API_KEY || "",
  hiveUrl: process.env.HIVE_API_URL || "https://api.thehive.ai/api/v2/task/sync",
  // Hive: AI-generated audio detection (Hive issues a separate key per project).
  hiveAudioKey: process.env.HIVE_AUDIO_API_KEY || "",
  hiveAudioUrl: process.env.HIVE_AUDIO_API_URL || process.env.HIVE_API_URL || "https://api.thehive.ai/api/v2/task/sync",
  // OpenAI: AI-written text detection (LLM judgment). Reuses the OpenAI key and
  // endpoint above; OPENAI_TEXT_MODEL can point at a smarter model than OPENAI_MODEL.
  textModel: process.env.OPENAI_TEXT_MODEL || "gpt-6.1-terra",
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
      max_tokens: 1200,
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

export function parseHive(j: unknown): { ai: number; sources: Array<{ name: string; score: number }>; c2pa: string } {
  const out =
    (j as { status?: Array<{ response?: { output?: Array<Record<string, unknown>> } }> })?.status?.[0]?.response?.output?.[0];
  if (!out) throw new Error("Unexpected Hive response. Check HIVE_API_URL and that the key belongs to an AI-detection project.");
  const classes = (out.classes as Array<{ class: string; score: number }> | undefined) || [];
  const ai = classes.find((c) => c.class === "ai_generated" || c.class === "ai_generated_audio")?.score;
  const sources = classes
    .filter((c) => !HEADS.has(c.class) && c.score > 0.01)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((c) => ({ name: c.class, score: c.score }));
  const c2p = out.algorithmic_tags as { c2pa?: { claim_generator?: string; actions_software_agent?: string } } | undefined;
  const c2pa = c2p?.c2pa && (c2p.c2pa.claim_generator || c2p.c2pa.actions_software_agent)
    ? [c2p.c2pa.claim_generator, c2p.c2pa.actions_software_agent].filter(Boolean).join(" · ")
    : "";
  return { ai: typeof ai === "number" ? ai : 0, sources, c2pa };
}

export async function callHive(
  buf: Uint8Array | ArrayBuffer,
  mediaType: string,
  filename: string,
  key: string,
  url: string
): Promise<{ ai: number; sources: Array<{ name: string; score: number }>; c2pa: string }> {
  const form = new FormData();
  form.append("media", new Blob([buf as BlobPart], { type: mediaType }), filename);
  const r = await fetch(url, { method: "POST", headers: { authorization: `Token ${key}` }, body: form });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(String((j as { message?: string; error?: string }).message || (j as { error?: string }).error || `Hive API error ${r.status}`));
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
