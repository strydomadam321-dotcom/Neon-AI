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
- While nuked, visitors see a "NEON AI has been NUKED" page with a #Fairs button (shows `assets/fairs.gif` for half a second) and a
  bypass-code box. The bypass code lives ONLY in the Render environment variable `NUKE_BYPASS_CODE` (never put it in the repo).
  A correct code sets a 12-hour cookie that lets that browser use the site normally.
