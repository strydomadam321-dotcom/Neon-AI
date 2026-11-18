"use strict";
const $ = (id) => document.getElementById(id);
const els = {
  list: $("chatList"), msgs: $("messages"), empty: $("empty"), input: $("input"), send: $("send"),
  model: $("model"), title: $("chatTitle"), atts: $("attachments"), file: $("fileInput"),
  composer: $("composer"), search: $("search"), sidebar: $("sidebar"), scrim: $("scrim"),
};

// ---------- storage (IndexedDB: saves chats in your browser, survives restarts) ----------
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("neon-ai", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("chats", { keyPath: "id" });
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  tx(mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction("chats", mode);
      const out = fn(t.objectStore("chats"));
      t.oncomplete = () => res(out.result);
      t.onerror = () => rej(t.error);
    });
  },
  all: () => DB.tx("readonly", (s) => s.getAll()),
  put: (c) => DB.tx("readwrite", (s) => s.put(c)),
  del: (id) => DB.tx("readwrite", (s) => s.delete(id)),
  clear: () => DB.tx("readwrite", (s) => s.clear()),
};

const ls = {
  get: (k, d = "") => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

// ---------- state ----------
let chats = [];
let current = null;      // active chat object
let pending = [];        // attachments waiting to be sent
let busy = false;
let abortCtl = null;
let config = { models: [], defaultModel: "", needsPassword: false };
let password = ls.get("neon-pw");

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const newChat = () => ({ id: uid(), title: "New chat", created: Date.now(), updated: Date.now(), model: els.model.value, messages: [] });

// ---------- markdown ----------
marked.setOptions({ breaks: true, gfm: true });
function md(text) {
  const html = DOMPurify.sanitize(marked.parse(text || ""));
  const d = document.createElement("div");
  d.className = "md";
  d.innerHTML = html;
  d.querySelectorAll("a").forEach((a) => { a.target = "_blank"; a.rel = "noopener noreferrer"; });
  d.querySelectorAll("pre").forEach((pre) => {
    const code = pre.querySelector("code");
    if (code && window.hljs) { try { hljs.highlightElement(code); } catch {} }
    const b = document.createElement("button");
    b.className = "copy"; b.textContent = "Copy";
    b.onclick = () => { navigator.clipboard.writeText(code ? code.innerText : pre.innerText); b.textContent = "Copied!"; setTimeout(() => (b.textContent = "Copy"), 1200); };
    pre.appendChild(b);
  });
  return d;
}

// ---------- rendering ----------
function renderList() {
  const q = els.search.value.trim().toLowerCase();
  els.list.innerHTML = "";
  chats
    .filter((c) => !q || c.title.toLowerCase().includes(q) || c.messages.some((m) => m.text?.toLowerCase().includes(q)))
    .sort((a, b) => b.updated - a.updated)
    .forEach((c) => {
      const d = document.createElement("div");
      d.className = "chat-item" + (current && c.id === current.id ? " active" : "");
      d.innerHTML = `<span class="t"></span><button class="x" title="Delete">🗑</button>`;
      d.querySelector(".t").textContent = c.title;
      d.onclick = () => { openChat(c.id); closeSide(); };
      d.ondblclick = async () => {
        const t = prompt("Rename chat", c.title);
        if (t && t.trim()) { c.title = t.trim().slice(0, 80); await DB.put(c); renderList(); if (current?.id === c.id) els.title.textContent = c.title; }
      };
      d.querySelector(".x").onclick = async (e) => {
        e.stopPropagation();
        if (!confirm("Delete this chat?")) return;
        await DB.del(c.id);
        chats = chats.filter((x) => x.id !== c.id);
        if (current?.id === c.id) startNew();
        renderList();
      };
      els.list.appendChild(d);
    });
}

function attachmentsView(atts) {
  const wrap = document.createElement("div");
  wrap.className = "thumbs";
  (atts || []).forEach((a) => {
    if (a.kind === "image") {
      const img = document.createElement("img");
      img.src = `data:${a.mediaType};base64,${a.data}`; img.alt = a.name;
      wrap.appendChild(img);
    } else {
      const c = document.createElement("div");
      c.className = "file-chip";
      c.innerHTML = `<span>${a.kind === "pdf" ? "📄" : "📃"}</span><span class="n"></span>`;
      c.querySelector(".n").textContent = a.name;
      wrap.appendChild(c);
    }
  });
  return wrap;
}

function msgEl(m, idx) {
  const row = document.createElement("div");
  row.className = "msg " + m.role + (m.error ? " error" : "");
  const av = document.createElement("div");
  av.className = "avatar"; av.textContent = m.role === "user" ? "U" : "⚡";
  const body = document.createElement("div");
  body.className = "body";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (m.role === "user") {
    if (m.attachments?.length) body.appendChild(attachmentsView(m.attachments));
    if (m.text) bubble.textContent = m.text;
    else bubble.style.display = "none";
    body.appendChild(bubble);
  } else {
    bubble.appendChild(md(m.text));
    body.appendChild(bubble);
    const act = document.createElement("div");
    act.className = "actions";
    const copy = document.createElement("button");
    copy.textContent = "⧉ Copy";
    copy.onclick = () => { navigator.clipboard.writeText(m.text); copy.textContent = "Copied!"; setTimeout(() => (copy.textContent = "⧉ Copy"), 1200); };
    act.appendChild(copy);
    if (idx === current.messages.length - 1) {
      const re = document.createElement("button");
      re.textContent = "↻ Regenerate";
      re.onclick = regenerate;
      act.appendChild(re);
    }
    body.appendChild(act);
  }
  row.append(av, body);
  return row;
}

function renderMessages() {
  els.msgs.querySelectorAll(".msg").forEach((n) => n.remove());
  els.empty.style.display = current.messages.length ? "none" : "";
  current.messages.forEach((m, i) => els.msgs.appendChild(msgEl(m, i)));
  els.title.textContent = current.title;
  scrollDown(true);
}

function scrollDown(force) {
  const m = els.msgs;
  if (force || m.scrollHeight - m.scrollTop - m.clientHeight < 160) m.scrollTop = m.scrollHeight;
}

function setBusy(b) {
  busy = b;
  els.send.textContent = b ? "■" : "➤";
  els.send.classList.toggle("stop", b);
  els.send.title = b ? "Stop" : "Send";
}

// ---------- chat actions ----------
function openChat(id) {
  if (busy) abortCtl?.abort();
  current = chats.find((c) => c.id === id);
  if (current.model && [...els.model.options].some((o) => o.value === current.model)) els.model.value = current.model;
  pending = []; renderPending(); renderMessages(); renderList();
  ls.set("neon-last", id);
}

function startNew() {
  if (busy) abortCtl?.abort();
  current = newChat();
  pending = []; renderPending(); renderMessages(); renderList();
  els.input.focus();
}

async function persist() {
  current.updated = Date.now();
  current.model = els.model.value;
  if (!chats.includes(current)) chats.push(current);
  await DB.put(current);
  renderList();
}

async function streamReply() {
  const history = current.messages;
  const row = msgEl({ role: "assistant", text: "" }, -1);
  row.querySelector(".actions")?.remove();
  const bubble = row.querySelector(".bubble");
  bubble.innerHTML = "";
  els.msgs.appendChild(row);
  els.empty.style.display = "none";

  let text = "", raf = 0, errMsg = "";
  const paint = () => {
    raf = 0;
    bubble.innerHTML = "";
    bubble.appendChild(md(text));
    bubble.firstChild?.classList.add("cursor");
    scrollDown();
  };
  bubble.innerHTML = '<div class="md cursor"></div>';

  abortCtl = new AbortController();
  setBusy(true);
  try {
    const res = await fetch("/api/chat", {
      method: "POST", signal: abortCtl.signal,
      headers: { "Content-Type": "application/json", "x-app-password": password },
      body: JSON.stringify({ messages: history, model: els.model.value, system: ls.get("neon-sys") }),
    });
    if (res.status === 401) { showLogin("Password required"); throw new Error("Not authorised"); }
    if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `HTTP ${res.status}`); }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2);
        if (!line.startsWith("data:")) continue;
        const ev = JSON.parse(line.slice(5));
        if (ev.t) { text += ev.t; if (!raf) raf = requestAnimationFrame(paint); }
        if (ev.error) errMsg = ev.error;
      }
    }
  } catch (e) {
    if (e.name !== "AbortError") errMsg = errMsg || e.message;
  }
  if (raf) cancelAnimationFrame(raf);
  setBusy(false); abortCtl = null;
  if (errMsg) text += (text ? "\n\n" : "") + "⚠️ " + errMsg;
  if (text) current.messages.push({ role: "assistant", text, error: !!errMsg && !text.replace("⚠️ " + errMsg, "").trim() });
  await persist();
  renderMessages();
}

async function sendMessage(textOverride) {
  if (busy) { abortCtl?.abort(); return; }
  const text = (textOverride ?? els.input.value).trim();
  if (!text && !pending.length) return;
  current.messages.push({ role: "user", text, attachments: pending });
  if (current.messages.length === 1) current.title = (text || pending[0]?.name || "New chat").replace(/\s+/g, " ").slice(0, 48);
  els.input.value = ""; autoGrow();
  pending = []; renderPending();
  await persist();
  renderMessages();
  streamReply();
}

async function regenerate() {
  if (busy) return;
  while (current.messages.length && current.messages.at(-1).role === "assistant") current.messages.pop();
  if (!current.messages.length) return;
  await persist(); renderMessages(); streamReply();
}

// ---------- attachments ----------
const TEXT_EXT = /\.(txt|md|csv|json|js|ts|jsx|tsx|py|html|css|java|c|cpp|h|cs|go|rs|rb|php|sh|sql|ya?ml|xml|log|toml|ini|env|vue|svelte|kt|swift)$/i;
const readAs = (file, how) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r[how](file); });

async function shrinkImage(file) {
  const url = await readAs(file, "readAsDataURL");
  if (file.type === "image/gif") return { mediaType: "image/gif", data: url.split(",")[1] };
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const max = 1568, s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return { mediaType: "image/jpeg", data: c.toDataURL("image/jpeg", 0.88).split(",")[1] };
}

async function addFiles(files) {
  for (const f of files) {
    try {
      if (f.type.startsWith("image/")) {
        const r = await shrinkImage(f);
        pending.push({ kind: "image", name: f.name || "image", ...r });
      } else if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
        if (f.size > 30 * 1024 * 1024) { alert(`${f.name} is over 30 MB`); continue; }
        const data = (await readAs(f, "readAsDataURL")).split(",")[1];
        pending.push({ kind: "pdf", name: f.name, data });
      } else if (f.type.startsWith("text/") || TEXT_EXT.test(f.name) || f.size < 200000) {
        if (f.size > 2 * 1024 * 1024) { alert(`${f.name} is too large (2 MB max for text files)`); continue; }
        const content = await readAs(f, "readAsText");
        if (/\u0000/.test(content.slice(0, 2000))) { alert(`${f.name} looks like a binary file; not supported`); continue; }
        pending.push({ kind: "text", name: f.name, content });
      } else alert(`Unsupported file: ${f.name}`);
    } catch { alert(`Could not read ${f.name}`); }
  }
  renderPending();
}

function renderPending() {
  els.atts.innerHTML = "";
  pending.forEach((a, i) => {
    const w = document.createElement("div");
    w.className = "att";
    if (a.kind === "image") { const im = document.createElement("img"); im.src = `data:${a.mediaType};base64,${a.data}`; w.appendChild(im); }
    else { const c = document.createElement("div"); c.className = "file-chip"; c.innerHTML = `<span>${a.kind === "pdf" ? "📄" : "📃"}</span><span class="n"></span>`; c.querySelector(".n").textContent = a.name; w.appendChild(c); }
    const rm = document.createElement("button");
    rm.className = "rm"; rm.textContent = "✕"; rm.onclick = () => { pending.splice(i, 1); renderPending(); };
    w.appendChild(rm);
    els.atts.appendChild(w);
  });
}

// ---------- misc UI ----------
function autoGrow() { els.input.style.height = "auto"; els.input.style.height = Math.min(els.input.scrollHeight, 200) + "px"; }
function openSide() { els.sidebar.classList.add("open"); els.scrim.classList.add("show"); }
function closeSide() { els.sidebar.classList.remove("open"); els.scrim.classList.remove("show"); }
function showLogin(msg = "") { $("login").classList.remove("hidden"); $("loginErr").textContent = msg; $("pw").focus(); }

$("loginForm").onsubmit = async (e) => {
  e.preventDefault();
  password = $("pw").value;
  const r = await fetch("/api/check", { method: "POST", headers: { "x-app-password": password } });
  if (r.ok) { ls.set("neon-pw", password); $("login").classList.add("hidden"); }
  else $("loginErr").textContent = "Wrong password";
};

els.send.onclick = () => sendMessage();
els.input.addEventListener("input", autoGrow);
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); }
});
els.input.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); addFiles(files); }
});
$("attachBtn").onclick = () => els.file.click();
els.file.onchange = () => { addFiles([...els.file.files]); els.file.value = ""; };
["dragenter", "dragover"].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); els.composer.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === "drop" || e.target === document.documentElement) els.composer.classList.remove("drag"); }));
document.addEventListener("drop", (e) => { if (e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files]); });

$("newChat").onclick = () => { startNew(); closeSide(); };
$("openSide").onclick = openSide; $("closeSide").onclick = closeSide; els.scrim.onclick = closeSide;
els.search.oninput = renderList;
els.model.onchange = () => { ls.set("neon-model", els.model.value); if (current) { current.model = els.model.value; if (chats.includes(current)) DB.put(current); } };
document.querySelectorAll(".chip").forEach((c) => (c.onclick = () => sendMessage(c.textContent)));

$("settingsBtn").onclick = () => { $("sysPrompt").value = ls.get("neon-sys"); $("settings").classList.remove("hidden"); };
$("closeSettings").onclick = () => { ls.set("neon-sys", $("sysPrompt").value.trim()); $("settings").classList.add("hidden"); };
$("clearAll").onclick = async () => {
  if (!confirm("Delete ALL chats? This cannot be undone.")) return;
  await DB.clear(); chats = []; startNew(); $("settings").classList.add("hidden");
};

$("exportBtn").onclick = () => {
  if (!current?.messages.length) return;
  const out = `# ${current.title}\n\n` + current.messages.map((m) => `**${m.role === "user" ? "You" : "AI"}:**\n\n${m.text}\n`).join("\n---\n\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([out], { type: "text/markdown" }));
  a.download = current.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") + ".md";
  a.click(); URL.revokeObjectURL(a.href);
};

// ---------- boot ----------
(async function init() {
  try { config = await (await fetch("/api/config")).json(); } catch {}
  els.model.innerHTML = "";
  config.models.forEach((m) => els.model.add(new Option(m.name, m.id)));
  const saved = ls.get("neon-model");
  els.model.value = config.models.some((m) => m.id === saved) ? saved : config.defaultModel;
  await DB.open();
  chats = await DB.all();
  const last = ls.get("neon-last");
  if (last && chats.some((c) => c.id === last)) openChat(last); else startNew();
  if (config.needsPassword) {
    const r = await fetch("/api/check", { method: "POST", headers: { "x-app-password": password } });
    if (!r.ok) showLogin();
  }
  if (config.hasKey === false) {
    els.empty.querySelector("p").textContent = "⚠️ Server has no ANTHROPIC_API_KEY set yet — add it in Render's environment settings.";
  }
})();
