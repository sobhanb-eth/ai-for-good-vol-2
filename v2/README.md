# FakeSpotter Arena

A real-or-fake game that trains students to spot AI fakes and misleading posts, with a teacher dashboard and an "Add a post" screen that runs real AI detectors.

- **Student game:** posts from a Yerevan feed (AI images, an AI-edited photo, AI-written Armenian text, an AI voice, real photos that look fake). Students choose Real or Fake, say how sure they are and why, and can use check tools.
- **Teacher view:** class profiles (too trusting, too suspicious, overconfident), tricks that fool the class, progress over the semester. The class data is a fictional demo.
- **Add a post:** a teacher uploads an image, text or audio. A real detector scores it (Hive for images and audio, GPTZero for text), Claude drafts an explanation, and the teacher decides Real or Fake before it joins the game.

---

## 1. Run it on your computer (5 minutes)

1. Install **Node.js 18 or newer** from https://nodejs.org (the "LTS" version).
2. Unzip this folder.
3. Open a terminal in the folder (the one with `server.js`):
   - **Windows:** open the folder, click the address bar, type `cmd`, press Enter.
   - **Mac:** right-click the folder in Finder → *New Terminal at Folder*.
4. Run:
   ```
   node server.js
   ```
5. Open **http://localhost:3000** in your browser.

The game works right away, with no keys. The keys switch on the live AI features.

## 2. Add your API keys

1. Copy `.env.example` and name the copy `.env` (same folder as `server.js`).
2. Paste your keys after the `=` signs:

| Setting | What it switches on | Where to get it |
|---|---|---|
| `OPENAI_API_KEY` **or** `ANTHROPIC_API_KEY` | The AI analysis on "Add a post" (reads images too) and the AI coach that grades students' reasoning. One of the two is enough. | https://platform.openai.com/api-keys or https://console.anthropic.com |
| `HIVE_API_KEY` | Live AI-image and AI-voice detection score, likely generator | https://thehive.ai → sign in → left sidebar **Service API Keys** → **Create API Key** (free tier, about 100 requests a day) |
| `GPTZERO_API_KEY` | Live AI-text detection | https://gptzero.me → API |

**Recommended minimum:** `OPENAI_API_KEY` + `HIVE_API_KEY`. GPT writes the analysis and coaches; Hive gives the real AI-image score. Text posts then get GPT's analysis only (GPT is not an AI-text detector), and the built-in posts still show the GPTZero results we recorded.

3. Stop the server (**Ctrl+C**) and start it again with `node server.js`. The terminal shows which features are on.

The app uses Hive's self-serve V3 API by default. If Hive sales gave you an older enterprise project key, set `HIVE_API_VERSION=v2`.

**Without a key, nothing breaks:** the detector box says "Not configured", and Claude's parts fall back to a simple built-in version.

## 3. Share it so other people can try it

Pick one:

- **Same Wi-Fi (fastest at the event):** find your computer's local IP (Windows: `ipconfig`; Mac: System Settings → Wi-Fi → Details) and share `http://YOUR-IP:3000`. People on the same network can open it on their phones.
- **Temporary public link:** keep the server running and, in a second terminal, run `npx localtunnel --port 3000`. Share the link it prints. It stops when you close the terminal.
- **Permanent link:** deploy the folder to a free Node host such as Render (render.com → New → Web Service → upload from GitHub → start command `node server.js`). Add the same keys under *Environment Variables* there instead of using a `.env` file.

The keys stay on the server and are never sent to the browser. But anyone with the link can use your API credit, so share public links only for as long as you need them.

## 4. Check that it works

The `test-posts` folder has three images:

| File | What it really is |
|---|---|
| `test-1-flood-AI.jpg` | Fully AI-generated (Google Gemini) |
| `test-2-cascade-REAL.jpg` | A real photo (Wikimedia Commons) |
| `test-3-opera-EDITED.jpg` | A real photo of the Yerevan Opera with fire added by AI |

1. Open the app → **Add a post** → **Image** → upload `test-1-flood-AI.jpg`.
2. Account: `Yerevan News NOW`. Caption: `Republic Square under water right now! Share before they delete it!`
3. Press **Analyze with the engine**. With `HIVE_API_KEY`, the detector box should show a high AI score (our test on 11 Nov 2026: 99.9%, likely source Gemini). With `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`), the AI analysis lists clues and a likely trick.
4. Choose **Fake**, edit the explanation, press **Add to the game**.
5. Repeat with `test-2-cascade-REAL.jpg` (expect a low AI score; choose **Real**).
6. Text test: choose **Text** and paste
   `ՇՏԱՊ։ Վաղը բոլոր դպրոցները փակ են գազի արտահոսքի պատճառով։ Կիսվեք ծնողների հետ։`
   Watch what GPTZero says. It often misjudges Armenian, which is part of the lesson.
7. Press **Play the teacher's round** and play your own posts as a student would.

Posts added by the teacher are saved in that browser only (this is a prototype).

## 5. Where things are

| File | What it is |
|---|---|
| `public/index.html` | The whole app: game, teacher view, Add a post. The built-in posts are in the `ALL_ITEMS` list. |
| `public/shim.js` | Connects the app to the server (GPT or Claude, detectors, browser voice). |
| `public/img/` | Images used by the built-in posts. |
| `server.js` | Serves the app and calls GPT or Claude, Hive and GPTZero with the keys from `.env`. |
| `.env.example` | Template for your keys. |
| `docs/` | Mentor brief (problem, components, plan, pitch). |

## 6. Honest notes

- **The detector never decides the answer.** In our tests it caught every AI image, but called AI-written Armenian text 100% human and couldn't catch a real photo with a false caption. The teacher sets the answer.
- The detector results shown on the built-in posts were recorded on 11 November 2026 with Hive's public demo, GPTZero and Google's SynthID check in Gemini.
- Image credits: AI images made with Google Gemini. Real photos from Wikimedia Commons by Marcin Konsek (CC BY-SA 4.0), Cetintas555 (CC BY-SA 4.0), Blake Patterson (CC BY 2.0) and Matthias Süßen (CC BY-SA 4.0; the edited Opera image is shared under the same license).
- API response formats can change. If a detector returns an error, check its docs and the `parseHive` or `callGPTZero` functions in `server.js`.
