import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- config ----------
const CLAUDE_MODELS = [
  { id: "claude-opus-5-5", name: "Opus 5.5 · smartest", provider: "claude" },
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5 · fast", provider: "claude" },
  { id: "claude-haiku-5-5", name: "Haiku 5.5 · fastest", provider: "claude" },
];
// Gemini models (free API key). Override with GEMINI_MODELS="id|Display name,id|Display name"
const GEMINI_DEFAULTS = [
  { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite · fastest", provider: "gemini" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash · balanced", provider: "gemini" },
];
const GEMINI_MODELS = process.env.GEMINI_MODELS
  ? process.env.GEMINI_MODELS.split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
      const [id, name] = x.split("|").map((y) => y.trim());
      return { id, name: name || id, provider: "gemini" };
    }).filter((m) => /^[\w.\-]{3,60}$/.test(m.id))
  : GEMINI_DEFAULTS;
const MODELS = [...CLAUDE_MODELS, ...GEMINI_MODELS];
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_BASE = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
// Model used for chat titles (tried first). Override with TITLE_MODEL.
const TITLE_MODEL = process.env.TITLE_MODEL || "gemini-3.5-flash";
const DEFAULT_EFFORT = 1; // 0 Low, 1 Medium, 2 High, 3 Max
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || MODELS[0].id;
// Signup gate: people must answer this question to create an account (keeps strangers from spending your credits).
// The answer lives only in the SIGNUP_ANSWER environment variable (never in the code). If it is unset, signups are closed.
const SIGNUP_ANSWER = (process.env.SIGNUP_ANSWER || "").trim().toLowerCase();
if (!SIGNUP_ANSWER) console.warn("SIGNUP_ANSWER is not set: new signups are disabled.");
const SYSTEM =
  "You are a helpful, sharp AI assistant inside a futuristic neon chat app. " +
  "Answer clearly and concisely. Use Markdown, and fenced code blocks with language tags for code.";

const DAY = 24 * 60 * 60 * 1000;
const REMEMBER_MS = 30 * DAY; // "stay logged in" lasts 30 days
const SHORT_MS = 12 * 60 * 60 * 1000; // otherwise: until the browser closes (max 12 h)
const COOKIE = "neon_sid";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add a Postgres database and set DATABASE_URL.");
  process.exit(1);
}
const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: 8,
  // Render's *external* URLs need TLS; internal ones (no ".render.com") and localhost do not.
  ssl: /\.render\.com/.test(DATABASE_URL) ? { rejectUnauthorized: false } : false,
});
const q = (text, params) => pool.query(text, params);

await q(`
create table if not exists users(
  id serial primary key,
  username text not null,
  username_lc text not null unique,
  pass_hash text not null,
  settings jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table if not exists sessions(
  token_hash text primary key,
  user_id int not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user on sessions(user_id);
create table if not exists chats(
  user_id int not null references users(id) on delete cascade,
  id text not null,
  title text not null,
  model text,
  messages jsonb not null,
  search_text text not null default '',
  created_at bigint not null,
  updated_at bigint not null,
  primary key(user_id, id)
);
create index if not exists chats_user_updated on chats(user_id, updated_at desc);
`);
const cleanup = () => q("delete from sessions where expires_at < now()").catch(() => {});
cleanup();
setInterval(cleanup, 60 * 60 * 1000).unref();

const client = new Anthropic(); // reads ANTHROPIC_API_KEY
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
  });
  next();
});
app.use(express.static(path.join(__dirname, "public"), { setHeaders: (res) => res.set("Cache-Control", "no-cache") }));

// ---------- helpers ----------
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const getCookie = (req, name) => {
  const m = (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(name + "="));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : "";
};
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => {
  console.error(e);
  if (!res.headersSent) res.status(500).json({ error: "Something went wrong on the server." });
});

// tiny in-memory rate limiter
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return true; }
  arr.push(now); hits.set(key, arr);
  return false;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 3600e3)) hits.delete(k); }, 10 * 60e3).unref();

async function startSession(req, res, userId, remember) {
  const token = crypto.randomBytes(32).toString("base64url");
  const ms = remember ? REMEMBER_MS : SHORT_MS;
  await q("insert into sessions(token_hash,user_id,expires_at) values($1,$2,$3)", [sha(token), userId, new Date(Date.now() + ms)]);
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: req.secure, path: "/",
    ...(remember ? { maxAge: ms } : {}), // no maxAge = session cookie
  });
}

const requireAuth = wrap(async (req, res, next) => {
  const token = getCookie(req, COOKIE);
  if (!token) return res.status(401).json({ error: "Not signed in" });
  const { rows } = await q(
    `select u.id, u.username, u.settings from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now()`, [sha(token)]);
  if (!rows[0]) { res.clearCookie(COOKIE, { path: "/" }); return res.status(401).json({ error: "Session expired" }); }
  req.user = rows[0]; req.token = token;
  next();
});

// block cross-site writes (belt and braces on top of SameSite=Lax)
app.use("/api", (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    const o = req.get("origin");
    if (o) { try { if (new URL(o).host !== req.get("host")) return res.status(403).json({ error: "Bad origin" }); } catch { return res.status(403).json({ error: "Bad origin" }); } }
  }
  next();
});

const small = express.json({ limit: "20kb" });
const big = express.json({ limit: "45mb" });

// ---------- auth ----------
app.get("/api/config", (req, res) => {
  res.json({ models: MODELS, defaultModel: DEFAULT_MODEL, needsInvite: true, hasKey: !!process.env.ANTHROPIC_API_KEY, hasGemini: !!GEMINI_KEY, defaultEffort: DEFAULT_EFFORT });
});

const USER_RE = /^[A-Za-z0-9_.-]{3,24}$/;
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

app.post("/api/signup", small, wrap(async (req, res) => {
  if (limited("signup:" + req.ip, 8, 60 * 60e3)) return res.status(429).json({ error: "Too many attempts. Try again later." });
  const { username, password, remember, answer } = req.body || {};
  if (typeof username !== "string" || !USER_RE.test(username))
    return res.status(400).json({ error: "Username must be 3-24 characters: letters, numbers, . _ -", field: "username" });
  if (typeof password !== "string" || password.length < 8)
    return res.status(400).json({ error: "Password must be at least 8 characters.", field: "password" });
  if (Buffer.byteLength(password) > 72)
    return res.status(400).json({ error: "Password is too long (72 bytes max).", field: "password" });
  {
    if (!SIGNUP_ANSWER) return res.status(503).json({ error: "Signups are currently closed." });
    const a = Buffer.from(String(answer || "").trim().toLowerCase()), b = Buffer.from(SIGNUP_ANSWER);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
      return res.status(403).json({ error: "That's not the right answer.", field: "answer" });
  }
  const hash = await bcrypt.hash(password, 11);
  let user;
  try {
    ({ rows: [user] } = await q("insert into users(username,username_lc,pass_hash) values($1,$2,$3) returning id,username,settings",
      [username, username.toLowerCase(), hash]));
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "That username is taken.", field: "username" });
    throw e;
  }
  await startSession(req, res, user.id, !!remember);
  res.json({ user: { username: user.username }, settings: user.settings });
}));

app.post("/api/login", small, wrap(async (req, res) => {
  const { username, password, remember } = req.body || {};
  if (typeof username !== "string" || typeof password !== "string") return res.status(400).json({ error: "Enter your username and password." });
  const key = "login:" + req.ip + ":" + username.toLowerCase();
  if (limited(key, 8, 15 * 60e3)) return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
  const { rows } = await q("select id,username,pass_hash,settings from users where username_lc = $1", [username.toLowerCase()]);
  const user = rows[0];
  const ok = await bcrypt.compare(password.slice(0, 200), user ? user.pass_hash : DUMMY_HASH);
  if (!user || !ok) return res.status(401).json({ error: "Wrong username or password." });
  hits.delete(key);
  await startSession(req, res, user.id, !!remember);
  res.json({ user: { username: user.username }, settings: user.settings });
}));

app.post("/api/logout", wrap(async (req, res) => {
  const token = getCookie(req, COOKIE);
  if (token) await q("delete from sessions where token_hash = $1", [sha(token)]);
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
}));

app.get("/api/me", requireAuth, (req, res) => res.json({ user: { username: req.user.username }, settings: req.user.settings }));

app.put("/api/settings", requireAuth, small, wrap(async (req, res) => {
  const cur = req.user.settings || {};
  const { system, model, effort, retro, bg, flicker } = req.body || {};
  const bool = (v, d) => (typeof v === "boolean" ? v : typeof cur[d.key] === "boolean" ? cur[d.key] : d.def);
  const s = {
    system: typeof system === "string" ? system.slice(0, 4000) : cur.system || "",
    model: model === undefined ? cur.model || "" : MODELS.some((m) => m.id === model) ? model : "",
    effort: [0, 1, 2, 3].includes(effort) ? effort : [0, 1, 2, 3].includes(cur.effort) ? cur.effort : DEFAULT_EFFORT,
    retro: bool(retro, { key: "retro", def: false }),
    bg: bool(bg, { key: "bg", def: true }),
    flicker: bool(flicker, { key: "flicker", def: true }),
  };
  await q("update users set settings = $1 where id = $2", [s, req.user.id]);
  res.json({ settings: s });
}));

// permanently delete the signed-in account (chats and sessions go with it via ON DELETE CASCADE)
app.post("/api/account/delete", requireAuth, small, wrap(async (req, res) => {
  if (limited("delacct:" + req.user.id, 5, 15 * 60e3)) return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
  const password = req.body?.password;
  if (typeof password !== "string" || !password) return res.status(400).json({ error: "Enter your password to confirm." });
  const { rows } = await q("select pass_hash from users where id = $1", [req.user.id]);
  if (!rows[0] || !(await bcrypt.compare(password.slice(0, 200), rows[0].pass_hash))) return res.status(403).json({ error: "Wrong password. Your account was not deleted." });
  await q("delete from users where id = $1", [req.user.id]);
  res.clearCookie(COOKIE, { path: "/" });
  console.log("account deleted:", req.user.username);
  res.json({ ok: true });
}));

// ---------- chats (stored per account so they follow you across devices) ----------
const ID_RE = /^[a-z0-9]{6,40}$/;
const searchText = (messages) => messages.map((m) => (typeof m?.text === "string" ? m.text : "")).join(" \n ").slice(0, 60000).toLowerCase();
const esc = (s) => s.replace(/[\\%_]/g, (c) => "\\" + c);

app.get("/api/chats", requireAuth, wrap(async (req, res) => {
  const term = String(req.query.q || "").trim().toLowerCase().slice(0, 100);
  const params = [req.user.id];
  let where = "";
  if (term) { params.push("%" + esc(term) + "%"); where = "and (lower(title) like $2 or search_text like $2)"; }
  const { rows } = await q(
    `select id,title,model,created_at as created,updated_at as updated from chats where user_id = $1 ${where} order by updated_at desc limit 500`, params);
  res.json({ chats: rows.map((r) => ({ ...r, created: Number(r.created), updated: Number(r.updated) })) });
}));

app.get("/api/chats/:id", requireAuth, wrap(async (req, res) => {
  const { rows } = await q("select id,title,model,messages,created_at as created,updated_at as updated from chats where user_id=$1 and id=$2", [req.user.id, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Chat not found" });
  const r = rows[0];
  res.json({ chat: { ...r, created: Number(r.created), updated: Number(r.updated) } });
}));

app.put("/api/chats/:id", requireAuth, big, wrap(async (req, res) => {
  const { title, model, messages, created } = req.body || {};
  if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: "Bad chat id" });
  if (!Array.isArray(messages) || messages.length > 2000) return res.status(400).json({ error: "Bad messages" });
  const updated = Date.now();
  await q(
    `insert into chats(user_id,id,title,model,messages,search_text,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (user_id,id) do update set title=excluded.title, model=excluded.model, messages=excluded.messages,
       search_text=excluded.search_text, updated_at=excluded.updated_at`,
    [req.user.id, req.params.id, String(title || "New chat").slice(0, 120), String(model || "").slice(0, 60),
      JSON.stringify(messages), searchText(messages), Number(created) || updated, updated]);
  res.json({ updated });
}));

app.patch("/api/chats/:id", requireAuth, small, wrap(async (req, res) => {
  const title = String(req.body?.title || "").trim().slice(0, 120);
  if (!title) return res.status(400).json({ error: "Title required" });
  await q("update chats set title=$1 where user_id=$2 and id=$3", [title, req.user.id, req.params.id]);
  res.json({ ok: true });
}));

// ---------- automatic chat titles ----------
// Same rule the browser uses for the temporary title (first message, shortened).
const fallbackTitle = (text) => String(text || "").replace(/\s+/g, " ").trim().slice(0, 48);
const TITLE_PROMPT =
  "Write a short title that summarises this conversation in 2 to 5 words. " +
  "Use the same language as the user. Reply with ONLY the title: no quotes, no trailing punctuation, no emoji.";

function cleanTitle(raw) {
  let t = String(raw || "").split("\n")[0].replace(/^["'`*#\s]+|["'`*.\s]+$/g, "").replace(/\s+/g, " ");
  t = t.replace(/^title\s*:\s*/i, "");
  return t.length > 60 ? t.slice(0, 60).replace(/\s+\S*$/, "") : t;
}

async function titleViaGemini(m, convo) {
  if (!GEMINI_KEY || !m) return "";
  // thinking tokens count against maxOutputTokens, so leave plenty of room
  const gc = { maxOutputTokens: 256, temperature: 0.4 };
  const th = geminiThinking(m.id, 0);
  const call = async (withTh) => {
    const r = await fetch(`${GEMINI_BASE}/v1beta/models/${encodeURIComponent(m.id)}:generateContent`, {
      method: "POST", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: TITLE_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: convo }] }],
        generationConfig: withTh && th ? { ...gc, thinkingConfig: th } : gc,
      }),
    });
    if (!r.ok) {
      let msg = ""; try { msg = (await r.json())?.error?.message || ""; } catch {}
      const e = new Error(`${r.status} ${msg}`.slice(0, 200)); e.status = r.status; throw e;
    }
    const j = await r.json();
    return (j.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
  };
  try { return await call(true); }
  catch (e) { if (e.status === 400) return await call(false); throw e; }
}

async function titleViaClaude(m, convo) {
  if (!process.env.ANTHROPIC_API_KEY) return "";
  const r = await client.messages.create({
    model: m.id, max_tokens: 60, system: TITLE_PROMPT,
    messages: [{ role: "user", content: convo }],
  }, { timeout: 20000 });
  return r.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

// Last resort when no model can be reached: a few key words from the first message.
const FILLER = new Set("a an the and or but so to of in on for with at by from is are was were be am can could would should will do does did please pls plz hey hi hello yo i me my you your we our it its this that these those just some any im ive thanks thank u ur".split(" "));
function keywordTitle(text) {
  const words = String(text || "").replace(/[^\p{L}\p{N}'\s-]/gu, " ").split(/\s+/).filter(Boolean);
  const keep = words.filter((w) => !FILLER.has(w.toLowerCase()));
  if (!keep.length) return "";
  return keep.slice(0, 5).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

// Try every available model (cheap/fast first), then fall back to keywords. Never throws.
async function makeTitle(userText, assistantText) {
  const convo = `User: ${userText.slice(0, 600)}\n\nAssistant: ${String(assistantText).slice(0, 600)}`;
  const gem = [{ id: TITLE_MODEL, provider: "gemini" }, ...GEMINI_MODELS.filter((m) => m.id !== TITLE_MODEL)];
  const claude = [...CLAUDE_MODELS].sort((x, y) => (/haiku/i.test(y.id) ? 1 : 0) - (/haiku/i.test(x.id) ? 1 : 0));
  const attempts = [...gem.map((m) => [m, titleViaGemini]), ...claude.slice(0, 2).map((m) => [m, titleViaClaude])];
  const why = [];
  for (const [m, fn] of attempts) {
    try {
      const t = cleanTitle(await fn(m, convo));
      if (t) { console.log(`title: "${t}" via ${m.id}`); return { title: t, via: m.id }; }
      if ((fn === titleViaGemini && GEMINI_KEY) || (fn === titleViaClaude && process.env.ANTHROPIC_API_KEY)) why.push(`${m.id}: empty reply`);
    } catch (e) { why.push(`${m.id}: ${e.message}`); }
  }
  console.warn("title: all models failed ->", why.join(" | "));
  const k = cleanTitle(keywordTitle(userText));
  return { title: k || "", via: "keywords", why };
}

// A chat counts as "untitled" while its title is still just the first message.
const firstUserText = (u) => (u?.text?.trim() || u?.attachments?.[0]?.name || "");

app.post("/api/chats/:id/title", requireAuth, wrap(async (req, res) => {
  if (limited("title:" + req.user.id, 40, 60e3)) return res.json({ title: null });
  const { rows } = await q("select title,messages from chats where user_id=$1 and id=$2", [req.user.id, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Chat not found" });
  const msgs = rows[0].messages || [];
  const u = msgs.find((m) => m.role === "user"), a = msgs.find((m) => m.role === "assistant" && m.text);
  if (!u || !a) return res.json({ title: null });
  // never overwrite a title the user set themselves
  if (rows[0].title !== fallbackTitle(firstUserText(u) || "New chat")) return res.json({ title: null });
  const r = await makeTitle(firstUserText(u), a.text);
  if (!r.title || r.title === rows[0].title) return res.json({ title: null, via: r.via });
  await q("update chats set title=$1 where user_id=$2 and id=$3 and title=$4", [r.title, req.user.id, req.params.id, rows[0].title]);
  res.json({ title: r.title, via: r.via });
}));

// Give titles to older chats that still just show the first message (a few per call).
app.post("/api/chats-retitle", requireAuth, wrap(async (req, res) => {
  if (limited("retitle:" + req.user.id, 6, 10 * 60e3)) return res.json({ updated: [] });
  const { rows } = await q(
    `select id, title, messages->0->>'role' as r0, messages->0->>'text' as t0, messages->0->'attachments'->0->>'name' as n0,
            messages->1->>'role' as r1, messages->1->>'text' as t1
       from chats where user_id=$1 order by updated_at desc limit 60`, [req.user.id]);
  const todo = rows.filter((c) => c.r0 === "user" && c.r1 === "assistant" && c.t1 && c.title === fallbackTitle((c.t0 || "").trim() || c.n0 || "New chat")).slice(0, 5);
  const updated = [];
  for (const c of todo) {
    const r = await makeTitle((c.t0 || "").trim() || c.n0 || "", c.t1);
    if (!r.title || r.title === c.title) continue;
    const u = await q("update chats set title=$1 where user_id=$2 and id=$3 and title=$4", [r.title, req.user.id, c.id, c.title]);
    if (u.rowCount) updated.push({ id: c.id, title: r.title });
  }
  res.json({ updated });
}));

app.delete("/api/chats/:id", requireAuth, wrap(async (req, res) => {
  await q("delete from chats where user_id=$1 and id=$2", [req.user.id, req.params.id]);
  res.json({ ok: true });
}));
app.delete("/api/chats", requireAuth, wrap(async (req, res) => {
  await q("delete from chats where user_id=$1", [req.user.id]);
  res.json({ ok: true });
}));

// ---------- AI streaming ----------
const IMG_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

function toContent(msg) {
  if (msg.role === "assistant") return msg.text;
  const blocks = [];
  for (const a of msg.attachments || []) {
    if (a.kind === "image" && IMG_TYPES.includes(a.mediaType)) {
      blocks.push({ type: "image", source: { type: "base64", media_type: a.mediaType, data: a.data } });
    } else if (a.kind === "pdf") {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data } });
    } else if (a.kind === "text") {
      blocks.push({ type: "text", text: `<file name="${String(a.name).replace(/"/g, "")}">\n${String(a.content).slice(0, 600000)}\n</file>` });
    }
  }
  blocks.push({ type: "text", text: msg.text?.trim() ? msg.text : "(see attached files)" });
  return blocks;
}

function friendlyError(err) {
  const m = String(err?.message || "");
  if (err?.provider === "gemini") {
    if (err.status === 400 && /api key/i.test(m)) return "The Gemini API key is invalid. Check GEMINI_API_KEY in your Render environment.";
    switch (err.status) {
      case 401: case 403: return "The Gemini API key was rejected or doesn't have access to this model.";
      case 404: return "That Gemini model isn't available to your key. Pick another model, or change GEMINI_MODELS.";
      case 429: return "Gemini's free-tier limit was reached. Wait a minute, lower the effort, or try another model.";
      case 500: case 503: return "Gemini is overloaded right now. Try again in a moment.";
    }
    return m.slice(0, 300) || "Gemini request failed";
  }
  switch (err?.status) {
    case 401: return "The server's Anthropic API key is missing or invalid. Check ANTHROPIC_API_KEY in your Render environment.";
    case 403: return "The Anthropic API key doesn't have permission for this model.";
    case 404: return "That model isn't available to this API key. Try another model from the menu.";
    case 429: return "Rate limit or credit limit reached on the Anthropic account. Try again shortly.";
    case 529: case 503: return "Anthropic's API is overloaded right now. Try again in a moment.";
  }
  return /credit balance/i.test(m) ? "The Anthropic account is out of credits." : m.slice(0, 300) || "Request failed";
}

// effort -> extended-thinking budget for Claude (Low = no extended thinking)
const CLAUDE_THINK = [
  { budget: 0, max: 16000 },
  { budget: 4000, max: 16000 },
  { budget: 10000, max: 24000 },
  { budget: 20000, max: 32000 },
];

// effort -> Gemini thinking config (2.5 models use a token budget, 3.x models use a level)
function geminiThinking(id, effort) {
  if (/gemini-3/i.test(id)) {
    // Flash-Lite supports minimal / low / medium / high. Other 3.x models: only use the levels they all share.
    const level = (/flash-lite/i.test(id) ? ["minimal", "low", "medium", "high"] : ["low", null, "high", "high"])[effort];
    return level ? { thinkingLevel: level } : null;
  }
  const pro = /pro/i.test(id);
  const budget = (pro ? [128, 2048, 8192, 32768] : [0, 2048, 8192, 24576])[effort];
  return { thinkingBudget: budget };
}

async function geminiStream({ model, history, system, effort, send, signal }) {
  const contents = history.map((m) => {
    if (m.role === "assistant") return { role: "model", parts: [{ text: m.text }] };
    const parts = [];
    for (const a of m.attachments || []) {
      if (a.kind === "image" && IMG_TYPES.includes(a.mediaType)) parts.push({ inlineData: { mimeType: a.mediaType, data: a.data } });
      else if (a.kind === "pdf") parts.push({ inlineData: { mimeType: "application/pdf", data: a.data } });
      else if (a.kind === "text") parts.push({ text: `<file name="${String(a.name).replace(/"/g, "")}">\n${String(a.content).slice(0, 600000)}\n</file>` });
    }
    parts.push({ text: m.text?.trim() ? m.text : "(see attached files)" });
    return { role: "user", parts };
  });

  let sentText = false;
  async function attempt(withThinking) {
    const generationConfig = { maxOutputTokens: 32000 };
    const th = withThinking ? geminiThinking(model, effort) : null;
    if (th) generationConfig.thinkingConfig = th;
    const r = await fetch(`${GEMINI_BASE}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig }),
    });
    if (!r.ok) {
      let msg = ""; try { msg = (await r.json())?.error?.message || ""; } catch {}
      const e = new Error(msg || `Gemini error ${r.status}`); e.status = r.status; e.provider = "gemini"; e.hadThinking = !!th; throw e;
    }
    const dec = new TextDecoder(); let buf = "", finish = "", blocked = "";
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        let j; try { j = JSON.parse(line.slice(5)); } catch { continue; }
        if (j.promptFeedback?.blockReason) blocked = j.promptFeedback.blockReason;
        const cand = j.candidates?.[0];
        for (const p of cand?.content?.parts || []) {
          if (p.thought) { send({ th: 1 }); continue; }
          if (typeof p.text === "string" && p.text) { sentText = true; send({ t: p.text }); }
        }
        if (cand?.finishReason) finish = cand.finishReason;
      }
    }
    if (blocked) send({ t: "\n\n*(Gemini blocked this request.)*" });
    else if (finish === "MAX_TOKENS") send({ t: "\n\n*(Reached max length.)*" });
    else if (finish === "SAFETY" || finish === "PROHIBITED_CONTENT") send({ t: "\n\n*(Gemini declined to answer this request.)*" });
    else if (!sentText) send({ t: "*(Gemini returned an empty response. Try again or pick another model.)*" });
  }
  try { await attempt(true); }
  catch (e) {
    // some models reject thinking settings: retry once without them
    if (e.status === 400 && e.hadThinking && !sentText && !/api key/i.test(e.message)) await attempt(false); else throw e;
  }
}

app.post("/api/chat", requireAuth, big, async (req, res) => {
  const { messages, model, effort: effortIn } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: "No messages" });
  if (limited("chat:" + req.user.id, 40, 60e3)) return res.status(429).json({ error: "Slow down a little. Too many messages per minute." });
  const info = MODELS.find((m) => m.id === model) || MODELS.find((m) => m.id === req.user.settings?.model) || MODELS.find((m) => m.id === DEFAULT_MODEL);
  const effort = [0, 1, 2, 3].includes(effortIn) ? effortIn : [0, 1, 2, 3].includes(req.user.settings?.effort) ? req.user.settings.effort : DEFAULT_EFFORT;
  const history = messages
    .filter((m) => (m.role === "user") || (m.role === "assistant" && typeof m.text === "string" && m.text.trim()))
    .slice(-40);
  while (history.length && history[0].role !== "user") history.shift();
  if (!history.length) return res.status(400).json({ error: "No messages" });
  const system = String(req.user.settings?.system || "").trim().slice(0, 4000) || SYSTEM;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const ctl = new AbortController();
  let stream;
  res.on("close", () => { ctl.abort(); stream?.abort(); });

  try {
    if (info.provider === "gemini") {
      if (!GEMINI_KEY) throw Object.assign(new Error("Gemini isn't set up yet. Add GEMINI_API_KEY in Render's Environment settings."), { provider: "gemini", status: 0 });
      await geminiStream({ model: info.id, history, system, effort, send, signal: ctl.signal });
      send({ done: true });
    } else {
      const cfg = CLAUDE_THINK[effort];
      let gotText = false;
      const run = async (thinking) => {
        stream = client.messages.stream({
          model: info.id,
          max_tokens: thinking ? cfg.max : 16000,
          system,
          ...(thinking ? { thinking: { type: "enabled", budget_tokens: cfg.budget } } : {}),
          messages: history.map((m) => ({ role: m.role, content: toContent(m) })),
        });
        stream.on("text", (t) => { gotText = true; send({ t }); });
        stream.on("streamEvent", (e) => { if (e.type === "content_block_start" && e.content_block?.type === "thinking") send({ th: 1 }); });
        return stream.finalMessage();
      };
      let final;
      try { final = await run(cfg.budget > 0); }
      catch (e) {
        // if the model rejects the thinking settings, retry once without them
        if (cfg.budget > 0 && e?.status === 400 && !gotText && !res.writableEnded) final = await run(false); else throw e;
      }
      if (final.stop_reason === "refusal") send({ t: "\n\n*(The model declined to answer this request.)*" });
      if (final.stop_reason === "max_tokens") send({ t: "\n\n*(Reached max length.)*" });
      send({ done: true, usage: final.usage });
    }
  } catch (err) {
    if (err?.name !== "AbortError" && !res.writableEnded) send({ error: friendlyError(err) });
  }
  res.end();
});

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Neon AI running on :${port}`));
