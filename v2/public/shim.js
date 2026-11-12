// Connects the app to this project's server (server.js) instead of the Claude artifact runtime.
// - window.claude.use("sample") -> /api/llm (Claude via your ANTHROPIC_API_KEY)
// - window.claude.use("tts")    -> the browser's built-in speech voices
// - window.FS_API.detect()      -> /api/detect (Hive / GPTZero via your keys)
(function () {
  const configPromise = fetch("/api/config").then(r => r.json()).catch(() => ({ llm: false, image: false, text: false, audio: false }));

  const blobToBase64 = blob => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1]);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });

  const sample = async () => ({ text: "" });
  sample.limits = async () => ({ images: { maxCount: 4, mediaTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"] } });
  sample.json = async (prompt, opts = {}) => {
    const images = [];
    for (const b of [].concat(opts.images || [])) images.push({ media_type: b.type || "image/jpeg", data: await blobToBase64(b) });
    const r = await fetch("/api/llm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: typeof prompt === "string" ? prompt : JSON.stringify(prompt), images }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw { code: r.status === 503 ? "unavailable" : "error", message: j.message };
    return j.json;
  };

  let pending = null;
  const tts = {
    speak(text, opts = {}) {
      return new Promise((resolve, reject) => {
        if (!("speechSynthesis" in window)) return reject({ code: "unavailable" });
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = opts.language || "en-US"; u.rate = 0.98;
        const v = speechSynthesis.getVoices().find(x => /^en/i.test(x.lang));
        if (v) u.voice = v;
        pending = reject;
        u.onend = () => { pending = null; resolve(); };
        u.onerror = () => { pending = null; reject({ code: "error" }); };
        speechSynthesis.speak(u);
      });
    },
    stop() { speechSynthesis.cancel(); if (pending) { pending({ code: "viewer_stopped" }); pending = null; } }
  };

  window.claude = {
    use: async name => {
      const cfg = await configPromise;
      if (name === "sample") return cfg.llm ? sample : null;
      if (name === "tts") return "speechSynthesis" in window ? tts : null;
      return null;
    }
  };

  window.FS_API = {
    config: null,
    async detect(A) {
      const body = { type: A.type };
      if (A.type === "text") body.text = A.text;
      if (A.type === "image") { body.data = await blobToBase64(A.imgBlob); body.media_type = "image/jpeg"; body.filename = "post.jpg"; }
      if (A.type === "audio") {
        if (!A.audioFile) throw new Error("Choose an audio file to run the voice detector.");
        body.data = await blobToBase64(A.audioFile); body.media_type = A.audioFile.type || "audio/mpeg"; body.filename = A.audioFile.name;
      }
      const r = await fetch("/api/detect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "The detector call failed.");
      return j;
    }
  };
  configPromise.then(cfg => { window.FS_API.config = cfg; window.dispatchEvent(new Event("fs-config")); });
})();
