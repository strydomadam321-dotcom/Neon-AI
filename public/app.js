"use strict";
const $ = (id) => document.getElementById(id);
const els = {
  list: $("chatList"), msgs: $("messages"), empty: $("empty"), input: $("input"), send: $("send"),
  model: $("model"), title: $("chatTitle"), atts: $("attachments"), file: $("fileInput"),
  composer: $("composer"), search: $("search"), sidebar: $("sidebar"), scrim: $("scrim"), toBottom: $("toBottom"),
  sync: $("syncDot"),
};
const icon = (n, cls = "") => `<svg class="ic ${cls}"><use href="#i-${n}"/></svg>`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const ls = {
  get: (k, d = "") => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

// ---------- state ----------
let config = { models: [], defaultModel: "", needsInvite: false, hasKey: true };
let user = null;
let settings = { system: "", model: "" };
let chats = [];          // metadata list for the sidebar: {id,title,model,created,updated}
let current = null;      // active chat (full object incl. messages)
let pending = [];        // attachments waiting to be sent
let busy = false;
let abortCtl = null;
let syncTimer = 0;

// ---------- toasts + dialogs ----------
function toast(msg, kind = "ok") {
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.innerHTML = icon(kind === "err" ? "alert" : "check");
  const s = document.createElement("span"); s.textContent = msg; t.appendChild(s);
  $("toasts").appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, kind === "err" ? 5200 : 2600);
}

function dialog({ title, message = "", input = null, ok = "OK", danger = false }) {
  return new Promise((resolve) => {
    const box = $("dialog"), form = $("dlgForm"), inp = $("dlgInput");
    $("dlgTitle").textContent = title;
    $("dlgMsg").textContent = message; $("dlgMsg").hidden = !message;
    inp.hidden = input === null; if (input !== null) inp.value = input;
    const okb = $("dlgOk"); okb.textContent = ok;
    okb.className = "btn " + (danger ? "danger" : "primary");
    box.classList.remove("hidden");
    (input === null ? okb : inp).focus(); if (input !== null) inp.select();
    const done = (v) => { box.classList.add("hidden"); form.onsubmit = null; $("dlgCancel").onclick = null; box.onmousedown = null; resolve(v); };
    form.onsubmit = (e) => { e.preventDefault(); done(input === null ? true : inp.value); };
    $("dlgCancel").onclick = () => done(input === null ? false : null);
    box.onmousedown = (e) => { if (e.target === box) done(input === null ? false : null); };
  });
}

// ---------- api ----------
async function api(path, opts = {}) {
  const init = { method: opts.method || "GET", headers: {}, credentials: "same-origin", signal: opts.signal };
  if (opts.body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
  const res = await fetch(path, init);
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401 && !opts.noAuthRedirect) { showAuth("Your session expired. Please sign in again."); }
  if (!res.ok) { const e = new Error(data?.error || `Request failed (${res.status})`); e.status = res.status; e.field = data?.field; throw e; }
  return data;
}

// ---------- auth screen ----------
let mode = "login";
const authEls = { form: $("authForm"), user: $("username"), pass: $("password"), err: $("authErr"), btn: $("authSubmit") };

function setMode(m) {
  mode = m;
  document.querySelector(".tabs").dataset.mode = m;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.mode === m));
  authEls.btn.querySelector(".lbl").textContent = m === "login" ? "Sign in" : "Create account";
  authEls.pass.autocomplete = m === "login" ? "current-password" : "new-password";
  $("strength").hidden = m !== "signup";
  $("fInvite").hidden = !(m === "signup" && config.needsInvite);
  authEls.err.textContent = "";
  document.querySelectorAll(".field.bad").forEach((f) => f.classList.remove("bad"));
}
document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => setMode(t.dataset.mode)));

$("togglePw").onclick = () => {
  const show = authEls.pass.type === "password";
  authEls.pass.type = show ? "text" : "password";
  $("togglePw").innerHTML = icon(show ? "eyeoff" : "eye");
  $("togglePw").setAttribute("aria-label", show ? "Hide password" : "Show password");
};

function scorePw(p) {
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
  return p.length ? Math.max(1, s) : 0;
}
authEls.pass.addEventListener("input", () => {
  const p = authEls.pass.value, s = scorePw(p);
  $("strength").dataset.s = p.length < 8 ? Math.min(1, s) : s;
  $("strengthTxt").textContent = p.length < 8 ? `${p.length}/8 characters minimum` : ["", "Weak", "Okay", "Strong", "Excellent"][s] || "Okay";
});

function fieldErr(id, msg) {
  authEls.err.textContent = msg;
  const f = $(id); f.classList.remove("bad"); void f.offsetWidth; f.classList.add("bad");
  f.querySelector("input")?.focus();
}
["username", "password", "invite"].forEach((id) => $(id).addEventListener("input", () => { $(id).closest(".field").classList.remove("bad"); authEls.err.textContent = ""; }));

authEls.form.onsubmit = async (e) => {
  e.preventDefault();
  const username = authEls.user.value.trim(), password = authEls.pass.value;
  if (!username) return fieldErr("fUser", "Enter a username.");
  if (mode === "signup" && !/^[A-Za-z0-9_.-]{3,24}$/.test(username)) return fieldErr("fUser", "Username: 3-24 characters, letters, numbers, . _ -");
  if (!password) return fieldErr("fPass", "Enter your password.");
  if (mode === "signup" && password.length < 8) return fieldErr("fPass", "Password must be at least 8 characters.");
  authEls.btn.classList.add("loading"); authEls.btn.disabled = true;
  try {
    const data = await api(mode === "login" ? "/api/login" : "/api/signup", {
      method: "POST", noAuthRedirect: true,
      body: { username, password, remember: $("remember").checked, invite: $("invite").value },
    });
    authEls.pass.value = ""; $("invite").value = "";
    await enterApp(data);
    if (mode === "signup") toast("Account created. Welcome aboard.");
  } catch (err) {
    const map = { username: "fUser", password: "fPass", invite: "fInvite" };
    if (map[err.field]) fieldErr(map[err.field], err.message);
    else { authEls.err.textContent = err.message; if (err.status === 401) { const f = $("fPass"); f.classList.remove("bad"); void f.offsetWidth; f.classList.add("bad"); } }
  } finally {
    authEls.btn.classList.remove("loading"); authEls.btn.disabled = false;
  }
};

function showAuth(msg = "") {
  clearInterval(syncTimer);
  if (busy) abortCtl?.abort();
  user = null; current = null; chats = [];
  $("app").classList.add("hidden");
  $("auth").classList.remove("hidden");
  setMode("login");
  authEls.err.textContent = msg;
  authEls.user.focus();
}

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
    const lang = (code?.className.match(/language-([\w+#-]+)/) || [])[1] || "code";
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.innerHTML = `<span></span><button class="copy" type="button">${icon("copy")}<span>Copy</span></button>`;
    bar.firstChild.textContent = lang;
    const b = bar.querySelector("button");
    b.onclick = () => {
      navigator.clipboard.writeText(code ? code.innerText : pre.innerText);
      b.innerHTML = `${icon("check")}<span>Copied</span>`;
      setTimeout(() => (b.innerHTML = `${icon("copy")}<span>Copy</span>`), 1400);
    };
    pre.appendChild(bar);
  });
  return d;
}

// ---------- sidebar ----------
function groupLabel(ts) {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const day = 864e5, t = d0.getTime();
  if (ts >= t) return "Today";
  if (ts >= t - day) return "Yesterday";
  if (ts >= t - 7 * day) return "Previous 7 days";
  if (ts >= t - 30 * day) return "Previous 30 days";
  return "Older";
}

function renderList() {
  els.list.innerHTML = "";
  const items = [...chats].sort((a, b) => b.updated - a.updated);
  if (!items.length) {
    const e = document.createElement("div");
    e.className = "list-empty";
    e.textContent = els.search.value.trim() ? "No chats match your search." : "No chats yet. Start one!";
    els.list.appendChild(e); return;
  }
  let last = "", i = 0;
  items.forEach((c) => {
    const g = groupLabel(c.updated);
    if (g !== last) { last = g; const h = document.createElement("div"); h.className = "group"; h.textContent = g; els.list.appendChild(h); }
    const d = document.createElement("div");
    d.className = "chat-item" + (current && c.id === current.id ? " active" : "");
    d.style.animationDelay = Math.min(i++, 12) * 25 + "ms";
    d.tabIndex = 0;
    d.innerHTML = `<span class="t"></span><span class="acts"><button class="ren" type="button" aria-label="Rename" title="Rename">${icon("pencil")}</button><button class="del" type="button" aria-label="Delete" title="Delete">${icon("trash")}</button></span>`;
    d.querySelector(".t").textContent = c.title;
    d.onclick = () => { openChat(c.id); closeSide(); };
    d.onkeydown = (e) => { if (e.key === "Enter" && e.target === d) { openChat(c.id); closeSide(); } };
    d.querySelector(".ren").onclick = async (e) => {
      e.stopPropagation();
      const t = await dialog({ title: "Rename chat", input: c.title, ok: "Save" });
      if (t && t.trim()) {
        try {
          await api(`/api/chats/${c.id}`, { method: "PATCH", body: { title: t.trim() } });
          c.title = t.trim().slice(0, 120);
          if (current?.id === c.id) { current.title = c.title; els.title.textContent = c.title; }
          renderList();
        } catch (err) { toast(err.message, "err"); }
      }
    };
    d.querySelector(".del").onclick = async (e) => {
      e.stopPropagation();
      if (!(await dialog({ title: "Delete this chat?", message: "This removes it from all your devices.", ok: "Delete", danger: true }))) return;
      try {
        await api(`/api/chats/${c.id}`, { method: "DELETE" });
        chats = chats.filter((x) => x.id !== c.id);
        if (current?.id === c.id) startNew();
        renderList();
      } catch (err) { toast(err.message, "err"); }
    };
    els.list.appendChild(d);
  });
}

function upsertMeta(chat) {
  const m = { id: chat.id, title: chat.title, model: chat.model, created: chat.created, updated: chat.updated };
  const i = chats.findIndex((c) => c.id === chat.id);
  if (i >= 0) chats[i] = m; else chats.push(m);
}

// ---------- messages ----------
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
      c.innerHTML = `${icon("file")}<span class="n"></span>`;
      c.querySelector(".n").textContent = a.name;
      wrap.appendChild(c);
    }
  });
  return wrap;
}

function errBlock(text) {
  const e = document.createElement("div");
  e.className = "msg-err";
  e.innerHTML = icon("alert") + "<span></span>";
  e.querySelector("span").textContent = text;
  return e;
}

function msgEl(m, idx, chat = current) {
  const row = document.createElement("div");
  row.className = "msg " + m.role;
  const av = document.createElement("div");
  av.className = "avatar";
  if (m.role === "user") av.textContent = (user?.username || "U")[0]; else av.innerHTML = icon("bolt");
  const body = document.createElement("div");
  body.className = "body";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (m.role === "user") {
    if (m.attachments?.length) body.appendChild(attachmentsView(m.attachments));
    if (m.text) bubble.textContent = m.text; else bubble.style.display = "none";
    body.appendChild(bubble);
  } else {
    if (m.text) bubble.appendChild(md(m.text));
    body.appendChild(bubble);
    if (m.err) body.appendChild(errBlock(m.err));
    const act = document.createElement("div");
    act.className = "actions";
    if (m.text) {
      const copy = document.createElement("button");
      copy.type = "button";
      copy.innerHTML = `${icon("copy")}<span>Copy</span>`;
      copy.onclick = () => { navigator.clipboard.writeText(m.text); copy.innerHTML = `${icon("check")}<span>Copied</span>`; setTimeout(() => (copy.innerHTML = `${icon("copy")}<span>Copy</span>`), 1400); };
      act.appendChild(copy);
    }
    if (idx === chat.messages.length - 1) {
      const re = document.createElement("button");
      re.type = "button";
      re.innerHTML = `${icon("refresh")}<span>Regenerate</span>`;
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
  if (force || m.scrollHeight - m.scrollTop - m.clientHeight < 160) { m.style.scrollBehavior = "auto"; m.scrollTop = m.scrollHeight; m.style.scrollBehavior = ""; }
}
els.msgs.addEventListener("scroll", () => {
  const m = els.msgs;
  els.toBottom.classList.toggle("show", m.scrollHeight - m.scrollTop - m.clientHeight > 300);
}, { passive: true });
els.toBottom.onclick = () => els.msgs.scrollTo({ top: els.msgs.scrollHeight, behavior: "smooth" });

function setBusy(b) {
  busy = b;
  els.send.innerHTML = icon(b ? "stop" : "send");
  els.send.classList.toggle("stop", b);
  els.send.setAttribute("aria-label", b ? "Stop" : "Send");
}
function setSync(state) { els.sync.className = "sync" + (state ? " " + state : ""); els.sync.title = state === "busy" ? "Saving" : state === "err" ? "Not saved" : "Synced"; }

// ---------- chat actions ----------
async function openChat(id) {
  if (busy) abortCtl?.abort();
  if (current?.id === id) return;
  try {
    const { chat } = await api(`/api/chats/${id}`);
    current = chat;
  } catch (err) { toast(err.message, "err"); return; }
  if (current.model && [...els.model.options].some((o) => o.value === current.model)) els.model.value = current.model;
  pending = []; renderPending(); renderMessages(); renderList();
  ls.set("neon-last-" + user.username, id);
}

function startNew() {
  if (busy) abortCtl?.abort();
  const model = els.model.value;
  current = { id: uid(), title: "New chat", created: Date.now(), updated: Date.now(), model, messages: [] };
  pending = []; renderPending(); renderMessages(); renderList();
  els.input.focus();
}

async function persist(chat) {
  setSync("busy");
  try {
    const r = await api(`/api/chats/${chat.id}`, { method: "PUT", body: { title: chat.title, model: chat.model, messages: chat.messages, created: chat.created } });
    chat.updated = r.updated;
    upsertMeta(chat); renderList(); setSync("");
    return true;
  } catch (err) {
    setSync("err"); toast("Couldn't save this chat: " + err.message, "err");
    return false;
  }
}

async function streamReply() {
  const chat = current;
  const row = msgEl({ role: "assistant", text: "" }, -1, chat);
  row.querySelector(".actions")?.remove();
  row.classList.add("streaming");
  const bubble = row.querySelector(".bubble");
  bubble.innerHTML = '<div class="thinking"><i></i><i></i><i></i></div>';
  els.msgs.appendChild(row);
  els.empty.style.display = "none";
  scrollDown(true);

  let text = "", raf = 0, errMsg = "";
  const paint = () => {
    raf = 0;
    if (current !== chat) return;
    bubble.innerHTML = "";
    const d = md(text); d.classList.add("cursor");
    bubble.appendChild(d);
    scrollDown();
  };

  abortCtl = new AbortController();
  setBusy(true);
  try {
    const res = await fetch("/api/chat", {
      method: "POST", signal: abortCtl.signal, credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: chat.messages, model: els.model.value }),
    });
    if (res.status === 401) { showAuth("Your session expired. Please sign in again."); throw new Error("Not signed in"); }
    if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `Request failed (${res.status})`); }
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
  if (!user) return;
  if (text || errMsg) chat.messages.push({ role: "assistant", text, ...(errMsg ? { err: errMsg } : {}) });
  await persist(chat);
  if (current === chat) renderMessages();
}

async function sendMessage(textOverride) {
  if (busy) { abortCtl?.abort(); return; }
  const text = (textOverride ?? els.input.value).trim();
  if (!text && !pending.length) return;
  if (config.hasKey === false) toast("The server has no Anthropic API key yet.", "err");
  const chat = current;
  chat.messages.push({ role: "user", text, attachments: pending });
  if (chat.messages.length === 1) chat.title = (text || pending[0]?.name || "New chat").replace(/\s+/g, " ").slice(0, 48);
  chat.model = els.model.value;
  els.input.value = ""; autoGrow();
  pending = []; renderPending();
  renderMessages();
  ls.set("neon-last-" + user.username, chat.id);
  streamReply();           // start streaming immediately
  persist(chat);           // save the user message in the background
}

async function regenerate() {
  if (busy) return;
  while (current.messages.length && current.messages.at(-1).role === "assistant") current.messages.pop();
  if (!current.messages.length) return;
  renderMessages();
  streamReply();
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
  return { mediaType: "image/jpeg", data: c.toDataURL("image/jpeg", 0.85).split(",")[1] };
}

async function addFiles(files) {
  for (const f of files) {
    try {
      if (f.type.startsWith("image/")) {
        const r = await shrinkImage(f);
        pending.push({ kind: "image", name: f.name || "image", ...r });
      } else if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
        if (f.size > 20 * 1024 * 1024) { toast(`${f.name} is over 20 MB`, "err"); continue; }
        const data = (await readAs(f, "readAsDataURL")).split(",")[1];
        pending.push({ kind: "pdf", name: f.name, data });
      } else if (f.type.startsWith("text/") || TEXT_EXT.test(f.name) || f.size < 200000) {
        if (f.size > 2 * 1024 * 1024) { toast(`${f.name} is too large (2 MB max for text files)`, "err"); continue; }
        const content = await readAs(f, "readAsText");
        if (/\u0000/.test(content.slice(0, 2000))) { toast(`${f.name} looks like a binary file; not supported`, "err"); continue; }
        pending.push({ kind: "text", name: f.name, content });
      } else toast(`Unsupported file: ${f.name}`, "err");
    } catch { toast(`Could not read ${f.name}`, "err"); }
  }
  renderPending();
}

function renderPending() {
  els.atts.innerHTML = "";
  pending.forEach((a, i) => {
    const w = document.createElement("div");
    w.className = "att";
    if (a.kind === "image") { const im = document.createElement("img"); im.src = `data:${a.mediaType};base64,${a.data}`; im.alt = a.name; w.appendChild(im); }
    else { const c = document.createElement("div"); c.className = "file-chip"; c.innerHTML = `${icon("file")}<span class="n"></span>`; c.querySelector(".n").textContent = a.name; w.appendChild(c); }
    const rm = document.createElement("button");
    rm.className = "rm"; rm.type = "button"; rm.setAttribute("aria-label", "Remove"); rm.innerHTML = icon("x");
    rm.onclick = () => { pending.splice(i, 1); renderPending(); };
    w.appendChild(rm);
    els.atts.appendChild(w);
  });
}

// ---------- misc UI ----------
function autoGrow() { els.input.style.height = "auto"; els.input.style.height = Math.min(els.input.scrollHeight, 200) + "px"; }
function openSide() { els.sidebar.classList.add("open"); els.scrim.classList.add("show"); }
function closeSide() { els.sidebar.classList.remove("open"); els.scrim.classList.remove("show"); }

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
["dragenter", "dragover"].forEach((ev) => document.addEventListener(ev, (e) => { if (!user) return; e.preventDefault(); els.composer.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === "drop" || e.target === document.documentElement) els.composer.classList.remove("drag"); }));
document.addEventListener("drop", (e) => { if (user && e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files]); });

$("newChat").onclick = () => { startNew(); closeSide(); };
$("openSide").onclick = openSide; $("closeSide").onclick = closeSide; els.scrim.onclick = closeSide;

let searchT = 0;
els.search.oninput = () => {
  clearTimeout(searchT);
  searchT = setTimeout(() => loadList(), 250);
};
async function loadList() {
  try {
    const { chats: list } = await api("/api/chats?q=" + encodeURIComponent(els.search.value.trim()));
    chats = list; renderList();
  } catch {}
}

els.model.onchange = () => {
  settings.model = els.model.value;
  if (current) current.model = els.model.value;
  api("/api/settings", { method: "PUT", body: settings }).catch(() => {});
};
document.querySelectorAll(".chip").forEach((c) => (c.onclick = () => sendMessage(c.querySelector("span").textContent)));

function openSettings() {
  $("sysPrompt").value = settings.system || "";
  $("settings").classList.remove("hidden");
}
function closeSettings() { $("settings").classList.add("hidden"); }
$("settingsBtn").onclick = openSettings;
$("closeSettings").onclick = closeSettings;
$("settings").onmousedown = (e) => { if (e.target === $("settings")) closeSettings(); };
$("saveSettings").onclick = async () => {
  try {
    const r = await api("/api/settings", { method: "PUT", body: { system: $("sysPrompt").value.trim(), model: els.model.value } });
    settings = r.settings; closeSettings(); toast("Settings saved.");
  } catch (err) { toast(err.message, "err"); }
};
$("clearAll").onclick = async () => {
  if (!(await dialog({ title: "Delete ALL chats?", message: "This permanently removes every chat on your account, on all devices.", ok: "Delete everything", danger: true }))) return;
  try {
    await api("/api/chats", { method: "DELETE" });
    chats = []; startNew(); closeSettings(); toast("All chats deleted.");
  } catch (err) { toast(err.message, "err"); }
};
$("logoutBtn").onclick = async () => {
  try { await api("/api/logout", { method: "POST", noAuthRedirect: true }); } catch {}
  showAuth(); toast("Signed out.");
};

$("exportBtn").onclick = () => {
  if (!current?.messages.length) return;
  const out = `# ${current.title}\n\n` + current.messages.map((m) => `**${m.role === "user" ? "You" : "AI"}:**\n\n${m.text}\n`).join("\n---\n\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([out], { type: "text/markdown" }));
  a.download = (current.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "chat") + ".md";
  a.click(); URL.revokeObjectURL(a.href);
};

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("dialog").classList.contains("hidden")) $("dlgCancel").click();
  else if (!$("settings").classList.contains("hidden")) closeSettings();
  else closeSide();
});

// ---------- cross-device sync ----------
async function syncNow() {
  if (!user || document.hidden || els.search.value.trim()) return;
  try {
    const { chats: list } = await api("/api/chats", { noAuthRedirect: true });
    chats = list; renderList();
    if (current && !busy) {
      const m = list.find((c) => c.id === current.id);
      if (m && m.updated > current.updated) {
        const { chat } = await api(`/api/chats/${current.id}`, { noAuthRedirect: true });
        if (!busy && current.id === chat.id) { current = chat; renderMessages(); renderList(); }
      }
    }
  } catch (e) { if (e.status === 401) showAuth("Your session expired. Please sign in again."); }
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) syncNow(); });
addEventListener("focus", syncNow);

// ---------- boot ----------
async function enterApp(data) {
  user = data.user; settings = { system: "", model: "", ...(data.settings || {}) };
  $("auth").classList.add("hidden"); $("app").classList.remove("hidden");
  $("meName").textContent = user.username; $("meAvatar").textContent = user.username[0];
  $("setName").textContent = user.username; $("setAvatar").textContent = user.username[0];
  els.model.innerHTML = "";
  config.models.forEach((m) => els.model.add(new Option(m.name, m.id)));
  els.model.value = config.models.some((m) => m.id === settings.model) ? settings.model : config.defaultModel;
  if (config.hasKey === false) $("emptyMsg").textContent = "The server has no ANTHROPIC_API_KEY yet. Add it in Render's environment settings.";
  els.search.value = "";
  current = null;
  try { chats = (await api("/api/chats")).chats; } catch { chats = []; }
  const last = ls.get("neon-last-" + user.username);
  if (last && chats.some((c) => c.id === last)) await openChat(last); else startNew();
  renderList();
  clearInterval(syncTimer);
  syncTimer = setInterval(syncNow, 25000);
}

(async function init() {
  try { config = await (await fetch("/api/config")).json(); } catch {}
  try {
    const data = await api("/api/me", { noAuthRedirect: true });
    await enterApp(data);
  } catch {
    showAuth();
  }
})();
