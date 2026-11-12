# FakeSpotter Arena

A real-or-fake game that trains students to spot AI fakes and misleading posts, with a teacher dashboard and an "Add a post" screen that runs real AI detectors. Built as an installable PWA on Next.js 16.

- **Student game:** posts from a Yerevan feed (AI images, an AI-edited photo, AI-written Armenian text, an AI voice, real photos that look fake). Students choose Real or Fake, say how sure they are and why, and can use check tools.
- **Teacher view:** class profiles (too trusting, too suspicious, overconfident), tricks that fool the class, progress over the semester. The class data is a fictional demo.
- **Add a post:** a teacher uploads an image, text or audio. A real detector scores it (Hive for images and audio, FineTuned LFM3 Omni — an OpenAI model — judges text), an LLM drafts an explanation, and the teacher decides Real or Fake before it joins the game.
- **Installable PWA:** add it to a home screen, play offline once loaded.

---

## 1. Run it on your computer (5 minutes)

1. Install **Node.js 20.9 or newer** from https://nodejs.org (the "LTS" version).
2. Open a terminal in this folder.
3. Run:
   ```
   npm install
   npm run dev
   ```
4. Open **http://localhost:3000** in your browser.

The game works right away, with no keys. The keys switch on the live AI features.

For a production build: `npm run build` then `npm start`.

## 2. Add your API keys

1. Copy `.env.example` and name the copy `.env.local` (repo root).
2. Paste your keys after the `=` signs:

| Setting | What it switches on | Where to get it |
|---|---|---|
| `OPENAI_API_KEY` | The draft analysis on "Add a post", and the AI coach that grades students' reasoning | https://platform.openai.com/api-keys |
| `HIVE_API_KEY` | Live AI-image and AI-voice detection score, likely generator, Content Credentials | https://thehive.ai → sign in → left sidebar **Service API Keys** → **Create API Key** (free tier, about 100 requests a day) |
| `HIVE_AUDIO_API_KEY` | Live AI-voice detection (optional; reuses `HIVE_API_KEY` if empty) | Hive dashboard → audio detection project |
| `OPENAI_TEXT_MODEL` | Live AI-text detection (uses `OPENAI_API_KEY`) | Any chat model on your OpenAI account; default `gpt-6.1-terra` (also `gpt-6-luna`, `gpt-6.1-sol`) |

3. Stop the dev server (**Ctrl+C**) and start it again with `npm run dev`. The terminal shows which features are on.

The LLM call is OpenAI-compatible: any provider that speaks the `/chat/completions` protocol works. Point `OPENAI_BASE_URL` at it and set `OPENAI_MODEL`. Defaults: `https://api.openai.com/v1` and `gpt-4o-mini`. AI-text detection uses the same key and endpoint with a smarter model: set `OPENAI_TEXT_MODEL` (default `gpt-6.1-terra`).

The app uses Hive's documented v2 task API by default (a per-project key, sent as `Authorization: token <key>`). If you have a self-serve V3 key instead, set `HIVE_API_VERSION=v3`. Without `HIVE_API_VERSION`, the version is read from `HIVE_API_URL`.

**Without a key, nothing breaks:** the detector box says "Not configured", and the AI parts fall back to a simple built-in version.

## 3. Share it so other people can try it

Pick one:

- **Same Wi-Fi (fastest at the event):** find your computer's local IP (Windows: `ipconfig`; Mac: System Settings → Wi-Fi → Details) and share `http://YOUR-IP:3000`. People on the same network can open it on their phones and install it as an app.
- **Temporary public link:** keep the server running and, in a second terminal, run `npx localtunnel --port 3000`. Share the link it prints. It stops when you close the terminal.
- **Permanent link:** deploy to a Next.js host such as Vercel (or any Node host with `npm run build && npm start`). Add the same keys under *Environment Variables* there instead of using a `.env.local` file.

The keys stay on the server (Next.js route handlers) and are never sent to the browser. But anyone with the link can use your API credit, so share public links only for as long as you need them.

## 4. Check that it works

The `test-posts` folder has three images:

| File | What it really is |
|---|---|
| `test-1-flood-AI.jpg` | Fully AI-generated (Google Gemini) |
| `test-2-cascade-REAL.jpg` | A real photo (Wikimedia Commons) |
| `test-3-opera-EDITED.jpg` | A real photo of the Yerevan Opera with fire added by AI |

1. Open the app → **Add a post** → **Image** → upload `test-1-flood-AI.jpg`.
2. Account: `Yerevan News NOW`. Caption: `Republic Square under water right now! Share before they delete it!`
3. Press **Analyze with the engine**. With `HIVE_API_KEY`, the detector box should show a high AI score (our test on 11 Nov 2026: 99.9%, likely source Gemini). With `OPENAI_API_KEY`, the engine lists clues and a likely trick.
4. Choose **Fake**, edit the explanation, press **Add to the game**.
5. Repeat with `test-2-cascade-REAL.jpg` (expect a low AI score; choose **Real**).
6. Text test: choose **Text** and paste
   `ՇՏԱՊ։ Վաղը բոլոր դպրոցները փակ են գազի արտահոսքի պատճառով։ Կիսվեք ծնողների հետ։`
   Watch what the AI-text judge says. It often misjudges Armenian, which is part of the lesson.
7. Press **Play the teacher's round** and play your own posts as a student would.

Posts added by the teacher are saved in that browser only (this is a prototype).

## 5. Where things are

| File | What it is |
|---|---|
| `public/index.html` | The whole app: game, teacher view, Add a post. The built-in posts are in the `ALL_ITEMS` list. |
| `public/shim.js` | Connects the app to the route handlers (LLM, detectors, browser voice) and registers the service worker. |
| `public/img/` | Images used by the built-in posts. |
| `public/img/pairs/` | The Detective round: web-sized copies of the 8 real-or-AI photo pairs (full-size sources in `media-src/ORIGINAL` and `media-src/GENERATED`, kept out of `public/` so they are not published). |
| `public/manifest.webmanifest` + `public/sw.js` + `public/icons/` | PWA manifest, offline cache, app icons. |
| `app/api/config/` | Reports which features have keys. |
| `app/api/llm/` | Calls the OpenAI-compatible endpoint with the key from the environment. |
| `app/api/detect/` | Calls Hive and the OpenAI text judge with the keys from the environment. |
| `lib/providers.ts` | Provider config and response parsing. |
| `.env.example` | Template for your keys. |
| `docs/` | Mentor brief (problem, components, plan, pitch) and `refs/`: forensic change tables for the photo pairs plus `MATCHES.md` (which table goes with which images). |

## 6. Honest notes

- **The detector never decides the answer.** In our tests it caught every AI image, but called AI-written Armenian text 100% human and couldn't catch a real photo with a false caption. The teacher sets the answer.
- The detector results shown on the built-in posts were recorded on 11 November 2026 with Hive's public demo, FineTuned LFM3 Omni and Google's SynthID check in Gemini.
- The **Harder round** posts (snow leopard, frozen-Sevan skating, sinkhole, airport) are AI images generated with ChatGPT; two of them fooled Hive's detector, which is the point of the round. The Sevan shore ice and Republic Square fountains are real Wikimedia Commons photos.
- The **Detective round** posts are built from the team's own camera photos (Panasonic DC-G90, 2025–2026) and AI variants generated from them. The untouched originals keep their camera EXIF; the AI files carry none. No automated detector ran on these pairs — the original photo is the evidence. Forensic change tables: `docs/refs/`.
- Image credits: AI images made with Google Gemini. Real photos from Wikimedia Commons by Marcin Konsek (CC BY-SA 4.0), Cetintas555 (CC BY-SA 4.0), Blake Patterson (CC BY 2.0) and Matthias Süßen (CC BY-SA 4.0; the edited Opera image is shared under the same license).
- API response formats can change. If a detector returns an error, check its docs and the `parseHive` or `callOpenAITextDetect` functions in `lib/providers.ts`.
