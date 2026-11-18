# NEON AI

A neon, ChatGPT-style web chat for Claude. Accounts with username + password, chats saved to your account
(continue them from any device), streaming replies, image / PDF / code-file uploads.

## Features
- Sign up (must answer a security question) / sign in (password 8+ characters), optional "stay signed in for 30 days"
- Chats stored in Postgres per account, so they follow you across devices
- Search, rename, delete, export chats; custom instructions synced to your account
- Flickering neon visuals, animated background, all icons are SVG

## Environment variables
| Name | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string (Render fills this in from `render.yaml`) |
| `ANTHROPIC_API_KEY` | yes | Your Anthropic key |
| `SIGNUP_ANSWER` | yes | Secret answer to the signup question. If unset, signups are closed |
| `DEFAULT_MODEL` | no | `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` |

## Run locally
```
npm install
export DATABASE_URL=postgres://user:pass@localhost:5432/neon
export ANTHROPIC_API_KEY=sk-ant-...
npm start
```
Open http://localhost:3000
