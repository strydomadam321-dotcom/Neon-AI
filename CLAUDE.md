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
