# NEON AI

Neon, ChatGPT-style web chat for Claude. Streaming replies, saved chats, image / PDF / code-file uploads.

## Run locally
```
npm install
set ANTHROPIC_API_KEY=sk-ant-...     (PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-...")
npm start
```
Open http://localhost:3000

## Deploy on Render
1. Push this folder to a GitHub repo.
2. Render → New → Web Service → pick the repo.
3. Build command `npm install`, start command `npm start`.
4. Environment variables:
   - `ANTHROPIC_API_KEY` – your key (required)
   - `APP_PASSWORD` – password to unlock the site (strongly recommended, otherwise anyone with the URL spends your credits)
   - `DEFAULT_MODEL` – optional (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`)

Chats are stored in each visitor's browser (IndexedDB), so they survive restarts and redeploys.
