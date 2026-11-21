# Notes for working on NEON AI

## UI transitions
- Any change to the shape of a panel, card or menu must animate: ease the height/size with a soft spring
  (`cubic-bezier(.3, 1.25, .4, 1)`, about 0.6-0.7 s) and bring new elements in with a short staggered fade-up and blur
  (see `.collapse`, `popIn`, `.step.in-fwd` in `public/style.css` and `goStep` in `public/app.js`).
- Do not make things snap or appear instantly. Swap text with a quick blur fade.
- No "squish" (scaling the whole card). The owner removed it; keep only the smooth size morph.
- Retro mode is the default look (on for new accounts and fresh devices).

## Kill switch ("Nuke") and dev account
- Dev accounts are the verified emails in `DEV_EMAILS` (default `strydomadam321@gmail.com`): full access, no limits, a Developer section in Settings.
- Nuke (dev only, typed confirmation) records a timestamp in `site_state`. Until it is cleared, every page and API call answers
  503 with an offline page, on every hostname (Render address and the custom domain).
- **To turn the site back on** (when the owner asks): set the service's `RESUME_AFTER` environment variable to the current time
  as an ISO string, e.g. with the Render `update_environment_variables` tool on service `srv-dbuogatckfvc73cqpl20`
  (workspace `tea-d92qrk8k1i2s73d1hu0g`). The redeploy restarts the app and it comes back. A later nuke turns it off again.
- New accounts must answer the plans pop-up (`plan_chosen`) before using the app. Paid plans are only recorded until payments exist.
- While nuked, visitors see a "NEON AI has been NUKED" page with a Fairs button (shows `assets/fairs.gif` for one second) and a
  bypass-code box. The bypass code lives ONLY in the Render environment variable `NUKE_BYPASS_CODE` (never put it in the repo).
  A correct code sets a 12-hour cookie that lets that browser use the site normally.

## Files the AI can make (PDF, Word, PowerPoint, Excel / Sheets)
- The AI writes ```neon-pdf / neon-docx / neon-pptx / neon-xlsx blocks (instructions: `FILE_RULES` in `server.js`, appended to every system prompt).
- `public/files.js` turns the text into the preview and builds the real file in the browser (pdfmake, docx, PptxGenJS, SheetJS, loaded from a CDN on first use).
- Code/HTML previews run in a sandboxed iframe without same-origin; `STORAGE_SHIM` in `public/app.js` gives them in-memory localStorage/cookies.

## Terms of Service and Privacy Policy
- The wording lives in `legal/terms.html` and `legal/privacy.html` (one source). It is served as pages at `/terms` and `/privacy` and as fragments for the in-app viewer (`/api/legal/:doc`).
- If the wording changes, bump `LEGAL_VERSION`/`LEGAL_UPDATED` in `server.js`. Keep the text true to what the app does (providers, retention, cookies).
- Creating an account needs the consent tick (`agree`); `users.terms_version` / `terms_at` record it. Signing in with Google never creates an account.
- `CONTACT_EMAIL` (environment) is shown in the documents for privacy requests; never put the owner's personal address in the repo.

## /chess (chess game against a bot)
- Typing `/chess` (optionally `/chess 1200 black`) adds an assistant message with `m.chess` state; `public/chessgame.js` renders it as a board card and saves moves, settings and chat in that state.
- Strength 100-2000 = `levelParams()` / `chooseMove()` in `public/chessbot.js` (search depth + candidate noise + random moves, tuned by playing the levels against each other so steps are about 150-300 apart). Re-tune by editing the DEPTH / TEMP / RANDOM tables and re-running matches.
- Engine: Stockfish.js 10 (GPLv3) in `public/engine/` (keep `COPYING.txt` and `NOTICE.txt`), run in a Web Worker. Rules: chess.js 0.10.3 from cdnjs.
- The opponent's chat lines come from `POST /api/chess/talk` (Gemini 3.5 Flash-Lite, counted in the user's Gemini tokens; silent when the Free limit is used up).
- Sounds: `public/chesssound.js` makes them with the Web Audio API (no audio files, nothing copied from chess.com). Move / capture / castle / check / start / win / lose / draw; the speaker button in the panel header mutes them (saved in localStorage `neon-chess-sound`).

## /larp (trading practice game)
- Typing `/larp` adds an assistant message with `m.larp` state; `public/larp.js` renders the card (canvas candlestick chart, replay controls, orders, XP/levels/achievements, debrief) and saves everything in that state.
- `public/larpengine.js` (UMD, testable in Node) is the simulation: seeded price generator (`trend/range/runner/breakdown/vshape`, same seed = same day), indicators, `Account` (market/limit/stop orders, no leverage, OCO exits), `score()` for mistakes, achievements, XP. Prices are synthetic and the money is fake; keep the "simulation, not financial advice" wording.
- The tutorial (`TUT` in larp.js) has gated tasks, quizzes and a Skip button; `ev` flags and `moved` drive the task checks. Add lessons there.
- `POST /api/larp/ai` (server.js, Gemini 3.5 Flash-Lite, counted in the user's Gemini tokens): `scenario` (ticker/company/headline/alert JSON), `coach` (debrief), `ask` (coach chat). The client falls back to local text when it is unavailable or limited.
- Sounds live in `public/chesssound.js` (fill / cash / loss / alert / level) and share the mute key.

## Daily usage ring
- Beside the name in the sidebar: a ring showing the most-used limited allowance (Free: Gemini tokens/day, Plus: Claude messages/day; Spark/Max have none, so a muted infinity). Click for a pop-up (Gemini + Claude rows, reset time); "See all" opens Settings, which shows the same rows (`renderUsage` in `public/app.js`).
- Dev accounts get a coloured infinity instead of the ring: each 20k Gemini tokens used today moves light green, dark green, light yellow, dark yellow, light red, dark red, then rainbow.
- Dropdowns inside cards reuse the `.dd` styles (see `niceSelect` in `public/larp.js`); do not use a bare native `<select>` in the UI.

## Update log (`changelog.json`)
- Every redeploy adds a NEW entry at the TOP of `changelog.json` (`version`, `date`, `title`, `tag`, `items[{icon,text}]`; `<b>`/`<i>` allowed in text). The server sends it in `/api/config`; the client shows the newest one once per version when the main page loads (seen version in localStorage `neon-seen-<username>`; the "Don't show again" tick stores `neon-nolog-<username>` and stops all future pop-ups; Settings > "What's new" reopens it).
- Pick the version by size of the change: big, headline features = next major (V3); a new feature or noticeable improvement = minor (2.1); small fixes/tweaks = patch (2.0.1). Keep items short and in plain language for users.

## Maths
- `md()` in `public/app.js` pulls `$...$`, `$$...$$`, `\(...\)` and `\[...\]` out of the text (never from code), lets marked/DOMPurify handle the rest, then puts KaTeX output back (KaTeX from cdnjs in `index.html`). `MATH_RULES` in `server.js` tells the models to write LaTeX. Chess piece CSS is scoped under `.ch-pieces` (a bare `.cp` rule once broke the code-block Copy button).

## Web search and live activity
- Every chat model can search the web: Gemini uses the `google_search` grounding tool (`geminiStream`), Claude the `web_search_20250305` server tool (`/api/chat`). If a provider rejects the tool the request is retried without it and search stays off for that model for 10 minutes (`noSearch`). `liveRules()` puts today's date and a "search before saying something isn't out" rule into every system prompt.
- The SSE stream carries `{act:{k:"search"|"query"|"read"}}` and `{src:[{t,u}]}` besides `{t}` text. `streamReply()` in `public/app.js` shows them as live steps (Thinking, Searching the web for "...", Reading N sources); a finished message stores `acts` and `sources` and shows a collapsible "Searched the web" summary plus source chips (`actsSummary`, `sourceChips`). Gemini only reports its searches at the end of the answer, Claude reports them live.
- Gemini fallback chain (`/api/chat`): a model that errors or answers with nothing is followed by 3.5 Flash-Lite, 2.5 Flash, 3.6 Flash (skipping the one already tried), announced with `{switched}`; if all fail the stream ends with `{down:"down"|"limit"}` and the client shows a pop-up. A model that returns nothing when it searches itself (Flash-Lite) is remembered for 30 min and gets its web results from `geminiResearch()` (a search-capable helper model writes notes, the chosen model answers from them). Tested with a fake DB + fake Gemini (`pg` stub), see the test idea in this commit's history.
