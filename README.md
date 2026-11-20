# NEON AI

A neon, ChatGPT-style web chat for Claude. Accounts with username + password, chats saved to your account
(continue them from any device), streaming replies, image / PDF / code-file uploads.

## Features
- Graphics mode per device (Settings): CPU (default, light effects that work without a graphics card) or GPU (full glow/blur/3D). Saved on the device, not the account
- Attach images, PDFs, Word (.docx), PowerPoint (.pptx) and text/code files (Word and PowerPoint text is read in the browser)
- Effort control (Low / Medium / High / Max): sets how much the model thinks before answering, for both Claude and Gemini
- Claude and Gemini models in one menu
- Sign up (must answer a security question) / sign in (password 8+ characters), optional "stay signed in for 30 days"
- Chats stored in Postgres per account, so they follow you across devices
- Search, rename, delete, export chats; custom instructions synced to your account
- Flickering neon visuals, animated background, all icons are SVG

## Environment variables
| Name | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string (Render fills this in from `render.yaml`) |
| `ANTHROPIC_API_KEY` | yes | Your Anthropic key |
| `RESEND_API_KEY` | for email sign-up | Resend API key; sends the 6-digit verification codes. Without it, email sign-up is off |
| `MAIL_FROM` | for email sign-up | Sender, e.g. `NEON AI <noreply@yourdomain.com>` (the domain must be verified in Resend) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | for Google sign-in | OAuth client from Google Cloud. Redirect URI: `https://YOUR-DOMAIN/api/auth/google/callback` |
| `CONTACT_EMAIL` | recommended | Public address shown in the Terms and Privacy Policy for privacy requests. Unset: the text says to use the contact details on the site |
| `OWNER_USERNAMES` | no | Comma-separated usernames that always get the Max plan (full access, no limits) |
| `GEMINI_API_KEY` | no | Free Google AI Studio key. Enables the Gemini models in the model menu |
| `GEMINI_MODELS` | no | Override the Gemini model list: `id|Display name,id|Display name` (defaults: gemini-3.5-flash-lite, gemini-2.5-flash) |
| `TITLE_MODEL` | no | Gemini model that writes chat titles (default `gemini-3.5-flash`) |
| `DEFAULT_MODEL` | no | `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` |

## Run locally
```
npm install
export DATABASE_URL=postgres://user:pass@localhost:5432/neon
export ANTHROPIC_API_KEY=sk-ant-...
npm start
```
Open http://localhost:3000
