# Chalkline: an AI whiteboard tutor

Type a topic. Chalkline writes a short lesson, **talks you through it while drawing on a whiteboard in sync**, lets you **pause, rewind and jump** to any moment, and stops to **answer your questions about anything on the board**. It ends with a quick quiz, and if you get a question wrong, the tutor explains your specific mistake.

- **Live demo:** https://chalkline-tutor.ravi-khatri-studio.workers.dev
- **Source:** https://github.com/Ravi-Khatri/chalkline-ai-whiteboard-tutor
- **Stack:** React + TypeScript (Vite) · Cloudflare Workers · Workers AI (Llama 3.3 70B for text, MeloTTS for live voice; sample lessons pre-recorded with Deepgram Aura-2 "Athena") · rough.js for hand-drawn rendering
- **Cost to run:** ₹0. Everything runs on the Cloudflare Workers Free plan.

> Submission for the [Braynix Studios AI whiteboard tutor assignment](docs/assignment/ASSIGNMENT.md).

---

## 1. The learner and the problem

**Learner:** a self-directed student (late school, university, or early career) who meets an unfamiliar concept, such as binary search, compound interest or photosynthesis, and wants to *understand* it in a few minutes, not just read a definition.

**Problem:** text answers from chatbots explain *what* but rarely *show how*. Video explainers show how, but they are fixed: you can't ask the video a question, and you can't get one for an arbitrary topic on demand. The thing that works best, a teacher talking while drawing who stops when you look confused, isn't available on demand.

**What Chalkline offers:** a two-minute spoken lesson with a diagram that builds up exactly as each sentence is spoken, for any topic, plus the ability to interrupt. I deliberately kept the scope to one excellent loop (*learn → interrupt → resume → check*) rather than many shallow features.

## 2. How to review it (about 5 minutes)

1. Open the demo and click a **ready-made lesson** (for example *Binary Search Explained*). It starts instantly.
2. Press **Start lesson**. Watch each drawing appear as the matching sentence is spoken.
3. Press **Space** to pause, then drag the timeline **backwards**. The board rewinds exactly. Click any line in the **Transcript** to jump to it.
4. **Click something on the board** (a box or label). The lesson pauses and the *Ask tutor* tab opens with that item selected. Ask "why does this matter?" The answer is spoken aloud and the tutor highlights what it refers to. Then press **Resume lesson**.
5. Press **Draw** under the board and circle or underline anything with your mouse, finger or stylus. Then press **Ask about my drawing**: the tutor is told which board items you marked.
6. Finish (or jump to the end) and take the **Quiz**. Pick a wrong answer and click *Ask the tutor to explain my mistake*.
7. Back on the home page, type your own topic and choose **Teach me** to generate a live lesson. This takes about 30 to 70 seconds on the free tier. (If someone already generated that topic at that level, it loads instantly from the cache.)
8. Optional: choose **My device** under *Where should the AI run?* to have an open-source model write the lesson in your own browser (needs desktop Chrome or Edge with WebGPU; the first time downloads the model, ~0.9–1.7 GB). The same option is offered automatically if the cloud allowance is used up.

Keyboard: `Space` play/pause · `←`/`→` ±5 s · `R` restart · `/` ask a question.

## 3. What is live and what is not

| Capability | Status |
|---|---|
| Lesson writing (outline, steps, drawings, quiz) for a typed topic | **Live AI**: Workers AI, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, per request |
| Narration audio for live lessons | **Live AI**: Workers AI, `@cf/myshell-ai/melotts`, one clip per sentence (chosen for capacity; see [Free-tier capacity](#free-tier-capacity)) |
| Answers to follow-up questions, including "explain my mistake" | **Live AI**: same text model, with the lesson context; the answer is spoken with MeloTTS |
| The 3 "ready-made lessons" on the home page | **Pre-generated** by the same live pipeline (`npm run samples`) and shipped as static files (lesson JSON plus one MP3 per sentence, Aura-2 *Athena*). They were recorded once with the more natural, more expensive Aura-2 voice, because they cost nothing to replay. Labelled *Sample lesson* in the UI. They exist so reviewers can try the experience instantly and without spending the free AI quota. Questions about them are answered live. |
| Cached live lessons | A live lesson for a topic + level that was generated before (by anyone) is served from a KV cache, with its audio, at zero AI cost. Labelled *Live AI lesson · cached*. |
| Fallback voice | If AI narration can't be generated at all (for example the daily free quota is fully used up), the app switches to the **browser's built-in voice** with estimated timing, and says so in a banner. |
| On-device lessons | **Live AI on the learner's own computer**: an open-source model (Qwen2.5 3B or 1.5B) runs in the browser through WebLLM when the learner picks *My device*, or offered automatically when the cloud allowance is used up. No AI service is involved. Labelled *On-device AI lesson*. |
| Learner drawings | Entirely local to the learner's browser; only the *names of the board items* they marked are sent with a question. |

Nothing in the experience is mocked or scripted by hand.

## 4. How it works

```
 Browser (React)                                  Cloudflare Worker (/api/*)                  Workers AI
 ───────────────                                  ──────────────────────────                  ──────────
 topic ───────────── POST /api/lesson ──────────▶ 1. outline (JSON): plan, running ───────────▶ Llama 3.3 70B
                                                     example, 5 step goals, quiz
                                                  2. 5 steps written IN PARALLEL in a ───────▶ Llama 3.3 70B ×5
                                                     compact SAY/DRAW line format
                                                  3. parse + validate + repair
                    ◀──────────── Lesson JSON ─── (shared/validate.ts)
 for each sentence ── POST /api/tts ────────────▶ MeloTTS ────────────────────────────────────▶ MeloTTS
 decode, MEASURE length ◀──── MP3 ───────────────
 build timeline from real durations
 merge clips into ONE AudioBuffer
 board = boardAt(lesson, timeline, audioTime)  ◀── pure function, recomputed every frame
 question ────────── POST /api/ask ─────────────▶ context: step, what was heard, ──────────▶ Llama 3.3 70B
                                                  board items, selected item
```

### Key decisions

**1. The narration audio is the only clock.** Every whiteboard action belongs to a *beat* (one spoken sentence). Each beat's audio is generated separately, and its **measured** length (not an estimate) decides when the next beat and its drawings start. The clips are merged into one track with short pauses between sentences, and the track's playback position drives everything, so voice and drawing cannot drift apart.

**1b. A slow, teacher-like pace.** The speech models have no speed setting, so the player slows the narration itself: it plays at **0.9×** by default **with the pitch preserved** (it doesn't sound deeper), and the learner can choose 0.75×, 0.9×, 1× or 1.15×. Because the board follows the audio's *media time*, sync holds at every speed. **Voice trade-off:** Aura-2 (*Athena*, chosen by listening to previews) sounds much more natural but costs ~4,000 units per lesson, which would allow only ~2 new lessons a day on the free plan. MeloTTS sounds more robotic but costs ~40 units per lesson, so live lessons and answers use MeloTTS and the demo can serve ~13 new lessons a day. The sample lessons, which cost nothing to replay, keep the Aura-2 recordings.

**2. The board is a pure function of time.** `boardAt(lesson, timeline, t)` (`shared/timeline.ts`) replays all actions up to `t` and computes each stroke's drawing progress from `t` alone. With no stored drawing state, *pause, resume, seek backwards, seek forwards and restart are all the same operation*. Rewinding mid-sentence gives exactly the half-drawn arrow you saw the first time. This is covered by unit tests.

**3. Two-stage, parallel generation.** My first version asked the model for the whole lesson as one nested JSON object in schema-constrained JSON mode. Measured on the free tier, it took **~50 s** and produced lessons **less than half the requested length** (about 110 words, 8 beats), and three newer models failed the schema outright. The current design asks for a small JSON **outline** first (a plan plus one concrete *running example* so all steps teach the same example), then writes all five steps **in parallel** in a line format:

```
SAY: When light hits tiny air molecules, short blue waves bounce around far more than red ones.
DRAW: box id=air text="Air molecules" x=50 y=28 w=22 h=8 color=blue
DRAW: arrow from=sun to=air text="white light"
```

That format uses fewer tokens than JSON, and a malformed line loses one drawing instead of the whole lesson. Each call has a small, bounded job, which brought lessons to the intended length (about 17 to 19 beats, 250 to 300 words, 40 or more drawings).

**4. Repair, don't reject.** Models are good at teaching order and unreliable at geometry and bookkeeping. `shared/validate.ts` clamps coordinates, fills defaults, de-duplicates ids, namespaces ids per step, drops references to items that don't exist, **nudges new items away from existing ones** so labels don't overlap, and only rejects a lesson if there is nothing teachable.

**5. Free, with honest degradation.** The deployment uses only the Workers Free plan. On that plan, requests past the daily AI allowance *fail rather than bill*. The app turns that error into a clear message, keeps the sample lessons fully usable, falls back to the browser voice for narration, and offers to **write the lesson on the learner's own device instead** (see 5c).

**5c. An open-source, on-device fallback with no daily limit.** Any free cloud allowance runs out eventually. So the learner can also choose *My device*: the same prompts, line-format parser and validator (all in `shared/`) run in the browser against an open-source model (Qwen2.5 3B or 1.5B, 4-bit) loaded with [WebLLM](https://github.com/mlc-ai/web-llm) (Apache-2.0) on the computer's GPU through WebGPU, inside a Web Worker so the page stays responsive. There is no API key, no AI service and no daily cap; follow-up questions are answered on the device too, and a cloud lesson's questions fall back to the device model if the cloud allowance runs out. WebLLM's 6 MB of JavaScript is loaded only when this mode is used. Trade-offs, stated in the UI: a one-time model download (~0.9–1.7 GB, then cached by the browser), it needs WebGPU (recent desktop Chrome or Edge), steps are written one after another (1–3 minutes per lesson), and small models write simpler lessons than the 70B cloud model.

**5b. Demonstrations, not just diagrams.** Besides boxes, circles, labels, arrows, underlines and highlights, the tutor has three actions that make the board *change* as the explanation progresses:

| Action | What it shows | Example |
|---|---|---|
| `cross` | strikes an item out (it stays visible, dimmed) | eliminating the left half in binary search; ruling out a wrong option |
| `move` | slides an item to a new place, eased over ~1 s | swapping two elements in bubble sort; a molecule travelling |
| `graph` | draws axes, then traces a line through real data points | a balance growing with compound interest; a population curve |

Moves are deterministic like everything else: seeking to the middle of a move shows the item half-way, and arrows attached to a moved item follow it. The prompt asks the model to *demonstrate* (cross out, move, graph) rather than only label.

**6. Interaction designed around the board.** Board items are focusable buttons. Selecting one pauses the lesson and frames your question ("Asking about *Air molecules*"). The tutor gets the step, everything you've heard in it, and the list of board items, and can point at them in its answer. Learners can also **draw on the board** themselves (pen, undo, clear); their marks are kept across seeks, and *Ask about my drawing* tells the tutor which items they circled. The UI follows the *UI/UX Pro Max* "AI-native" design system (Inter, violet and cyan, captions plus transcript, click-to-play, visible focus, reduced-motion support, 44 px targets).

## 5. Project structure

```
shared/            Code used by both the Worker and the browser
  types.ts         Lesson / Beat / Action model
  validate.ts      Validation and repair of model output, layout nudging
  timeline.ts      Timeline from measured durations, boardAt(t)
  geometry.ts      Text layout and geometry helpers
  prompts.ts       Outline, step and ask prompts (used by cloud AND on-device generation)
  dsl.ts           SAY/DRAW line-format parser
  assemble.ts      JSON extraction, outline checks, joining steps into one lesson
worker/            Cloudflare Worker (API)
  index.ts         /api/lesson, /api/tts, /api/ask, /api/health
  usage.ts         Topic/audio cache, daily budget guard, fair-use limit (KV)
src/               React app
  lib/clock.ts     AudioClock (Web Audio) and SpeechClock (browser voice fallback)
  lib/narration.ts Fetch, measure and merge narration clips
  lib/deviceAI.ts  On-device mode: WebLLM engine, lesson writing and answers in the browser
  lib/llm.worker.ts Runs the on-device model in a Web Worker
  components/      Whiteboard (rough.js SVG), PenLayer, PlayerBar, Transcript, AskPanel, QuizPanel, …
public/samples/    Pre-generated sample lessons (JSON + one MP3 per sentence)
scripts/           make-samples.mjs (regenerate samples), smoke.mjs (browser smoke test),
                   smoke-device.mjs (on-device end-to-end test), bench-models.mjs (compare cloud models)
tests/             Unit tests (timeline determinism, demonstrations, validation, parser, budget/cache)
```

## 6. Run it locally

Requirements: Node 20+ and a free Cloudflare account. Workers AI runs remotely even in local development, so you need to log in once.

```bash
npm install
npx wrangler login          # free Cloudflare account; no paid plan needed
npm run dev                 # API on :8790 (wrangler) + app on :5173 (vite)
```

Open http://localhost:5173.

Other scripts:

```bash
npm test                    # unit tests (vitest)
npm run typecheck
node scripts/smoke.mjs http://localhost:5173   # browser smoke test (uses installed Edge; BROWSER=chrome for Chrome)
npm run samples             # regenerate sample lessons (needs the API running)
npm run deploy              # build + deploy to your workers.dev subdomain
```

### Configuration

There are no API keys or secrets. Workers AI is accessed through a binding in `wrangler.jsonc`. Non-secret settings are vars:

| Name | Example | Purpose |
|---|---|---|
| `LESSON_MODEL` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Text model for lessons and answers |
| `TTS_MODEL` | `@cf/myshell-ai/melotts` | Speech model for live narration and answers. Set `@cf/deepgram/aura-2-en` for a far more natural voice (about 6x fewer new lessons per day; the budget guard below then applies). |
| `TTS_VOICE` | `athena` | Aura-2 voice when Aura-2 is used (e.g. `athena`, `asteria`, `orion`) |
| `PREMIUM_BUDGET` | `6500` | Only with Aura-2: estimated units per day it may use before new narration switches to MeloTTS |
| `FAIR_USE_LESSONS` | `3` | New (uncached) lessons each visitor may create per day |
| `CACHE` (KV binding) | see `wrangler.jsonc` | Free KV namespace for the cache and budget counter. Create with `npx wrangler kv namespace create CACHE` and paste the id. Optional: without it, caching and budgeting are simply off. |
| `ALLOW_MODEL_OVERRIDE` | `1` (local `.dev.vars` only) | Lets the request body choose a model, for local benchmarking. Never set in production. |

## 7. Known limitations

- **Generation time.** A live lesson takes about 30 to 70 seconds to write on the free tier, plus a few seconds of narration. The UI shows staged progress and the lesson plan while you wait. With a paid tier, streaming the first step and starting playback early would cut this to under 10 seconds.
- **Daily quota.** About 13 new live lessons a day (fewer if many questions are asked); after that, new lessons stop until the daily reset. See [Free-tier capacity](#free-tier-capacity) below. Cached and sample lessons are unlimited.
- **Board layout is AI-placed.** The validator prevents most overlaps, but some lessons have sparse or crowded layouts, and board text is small on phones.
- **Live voice quality.** MeloTTS sounds more robotic than Aura-2; it's a deliberate trade for ~6x more lessons per day on the free plan.
- **On-device mode.** Needs WebGPU (desktop Chrome/Edge on a reasonably modern GPU), downloads the model once (~0.9–1.7 GB), writes steps sequentially (about 2 minutes for a 5-part lesson with Qwen2.5 1.5B on an RTX 3050 laptop GPU), and small open models produce simpler lessons with fewer drawings than the cloud model. On laptops with two GPUs, browsers default to the weak integrated one, which runs out of memory; set the browser to *High performance* in Windows' graphics settings (the app explains this if it happens). Model files are fetched from Hugging Face by WebLLM.
- **Fallback voice timing.** In browser-voice mode, seeking snaps to the start of a sentence, because the browser voice can't start mid-sentence.
- **Accuracy.** Lessons and answers come from a language model and can contain mistakes. The prompt asks the tutor to say when it's unsure, and the UI says lessons can contain mistakes.
- **English only**, and lessons are not saved between visits.

### Free-tier capacity

The demo runs on the **Cloudflare Workers Free plan**, which includes **10,000 Workers AI units ("neurons") per day**, resetting at 00:00 UTC (05:30 IST). On the Free plan, usage past the allowance is **never billed**: requests simply fail until the reset, and the app shows a clear message.

These are estimates calculated from Cloudflare's published per-model prices and the size of our lessons; the Cloudflare dashboard (Workers AI → usage) shows the measured numbers.

| Action | MeloTTS (default) | Aura-2 (optional) |
|---|---|---|
| Write one lesson (Llama 3.3 70B: 1 outline + 5 parallel step calls) | ~700 | ~700 |
| Narrate one lesson (~1,200–1,600 characters) | ~40 | ~3,300–4,400 |
| **One new live lesson in total** | **~750** | **~4,000–5,000** |
| One spoken tutor answer | **~60** | **~1,000** |
| Play, replay or seek a sample or cached lesson; take the quiz | **0** | **0** |

So with the default MeloTTS voice the free plan allows roughly **13 new live lessons per day** (or, for example, 10 lessons and 40 questions), plus unlimited sample lessons, cached lessons and replays. With Aura-2 it would be only ~2 new lessons per day; nearly all of the cost is the voice, because Aura-2 is billed per character and MeloTTS per audio minute at a tiny fraction of the price.

**How the public demo stays usable all day** (`worker/usage.ts`, using a free KV namespace):

1. **Topic cache.** A lesson for the same topic and level is generated once and then served to everyone, with its audio, at **0 units**. The suggested topics on the home page are therefore almost always free.
2. **Audio cache.** Every narration clip is cached by voice and text, so replays and repeat answers cost nothing.
3. **Fair use.** Each visitor can create `FAIR_USE_LESSONS` (3) new, uncached lessons per day, so one person can't use up everyone's allowance. Visitors are identified only by a salted, daily-rotating hash of their IP address; the IP itself is never stored.
4. **Budget guard (when Aura-2 is enabled).** The Worker keeps an estimate of the day's spend. Up to `PREMIUM_BUDGET` (6,500 units) new narration uses Aura-2; after that it automatically switches to MeloTTS so the demo keeps working instead of failing. With the default MeloTTS setting this guard is not needed.

Because KV is eventually consistent, the spend counter is a soft estimate, not an exact meter.

**Reaching 50+ new lessons a day.** Almost all of the remaining cost is the lesson-writing model (Llama 3.3 70B, ~700 units per lesson). Cheaper Workers AI models (Gemma 4 26B, Qwen3 30B, Llama 3.1 8B) cost ~110–130 units per lesson by Cloudflare's price list, which would allow ~55–65 lessons a day. Switching is one line (`LESSON_MODEL` in `wrangler.jsonc`), and `scripts/bench-models.mjs` measures real cost and lesson quality per model. I kept Llama 3.3 70B for the submission because it is the model whose lessons I could verify; the benchmark could not be run before the deadline because the daily allowance was already spent. When the cloud allowance does run out, learners can still use sample lessons, cached lessons, or **on-device mode** (5c), which has no daily limit.

### Security and privacy

- **No secrets anywhere.** Workers AI is reached through a Cloudflare binding, so there is no API key to leak. The full git history was scanned for keys and credentials (none found), and GitHub secret scanning and push protection are on.
- **Model output is never executed or injected as HTML.** Lessons are parsed into a fixed set of drawing actions, validated and clamped (`shared/validate.ts`), and rendered as text and SVG through React, so a prompt-injected topic cannot run script on the page.
- **Input limits.** Request bodies are size-capped (oversized requests get 413), topics are limited to 120 characters and questions to 500, and narration text is cleaned before speech synthesis.
- **Abuse limits.** Per-visitor daily limits on new lessons (3) and questions (40), plus caching, stop one person from spending the shared free AI allowance. The API sends no CORS headers, so other websites cannot call it from a visitor's browser.
- **Security headers** (`public/_headers`): `frame-ancestors 'none'` and `X-Frame-Options: DENY` (no clickjacking), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, a Permissions-Policy denying camera, microphone and location, and HSTS.
- **Privacy.** No accounts and no personal data. Fair-use counters store only a salted, daily hash of the IP address; questions and learner drawings are not stored. On-device mode sends nothing to an AI service.
- **Dependencies.** `npm audit --omit=dev` reports 0 vulnerabilities in shipped code. `npm audit` reports a ReDoS advisory in `picomatch` (GHSA-fc5q-39xc-vjpf), which is used only by the build and test tools (Vite, Vitest) for file-path matching; it is not shipped, cannot be reached with external input, and has no patched release yet.
- **Known gaps.** The text-to-speech endpoint has no per-visitor limit (MeloTTS is cheap, so abuse can use but not easily exhaust the allowance); the daily IP-hash salt is not secret; KV counters are eventually consistent, so limits are approximate; there is no full Content-Security-Policy for scripts yet, because on-device mode loads model code from Hugging Face and GitHub.

## 8. What I'd do next

1. **Stream the lesson.** Play step 1 as soon as it is ready while the rest are written.
2. **Share and rate lessons.** Cached lessons already exist per topic; letting learners rate them would let poor generations be regenerated and good ones promoted.
3. **Word-level emphasis.** Use speech marks so highlights land on the exact word, not just the sentence.
4. **Adaptive teaching.** Use quiz mistakes and questions to generate a short follow-up "fix-it" segment.
5. **A layout engine.** Let the model describe structure (a list, a flow, a comparison) and compute positions deterministically.

## 9. Use of AI coding tools

I used AI coding assistants (Claude Code, and earlier exploration with ChatGPT/Codex) for research, scaffolding and code generation, and the UI/UX Pro Max skill for the design system. Product direction, architecture choices, the model benchmarks behind the two-stage design, and verification (unit tests, browser smoke tests, manual review of generated lessons) were done and checked as part of the work, and I can walk through any part of the code.
