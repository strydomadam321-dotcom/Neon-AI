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
// ---------- plans ----------
// Payments are not connected yet, so nobody can buy a paid plan: choosing one at signup is only recorded
// (users.plan_requested) and the account runs on Free. Set a user's real plan by hand with
//   update users set plan = 'max' where username_lc = '...';   (free | spark | plus | max)
// OWNER_USERNAMES (comma separated) always get full access.
const FREE_GEMINI_TOKENS_PER_DAY = 50000;
const PLUS_CLAUDE_MSGS_PER_DAY = 50;
const PLAN_IDS = ["free", "spark", "plus", "max"];
const PLANS = [
  { id: "free", name: "Free", price: 0, tag: "Try it out", gemini: "50k tokens / day", claude: "none" },
  { id: "spark", name: "Spark", price: 5, tag: "Unlimited Gemini", gemini: "unlimited", claude: "none" },
  { id: "plus", name: "Plus", price: 12, tag: "Gemini + Claude", gemini: "unlimited", claude: "limited" },
  { id: "max", name: "Max", price: 22, tag: "Everything, unlimited", gemini: "unlimited", claude: "unlimited" },
];
const OWNERS = new Set((process.env.OWNER_USERNAMES || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean));
// Dev accounts: full access (Max, no limits) and the Nuke button. Identified by a VERIFIED email (Google-verified or code-verified).
// Override with DEV_EMAILS (comma separated).
const DEV_EMAILS = new Set((process.env.DEV_EMAILS || "strydomadam321@gmail.com").split(",").map((x) => x.trim()).filter(Boolean).map((x) => { let [l, d] = x.toLowerCase().split("@"); if (d === "googlemail.com") d = "gmail.com"; if (d === "gmail.com") l = l.split("+")[0].replace(/\./g, ""); return `${l}@${d}`; }));
const isDevRow = (r) => !!(r && r.email_verified && r.email_norm && DEV_EMAILS.has(r.email_norm));
const effectivePlan = (u) => (u.dev || OWNERS.has(String(u.username).toLowerCase()) ? "max" : PLAN_IDS.includes(u.plan) ? u.plan : "free");
const claudeAllowed = (plan, modelId) => plan === "max" || (plan === "plus" && !/opus/i.test(modelId));
const SYSTEM =
  "You are a helpful, sharp AI assistant inside a futuristic neon chat app. " +
  "Answer clearly and concisely. Use Markdown, and fenced code blocks with language tags for code.";

// ---------- email codes (Resend) and Google sign-in ----------
// RESEND_API_KEY + MAIL_FROM: sends the 6-digit verification codes (https://resend.com). Without a key, email sign-up is switched off.
// GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET: "Continue with Google". Redirect URI to register in Google Cloud:
//   https://YOUR-DOMAIN/api/auth/google/callback   (override with GOOGLE_REDIRECT_URI if needed)
const RESEND_KEY = process.env.RESEND_API_KEY || "";
const MAIL_FROM = process.env.MAIL_FROM || "NEON AI <onboarding@resend.dev>";
const RESEND_URL = process.env.RESEND_URL || "https://api.resend.com/emails";
const MAIL_DEBUG = process.env.MAIL_DEBUG === "1"; // local testing only: prints codes to the server log instead of emailing
const MAIL_READY = !!RESEND_KEY || MAIL_DEBUG;
const GOOGLE_ID = process.env.GOOGLE_CLIENT_ID || "", GOOGLE_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_AUTH_URL = process.env.GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const CODE_MS = 10 * 60e3, RESEND_COOLDOWN_MS = 30e3, MAX_CODE_TRIES = 5;

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

// one canonical form per mailbox, so jane@gmail.com, j.a.n.e@gmail.com and jane+x@gmail.com count as the same email
function normEmail(e) {
  let [l, d] = String(e).trim().toLowerCase().split("@");
  if (d === "googlemail.com") d = "gmail.com";
  if (d === "gmail.com") l = l.split("+")[0].replace(/\./g, "");
  return `${l}@${d}`;
}

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
alter table users add column if not exists plan text not null default 'free';
alter table users add column if not exists plan_requested text;
alter table users add column if not exists email text;
create unique index if not exists users_email_uq on users(email);
alter table users add column if not exists email_verified boolean not null default false;
alter table users add column if not exists google_sub text;
alter table users add column if not exists has_password boolean not null default true;
create unique index if not exists users_google_uq on users(google_sub);
alter table users add column if not exists email_norm text;
alter table users add column if not exists avatar text;
create table if not exists password_resets(
  user_id int primary key references users(id) on delete cascade,
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  sent_at timestamptz not null default now()
);
alter table users add column if not exists plan_chosen boolean not null default false;
create table if not exists site_state(
  key text primary key,
  set_at timestamptz not null default now(),
  set_by text
);
create table if not exists google_pending(
  state text primary key,
  username text,
  pass_hash text,
  remember boolean not null default false,
  expires_at timestamptz not null
);
create table if not exists signup_pending(
  email text primary key,
  username text not null,
  username_lc text not null,
  pass_hash text not null,
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  sent_at timestamptz not null default now()
);
create table if not exists usage(
  user_id int not null references users(id) on delete cascade,
  day date not null default current_date,
  gemini_tokens bigint not null default 0,
  claude_msgs int not null default 0,
  primary key(user_id, day)
);
create table if not exists meta(key text primary key, done_at timestamptz not null default now());
`);
// one-time reset requested by the owner: removes every account, chat and session, once
{
  const r = await q("insert into meta(key) values('reset-2026-11-plans') on conflict do nothing returning key");
  if (r.rowCount) { await q("truncate users restart identity cascade"); console.log("One-time reset done: all accounts and chats removed."); }
}
// every account gets a canonical email; two accounts can never share one (or a username, or a Google account)
for (const r of (await q("select id,email from users where email is not null and email_norm is null")).rows) await q("update users set email_norm=$1 where id=$2", [normEmail(r.email), r.id]);
try { await q("create unique index if not exists users_email_norm_uq on users(email_norm)"); }
catch (e) { console.warn("users_email_norm_uq not created (duplicate emails exist):", e.message); }
{
  const r = await q("insert into meta(key) values('rm-user-strydomadam321') on conflict do nothing returning key");
  if (r.rowCount) { const d = await q("delete from users where username_lc = 'strydomadam321' or email_norm = 'strydomadam321@gmail.com'"); console.log(`Housekeeping: removed account strydomadam321 (${d.rowCount} found)`); }
}
// one-time reset requested by the owner: every account (email or Google) with its chats and sessions. Runs once.
{
  const r = await q("insert into meta(key) values('reset-2026-11-20-all-accounts') on conflict do nothing returning key");
  if (r.rowCount) { await q("truncate users restart identity cascade"); await q("truncate signup_pending, google_pending"); console.log("One-time reset done: all accounts removed."); }
}
// one-time reset requested by the owner (second time): every account with its chats and sessions. Runs once.
{
  const r = await q("insert into meta(key) values('reset-all-accounts-2') on conflict do nothing returning key");
  if (r.rowCount) { await q("truncate users restart identity cascade"); await q("truncate signup_pending, google_pending"); console.log("One-time reset #2 done: all accounts removed."); }
}
// one-time housekeeping: remove a test account (its chats, sessions and usage go with it). Runs once, then never again.
{
  const r = await q("insert into meta(key) values('rm-user-asdfefeweffas') on conflict do nothing returning key");
  if (r.rowCount) { const d = await q("delete from users where username_lc = 'asdfefeweffas'"); console.log(`Housekeeping: removed test account asdfefeweffas (${d.rowCount} found)`); }
}
const cleanup = () => { q("delete from sessions where expires_at < now()").catch(() => {}); q("delete from signup_pending where expires_at < now() - interval '1 hour'").catch(() => {}); };
cleanup();
setInterval(cleanup, 60 * 60 * 1000).unref();

// ---------- kill switch ("Nuke") ----------
// A dev account can take the whole site offline. It stays offline (every page and API answers 503) until RESUME_AFTER, an
// ISO timestamp in the environment, is later than the moment it was nuked. To turn the site back on, set
// RESUME_AFTER to the current time (the redeploy restarts the app) and it comes back.
let nukedAt = (await q("select set_at from site_state where key = 'nuked'")).rows[0]?.set_at;
nukedAt = nukedAt ? new Date(nukedAt).getTime() : 0;
const siteOff = () => nukedAt > 0 && !(Date.parse(process.env.RESUME_AFTER || "") > nukedAt);
if (siteOff()) console.warn("SITE IS NUKED: serving the offline page until RESUME_AFTER is set to a time after", new Date(nukedAt).toISOString());
const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Offline · NEON AI</title>
<style>*{box-sizing:border-box}html,body{height:100%;margin:0}body{display:grid;place-items:center;padding:24px;font-family:Inter,system-ui,"Segoe UI",Arial,sans-serif;color:#f6e9ff;text-align:center;background:radial-gradient(900px 500px at 50% 0%,rgba(255,95,216,.25),transparent 70%),#12062b}
h1{margin:0 0 10px;font-size:30px;letter-spacing:.22em;font-weight:800;background:linear-gradient(90deg,#ff5fd8,#3df0ff);-webkit-background-clip:text;background-clip:text;color:transparent}p{margin:0;color:#c9b4e8;font-size:15px;line-height:1.5}
.c{max-width:420px;padding:34px 28px;border-radius:20px;background:rgba(40,16,78,.6);border:1px solid rgba(255,160,240,.3);box-shadow:0 30px 80px rgba(8,1,26,.7),0 0 60px rgba(255,95,216,.18)}</style></head>
<body><div class="c"><h1>NEON AI</h1><p>We've temporarily taken the site offline. Please check back later.</p></div></body></html>`;

const client = new Anthropic(); // reads ANTHROPIC_API_KEY
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req, res, next) => {
  if (!siteOff()) return next();
  res.status(503).set({ "Retry-After": "3600", "Cache-Control": "no-store" });
  if (req.path.startsWith("/api")) return res.json({ error: "NEON AI is offline." });
  res.type("html").send(OFFLINE_HTML);
});

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
    `select u.id, u.username, u.settings, u.plan, u.plan_requested, u.has_password, u.avatar, u.plan_chosen, u.email_norm, u.email_verified from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now()`, [sha(token)]);
  if (!rows[0]) { res.clearCookie(COOKIE, { path: "/" }); return res.status(401).json({ error: "Session expired" }); }
  req.user = rows[0]; req.user.dev = isDevRow(rows[0]); req.token = token;
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
  res.json({ models: MODELS, defaultModel: DEFAULT_MODEL, plans: PLANS, freeTokens: FREE_GEMINI_TOKENS_PER_DAY, plusClaudeMsgs: PLUS_CLAUDE_MSGS_PER_DAY, paymentsLive: false, hasKey: !!process.env.ANTHROPIC_API_KEY, hasGemini: !!GEMINI_KEY, hasGoogle: !!(GOOGLE_ID && GOOGLE_SECRET), mailReady: MAIL_READY, defaultEffort: DEFAULT_EFFORT });
});

const USER_RE = /^[A-Za-z0-9_.-]{3,24}$/;
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const codeHash = (em, code) => sha(`${em}:${code}:${process.env.CODE_PEPPER || "neon"}`);
const maskEmail = (em) => { const [l, d] = em.split("@"); return (l.length <= 2 ? l[0] + "*" : l[0] + "*".repeat(Math.min(5, l.length - 2)) + l.slice(-1)) + "@" + d; };

async function sendCodeEmail(to, code, kind = "signup") {
  const reset = kind === "reset";
  if (!RESEND_KEY) { console.log(`[mail debug] ${kind} code for ${to}: ${code}`); return; }
  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:420px;margin:0 auto;padding:28px;color:#111">
    <h2 style="margin:0 0 6px;font-size:20px">${reset ? "Reset your password" : "Verify your email"}</h2>
    <p style="margin:0 0 18px;color:#555">${reset ? "Use this code to choose a new password for your NEON AI account." : "Use this code to finish creating your NEON AI account."}</p>
    <div style="font-size:34px;letter-spacing:10px;font-weight:700;background:#f3f1ff;border-radius:12px;padding:16px 0;text-align:center;font-family:ui-monospace,Menlo,Consolas,monospace">${code}</div>
    <p style="margin:18px 0 0;color:#777;font-size:13px">This code expires in 10 minutes. ${reset ? "If you didn't ask to reset your password, you can ignore this email: your password hasn't changed." : "If you didn't try to sign up, you can ignore this email."}</p></div>`;
  const r = await fetch(RESEND_URL, {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject: reset ? `${code} is your NEON AI password reset code` : `${code} is your NEON AI verification code`, html, text: `Your NEON AI ${reset ? "password reset" : "verification"} code is ${code}. It expires in 10 minutes.` }),
  });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(`Resend ${r.status}: ${t.slice(0, 200)}`); }
}

async function sendGoogleNotice(to) {
  if (!RESEND_KEY) { console.log(`[mail debug] google notice for ${to}`); return; }
  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:420px;margin:0 auto;padding:28px;color:#111">
    <h2 style="margin:0 0 6px;font-size:20px">You sign in with Google</h2>
    <p style="margin:0 0 12px;color:#555">Someone asked to reset the password for this NEON AI account, but it doesn't have one: it uses Google sign-in.</p>
    <p style="margin:0;color:#555">Open NEON AI and choose <b>Continue with Google</b> with this email address. If that wasn't you, you can ignore this message.</p></div>`;
  const r = await fetch(RESEND_URL, { method: "POST", signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject: "Your NEON AI account uses Google sign-in", html, text: "Your NEON AI account uses Google sign-in, so it has no password to reset. Open NEON AI and choose Continue with Google with this email address." }) });
  if (!r.ok) throw new Error(`Resend ${r.status}`);
}

function checkSignupFields({ username, password, email }) {
  if (typeof email !== "string" || email.length > 120 || !EMAIL_RE.test(email.trim())) return { error: "Enter a valid email address.", field: "email" };
  if (typeof username !== "string" || !USER_RE.test(username)) return { error: "Username must be 3-24 characters: letters, numbers, . _ -", field: "username" };
  if (typeof password !== "string" || password.length < 8) return { error: "Password must be at least 8 characters.", field: "password" };
  if (Buffer.byteLength(password) > 72) return { error: "Password is too long (72 bytes max).", field: "password" };
  return null;
}

// step 1 of email sign-up: nothing is created yet, we just email a code
app.post("/api/signup/start", small, wrap(async (req, res) => {
  if (limited("sstart:" + req.ip, 10, 60 * 60e3)) return res.status(429).json({ error: "Too many attempts. Try again later." });
  const bad = checkSignupFields(req.body || {});
  if (bad) return res.status(400).json(bad);
  if (!MAIL_READY) return res.status(503).json({ error: "Email sign-up isn't available yet. Try Continue with Google instead.", field: "email" });
  const { username, password } = req.body, em = req.body.email.trim().toLowerCase();
  if (limited("smail:" + em, 5, 60 * 60e3)) return res.status(429).json({ error: "Too many codes sent to that email. Try again in an hour.", field: "email" });
  const { rows: dup } = await q("select username_lc = $1 as u, email_norm = $2 as e from users where username_lc = $1 or email_norm = $2", [username.toLowerCase(), normEmail(em)]);
  if (dup.some((r) => r.e)) return res.status(409).json({ error: "This email already has an account (email or Google). Please sign in instead.", field: "email" });
  if (dup.some((r) => r.u)) return res.status(409).json({ error: "That username is taken.", field: "username" });
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const hash = await bcrypt.hash(password, 11);
  await q(`insert into signup_pending(email,username,username_lc,pass_hash,code_hash,attempts,expires_at,sent_at) values($1,$2,$3,$4,$5,0,$6,now())
           on conflict(email) do update set username=$2, username_lc=$3, pass_hash=$4, code_hash=$5, attempts=0, expires_at=$6, sent_at=now()`,
    [em, username, username.toLowerCase(), hash, codeHash(em, code), new Date(Date.now() + CODE_MS)]);
  try { await sendCodeEmail(em, code); }
  catch (e) {
    console.error("send code failed:", e.message);
    await q("delete from signup_pending where email = $1", [em]).catch(() => {});
    return res.status(502).json({ error: "We couldn't send the email. Check the address and try again in a moment.", field: "email" });
  }
  res.json({ sent: true, email: maskEmail(em), cooldown: RESEND_COOLDOWN_MS / 1000 });
}));

app.post("/api/signup/resend", small, wrap(async (req, res) => {
  const em = String(req.body?.email || "").trim().toLowerCase();
  if (limited("sresend:" + req.ip, 12, 60 * 60e3)) return res.status(429).json({ error: "Too many attempts. Try again later." });
  const { rows } = await q("select sent_at from signup_pending where email = $1", [em]);
  if (!rows[0]) return res.status(400).json({ error: "Start again to get a new code.", field: "code" });
  const wait = Math.ceil((new Date(rows[0].sent_at).getTime() + RESEND_COOLDOWN_MS - Date.now()) / 1000);
  if (wait > 0) return res.status(429).json({ error: `Wait ${wait}s before asking for another code.`, wait });
  if (limited("smail:" + em, 5, 60 * 60e3)) return res.status(429).json({ error: "Too many codes sent to that email. Try again in an hour." });
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await q("update signup_pending set code_hash=$2, attempts=0, expires_at=$3, sent_at=now() where email=$1", [em, codeHash(em, code), new Date(Date.now() + CODE_MS)]);
  try { await sendCodeEmail(em, code); } catch (e) { console.error("resend failed:", e.message); return res.status(502).json({ error: "We couldn't send the email. Try again in a moment." }); }
  res.json({ sent: true, cooldown: RESEND_COOLDOWN_MS / 1000 });
}));

// step 3 of email sign-up: the right code creates the account
app.post("/api/signup/verify", small, wrap(async (req, res) => {
  if (limited("sverify:" + req.ip, 30, 60 * 60e3)) return res.status(429).json({ error: "Too many attempts. Try again later." });
  const em = String(req.body?.email || "").trim().toLowerCase(), code = String(req.body?.code || "").replace(/\D/g, "");
  if (code.length !== 6) return res.status(400).json({ error: "Enter the 6-digit code.", field: "code" });
  const { rows } = await q("select * from signup_pending where email = $1", [em]);
  const p = rows[0];
  if (!p || new Date(p.expires_at) < new Date()) return res.status(400).json({ error: "That code has expired. Tap Resend to get a new one.", field: "code", expired: true });
  if (p.attempts >= MAX_CODE_TRIES) return res.status(429).json({ error: "Too many wrong tries. Tap Resend to get a new code.", field: "code", expired: true });
  const a = Buffer.from(codeHash(em, code)), b = Buffer.from(p.code_hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const left = MAX_CODE_TRIES - p.attempts - 1;
    await q("update signup_pending set attempts = attempts + 1 where email = $1", [em]);
    return res.status(400).json({ error: left > 0 ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong tries. Tap Resend to get a new code.", field: "code", expired: left <= 0 });
  }
  let user;
  try {
    ({ rows: [user] } = await q("insert into users(username,username_lc,pass_hash,email,email_norm,email_verified) values($1,$2,$3,$4,$5,true) returning id,username,settings,plan,plan_requested,has_password,avatar",
      [p.username, p.username_lc, p.pass_hash, em, normEmail(em)]));
  } catch (e) {
    if (e.code === "23505") return /email/.test(e.constraint || "") ? res.status(409).json({ error: "This email already has an account (email or Google). Please sign in instead.", field: "email" }) : res.status(409).json({ error: "That username was just taken. Pick another.", field: "username" });
    throw e;
  }
  await q("delete from signup_pending where email = $1", [em]);
  await startSession(req, res, user.id, !!req.body?.remember);
  res.json(await mePayload(user));
}));

// ---------- Google sign-in (authorization-code flow) ----------
const GCOOKIE = "neon_gs";
const googleRedirectUri = (req) => process.env.GOOGLE_REDIRECT_URI || `${req.protocol}://${req.get("host")}/api/auth/google/callback`;
const authFail = (res, msg) => res.redirect("/?auth_error=" + encodeURIComponent(msg));
const isHttps = (u) => typeof u === "string" && /^https:\/\/[^\s]{1,500}$/.test(u);

// The page asks for the Google link with a POST, so a username and password chosen in the sign-up form travel safely (never in a URL)
app.post("/api/auth/google/start", small, wrap(async (req, res) => {
  if (!GOOGLE_ID || !GOOGLE_SECRET) return res.status(503).json({ error: "Google sign-in isn't set up yet." });
  if (limited("gstart:" + req.ip, 30, 60 * 60e3)) return res.status(429).json({ error: "Too many attempts. Try again later." });
  const { username, password, remember } = req.body || {};
  let name = null, hash = null;
  if (username !== undefined || password !== undefined) {   // creating an account: they picked a username and password first
    const bad = checkSignupFields({ username, password, email: "x@x.xx" });
    if (bad) return res.status(400).json(bad);
    if ((await q("select 1 from users where username_lc = $1", [username.toLowerCase()])).rows[0]) return res.status(409).json({ error: "That username is taken.", field: "username" });
    name = username; hash = await bcrypt.hash(password, 11);
  }
  const state = crypto.randomBytes(24).toString("base64url");
  await q("delete from google_pending where expires_at < now()");
  await q("insert into google_pending(state,username,pass_hash,remember,expires_at) values($1,$2,$3,$4,$5)", [state, name, hash, !!remember, new Date(Date.now() + 10 * 60e3)]);
  res.cookie(GCOOKIE, state, { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: 10 * 60e3, path: "/api/auth" });
  const u = new URL(GOOGLE_AUTH_URL);
  u.search = new URLSearchParams({ client_id: GOOGLE_ID, redirect_uri: googleRedirectUri(req), response_type: "code", scope: "openid email profile", state, prompt: "select_account" }).toString();
  res.json({ url: u.toString() });
}));

function usernameFromEmail(email) {
  let base = email.split("@")[0].replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 18);
  if (base.length < 3) base = (base + "user").slice(0, 18);
  return base;
}

app.get("/api/auth/google/callback", wrap(async (req, res) => {
  const st = getCookie(req, GCOOKIE);
  res.clearCookie(GCOOKIE, { path: "/api/auth" });
  if (req.query.error) { if (st) await q("delete from google_pending where state = $1", [st]); return authFail(res, "Google sign-in was cancelled."); }
  const pend = st && st === String(req.query.state || "") ? (await q("delete from google_pending where state = $1 returning *", [st])).rows[0] : null;
  if (!GOOGLE_ID || !GOOGLE_SECRET || !pend || new Date(pend.expires_at) < new Date() || !req.query.code) return authFail(res, "Google sign-in expired. Please try again.");
  let claims;
  try {
    const r = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST", signal: AbortSignal.timeout(15000), headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: String(req.query.code), client_id: GOOGLE_ID, client_secret: GOOGLE_SECRET, redirect_uri: googleRedirectUri(req), grant_type: "authorization_code" }),
    });
    if (!r.ok) throw new Error("token " + r.status + " " + (await r.text().catch(() => "")).slice(0, 200));
    const { id_token } = await r.json();
    // the token came straight from Google over TLS in exchange for our secret, so its claims can be trusted; we still check them
    claims = JSON.parse(Buffer.from(String(id_token).split(".")[1], "base64url").toString());
  } catch (e) { console.error("google sign-in failed:", e.message); return authFail(res, "Google sign-in failed. Please try again."); }
  const okIss = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  const verified = claims.email_verified === true || claims.email_verified === "true";
  if (!okIss || claims.aud !== GOOGLE_ID || !(claims.exp * 1000 > Date.now()) || !claims.sub || !claims.email || !verified) return authFail(res, "Google couldn't verify that account.");
  const email = String(claims.email).toLowerCase(), enorm = normEmail(email), sub = String(claims.sub), pic = isHttps(claims.picture) ? claims.picture : null;
  const cols = "id,username,settings,plan,plan_requested,has_password,avatar";
  let user = (await q(`select ${cols} from users where google_sub = $1`, [sub])).rows[0], created = false;
  const byMail = user ? null : (await q(`select id from users where email_norm = $1`, [enorm])).rows[0];
  if (pend.username && (user || byMail)) return authFail(res, "This email or Google account already has an account. Please sign in instead.");   // they pressed Create account, but it already exists
  if (!user && byMail) user = (await q(`update users set google_sub = $1, email_verified = true where id = $2 and google_sub is null returning ${cols}`, [sub, byMail.id])).rows[0]; // signing IN with the same mailbox: link to that account
  if (user) { if (pic && pic !== user.avatar) await q("update users set avatar = $1 where id = $2", [pic, user.id]); }
  else {
    // new account: the username they typed in the sign-up form (if it's still free), otherwise one made from their email
    const base = usernameFromEmail(email);
    const wanted = pend.username && !(await q("select 1 from users where username_lc = $1", [pend.username.toLowerCase()])).rows[0] ? pend.username : null;
    const hash = pend.pass_hash || await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);   // no password typed: nobody knows this one, they use Google
    for (let i = 0; i < 25 && !user; i++) {
      const name = i === 0 ? (wanted || base) : i === 1 && wanted ? base : base.slice(0, 19) + String(crypto.randomInt(10, 9999));
      try {
        user = (await q(`insert into users(username,username_lc,pass_hash,email,email_norm,email_verified,google_sub,has_password,avatar) values($1,$2,$3,$4,$5,true,$6,$7,$8) returning ${cols}`,
          [name, name.toLowerCase(), hash, email, enorm, sub, !!pend.pass_hash, pic])).rows[0];
        created = true;
      } catch (e) {
        if (e.code !== "23505") throw e;
        if (/google/.test(e.constraint || "")) { user = (await q(`select ${cols} from users where google_sub = $1`, [sub])).rows[0]; break; }   // double-click race: they already exist
        if (/email/.test(e.constraint || "")) return authFail(res, "This email or Google account already has an account. Please sign in instead.");
      }
    }
    if (!user) return authFail(res, "Couldn't create your account. Please try again.");
  }
  await startSession(req, res, user.id, !!pend.remember);
  res.redirect(created ? "/?welcome=1" : "/");
}));

app.post("/api/login", small, wrap(async (req, res) => {
  const { username, password, remember } = req.body || {};
  if (typeof username !== "string" || typeof password !== "string") return res.status(400).json({ error: "Enter your username or email and your password." });
  const id = username.trim().slice(0, 120);
  const key = "login:" + req.ip + ":" + id.toLowerCase();
  if (limited(key, 8, 15 * 60e3)) return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
  // an email works as a second username (usernames can't contain "@", so the two never clash)
  const cols = "id,username,pass_hash,settings,plan,plan_requested,has_password,avatar";
  const { rows } = id.includes("@")
    ? await q(`select ${cols} from users where email_norm = $1`, [normEmail(id)])
    : await q(`select ${cols} from users where username_lc = $1`, [id.toLowerCase()]);
  const user = rows[0];
  const ok = await bcrypt.compare(password.slice(0, 200), user ? user.pass_hash : DUMMY_HASH);
  if (!user || !ok) return res.status(401).json({ error: "Wrong username, email or password." });
  hits.delete(key);
  await startSession(req, res, user.id, !!remember);
  res.json(await mePayload(user));
}));

// ---------- forgot password (only accounts that have a password; the answer never reveals whether an email has an account) ----------
const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");
app.post("/api/password/forgot", small, wrap(async (req, res) => {
  if (limited("pwf:" + req.ip, 10, 60 * 60e3)) return res.status(429).json({ error: "Too many attempts. Try again later." });
  const email = String(req.body?.email || "").trim();
  if (!EMAIL_RE.test(email) || email.length > 120) return res.status(400).json({ error: "Enter a valid email address.", field: "email" });
  if (!MAIL_READY) return res.status(503).json({ error: "Password reset isn't available yet.", field: "email" });
  const norm = normEmail(email);
  if (!limited("pwfm:" + norm, 5, 60 * 60e3)) {
    const u = (await q("select id, email, has_password from users where email_norm = $1", [norm])).rows[0];
    console.log(`password reset asked for ${maskEmail(norm)}: ${!u ? "no account" : u.has_password ? "account with a password" : "Google-only account"}`);
    if (u && !u.has_password) {
      // no password to reset: the mailbox owner gets a note saying to use Google (nothing is revealed to whoever typed the address)
      const cur = (await q("select sent_at from password_resets where user_id = $1", [u.id])).rows[0];
      if (!cur || Date.now() - new Date(cur.sent_at).getTime() >= RESEND_COOLDOWN_MS) {
        await q(`insert into password_resets(user_id,code_hash,attempts,expires_at,sent_at) values($1,'-',99,now(),now()) on conflict(user_id) do update set sent_at=now()`, [u.id]);
        sendGoogleNotice(u.email).catch((e) => console.error("google notice failed:", e.message));
      }
    } else if (u) {
      const cur = (await q("select sent_at from password_resets where user_id = $1", [u.id])).rows[0];
      if (!cur || Date.now() - new Date(cur.sent_at).getTime() >= RESEND_COOLDOWN_MS) {
        const code = newCode();
        await q(`insert into password_resets(user_id,code_hash,attempts,expires_at,sent_at) values($1,$2,0,$3,now())
                 on conflict(user_id) do update set code_hash=$2, attempts=0, expires_at=$3, sent_at=now()`, [u.id, codeHash(norm, code), new Date(Date.now() + CODE_MS)]);
        sendCodeEmail(u.email, code, "reset").catch((e) => console.error("reset email failed:", e.message));   // not awaited, so response time doesn't reveal whether the email has an account
      }
    }
  }
  res.json({ sent: true, cooldown: RESEND_COOLDOWN_MS / 1000 });
}));

app.post("/api/password/reset", small, wrap(async (req, res) => {
  if (limited("pwr:" + req.ip, 30, 60 * 60e3)) return res.status(429).json({ error: "Too many attempts. Try again later." });
  const email = String(req.body?.email || "").trim(), code = String(req.body?.code || "").replace(/\D/g, ""), password = req.body?.password;
  if (code.length !== 6) return res.status(400).json({ error: "Enter the 6-digit code.", field: "code" });
  if (typeof password !== "string" || password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters.", field: "password" });
  if (Buffer.byteLength(password) > 72) return res.status(400).json({ error: "Password is too long (72 bytes max).", field: "password" });
  const norm = normEmail(email);
  const u = (await q("select id,username,settings,plan,plan_requested,has_password,avatar from users where email_norm = $1 and has_password", [norm])).rows[0];
  const r = u ? (await q("select * from password_resets where user_id = $1", [u.id])).rows[0] : null;
  const dead = { error: "That code isn't right or has expired. Tap Resend to get a new one.", field: "code", expired: true };
  if (!r || new Date(r.expires_at) < new Date() || r.attempts >= MAX_CODE_TRIES) return res.status(400).json(dead);
  const a = Buffer.from(codeHash(norm, code)), b = Buffer.from(r.code_hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const left = MAX_CODE_TRIES - r.attempts - 1;
    await q("update password_resets set attempts = attempts + 1 where user_id = $1", [u.id]);
    return res.status(400).json(left > 0 ? { error: `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.`, field: "code" } : dead);
  }
  await q("update users set pass_hash = $1 where id = $2", [await bcrypt.hash(password, 11), u.id]);
  await q("delete from password_resets where user_id = $1", [u.id]);
  await q("delete from sessions where user_id = $1", [u.id]);     // anyone signed in with the old password is signed out
  await startSession(req, res, u.id, !!req.body?.remember);
  res.json(await mePayload(u));
}));

app.post("/api/logout", wrap(async (req, res) => {
  const token = getCookie(req, COOKIE);
  if (token) await q("delete from sessions where token_hash = $1", [sha(token)]);
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
}));

async function todayUsage(userId) {
  const { rows } = await q("select gemini_tokens, claude_msgs from usage where user_id=$1 and day=current_date", [userId]);
  return { gemini: Number(rows[0]?.gemini_tokens || 0), claude: rows[0]?.claude_msgs || 0 };
}
async function mePayload(u) {
  const extra = (await q("select email_norm, email_verified, plan_chosen from users where id = $1", [u.id])).rows[0] || {};
  const dev = isDevRow(extra), plan = effectivePlan({ ...u, dev }), use = await todayUsage(u.id);
  return {
    user: { username: u.username, hasPassword: u.has_password !== false, picture: u.avatar || null, dev }, settings: u.settings,
    plan: { id: plan, requested: u.plan_requested && u.plan_requested !== plan ? u.plan_requested : null, owner: OWNERS.has(u.username.toLowerCase()), chosen: dev || !!extra.plan_chosen, usedTokens: use.gemini, usedClaude: use.claude },
  };
}
app.get("/api/me", requireAuth, wrap(async (req, res) => res.json(await mePayload(req.user))));

app.put("/api/settings", requireAuth, small, wrap(async (req, res) => {
  const cur = req.user.settings || {};
  const { system, model, effort, retro, bg, flicker } = req.body || {};
  const bool = (v, d) => (typeof v === "boolean" ? v : typeof cur[d.key] === "boolean" ? cur[d.key] : d.def);
  const s = {
    system: typeof system === "string" ? system.slice(0, 4000) : cur.system || "",
    model: model === undefined ? cur.model || "" : MODELS.some((m) => m.id === model) ? model : "",
    effort: [0, 1, 2, 3].includes(effort) ? effort : [0, 1, 2, 3].includes(cur.effort) ? cur.effort : DEFAULT_EFFORT,
    retro: bool(retro, { key: "retro", def: true }),
    bg: bool(bg, { key: "bg", def: true }),
    flicker: bool(flicker, { key: "flicker", def: true }),
  };
  await q("update users set settings = $1 where id = $2", [s, req.user.id]);
  res.json({ settings: s });
}));

// the plan pop-up that every new account must answer before using the app (paid plans are only recorded until payments exist)
app.post("/api/plan/choose", requireAuth, small, wrap(async (req, res) => {
  const id = req.body?.plan;
  if (!PLAN_IDS.includes(id)) return res.status(400).json({ error: "Unknown plan." });
  await q("update users set plan_chosen = true, plan_requested = $2 where id = $1", [req.user.id, id === "free" ? null : id]);
  res.json(await mePayload({ ...req.user, plan_requested: id === "free" ? null : id }));
}));

// dev only: take the whole site offline (see "kill switch" above)
app.post("/api/dev/nuke", requireAuth, small, wrap(async (req, res) => {
  if (!req.user.dev) return res.status(403).json({ error: "Not allowed." });
  if (limited("nuke:" + req.user.id, 5, 15 * 60e3)) return res.status(429).json({ error: "Too many attempts. Try again later." });
  if (req.body?.confirm !== "NUKE") return res.status(400).json({ error: "Type NUKE exactly to confirm." });
  await q("insert into site_state(key,set_at,set_by) values('nuked',now(),$1) on conflict(key) do update set set_at = now(), set_by = $1", [req.user.username]);
  nukedAt = Date.now();
  console.warn(`NUKE: site taken offline by ${req.user.username} at ${new Date(nukedAt).toISOString()}`);
  res.json({ ok: true });
}));

app.post("/api/plan/request", requireAuth, small, wrap(async (req, res) => {
  const id = req.body?.plan;
  if (!PLAN_IDS.includes(id) || id === "free") return res.status(400).json({ error: "Unknown plan." });
  await q("update users set plan_requested = $1 where id = $2", [id, req.user.id]);
  res.json(await mePayload({ ...req.user, plan_requested: id }));
}));

// permanently delete the signed-in account (chats and sessions go with it via ON DELETE CASCADE)
app.post("/api/account/delete", requireAuth, small, wrap(async (req, res) => {
  if (limited("delacct:" + req.user.id, 5, 15 * 60e3)) return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
  if (req.user.has_password === false) {
    // signed up with Google: there's no password, so they type their username instead
    if (String(req.body?.confirm || "").trim().toLowerCase() !== req.user.username.toLowerCase()) return res.status(403).json({ error: "That isn't your username. Your account was not deleted." });
  } else {
    const password = req.body?.password;
    if (typeof password !== "string" || !password) return res.status(400).json({ error: "Enter your password to confirm." });
    const { rows } = await q("select pass_hash from users where id = $1", [req.user.id]);
    if (!rows[0] || !(await bcrypt.compare(password.slice(0, 200), rows[0].pass_hash))) return res.status(403).json({ error: "Wrong password. Your account was not deleted." });
  }
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

  let sentText = false, tokens = 0;
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
        if (j.usageMetadata?.totalTokenCount) tokens = j.usageMetadata.totalTokenCount;
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
  return tokens;
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

  const plan = effectivePlan(req.user);
  const use = await todayUsage(req.user.id);
  let block = "";
  if (info.provider === "gemini") {
    if (plan === "free" && use.gemini >= FREE_GEMINI_TOKENS_PER_DAY) block = `You've used your ${FREE_GEMINI_TOKENS_PER_DAY.toLocaleString()} free Gemini tokens for today. They reset at midnight UTC. Upgrade to Spark for unlimited Gemini.`;
  } else if (!claudeAllowed(plan, info.id)) {
    block = plan === "plus" ? "Opus is included with the Max plan. Pick Sonnet or Haiku, or upgrade to Max."
      : "Claude models are part of the Plus and Max plans. Pick a Gemini model, or upgrade your plan.";
  } else if (plan === "plus" && use.claude >= PLUS_CLAUDE_MSGS_PER_DAY) {
    block = `You've reached today's ${PLUS_CLAUDE_MSGS_PER_DAY} Claude messages on Plus. Use Gemini (unlimited), or upgrade to Max for unlimited Claude.`;
  }
  if (block) return res.status(403).json({ error: block, upgrade: true });

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
      const used = await geminiStream({ model: info.id, history, system, effort, send, signal: ctl.signal });
      if (used > 0) q("insert into usage(user_id,day,gemini_tokens) values($1,current_date,$2) on conflict(user_id,day) do update set gemini_tokens = usage.gemini_tokens + $2", [req.user.id, used]).catch(() => {});
      send({ done: true, tokens: use.gemini + (used || 0) });
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
      q("insert into usage(user_id,day,claude_msgs) values($1,current_date,1) on conflict(user_id,day) do update set claude_msgs = usage.claude_msgs + 1", [req.user.id]).catch(() => {});
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
