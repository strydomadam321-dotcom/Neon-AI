# Restoring NEON AI

The complete NEON AI app (accounts, cloud-synced chats, neon UI, model dropdown, secret signup question)
is saved in `archive/neon-ai-v2/`. It is also the exact state of git commit `d520c7b`.

## Bring it back
From the repo root, on the branch Render deploys:

```bash
git rm -r -q public server.js package.json package-lock.json README.md
cp -a archive/neon-ai-v2/. .
git add -A && git commit -m "Restore NEON AI" && git push
```

Render redeploys automatically. Nothing else needs changing:

- `DATABASE_URL`, `ANTHROPIC_API_KEY` and `SIGNUP_ANSWER` are still set on the Render service.
- Accounts and chats live in the Postgres database (`neon-ai-db`), which is untouched by the switch.
  NOTE: the free Render database expires on 2026-12-18. Upgrade it to keep that data.

## Alternative
`git checkout d520c7b -- .` restores the same files straight from history.

## Earlier flashcard landing page
The academic one-page site ("Study less often. Remember more.") is saved in `archive/academic-site-v1/public/`.
To bring it back: `rm -rf public && cp -a archive/academic-site-v1/public public`, then commit and push.
(`server.js` already serves whatever is in `public/`.)
