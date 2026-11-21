import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TOTAL as RIDDLES, riddleAt, isRight, publicRiddle } from "./riddles.js";

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
  { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash · newest", provider: "gemini" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash · balanced", provider: "gemini" },
];
const GEMINI_MODELS = process.env.GEMINI_MODELS
  ? process.env.GEMINI_MODELS.split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
      const [id, name] = x.split("|").map((y) => y.trim());
      return { id, name: name || id, provider: "gemini" };
    }).filter((m) => /^[\w.\-]{3,60}$/.test(m.id))
  : GEMINI_DEFAULTS;
const MODELS = [...GEMINI_MODELS, ...CLAUDE_MODELS];   // Gemini first, Claude below
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || "", STRIPE_WH = process.env.STRIPE_WEBHOOK_SECRET || "", STRIPE_LIVE = /^(sk|rk)_live_/.test(STRIPE_KEY);
const GEMINI_BASE = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
// Model used for chat titles (tried first). Override with TITLE_MODEL.
const TITLE_MODEL = process.env.TITLE_MODEL || "gemini-3.5-flash";
const DEFAULT_EFFORT = 1; // 0 Low, 1 Medium, 2 High, 3 Max
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || (MODELS.some((m) => m.id === "gemini-3.5-flash-lite") ? "gemini-3.5-flash-lite" : MODELS[0].id);
// ---------- plans ----------
// Payments are not connected yet, so nobody can buy a paid plan: choosing one at signup is only recorded
// (users.plan_requested) and the account runs on Free. Set a user's real plan by hand with
//   update users set plan = 'max' where username_lc = '...';   (free | spark | plus | max)
// OWNER_USERNAMES (comma separated) always get full access.
const FREE_GEMINI_TOKENS_PER_DAY = 25000;
const PLUS_CLAUDE_MSGS_PER_DAY = 50;
const PLAN_IDS = ["free", "spark", "plus", "max"];
const PLANS = [
  { id: "free", name: "Free", price: 0, tag: "Try it out", gemini: "25k tokens / 12h", claude: "none" },
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

// Appended to every system prompt (also the user's own custom instructions): how the model hands over real files
const MATH_RULES = `MATHS: write any mathematics in LaTeX, never as plain text. Inline maths goes between single dollar signs like $x^2 + 1$ and displayed equations go on their own lines between double dollar signs like $$\\frac{a}{b}$$. Do not put LaTeX inside code blocks, and write money as plain text such as 5 dollars or \\$5.`;
// every model gets today's date and is told it can search the web (its own training knowledge is out of date)
const liveRules = () => `TODAY: the current date is ${new Date().toISOString().slice(0, 10)} (UTC). You have a web search tool. Use it whenever the question could depend on recent or changing facts (news, releases, prices, sports, software versions, "latest", "is X out yet") or when you are not sure. Your training data ends before today, so never claim that something has not happened, or is unreleased, without searching first. After searching, answer from what you found and mention the source names naturally.`;
// search tools that a provider rejected are switched off for a while so chats keep working
const noSearch = new Map();
const searchOff = (id) => (noSearch.get(id) || 0) > Date.now();
const markNoSearch = (id) => noSearch.set(id, Date.now() + 10 * 60e3);
const webSrc = (arr) => arr.map((w) => ({ t: String((w && (w.title || w.page_age)) || "").slice(0, 90), u: String((w && (w.uri || w.url)) || "") })).filter((x) => /^https?:\/\//.test(x.u)).slice(0, 8);
const FILE_RULES = `FILES: you can hand the user real, downloadable files. When they ask for a PDF, a Word document (.docx), a PowerPoint (.pptx), or an Excel / Google Sheets spreadsheet (.xlsx), or one of those is clearly the best deliverable, write one short sentence and then ONE fenced code block whose language is neon-pdf, neon-docx, neon-pptx or neon-xlsx. The app turns the block into a file with a preview and a download button, so never tell the user to copy, print, save as HTML or paste it into another program.
Block layout: optional header lines first (title: My Title, and for neon-pptx optionally theme: dark), then the content.
- neon-pdf and neon-docx: the whole document in Markdown (# headings, paragraphs, **bold**, *italic*, lists, tables, > quotes, --- rules). No HTML.
- neon-pptx: slides separated by a line containing only ---. The first slide starts with a # title (the cover, optional subtitle lines under it); the other slides start with a ## heading, then - bullets (indent two spaces for sub-bullets), short paragraphs or a Markdown table. Optional speaker notes on a line starting Notes:.
- neon-xlsx: CSV rows. Start each sheet with a line sheet: Name. Quote cells that contain commas. A cell that starts with = is a formula (for example =SUM(B2:B10)). Write numbers without currency symbols or thousands separators.
If the content itself contains code fences, open and close the outer block with four backticks. Use normal code blocks (html, python, ...) for code and web pages.`;

// ---------- legal documents (legal/terms.html, legal/privacy.html) ----------
// Update log shown to users once per new version (see changelog.json; newest entry first).
const CHANGELOG = (() => { try { const j = JSON.parse(fs.readFileSync(path.join(__dirname, "changelog.json"), "utf8")); return Array.isArray(j) ? j : []; } catch { return []; } })();
// Bump LEGAL_VERSION whenever the wording changes. CONTACT_EMAIL (environment) is where people can send privacy requests.
const LEGAL_VERSION = "2026-11-21.1", LEGAL_UPDATED = "21 November 2026";
const CONTACT_EMAIL = (process.env.CONTACT_EMAIL || "").trim();
const readLegal = (n) => { try { return fs.readFileSync(path.join(__dirname, "legal", n + ".html"), "utf8"); } catch { return "<p>This document is not available right now.</p>"; } };
const LEGAL = { terms: readLegal("terms"), privacy: readLegal("privacy") };
const legalHtml = (doc) => LEGAL[doc]
  .replace(/\{\{VERSION\}\}/g, LEGAL_VERSION).replace(/\{\{UPDATED\}\}/g, LEGAL_UPDATED)
  .replace(/\{\{CONTACT\}\}/g, CONTACT_EMAIL ? `<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>` : "the contact details published on freestudyresources.org");

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
alter table users add column if not exists stripe_customer text;
alter table users add column if not exists stripe_sub text;
alter table users add column if not exists stripe_status text;
alter table users add column if not exists plan_renews timestamptz;
alter table users add column if not exists plan_cancelling boolean not null default false;
create index if not exists users_stripe_customer on users(stripe_customer);
alter table users add column if not exists terms_version text;
alter table users add column if not exists terms_at timestamptz;
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
alter table signup_pending add column if not exists terms_version text;
create table if not exists usage(
  user_id int not null references users(id) on delete cascade,
  day date not null default current_date,
  gemini_tokens bigint not null default 0,
  claude_msgs int not null default 0,
  primary key(user_id, day)
);
create table if not exists usage_window(
  user_id int primary key references users(id) on delete cascade,
  started_at timestamptz not null default now(),
  gemini_tokens bigint not null default 0,
  claude_msgs int not null default 0
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
const BYPASS_CODE = process.env.NUKE_BYPASS_CODE || "";        // secret: set only in the environment, never in the code
const BYPASS_COOKIE = "neon_bp";
const bypassToken = () => sha(`bypass:${BYPASS_CODE}:${nukedAt}`);   // tied to this nuke and this code, so a new nuke or a new code invalidates old passes
const hasBypass = (req) => {
  if (!BYPASS_CODE) return false;
  const c = getCookie(req, BYPASS_COOKIE), t = bypassToken();
  return c.length === t.length && crypto.timingSafeEqual(Buffer.from(c), Buffer.from(t));
};
const FAIRS_GIF = (() => { try { return fs.readFileSync(path.join(__dirname, "assets", "fairs.gif")); } catch { return null; } })();
const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>NUKED · NEON AI</title>
<style>
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{display:grid;place-items:center;padding:22px;font-family:Inter,system-ui,"Segoe UI",Arial,sans-serif;color:#f6e9ff;text-align:center;overflow:hidden;
 background:radial-gradient(900px 520px at 50% -5%,rgba(255,60,120,.3),transparent 70%),radial-gradient(700px 500px at 85% 105%,rgba(61,240,255,.16),transparent 70%),#12062b}
.card{width:min(460px,100%);padding:36px 28px 28px;border-radius:22px;background:rgba(40,16,78,.62);border:1px solid rgba(255,120,180,.35);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
 box-shadow:0 30px 80px rgba(8,1,26,.75),0 0 70px rgba(255,60,120,.22),inset 0 1px 0 rgba(255,255,255,.08);animation:rise .7s cubic-bezier(.2,.9,.25,1) both}
@keyframes rise{from{opacity:0;transform:translateY(18px) scale(.98);filter:blur(5px)}}
.brand{margin:0;font-size:15px;letter-spacing:.42em;font-weight:800;color:#c9b4e8}
h1{margin:10px 0 8px;font-size:clamp(30px,8.5vw,44px);line-height:1.05;font-weight:900;letter-spacing:.04em;color:#ffe7f3;text-shadow:0 0 14px rgba(255,60,120,.9),0 0 38px rgba(255,60,120,.6),0 0 80px rgba(255,60,120,.4);animation:flick 3.6s infinite}
@keyframes flick{0%,18%,22%,62%,64%,100%{opacity:1}20%{opacity:.55}63%{opacity:.7}}
p.sub{margin:0 0 24px;color:#c9b4e8;font-size:14.5px;line-height:1.5}
.btn{height:48px;border:0;border-radius:13px;font-family:inherit;font-weight:700;font-size:15px;cursor:pointer;color:#260a3d;position:relative;overflow:hidden;transition:transform .2s,box-shadow .25s}
.btn:hover{transform:translateY(-2px)}.btn:active{transform:scale(.97)}
#fairs{width:100%;background:linear-gradient(120deg,#ff5fd8,#a66bff 55%,#3df0ff);box-shadow:0 8px 30px rgba(166,107,255,.4)}
.or{display:flex;align-items:center;gap:12px;margin:20px 0 14px;color:#8d79b3;font-size:12px;letter-spacing:.1em;text-transform:uppercase}
.or:before,.or:after{content:"";flex:1;height:1px;background:linear-gradient(90deg,transparent,rgba(255,160,240,.35),transparent)}
form{display:flex;gap:8px}
input{flex:1;min-width:0;height:48px;padding:0 14px;border-radius:12px;border:1px solid rgba(255,160,240,.3);background:rgba(8,2,26,.55);color:#fff;font:inherit;outline:0;transition:border-color .25s,box-shadow .25s}
input:focus{border-color:#3df0ff;box-shadow:0 0 18px rgba(61,240,255,.4)}
input::placeholder{color:#8d79b3}
#go{width:84px;background:rgba(255,255,255,.08);color:#f6e9ff;border:1px solid rgba(255,160,240,.35)}
#go:hover{border-color:#3df0ff;box-shadow:0 0 18px rgba(61,240,255,.35)}
#err{min-height:20px;margin:10px 2px 0;color:#ff8aa5;font-size:13.5px;text-align:left}
form.bad input{border-color:#ff5c7a;animation:shake .4s}
@keyframes shake{20%,60%{transform:translateX(-5px)}40%,80%{transform:translateX(5px)}}
#pop{position:fixed;inset:0;display:grid;place-items:center;background:rgba(8,1,26,.72);opacity:0;pointer-events:none;z-index:9}
#pop.on{opacity:1;pointer-events:auto}
#pop img{max-width:min(80vw,400px);max-height:80vh;border-radius:16px;box-shadow:0 0 70px rgba(255,95,216,.6);transform:scale(.7)}
#pop.on img{animation:pop .22s cubic-bezier(.3,1.5,.5,1) both}
@keyframes pop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}
</style></head>
<body>
<main class="card">
  <p class="brand">NEON AI</p>
  <h1>NEON AI has been NUKED</h1>
  <p class="sub">The whole site has been shut down. It will be back when it's turned on again.</p>
  <button class="btn" id="fairs" type="button">Fairs</button>
  <div class="or"><span>or enter the bypass code</span></div>
  <form id="bp" autocomplete="off"><input id="code" type="password" placeholder="Bypass code" aria-label="Bypass code" spellcheck="false" autocapitalize="none" maxlength="120"><button class="btn" id="go" type="submit">Enter</button></form>
  <div id="err" role="alert"></div>
</main>
<div id="pop" aria-hidden="true"><img id="pimg" alt=""></div>
<script>
(function(){
  var pop=document.getElementById("pop"),pimg=document.getElementById("pimg"),busy=false;
  var pre=new Image();pre.src="/_nuked/fairs.gif";           // load it ahead so it appears instantly
  document.getElementById("fairs").addEventListener("click",function(){
    if(busy)return;busy=true;pimg.src="/_nuked/fairs.gif";pop.classList.add("on");pop.setAttribute("aria-hidden","false");
    setTimeout(function(){pop.classList.remove("on");pop.setAttribute("aria-hidden","true");busy=false;},1000);   // gone after one second
  });
  var form=document.getElementById("bp"),code=document.getElementById("code"),err=document.getElementById("err");
  form.addEventListener("submit",function(e){
    e.preventDefault();err.textContent="";form.classList.remove("bad");
    if(!code.value){err.textContent="Enter the bypass code.";return;}
    fetch("/_nuked/bypass",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({code:code.value})})
      .then(function(r){return r.json().catch(function(){return{}}).then(function(j){return{ok:r.ok,j:j}})})
      .then(function(x){
        if(x.ok){location.reload();return;}
        err.textContent=x.j.error||"That's not the code.";void form.offsetWidth;form.classList.add("bad");code.select();
      }).catch(function(){err.textContent="Couldn't reach the server."});
  });
})();
</script>
</body></html>`;

const client = new Anthropic(); // reads ANTHROPIC_API_KEY
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
// the offline page's own helpers have to work while the site is off
app.get("/_nuked/fairs.gif", (req, res) => {
  if (!FAIRS_GIF) return res.status(404).end();
  res.set({ "Content-Type": "image/gif", "Cache-Control": "public, max-age=86400" }).send(FAIRS_GIF);
});
app.post("/_nuked/bypass", express.json({ limit: "2kb" }), (req, res) => {
  const o = req.get("origin");
  if (o) { try { if (new URL(o).host !== req.get("host")) return res.status(403).json({ error: "Bad origin" }); } catch { return res.status(403).json({ error: "Bad origin" }); } }
  if (!siteOff()) return res.json({ ok: true });
  if (!BYPASS_CODE) return res.status(403).json({ error: "There's no bypass code set." });
  if (limited("bp:" + req.ip, 8, 15 * 60e3)) return res.status(429).json({ error: "Too many tries. Wait a few minutes." });
  const a = crypto.createHash("sha256").update(String(req.body?.code || "")).digest(), b = crypto.createHash("sha256").update(BYPASS_CODE).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "That's not the code." });
  res.cookie(BYPASS_COOKIE, bypassToken(), { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: 12 * 60 * 60e3, path: "/" });
  res.json({ ok: true });
});
app.use((req, res, next) => {
  if (!siteOff() || hasBypass(req)) return next();
  res.status(503).set({ "Retry-After": "3600", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
  if (req.path.startsWith("/api")) return res.json({ error: "NEON AI has been NUKED." });
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
  res.json({ models: MODELS, defaultModel: DEFAULT_MODEL, plans: PLANS, freeTokens: FREE_GEMINI_TOKENS_PER_DAY, plusClaudeMsgs: PLUS_CLAUDE_MSGS_PER_DAY, paymentsLive: !!STRIPE_KEY && STRIPE_LIVE, hasKey: !!process.env.ANTHROPIC_API_KEY, signupGate: !SIGNUPS_OPEN, hasGemini: !!GEMINI_KEY, hasGoogle: !!(GOOGLE_ID && GOOGLE_SECRET), mailReady: MAIL_READY, legalVersion: LEGAL_VERSION, version: CHANGELOG[0]?.version || "1", changelog: CHANGELOG.slice(0, 6), defaultEffort: DEFAULT_EFFORT });
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
// ---------- the Riddle Gate: sign-ups are closed for now, behind 300 riddles ----------
// Set SIGNUPS_OPEN=1 in the environment to open sign-ups normally again. Riddles and answers stay on the server; the page only
// ever sees one riddle at a time, and its progress lives in the page's memory (a refresh starts again from 1).
const SIGNUPS_OPEN = process.env.SIGNUPS_OPEN === "1";
const gates = new Map(), passes = new Map();
setInterval(() => { const now = Date.now(); for (const [k, g] of gates) if (now - g.at > 2 * 3600e3) gates.delete(k); for (const [k, v] of passes) if (v.exp < now) passes.delete(k); }, 5 * 60e3).unref();
const gateOk = (req) => { const t = String(req.body?.pass || ""); const v = passes.get(t); return !!(v && v.exp > Date.now() && v.uses < 5 && v.ip === req.ip && (v.uses++, true)); };
const needGate = (req, res) => {
  if (SIGNUPS_OPEN || gateOk(req)) return false;
  res.status(403).json({ error: "Sign-ups are locked behind the Riddle Gate. Solve all 300 riddles to get in.", field: "riddle" });
  return true;
};
app.post("/api/riddle/start", small, wrap(async (req, res) => {
  if (SIGNUPS_OPEN) return res.json({ open: true });
  if (limited("rstart:" + req.ip, 30, 3600e3)) return res.status(429).json({ error: "Easy there. Too many attempts, try again later." });
  if (gates.size > 20000) return res.status(503).json({ error: "The gate is busy. Try again in a bit." });
  const id = crypto.randomBytes(16).toString("hex"), g = { seed: crypto.randomInt(1, 2 ** 31), i: 0, salt: 0, wrong: 0, at: Date.now(), last: 0, ip: req.ip };
  gates.set(id, g);
  res.json({ gate: id, i: 0, total: RIDDLES, q: publicRiddle(riddleAt(g.seed, 0, 0)) });
}));
app.post("/api/riddle/answer", small, wrap(async (req, res) => {
  const g = gates.get(String(req.body?.gate || ""));
  if (!g || g.ip !== req.ip) return res.status(404).json({ error: "This run has ended. Start again from riddle 1.", gone: true });
  if (limited("rans:" + req.ip, 400, 10 * 60e3)) return res.status(429).json({ error: "Slow down. You can't answer that quickly." });
  const now = Date.now(); if (now - g.last < 250) return res.status(429).json({ error: "Slow down. You can't answer that quickly." });
  g.last = now; g.at = now;
  const q = riddleAt(g.seed, g.i, g.salt);
  if (!isRight(q, req.body?.answer)) {
    g.wrong++;
    if (g.wrong >= 6) { g.wrong = 0; g.salt++; return res.json({ ok: false, changed: true, q: publicRiddle(riddleAt(g.seed, g.i, g.salt)), i: g.i }); }   // too many guesses: a new riddle takes its place
    return res.json({ ok: false, i: g.i, left: 6 - g.wrong });
  }
  g.i++; g.wrong = 0; g.salt = 0;
  if (g.i >= RIDDLES) {
    const pass = crypto.randomBytes(24).toString("hex"); passes.set(pass, { exp: now + 20 * 60e3, uses: 0, ip: req.ip }); gates.delete(String(req.body.gate));
    console.log("Riddle Gate: someone solved all", RIDDLES, "riddles");
    return res.json({ ok: true, done: true, pass, i: g.i });
  }
  res.json({ ok: true, i: g.i, q: publicRiddle(riddleAt(g.seed, g.i, 0)) });
}));

app.post("/api/signup/start", small, wrap(async (req, res) => {
  if (needGate(req, res)) return;
  if (limited("sstart:" + req.ip, 10, 60 * 60e3)) return res.status(429).json({ error: "Too many attempts. Try again later." });
  const bad = checkSignupFields(req.body || {});
  if (bad) return res.status(400).json(bad);
  if (req.body?.agree !== true) return res.status(400).json({ error: "Please agree to the Terms and Privacy Policy to continue.", field: "agree" });
  if (!MAIL_READY) return res.status(503).json({ error: "Email sign-up isn't available yet. Try Continue with Google instead.", field: "email" });
  const { username, password } = req.body, em = req.body.email.trim().toLowerCase();
  if (limited("smail:" + em, 5, 60 * 60e3)) return res.status(429).json({ error: "Too many codes sent to that email. Try again in an hour.", field: "email" });
  const { rows: dup } = await q("select username_lc = $1 as u, email_norm = $2 as e from users where username_lc = $1 or email_norm = $2", [username.toLowerCase(), normEmail(em)]);
  if (dup.some((r) => r.e)) return res.status(409).json({ error: "This email already has an account (email or Google). Please sign in instead.", field: "email" });
  if (dup.some((r) => r.u)) return res.status(409).json({ error: "That username is taken.", field: "username" });
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const hash = await bcrypt.hash(password, 11);
  await q(`insert into signup_pending(email,username,username_lc,pass_hash,code_hash,attempts,expires_at,sent_at,terms_version) values($1,$2,$3,$4,$5,0,$6,now(),$7)
           on conflict(email) do update set username=$2, username_lc=$3, pass_hash=$4, code_hash=$5, attempts=0, expires_at=$6, sent_at=now(), terms_version=$7`,
    [em, username, username.toLowerCase(), hash, codeHash(em, code), new Date(Date.now() + CODE_MS), LEGAL_VERSION]);
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
    ({ rows: [user] } = await q("insert into users(username,username_lc,pass_hash,email,email_norm,email_verified,terms_version,terms_at) values($1,$2,$3,$4,$5,true,$6,now()) returning id,username,settings,plan,plan_requested,has_password,avatar",
      [p.username, p.username_lc, p.pass_hash, em, normEmail(em), p.terms_version || LEGAL_VERSION]));
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
// A password typed before "Continue with Google" waits in the database for at most 10 minutes, encrypted. It is hashed only if a new account is actually created.
const sealKey = () => crypto.createHash("sha256").update("pending:" + GOOGLE_SECRET).digest();
function sealPw(pw) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", sealKey(), iv); const enc = Buffer.concat([c.update(pw, "utf8"), c.final()]); return "enc:" + Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64"); }
function openPw(v) { const b = Buffer.from(String(v).slice(4), "base64"), d = crypto.createDecipheriv("aes-256-gcm", sealKey(), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"); }
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
    if (needGate(req, res)) return;
    const bad = checkSignupFields({ username, password, email: "x@x.xx" });
    if (bad) return res.status(400).json(bad);
    if (req.body?.agree !== true) return res.status(400).json({ error: "Please agree to the Terms and Privacy Policy to continue.", field: "agree" });
    if ((await q("select 1 from users where username_lc = $1", [username.toLowerCase()])).rows[0]) return res.status(409).json({ error: "That username is taken.", field: "username" });
    name = username; hash = sealPw(password);
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
  else if (!pend.username) return authFail(res, "There's no NEON AI account for that Google account yet. Choose Create account first.");   // signing in never makes an account: that needs the sign-up form and the Terms
  else {
    // new account: the username they typed in the sign-up form (if it's still free), otherwise one made from their email
    const base = usernameFromEmail(email);
    const wanted = pend.username && !(await q("select 1 from users where username_lc = $1", [pend.username.toLowerCase()])).rows[0] ? pend.username : null;
    let hash;
    try { hash = pend.pass_hash ? await bcrypt.hash(openPw(pend.pass_hash), 11) : await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10); }   // no password typed: nobody knows this one, they use Google
    catch { return authFail(res, "Google sign-in expired. Please try again."); }
    for (let i = 0; i < 25 && !user; i++) {
      const name = i === 0 ? (wanted || base) : i === 1 && wanted ? base : base.slice(0, 19) + String(crypto.randomInt(10, 9999));
      try {
        user = (await q(`insert into users(username,username_lc,pass_hash,email,email_norm,email_verified,google_sub,has_password,avatar,terms_version,terms_at) values($1,$2,$3,$4,$5,true,$6,$7,$8,$9,now()) returning ${cols}`,
          [name, name.toLowerCase(), hash, email, enorm, sub, !!pend.pass_hash, pic, LEGAL_VERSION])).rows[0];
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

// Limits reset 12 hours after the FIRST use on an empty limit (a rolling window per user), not at midnight.
const WINDOW_MS = 12 * 3600e3;
async function todayUsage(userId) {
  const { rows } = await q("select gemini_tokens, claude_msgs, started_at from usage_window where user_id=$1 and started_at + interval '12 hours' > now()", [userId]);
  const r = rows[0];
  return { gemini: Number(r?.gemini_tokens || 0), claude: r?.claude_msgs || 0, resetAt: r ? new Date(r.started_at).getTime() + WINDOW_MS : null };
}
// adds usage; if the window ran out (or never started) this use starts a fresh 12-hour window
const addUsage = (userId, tokens, msgs) => q(`insert into usage_window(user_id, started_at, gemini_tokens, claude_msgs) values($1, now(), $2, $3)
  on conflict (user_id) do update set
    gemini_tokens = case when usage_window.started_at + interval '12 hours' <= now() then $2 else usage_window.gemini_tokens + $2 end,
    claude_msgs = case when usage_window.started_at + interval '12 hours' <= now() then $3 else usage_window.claude_msgs + $3 end,
    started_at = case when usage_window.started_at + interval '12 hours' <= now() then now() else usage_window.started_at end`, [userId, Math.max(0, Math.floor(tokens || 0)), msgs || 0]);
const resetIn = (at) => { const m = Math.max(1, Math.ceil(((at || Date.now() + WINDOW_MS) - Date.now()) / 60e3)); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
async function mePayload(u) {
  const extra = (await q("select email_norm, email_verified, plan_chosen, stripe_customer, stripe_status, plan_renews, plan_cancelling from users where id = $1", [u.id])).rows[0] || {};
  const dev = isDevRow(extra), plan = effectivePlan({ ...u, dev }), use = await todayUsage(u.id);
  return {
    user: { username: u.username, hasPassword: u.has_password !== false, picture: u.avatar || null, dev }, settings: u.settings,
    plan: { id: plan, requested: u.plan_requested && u.plan_requested !== plan ? u.plan_requested : null, owner: OWNERS.has(u.username.toLowerCase()), chosen: dev || !!extra.plan_chosen, usedTokens: use.gemini, usedClaude: use.claude, resetAt: use.resetAt },
    billing: { enabled: !!STRIPE_KEY && (STRIPE_LIVE || dev), test: !STRIPE_LIVE, customer: !!extra.stripe_customer, status: extra.stripe_status || null, renews: extra.plan_renews ? new Date(extra.plan_renews).getTime() : null, cancelling: !!extra.plan_cancelling },
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
  // use the database's own timestamp (not the app clock), so the value is identical after every restart and bypass passes stay valid
  const ins = await q("insert into site_state(key,set_at,set_by) values('nuked',now(),$1) on conflict(key) do update set set_at = now(), set_by = $1 returning set_at", [req.user.username]);
  nukedAt = new Date(ins.rows[0].set_at).getTime();
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

// Long replies: ask for the biggest output the model allows; if a reply still hits the limit, the server asks the model to carry on
// and stitches the parts together, so nothing is cut off.
const CONT_PROMPT = "Your previous reply was cut off by the output limit. Continue exactly where it stopped: no preface, no repetition, no apology. Start with the very next character.";
const MAX_CONTINUES = 4;
const learnedClaudeMax = new Map();   // model id -> output limit learned from an API error
const learnedGeminiMax = new Map();

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

const LEAK_RE = /^\s*(?:```(?:json)?\s*)?\{[^{}]*"search_queries"[^{}]*\}\s*(?:```\s*(?:userData|json|text)?\s*)?/i;
const FIRST_BYTE_MS = Number(process.env.GEMINI_FIRST_BYTE_MS) || 25000;   // how long a model may stay silent before the next one is tried
async function geminiStream({ model, history, system, effort, send, signal, final = true, st = {}, noTools = false }) {
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

  let sentText = false, tokens = 0, seg = "", maxOut = learnedGeminiMax.get(model) || 65536, useSearch = !noTools && !searchOff(model);
  const seenQ = new Set(); let seenSrc = 0;
  async function attemptRun(withThinking, sig, touch) {
    const generationConfig = { maxOutputTokens: maxOut };
    const th = withThinking ? geminiThinking(model, effort) : null;
    if (th) generationConfig.thinkingConfig = th;
    const r = await fetch(`${GEMINI_BASE}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: "POST", signal: sig,
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig, ...(useSearch ? { tools: [{ google_search: {} }] } : {}) }),
    });
    if (!r.ok) {
      let msg = ""; try { msg = (await r.json())?.error?.message || ""; } catch {}
      const e = new Error(msg || `Gemini error ${r.status}`); e.status = r.status; e.provider = "gemini"; e.hadThinking = !!th; throw e;
    }
    const dec = new TextDecoder(); let buf = "", finish = "", blocked = "", reqTotal = 0;
    // Some models write their own search request as text ({"search_queries": [...]} then a "userData" fence) before the real
    // answer. An answer that opens with "{" or a code fence is held back for a moment so that junk can be cut off.
    let hold = "", holding = null;
    const out = (t) => { if (!t) return; sentText = true; st.sent = true; seg += t; send({ t }); };
    const clean = (t) => t.replace(LEAK_RE, "");
    const gate = (t) => {
      if (holding === false) return out(t);
      hold += t;
      if (holding === null) { if (!/^\s*(\{|```)/.test(hold)) { holding = false; const h = hold; hold = ""; return out(h); } holding = true; }
      if (hold.length >= 600) { holding = false; const h = clean(hold); hold = ""; out(h); }
    };
    const flush = () => { if (holding === true && hold) { const h = clean(hold); hold = ""; holding = false; out(h); } };
    for await (const chunk of r.body) {
      touch(40000);
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        let j; try { j = JSON.parse(line.slice(5)); } catch { continue; }
        if (j.usageMetadata?.totalTokenCount) reqTotal = j.usageMetadata.totalTokenCount;
        if (j.promptFeedback?.blockReason) blocked = j.promptFeedback.blockReason;
        const cand = j.candidates?.[0];
        for (const p of cand?.content?.parts || []) {
          if (p.thought) { send({ th: 1 }); continue; }
          if (typeof p.text === "string" && p.text) gate(p.text);
        }
        const gm = cand?.groundingMetadata;
        if (gm) {
          for (const sq of gm.webSearchQueries || []) if (sq && !seenQ.has(sq)) { seenQ.add(sq); send({ act: { k: "search" } }); send({ act: { k: "query", q: String(sq).slice(0, 120) } }); }
          const web = webSrc((gm.groundingChunks || []).map((c) => c.web).filter(Boolean));
          if (web.length && web.length !== seenSrc) { seenSrc = web.length; send({ act: { k: "read", n: web.length } }); send({ src: web }); }
        }
        if (cand?.finishReason) finish = cand.finishReason;
      }
    }
    flush();
    tokens += reqTotal;                                   // each request is billed on its own (continuations re-send the earlier text)
    return { finish, blocked };
  }
  async function attempt(withThinking) {
    const ac = new AbortController(); let timer = setTimeout(() => ac.abort(), FIRST_BYTE_MS);
    const touch = (ms) => { clearTimeout(timer); timer = setTimeout(() => ac.abort(), ms); };
    try { return await attemptRun(withThinking, signal ? AbortSignal.any([signal, ac.signal]) : ac.signal, touch); }
    catch (e) { if (ac.signal.aborted && !signal?.aborted) throw Object.assign(new Error("Gemini took too long to answer."), { status: 504, provider: "gemini" }); throw e; }
    finally { clearTimeout(timer); }
  }
  // an output-size error means this model allows less than we asked for: remember the smaller number and retry
  async function attemptSafe(withThinking) {
    for (let k = 0; k < 3; k++) {
      try { return await attempt(withThinking); }
      catch (e) {
        if (useSearch && !sentText && e.status >= 400 && e.status < 500 && e.status !== 401 && /search|ground|tool|quota|exhaust/i.test(e.message)) { useSearch = false; markNoSearch(model); continue; }   // search not available: carry on without it
        if (e.status === 400 && !sentText && /max.?output.?tokens|output token|out of range|exceeds?/i.test(e.message) && !/api key/i.test(e.message) && maxOut > 8192) { maxOut = maxOut > 40000 ? 32000 : Math.floor(maxOut / 2); learnedGeminiMax.set(model, maxOut); continue; }
        throw e;
      }
    }
    return attempt(withThinking);
  }
  let res1;
  try { res1 = await attemptSafe(true); }
  catch (e) {
    // some models reject thinking settings: retry once without them
    if (e.status === 400 && e.hadThinking && !sentText && !/api key/i.test(e.message)) res1 = await attemptSafe(false); else throw e;
  }
  // hit the output limit: keep going automatically (no thinking this time, so everything goes into the answer)
  for (let n = 0; n < MAX_CONTINUES && res1.finish === "MAX_TOKENS" && seg.trim(); n++) {
    contents.push({ role: "model", parts: [{ text: seg }] }, { role: "user", parts: [{ text: CONT_PROMPT }] });
    seg = "";
    res1 = await attemptSafe(false);
  }
  if (res1.blocked) send({ t: "\n\n*(Gemini blocked this request.)*" });
  else if (res1.finish === "MAX_TOKENS") send({ t: "\n\n*(Reached max length.)*" });
  else if (res1.finish === "SAFETY" || res1.finish === "PROHIBITED_CONTENT") send({ t: "\n\n*(Gemini declined to answer this request.)*" });
  else if (!sentText) { if (!final) { st.empty = true; return tokens; } send({ t: "*(Gemini returned an empty response. Try again or pick another model.)*" }); }
  return tokens;
}

// Some models (Flash-Lite) answer nothing when they search for themselves. For those, a search-capable model does the
// searching and writes short research notes (with sources), and the chosen model writes the answer from them.
const RESEARCH_MODELS = ["gemini-2.5-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"];
const viaHelper = new Map();                                        // model id -> time until which it uses the helper
const usesHelper = (id) => /lite/i.test(id) || (viaHelper.get(id) || 0) > Date.now();   // Lite models do not search well on their own
const needsWeb = (t) => /\b(latest|newest|recent|recently|today|tonight|yesterday|tomorrow|this (week|month|year|season)|right now|currently|current|news|releases?d?|out yet|launch(ed)?|prices?|cost of|how much|scores?|won|winner|wins|standings|rank(ed|ing|ings)?|rated|ratings?|reviews?|best|top \d+|weather|forecast|stocks?|crypto|bitcoin|exchange rate|versions?|updates?d?|202[5-9]|who is the|what happened|search|google|look ?up|online|internet|web)\b/i.test(String(t || ""));
async function geminiResearch({ history, send, signal }) {
  const out = { notes: "", tokens: 0 };
  const rm = RESEARCH_MODELS.find((id) => MODELS.some((m) => m.id === id));
  if (!rm) return out;
  const talk = history.slice(-6).map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${String(m.text || "").slice(0, 1500)}`).join("\n");
  const system = `You are a research assistant with web search. Today is ${new Date().toISOString().slice(0, 10)} (UTC). Read the conversation and search the web for anything in the user's latest message that depends on recent or changing facts (news, releases, prices, scores, versions, reviews). Reply with concise research notes (at most 350 words): the key facts with dates and numbers, and the names of the sources. If the latest message needs no web search at all (chit-chat, maths, coding, creative writing, general knowledge that does not change), reply with exactly NO_SEARCH.`;
  try {
    send({ act: { k: "search" } });                                   // shows "Searching the web" while the helper works
    const r = await fetch(`${GEMINI_BASE}/v1beta/models/${encodeURIComponent(rm)}:generateContent`, {
      method: "POST", signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: talk }] }], tools: [{ google_search: {} }], generationConfig: { maxOutputTokens: 1200, temperature: 0.2 } }),
    });
    if (!r.ok) return out;
    const j = await r.json(), cand = j.candidates?.[0];
    out.tokens = j.usageMetadata?.totalTokenCount || 0;
    const text = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("").trim();
    if (!text || /^NO_SEARCH\b/.test(text)) return out;
    out.notes = text.slice(0, 4000);
    const gm = cand?.groundingMetadata;
    for (const sq of gm?.webSearchQueries || []) send({ act: { k: "query", q: String(sq).slice(0, 120) } });
    const web = webSrc((gm?.groundingChunks || []).map((c) => c.web).filter(Boolean));
    if (web.length) { send({ act: { k: "read", n: web.length } }); send({ src: web }); }
  } catch (e) { if (e?.name === "AbortError" && signal?.aborted) throw e; }
  return out;
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
  const system = (String(req.user.settings?.system || "").trim().slice(0, 4000) || SYSTEM) + "\n\n" + liveRules() + "\n\n" + MATH_RULES + "\n\n" + FILE_RULES;

  const plan = effectivePlan(req.user);
  const use = await todayUsage(req.user.id);
  let block = "";
  if (info.provider === "gemini") {
    if (plan === "free" && use.gemini >= FREE_GEMINI_TOKENS_PER_DAY) block = `You've used your ${FREE_GEMINI_TOKENS_PER_DAY.toLocaleString()} free Gemini tokens. They reset in ${resetIn(use.resetAt)}. Upgrade to Spark for unlimited Gemini.`;
  } else if (!claudeAllowed(plan, info.id)) {
    block = plan === "plus" ? "Opus is included with the Max plan. Pick Sonnet or Haiku, or upgrade to Max."
      : "Claude models are part of the Plus and Max plans. Pick a Gemini model, or upgrade your plan.";
  } else if (plan === "plus" && use.claude >= PLUS_CLAUDE_MSGS_PER_DAY) {
    block = `You've used your ${PLUS_CLAUDE_MSGS_PER_DAY} Claude messages on Plus. They reset in ${resetIn(use.resetAt)}. Use Gemini (unlimited), or upgrade to Max for unlimited Claude.`;
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
      // if a model fails or answers with nothing, try the others in turn: 3.5 Flash-Lite, 2.5 Flash, 3.6 Flash.
      // A model that answers nothing when it searches by itself gets its web results from a research helper instead.
      const chain = [info.id, ...["gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-3.6-flash"].filter((id) => id !== info.id && MODELS.some((m) => m.id === id))];
      let used = 0, ok = false, lastErr = null;
      const lastUser = [...history].reverse().find((m) => m.role === "user")?.text || "";
      let research = null;                                           // made at most once per message, then reused by every model tried
      const tryModel = async (id, helper) => {
        const st = {};
        try {
          let sys = system;
          if (helper && needsWeb(lastUser)) {
            if (!research) { research = await geminiResearch({ history, send, signal: ctl.signal }); used += research.tokens; }
            if (research.notes) sys += "\n\nWEB RESEARCH (fresh results from a live web search made just now; rely on them over your memory, and mention the source names naturally):\n" + research.notes;
          }
          used += await geminiStream({ model: id, history, system: sys, effort, send, signal: ctl.signal, final: false, st, noTools: helper });
        } catch (e) { e.sent = !!st.sent; throw e; }
        return st;
      };
      for (let i = 0; i < chain.length && !ok; i++) {
        try {
          if (i > 0) { const nm = (MODELS.find((m) => m.id === chain[i])?.name || chain[i]).split("·")[0].trim(); send({ switched: { to: chain[i], name: nm } }); }
          let st = await tryModel(chain[i], usesHelper(chain[i]));
          if (st.empty && !usesHelper(chain[i])) { viaHelper.set(chain[i], Date.now() + 30 * 60e3); st = await tryModel(chain[i], true); }
          if (!st.empty) ok = true; else lastErr = Object.assign(new Error("empty"), { status: 200, provider: "gemini" });
        } catch (e) {
          if (e?.name === "AbortError" || ctl.signal.aborted) throw e;
          if (e.sent || e.status === 401 || e.status === 403 || (e.status === 400 && /api key/i.test(String(e.message)))) throw e;   // half an answer is out already, or the key itself is the problem
          lastErr = e;
        }
      }
      if (!ok) { send({ down: lastErr?.status === 429 ? "limit" : "down" }); console.warn("Gemini fallbacks all failed:", lastErr?.status, String(lastErr?.message || "").slice(0, 160)); }
      if (used > 0) addUsage(req.user.id, used, 0).catch(() => {});
      send({ done: true, tokens: use.gemini + (used || 0), reset: use.resetAt || (used > 0 ? Date.now() + WINDOW_MS : null) });
    } else {
      const cfg = CLAUDE_THINK[effort];
      let gotText = false, acc = "";
      const run = async (thinking, extra) => {
        const cap = learnedClaudeMax.get(info.id) || 64000;                    // the biggest reply the model will give
        const budget = Math.min(cfg.budget, Math.max(1024, cap - 4000));        // thinking has to fit under the cap with room left to answer
        stream = client.messages.stream({
          model: info.id,
          max_tokens: cap,
          system,
          ...(thinking ? { thinking: { type: "enabled", budget_tokens: budget } } : {}),
          ...(searchOff(info.id) ? {} : { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }] }),
          messages: [...history.map((m) => ({ role: m.role, content: toContent(m) })), ...extra],
        });
        stream.on("text", (t) => { gotText = true; acc += t; send({ t }); });
        const tb = {};
        stream.on("streamEvent", (e) => {
          const b = e.content_block;
          if (e.type === "content_block_start") {
            if (b?.type === "thinking") send({ th: 1 });
            else if (b?.type === "server_tool_use") { tb[e.index] = ""; send({ act: { k: "search" } }); }
            else if (b?.type === "web_search_tool_result") { const rs = webSrc(Array.isArray(b.content) ? b.content.filter((x) => x.type === "web_search_result") : []); if (rs.length) { send({ act: { k: "read", n: rs.length } }); send({ src: rs }); } }
          } else if (e.type === "content_block_delta" && tb[e.index] !== undefined && e.delta?.type === "input_json_delta") tb[e.index] += e.delta.partial_json || "";
          else if (e.type === "content_block_stop" && tb[e.index] !== undefined) { let sq = ""; try { sq = JSON.parse(tb[e.index] || "{}").query || ""; } catch {} delete tb[e.index]; if (sq) send({ act: { k: "query", q: String(sq).slice(0, 120) } }); }
        });
        return stream.finalMessage();
      };
      // if the API says the model allows fewer output tokens than we asked for, remember its number and go again
      const runSafe = async (thinking, extra) => {
        for (let k = 0; k < 3; k++) {
          try { return await run(thinking, extra); }
          catch (e) {
            const msg = String(e?.message || "");
            if (e?.status === 400 && !gotText && /max_tokens/i.test(msg) && !/thinking|budget_tokens/i.test(msg.replace(/max_tokens/gi, ""))) {
              const m = msg.match(/max_tokens:\s*\d+\s*>\s*(\d+)/), cur = learnedClaudeMax.get(info.id) || 64000;
              learnedClaudeMax.set(info.id, m ? Number(m[1]) : Math.max(8000, Math.floor(cur / 2)));
              continue;
            }
            throw e;
          }
        }
        return run(thinking, extra);
      };
      let final;
      const toolErr = (e) => e?.status === 400 && /web.?search|tool/i.test(String(e?.message || ""));
      const attemptAll = async () => {
        try { return await runSafe(cfg.budget > 0, []); }
        catch (e) {
          // if the model rejects the thinking settings, retry once without them
          if (cfg.budget > 0 && e?.status === 400 && !gotText && !res.writableEnded && !toolErr(e)) return runSafe(false, []);
          throw e;
        }
      };
      try { final = await attemptAll(); }
      catch (e) { if (toolErr(e) && !gotText && !searchOff(info.id)) { markNoSearch(info.id); final = await attemptAll(); } else throw e; }
      // a long web search can pause the turn: hand the work back so the model carries on
      for (let n = 0; n < 4 && final.stop_reason === "pause_turn"; n++) final = await runSafe(false, [{ role: "assistant", content: final.content }]);
      // hit the output limit: carry on automatically and stitch the parts together (no thinking, so all of it goes into the answer)
      for (let n = 0; n < MAX_CONTINUES && final.stop_reason === "max_tokens" && acc.trim(); n++) {
        final = await runSafe(false, [{ role: "assistant", content: acc.replace(/\s+$/, "") }, { role: "user", content: CONT_PROMPT }]);
      }
      if (final.stop_reason === "refusal") send({ t: "\n\n*(The model declined to answer this request.)*" });
      if (final.stop_reason === "max_tokens") send({ t: "\n\n*(Reached max length.)*" });
      addUsage(req.user.id, 0, 1).catch(() => {});
      send({ done: true, usage: final.usage, reset: use.resetAt || Date.now() + WINDOW_MS });
    }
  } catch (err) {
    if (err?.name !== "AbortError" && !res.writableEnded) send({ error: friendlyError(err) });
  }
  res.end();
});


// ---------- chess bot chat (/chess): Gemini plays a "person" in the chat beside the board ----------
const CHESS_MODEL = process.env.CHESS_MODEL || "gemini-3.5-flash-lite";
async function geminiOnce({ model, system, user, maxOut = 256, temperature = 0.95 }) {
  const gc = { maxOutputTokens: maxOut, temperature }, th = geminiThinking(model, 0);
  const call = async (withTh) => {
    const r = await fetch(`${GEMINI_BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", signal: AbortSignal.timeout(25000),
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: withTh && th ? { ...gc, thinkingConfig: th } : gc }),
    });
    if (!r.ok) { let msg = ""; try { msg = (await r.json())?.error?.message || ""; } catch {} const e = new Error(`${r.status} ${msg}`.slice(0, 200)); e.status = r.status; throw e; }
    const j = await r.json();
    return { text: (j.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join(""), tokens: j.usageMetadata?.totalTokenCount || 0 };
  };
  try { return await call(true); } catch (e) { if (e.status === 400) return await call(false); throw e; }
}
const clip = (v, n) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const CHESS_EVENTS = {
  start: "The game is just starting. Say a short hello / opening line to your opponent.",
  user_move: "Your opponent just moved. React briefly to what happened on the board, the way you would while playing.",
  bot_move: "You just made your move. Say something short about it or about the position.",
  user_message: "Your opponent wrote you a message in the chat. Reply to it.",
  game_over: "The game just ended. Say something fitting about the result.",
};
app.post("/api/chess/talk", requireAuth, small, wrap(async (req, res) => {
  if (!GEMINI_KEY) return res.json({ text: "", unavailable: true });
  if (limited("chess:" + req.user.id, 40, 60e3)) return res.status(429).json({ error: "The bot needs a moment. Try again shortly." });
  const plan = effectivePlan(req.user), use = await todayUsage(req.user.id);
  if (plan === "free" && use.gemini >= FREE_GEMINI_TOKENS_PER_DAY) return res.json({ text: "", limited: true });
  const b = req.body || {}, event = CHESS_EVENTS[b.event] ? b.event : "user_message";
  const name = clip(b.name, 24) || "Alex", elo = Math.max(100, Math.min(2000, Number(b.elo) || 1000)), persona = clip(b.personality, 400) || "A friendly, relaxed chess player.";
  const botColor = b.botColor === "b" ? "Black" : "White";
  const moves = (Array.isArray(b.moves) ? b.moves : []).slice(-24).map((m) => clip(m, 10)).filter(Boolean);
  const flags = b.flags && typeof b.flags === "object" ? b.flags : {};
  const notes = [];
  if (flags.capture) notes.push("a piece was just captured");
  if (flags.check) notes.push("the last move gave check");
  if (flags.blunder) notes.push("your opponent's last move looks like a real mistake");
  if (flags.great) notes.push("your opponent's last move was impressive");
  if (flags.result) notes.push("result: " + clip(flags.result, 60));
  const chatLog = (Array.isArray(b.log) ? b.log : []).slice(-8).map((x) => `${x && x.f === "you" ? "Opponent" : name}: ${clip(x && x.t, 200)}`).join("\n");
  const system = `You are ${name}, a real person sitting across the board from the user in a game of chess, chatting while you play. Your chess strength is about ${elo} (chess.com-style rating), so talk like someone at that level: a beginner does not use engine or master-level jargon.
Your personality: ${persona}
Rules: reply with ONE or TWO short sentences (under 30 words) of casual chat, the way a person types, and nothing else: no quotation marks, no stage directions, no names in front. Stay in character. Light teasing is fine, but keep it friendly enough for all ages: no slurs, no cruelty, nothing sexual, no threats. Do not give the opponent move suggestions or analysis, and do not mention numbers like evaluations. Never claim you are definitely human if the user sincerely asks whether you are an AI or a bot: then say honestly, in a light way, that you are a chess bot with a personality.`;
  const user = `You are playing ${botColor}. Recent moves: ${moves.join(" ") || "(none yet)"}.${notes.length ? "\nNotes: " + notes.join("; ") + "." : ""}${chatLog ? "\nRecent chat:\n" + chatLog : ""}\n${event === "user_message" ? `Opponent says: ${clip(b.text, 300)}\n` : ""}Situation: ${CHESS_EVENTS[event]}\nWrite your chat message now.`;
  let out;
  try { out = await geminiOnce({ model: CHESS_MODEL, system, user }); }
  catch (e) { console.error("chess talk failed:", e.message); return res.json({ text: "", unavailable: true }); }
  if (out.tokens > 0) addUsage(req.user.id, out.tokens, 0).catch(() => {});
  const text = clip(out.text.replace(/^["'“”]+|["'“”]+$/g, "").replace(new RegExp("^" + name + "\\s*:\\s*", "i"), ""), 280);
  res.json({ text });
}));

// ---------- billing with Stripe ----------
// Plans are Stripe subscriptions. The prices are found by lookup key (so no price IDs to copy around). A signed webhook
// is what switches a plan on or off; the browser coming back from Checkout never decides anything.
const PLAN_LOOKUP = { spark: "neon_spark_monthly", plus: "neon_plus_monthly", max: "neon_max_monthly" };
const stripeEnc = (o, pre = "", out = []) => {
  for (const [k, v] of Object.entries(o)) {
    if (v == null) continue;
    const key = pre ? `${pre}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (x && typeof x === "object" ? stripeEnc(x, `${key}[${i}]`, out) : out.push([`${key}[${i}]`, x])));
    else if (typeof v === "object") stripeEnc(v, key, out);
    else out.push([key, v]);
  }
  return out;
};
async function stripeApi(method, route, body, idem) {
  if (!STRIPE_KEY) throw Object.assign(new Error("Payments aren't set up yet."), { status: 503 });
  const r = await fetch("https://api.stripe.com/v1" + route, {
    method, signal: AbortSignal.timeout(20000),
    headers: { Authorization: "Bearer " + STRIPE_KEY, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}), ...(idem ? { "Idempotency-Key": idem } : {}) },
    body: body ? stripeEnc(body).map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&") : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error?.message || `Stripe error ${r.status}`); e.status = r.status; e.stripe = j.error; throw e; }
  return j;
}
const priceCache = new Map();
async function stripePrice(planId) {
  const hit = priceCache.get(planId);
  if (hit && hit.at > Date.now() - 10 * 60e3) return hit.id;
  const j = await stripeApi("GET", `/prices?lookup_keys[]=${encodeURIComponent(PLAN_LOOKUP[planId])}&active=true&limit=1`);
  const id = j.data?.[0]?.id;
  if (!id) throw Object.assign(new Error("That plan isn't set up in Stripe yet."), { status: 503 });
  priceCache.set(planId, { id, at: Date.now() });
  return id;
}
const publicBase = (req) => process.env.PUBLIC_URL || `${/^(localhost|127\.)/.test(req.get("host") || "") ? "http" : "https"}://${req.get("host")}`;
const billingOn = (u) => !!STRIPE_KEY && (STRIPE_LIVE || u.dev);          // while Stripe is in test mode only dev accounts see real checkout

// turns a Stripe subscription into the user's plan: active (or being retried after a failed payment) keeps it, anything else is Free
async function applySubscription(sub, fallbackUserId) {
  const key = sub.items?.data?.[0]?.price?.lookup_key;
  const planId = Object.keys(PLAN_LOOKUP).find((k) => PLAN_LOOKUP[k] === key);
  const entitled = ["active", "trialing", "past_due"].includes(sub.status) && !!planId;
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  let uid = Number(sub.metadata?.user_id) || Number(fallbackUserId) || 0;
  if (!uid && customer) uid = (await q("select id from users where stripe_customer = $1", [customer])).rows[0]?.id || 0;
  if (!uid) { console.warn("Stripe subscription with no matching user:", sub.id); return; }
  const end = sub.items?.data?.[0]?.current_period_end || sub.current_period_end;
  await q(`update users set plan = $2, plan_requested = case when $2 = 'free' then plan_requested else null end, stripe_customer = coalesce($3, stripe_customer), stripe_sub = $4, stripe_status = $5,
           plan_renews = case when $6::bigint is null then null else to_timestamp($6::bigint) end, plan_cancelling = $7, plan_chosen = true where id = $1`,
    [uid, entitled ? planId : "free", customer || null, sub.id, sub.status, end || null, !!(sub.cancel_at_period_end || sub.cancel_at)]);
  console.log(`Stripe: user ${uid} is now on ${entitled ? planId : "free"} (${sub.status})`);
}

app.post("/api/billing/checkout", requireAuth, small, wrap(async (req, res) => {
  if (!billingOn(req.user)) return res.status(403).json({ error: STRIPE_KEY ? "Payments are in test mode for now." : "Payments aren't open yet." });
  const planId = req.body?.plan;
  if (!PLAN_LOOKUP[planId]) return res.status(400).json({ error: "Unknown plan." });
  if (limited("billing:" + req.user.id, 10, 60e3)) return res.status(429).json({ error: "Too many attempts. Try again in a minute." });
  const u = (await q("select id, email, email_verified, stripe_customer, stripe_sub, stripe_status from users where id = $1", [req.user.id])).rows[0];
  const base = publicBase(req);
  // someone who already pays changes plan (or cancels) in Stripe's customer portal instead of getting a second subscription
  if (u.stripe_customer && ["active", "trialing", "past_due"].includes(u.stripe_status)) return res.json({ url: await portalUrl(u.stripe_customer, base) });
  const price = await stripePrice(planId);
  const session = await stripeApi("POST", "/checkout/sessions", {
    mode: "subscription", line_items: [{ price, quantity: 1 }],
    success_url: base + "/?billing=success", cancel_url: base + "/?billing=cancel",
    client_reference_id: String(u.id), allow_promotion_codes: "true",
    ...(u.stripe_customer ? { customer: u.stripe_customer } : u.email && u.email_verified ? { customer_email: u.email } : {}),
    metadata: { user_id: String(u.id), plan: planId }, subscription_data: { metadata: { user_id: String(u.id), plan: planId }, billing_mode: { type: "flexible" } },
  }, `checkout-${u.id}-${planId}-${Math.floor(Date.now() / 60e3)}`);
  res.json({ url: session.url });
}));

let portalConfigId = process.env.STRIPE_PORTAL_CONFIG || "";
async function portalConfig() {
  if (portalConfigId) return portalConfigId;
  const prices = await Promise.all(Object.keys(PLAN_LOOKUP).map(stripePrice));
  const products = [];
  for (const pr of prices) { const j = await stripeApi("GET", `/prices/${pr}`); products.push({ product: j.product, prices: [pr] }); }
  const c = await stripeApi("POST", "/billing_portal/configurations", {
    business_profile: { headline: "Manage your NEON AI plan" },
    features: {
      customer_update: { enabled: true, allowed_updates: ["email", "name"] },
      invoice_history: { enabled: true }, payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      subscription_update: { enabled: true, default_allowed_updates: ["price"], proration_behavior: "create_prorations", products },
    },
  });
  portalConfigId = c.id; console.log("Stripe portal configuration created:", c.id, "(set STRIPE_PORTAL_CONFIG to reuse it)");
  return portalConfigId;
}
async function portalUrl(customer, base) {
  const ps = await stripeApi("POST", "/billing_portal/sessions", { customer, return_url: base + "/", configuration: await portalConfig() });
  return ps.url;
}
app.post("/api/billing/portal", requireAuth, small, wrap(async (req, res) => {
  if (!STRIPE_KEY) return res.status(503).json({ error: "Payments aren't set up yet." });
  const u = (await q("select stripe_customer from users where id = $1", [req.user.id])).rows[0];
  if (!u?.stripe_customer) return res.status(400).json({ error: "You don't have a subscription to manage." });
  res.json({ url: await portalUrl(u.stripe_customer, publicBase(req)) });
}));

// Stripe -> us. The body must stay raw so the signature can be checked.
function verifyStripe(raw, header, secret) {
  const parts = Object.fromEntries(String(header || "").split(",").map((x) => x.trim().split("=")).filter((x) => x.length === 2).map(([k, v]) => [k, v]));
  const sigs = String(header || "").split(",").map((x) => x.trim()).filter((x) => x.startsWith("v1=")).map((x) => x.slice(3));
  if (!parts.t || !sigs.length || Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  const want = crypto.createHmac("sha256", secret).update(`${parts.t}.`).update(raw).digest("hex");
  return sigs.some((g) => g.length === want.length && crypto.timingSafeEqual(Buffer.from(g), Buffer.from(want)));
}
app.post("/api/stripe/webhook", express.raw({ type: () => true, limit: "1mb" }), wrap(async (req, res) => {
  if (!STRIPE_WH) return res.status(503).json({ error: "Webhook secret not set" });
  if (!Buffer.isBuffer(req.body) || !verifyStripe(req.body, req.get("stripe-signature"), STRIPE_WH)) return res.status(400).json({ error: "Bad signature" });
  let ev; try { ev = JSON.parse(req.body.toString("utf8")); } catch { return res.status(400).json({ error: "Bad payload" }); }
  const obj = ev.data?.object || {};
  if (ev.type === "checkout.session.completed" && obj.mode === "subscription" && obj.subscription) {
    await applySubscription(await stripeApi("GET", `/subscriptions/${obj.subscription}?expand[]=items.data.price`), obj.client_reference_id);
  } else if (/^customer\.subscription\.(created|updated|deleted)$/.test(ev.type) && obj.id) {
    // fetch the current state instead of trusting the order events arrive in
    let sub = obj; try { sub = await stripeApi("GET", `/subscriptions/${obj.id}`); } catch (e) { if (ev.type !== "customer.subscription.deleted") throw e; }
    await applySubscription(sub);
  } else if (ev.type === "invoice.paid") {
    const subId = typeof obj.subscription === "string" ? obj.subscription : obj.subscription?.id || obj.parent?.subscription_details?.subscription;
    if (subId) await applySubscription(await stripeApi("GET", `/subscriptions/${subId}`));
  } else if (ev.type === "invoice.payment_failed") {
    console.warn("Stripe: a payment failed for customer", obj.customer);
  }
  res.json({ received: true });
}));

// ---------- trading practice (/larp): Gemini writes the market-day stories, reviews sessions and answers questions ----------
const LARP_KINDS = {
  trend: "a steady uptrend with pullbacks (the alert is mildly positive news)",
  range: "a choppy sideways day with no real news (the alert is meaningless noise or an unconfirmed rumour)",
  runner: "a tiny stock that gaps up on hype and huge volume, then fades (the alert is exciting-sounding but hollow news)",
  breakdown: "a quiet morning, then the price breaks down on bad news (the alert is the bad news)",
  vshape: "an early sell-off that flushes out, then recovers (the alert is that buyers are stepping in)",
};
const LARP_RULES = `Everything in this game is SIMULATED: made-up companies, random prices, fake money. You teach beginners. Never give real financial advice, never recommend real stocks, crypto or brokers, and never promise profits. Keep it friendly and suitable for all ages.`;
app.post("/api/larp/ai", requireAuth, small, wrap(async (req, res) => {
  if (!GEMINI_KEY) return res.json({ text: "", unavailable: true });
  if (limited("larp:" + req.user.id, 30, 60e3)) return res.status(429).json({ error: "The coach needs a moment. Try again shortly." });
  const plan = effectivePlan(req.user), use = await todayUsage(req.user.id);
  if (plan === "free" && use.gemini >= FREE_GEMINI_TOKENS_PER_DAY) return res.json({ text: "", limited: true });
  const b = req.body || {}, mode = ["scenario", "coach", "ask"].includes(b.mode) ? b.mode : "ask";
  let system, user, maxOut = 300;
  if (mode === "scenario") {
    const kind = LARP_KINDS[b.kind] ? b.kind : "range";
    system = `You write fictional stock-market scenarios for a trading practice game. ${LARP_RULES}
Reply with ONLY a JSON object, no markdown, with these string fields: "ticker" (3 to 4 capital letters, an invented symbol), "company" (an invented funny or plausible company name, under 28 characters), "headline" (a pre-market news line, under 95 characters, that sets the mood but does NOT reveal what the price will do), "alert" (a mid-day breaking-news line, under 95 characters, that fits the situation below).`;
    user = `Today's situation: ${LARP_KINDS[b.kind] || LARP_KINDS.range}. Random inspiration number: ${Number(b.seed) % 997 || 1}. Write the JSON now.`;
    maxOut = 220;
  } else if (mode === "coach") {
    const st = b.stats && typeof b.stats === "object" ? b.stats : {};
    const trades = (Array.isArray(b.trades) ? b.trades : []).slice(0, 12).map((t) => `${clip(t && t.side, 6)} ${Number(t && t.pnl) || 0}$ ${Number(t && t.mins) || 0}min${t && t.stopped ? " stop" : ""}`).join("; ");
    system = `You are a warm, honest trading coach reviewing a beginner's practice session. ${LARP_RULES}
Write 4 to 6 short sentences in plain language (no markdown headings, no lists): one thing they did well, the single biggest mistake or habit to fix, and one concrete thing to try next session. Mention the kind of market day and what it teaches. Be encouraging, not preachy. Reference risk management (stop-loss, size, reward-to-risk) where it fits.`;
    user = `Market day: ${LARP_KINDS[b.kind] || "unknown"}. Company: ${clip(b.company, 40)}. Result: P&L ${Number(st.pnl) || 0}$ (${Number(st.pct) || 0}%), ${Number(st.trades) || 0} trades, win rate ${Number(st.winRate) || 0}%, average win ${Number(st.avgWin) || 0}$, average loss ${Number(st.avgLoss) || 0}$. Detected mistakes: ${(Array.isArray(b.mistakes) ? b.mistakes : []).slice(0, 6).map((x) => clip(x, 16)).join(", ") || "none"}. Trades: ${trades || "none"}.`;
    maxOut = 420;
  } else {
    system = `You are the friendly coach inside a trading practice simulator, talking to a complete beginner. ${LARP_RULES}
Answer in at most 90 words, in simple words, defining any jargon. If the question is unrelated to trading, markets, money habits or this game, politely steer back. Use the game's context if given, but you can't see the future prices, so never predict what the price will do next.`;
    const hist = (Array.isArray(b.history) ? b.history : []).slice(-6).map((x) => `${x && x.f === "you" ? "Student" : "Coach"}: ${clip(x && x.t, 300)}`).join("\n");
    const ctx = [b.tutorial ? `The student is on the tutorial lesson "${clip(b.tutorial, 60)}".` : "", Number(b.price) > 0 ? `Current price ${Number(b.price).toFixed(2)}.` : "", Number(b.qty) ? `They hold ${Number(b.qty) > 0 ? "a long" : "a short"} position of ${Math.abs(Math.floor(Number(b.qty)))} shares${Number(b.avg) > 0 ? " at " + Number(b.avg).toFixed(2) : ""}.` : "They have no open position."].filter(Boolean).join(" ");
    user = `${ctx}\n${hist ? "Recent chat:\n" + hist + "\n" : ""}Student asks: ${clip(b.q, 240)}\nAnswer now.`;
    maxOut = 260;
  }
  let out;
  try { out = await geminiOnce({ model: CHESS_MODEL, system, user, maxOut, temperature: mode === "scenario" ? 1 : 0.7 }); }
  catch (e) { console.error("larp ai failed:", e.message); return res.json({ text: "", unavailable: true }); }
  if (out.tokens > 0) addUsage(req.user.id, out.tokens, 0).catch(() => {});
  if (mode === "scenario") {
    let j = null; try { const m = out.text.match(/\{[\s\S]*\}/); j = m && JSON.parse(m[0]); } catch {}
    const tk = String(j && j.ticker || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
    if (!j || tk.length < 3 || !clip(j.company, 28) || !clip(j.headline, 100)) return res.json({ text: "", unavailable: true });
    return res.json({ flavor: { ticker: tk, company: clip(j.company, 28), headline: clip(j.headline, 100), alert: clip(j.alert, 100) || "Breaking: unusual activity in the stock" } });
  }
  res.json({ text: out.text.replace(/\*\*/g, "").trim().slice(0, mode === "coach" ? 900 : 700) });
}));

// ---------- public Terms / Privacy pages (also what Google's sign-in setup asks for) ----------
const legalPage = (doc) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${doc === "terms" ? "Terms of Service" : "Privacy Policy"} · NEON AI</title>
<style>*{box-sizing:border-box}html{background:#12062b}body{margin:0;padding:28px 16px 60px;font:16px/1.65 Inter,system-ui,"Segoe UI",Roboto,Arial,sans-serif;color:#f2e6ff;background:radial-gradient(900px 500px at 50% -5%,rgba(255,95,216,.25),transparent 70%),#12062b}
.wrap{max-width:780px;margin:0 auto}.top{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:18px}.brand{font-weight:800;letter-spacing:.32em;color:#ff8ae2;text-decoration:none;font-size:15px}
nav a{color:#c9b4e8;text-decoration:none;margin-left:16px;font-size:14px}nav a.on,nav a:hover{color:#3df0ff}
article{padding:34px 36px;border-radius:20px;background:rgba(40,16,78,.6);border:1px solid rgba(255,160,240,.28);box-shadow:0 30px 80px rgba(8,1,26,.6)}
h1{margin:0 0 4px;font-size:30px;background:linear-gradient(90deg,#ff5fd8,#3df0ff);-webkit-background-clip:text;background-clip:text;color:transparent}.meta{margin:0 0 20px;color:#a994cc;font-size:13px}
h2{margin:30px 0 8px;font-size:19px;color:#fff}h3{margin:18px 0 6px;font-size:15px;color:#e5d4ff}p,li{color:#dccdf2}ul,ol{padding-left:22px}li{margin:5px 0}a{color:#3df0ff}b{color:#fff}
.legal-sum{margin:6px 0 10px;padding:16px 18px;border-radius:14px;background:rgba(61,240,255,.07);border:1px solid rgba(61,240,255,.3)}.legal-sum ul{margin:8px 0 0}
@media(max-width:560px){article{padding:22px 18px}}</style></head><body><div class="wrap"><div class="top"><a class="brand" href="/">NEON AI</a><nav><a href="/terms" class="${doc === "terms" ? "on" : ""}">Terms of Service</a><a href="/privacy" class="${doc === "privacy" ? "on" : ""}">Privacy Policy</a><a href="/">Back to the site</a></nav></div><article>${legalHtml(doc)}</article></div></body></html>`;
for (const doc of ["terms", "privacy"]) app.get("/" + doc, (req, res) => res.set("Cache-Control", "no-cache").type("html").send(legalPage(doc)));
app.get("/api/legal/:doc", (req, res) => LEGAL[req.params.doc] ? res.set("Cache-Control", "no-cache").type("html").send(legalHtml(req.params.doc)) : res.status(404).end());

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Neon AI running on :${port}`));
