# Notes for working on NEON AI

## UI transitions
- Any change to the shape of a panel, card or menu must animate: ease the height/size with a soft spring
  (`cubic-bezier(.3, 1.25, .4, 1)`, about 0.6-0.7 s) and bring new elements in with a short staggered fade-up and blur
  (see `.collapse`, `popIn`, `.step.in-fwd` in `public/style.css` and `goStep` in `public/app.js`).
- Do not make things snap or appear instantly. Swap text with a quick blur fade.
- No "squish" (scaling the whole card). The owner removed it; keep only the smooth size morph.
- Retro mode is the default look (on for new accounts and fresh devices).
