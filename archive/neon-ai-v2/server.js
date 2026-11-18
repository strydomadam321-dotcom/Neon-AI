import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- config ----------
const MODELS = [
  { id: "claude-opus-5-5", name: "Opus 5.5 · smartest" },
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5 · fast" },
  { id: "claude-haiku-5-5", name: "Haiku 5.5 · fastest" },
];
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
app.use(express.static(path.join(__dirname, "public"), { maxAge: "5m" }));

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
  res.json({ models: MODELS, defaultModel: DEFAULT_MODEL, needsInvite: true, hasKey: !!process.env.ANTHROPIC_API_KEY });
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
  const { system, model } = req.body || {};
  const s = {
    system: typeof system === "string" ? system.slice(0, 4000) : "",
    model: MODELS.some((m) => m.id === model) ? model : "",
  };
  await q("update users set settings = $1 where id = $2", [s, req.user.id]);
  res.json({ settings: s });
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
      blocks.push({ type: "text", text: `<file name="${String(a.name).replace(/"/g, "")}">\n${a.content}\n</file>` });
    }
  }
  blocks.push({ type: "text", text: msg.text?.trim() ? msg.text : "(see attached files)" });
  return blocks;
}

function friendlyError(err) {
  switch (err?.status) {
    case 401: return "The server's Anthropic API key is missing or invalid. Check ANTHROPIC_API_KEY in your Render environment.";
    case 403: return "The Anthropic API key doesn't have permission for this model.";
    case 404: return "That model isn't available to this API key. Try another model from the menu.";
    case 429: return "Rate limit or credit limit reached on the Anthropic account. Try again shortly.";
    case 529: case 503: return "Anthropic's API is overloaded right now. Try again in a moment.";
  }
  const m = String(err?.message || "");
  return /credit balance/i.test(m) ? "The Anthropic account is out of credits." : m.slice(0, 300) || "Request failed";
}

app.post("/api/chat", requireAuth, big, async (req, res) => {
  const { messages, model } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: "No messages" });
  if (limited("chat:" + req.user.id, 40, 60e3)) return res.status(429).json({ error: "Slow down a little. Too many messages per minute." });
  const useModel = MODELS.some((m) => m.id === model) ? model : req.user.settings?.model || DEFAULT_MODEL;
  const history = messages
    .filter((m) => (m.role === "user") || (m.role === "assistant" && typeof m.text === "string" && m.text.trim()))
    .slice(-40);
  if (!history.length || history[0].role !== "user") {
    while (history.length && history[0].role !== "user") history.shift();
  }
  if (!history.length) return res.status(400).json({ error: "No messages" });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  let stream;
  res.on("close", () => stream?.abort());
  try {
    stream = client.messages.stream({
      model: useModel,
      max_tokens: 16000,
      system: String(req.user.settings?.system || "").trim().slice(0, 4000) || SYSTEM,
      messages: history.map((m) => ({ role: m.role, content: toContent(m) })),
    });
    stream.on("text", (t) => send({ t }));
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") send({ t: "\n\n*(The model declined to answer this request.)*" });
    if (final.stop_reason === "max_tokens") send({ t: "\n\n*(Reached max length.)*" });
    send({ done: true, usage: final.usage });
  } catch (err) {
    if (!res.writableEnded) send({ error: friendlyError(err) });
  }
  res.end();
});

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Neon AI running on :${port}`));
