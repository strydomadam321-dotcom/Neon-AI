"use strict";
if (!Array.prototype.at) Object.defineProperty(Array.prototype, "at", { value: function (i) { i = Math.trunc(i) || 0; if (i < 0) i += this.length; return this[i]; }, writable: true, configurable: true });
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
let config = { hasGoogle: false, mailReady: true, models: [], defaultModel: "", plans: [], freeTokens: 50000, plusClaudeMsgs: 50, hasKey: true, hasGemini: false, defaultEffort: 1 };
let user = null;
let plan = { id: "free", requested: null, owner: false, usedTokens: 0, usedClaude: 0 };
const readLook = () => { try { return JSON.parse(localStorage.getItem("neon-look") || "{}") || {}; } catch { return {}; } };
let settings = { system: "", model: "", effort: 1, retro: true, bg: true, flicker: true, gfx: readLook().gfx === "gpu" ? "gpu" : "cpu" };
let chats = [];          // metadata list for the sidebar: {id,title,model,created,updated}
let current = null;      // active chat (full object incl. messages)
let pending = [];        // attachments waiting to be sent
let busy = false;
let abortCtl = null;
let syncTimer = 0;

// ---------- look: retro theme + animation switches (kept on this device too, so even the sign-in screen matches) ----------
function applyLook() {
  const R = document.documentElement;
  if (settings.retro) R.dataset.theme = "retro"; else delete R.dataset.theme;
  R.classList.toggle("no-bg-anim", settings.bg === false);
  R.classList.toggle("no-flicker", settings.flicker === false);
  R.dataset.gfx = settings.gfx === "gpu" ? "gpu" : "cpu";
  try { localStorage.setItem("neon-look", JSON.stringify({ retro: !!settings.retro, bg: settings.bg !== false, flicker: settings.flicker !== false, gfx: R.dataset.gfx })); } catch {}
  window.dispatchEvent(new Event("neon-look"));       // lets fx.js rebuild its canvases for the new mode
}

// ---------- toasts + dialogs ----------
function toast(msg, kind = "ok") {
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.innerHTML = icon(kind === "err" ? "alert" : "check");
  const s = document.createElement("span"); s.textContent = msg; t.appendChild(s);
  $("toasts").appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, kind === "err" ? 5200 : 2600);
}

function dialog({ title, message = "", input = null, ok = "OK", danger = false, password = false, placeholder = "" }) {
  return new Promise((resolve) => {
    const box = $("dialog"), form = $("dlgForm"), inp = $("dlgInput");
    $("dlgTitle").textContent = title;
    $("dlgMsg").textContent = message; $("dlgMsg").hidden = !message;
    inp.hidden = input === null; if (input !== null) inp.value = input;
    inp.type = password ? "password" : "text"; inp.placeholder = placeholder; inp.autocomplete = password ? "current-password" : "off"; inp.maxLength = password ? 72 : 120;
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
let step = 1;
const SPRING = "cubic-bezier(.3, 1.25, .4, 1)";
let lblTxt = "";
function syncStep(animate) {
  const lbl = authEls.btn.querySelector(".lbl"), t = step === 4 ? "Send code" : step === 5 ? "Reset password" : mode === "login" ? "Sign in" : step === 1 ? "Next" : step === 2 ? "Create account" : "Verify";
  if (t !== lblTxt) {
    if (animate && lblTxt) {
      const out = lbl.animate([{ opacity: 1, filter: "blur(0)", transform: "translateY(0)" }, { opacity: 0, filter: "blur(4px)", transform: "translateY(-6px)" }], { duration: 140, fill: "forwards" });
      out.onfinish = () => {
        lbl.textContent = t; out.cancel();
        lbl.animate([{ opacity: 0, filter: "blur(4px)", transform: "translateY(6px)" }, { opacity: 1, filter: "blur(0)", transform: "translateY(0)" }], { duration: 260, easing: "cubic-bezier(.2,.9,.25,1)" });
      };
    } else lbl.textContent = t;
    lblTxt = t;
  }
  $("tabsC").classList.toggle("open", step < 4);                       // the reset screens replace the tabs
  $("gLoginC").classList.toggle("open", mode === "login" && step < 4);
  document.querySelectorAll("#stepper i").forEach((d, i) => d.classList.toggle("on", i < Math.min(step, 2)));
  $("stepTxt").textContent = `Step ${Math.min(step, 2)} of 2`;   // the code screen is not shown as a third step (Google users skip it)
}
// slide between the two signup steps while the box stretches or shrinks to the new content
function goStep(n, instant) {
  if (n === step) return;
  const fwd = n > step, from = $("step" + step), to = $("step" + n), wrap = $("steps");
  step = n; syncStep(!instant); authEls.err.textContent = "";
  if (instant) { from.hidden = true; from.className = "step"; to.hidden = false; to.className = "step"; return; }
  const h0 = wrap.offsetHeight;
  wrap.style.height = h0 + "px"; wrap.classList.add("morphing");
  from.className = "step " + (fwd ? "out-fwd" : "out-back");
  setTimeout(() => {
    from.hidden = true; from.className = "step";
    to.hidden = false; to.className = "step " + (fwd ? "in-fwd" : "in-back");
    wrap.style.height = "auto"; const h1 = wrap.offsetHeight;
    wrap.style.height = h1 + "px";
    const an = wrap.animate([{ height: h0 + "px" }, { height: h1 + "px" }], { duration: 700, easing: SPRING });
    an.onfinish = an.oncancel = () => { wrap.style.height = ""; wrap.classList.remove("morphing"); };
    (n === 5 ? otpR.boxes[0] : n === 4 ? $("emailR") : n === 3 ? otpS.boxes[0] : n === 2 ? $("email") : authEls.user).focus({ preventScroll: true });
  }, 230);
}
$("backBtn").onclick = () => goStep(1);
$("backBtn3").onclick = () => { clearInterval(timers[""]); goStep(2); };
$("backBtn4").onclick = () => goStep(1);
$("backBtn5").onclick = () => { clearInterval(timers["2"]); goStep(4); };

// ---------- 6-digit code boxes (used for sign-up verification and for password reset) ----------
function makeOtp(root, onComplete) {
  const boxes = [...root.querySelectorAll(".otp-i")];
  const o = {
    boxes, root,
    code: () => boxes.map((b) => b.value).join(""),
    clear() { boxes.forEach((b) => { b.value = ""; b.classList.remove("filled"); }); root.classList.remove("bad"); },
    shake() { root.classList.remove("bad"); void root.offsetWidth; root.classList.add("bad"); },
    fill(digits, from = 0) {
      const d = String(digits).replace(/\D/g, "").slice(0, 6 - from);
      [...d].forEach((c, i) => { const b = boxes[from + i]; b.value = c; b.classList.add("filled"); });
      boxes[Math.min(from + d.length, 5)].focus();
      if (o.code().length === 6) setTimeout(onComplete, 180);
    },
  };
  boxes.forEach((b, i) => {
    b.addEventListener("input", () => {
      root.classList.remove("bad"); authEls.err.textContent = "";
      const v = b.value.replace(/\D/g, "");
      if (v.length > 1) { b.value = ""; o.fill(v, i); return; }          // autofill / fast typing dropped several digits in one box
      b.value = v; b.classList.toggle("filled", !!v);
      if (v) { if (i < 5) boxes[i + 1].focus(); if (o.code().length === 6) setTimeout(onComplete, 180); }
    });
    b.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !b.value && i > 0) { boxes[i - 1].value = ""; boxes[i - 1].classList.remove("filled"); boxes[i - 1].focus(); e.preventDefault(); }
      else if (e.key === "ArrowLeft" && i > 0) { boxes[i - 1].focus(); e.preventDefault(); }
      else if (e.key === "ArrowRight" && i < 5) { boxes[i + 1].focus(); e.preventDefault(); }
    });
    b.addEventListener("paste", (e) => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData("text"); if (/\d/.test(t)) o.fill(t, 0); });
    b.addEventListener("focus", () => b.select());
  });
  return o;
}
const otpS = makeOtp($("otp"), () => authEls.form.requestSubmit());      // sign-up: all six in, verify right away
const otpR = makeOtp($("otp2"), () => $("newpass").focus());              // reset: now they pick the new password
const timers = {};
let signupEmail = "", resetEmail = "";
function startResendCooldown(sec, sfx = "") {
  clearInterval(timers[sfx]);
  const txt = $("resendTxt" + sfx), btn = $("resendBtn" + sfx); let left = sec;
  btn.hidden = true; txt.textContent = `Didn't get it? Resend in ${left}s`;
  timers[sfx] = setInterval(() => {
    left--;
    if (left <= 0) { clearInterval(timers[sfx]); txt.textContent = "Didn't get it?"; btn.hidden = false; }
    else txt.textContent = `Didn't get it? Resend in ${left}s`;
  }, 1000);
}
$("resendBtn").onclick = async () => {
  $("resendBtn").disabled = true;
  try {
    const d = await api("/api/signup/resend", { method: "POST", noAuthRedirect: true, body: { email: signupEmail } });
    otpS.clear(); otpS.boxes[0].focus(); authEls.err.textContent = ""; startResendCooldown(d.cooldown || 30); toast("New code sent.");
  } catch (e) { authEls.err.textContent = e.message; }
  finally { $("resendBtn").disabled = false; }
};
$("resendBtn2").onclick = async () => {
  $("resendBtn2").disabled = true;
  try {
    const d = await api("/api/password/forgot", { method: "POST", noAuthRedirect: true, body: { email: resetEmail } });
    otpR.clear(); otpR.boxes[0].focus(); authEls.err.textContent = ""; startResendCooldown(d.cooldown || 30, "2"); toast("New code sent, if that email has an account.");
  } catch (e) { authEls.err.textContent = e.message; }
  finally { $("resendBtn2").disabled = false; }
};
let googleWatch = 0;
function googleBusy(on) {
  clearTimeout(googleWatch);
  [$("googleBtn"), $("googleBtn2")].forEach((x) => {
    x.disabled = on; x.classList.toggle("busy", on);
    const t = x.querySelector("span"); if (t) t.textContent = on ? "Opening Google…" : "Continue with Google";
  });
  if (on) googleWatch = setTimeout(() => { googleBusy(false); toast("Google is taking too long. Please try again.", "err"); }, 12000);   // never leave the button stuck
}
async function googleGo() {
  if (!config.hasGoogle) { toast("Google sign-in isn't set up yet.", "err"); return; }
  googleBusy(true);
  try {
    const body = { remember: $("remember").checked };
    if (mode === "signup") { body.username = authEls.user.value.trim(); body.password = authEls.pass.value; }   // the username they chose is kept
    const d = await api("/api/auth/google/start", { method: "POST", noAuthRedirect: true, body });
    location.href = d.url;
  } catch (err) {
    googleBusy(false);
    if (err.field === "username" || err.field === "password") { goStep(1); setTimeout(() => fieldErr(err.field === "username" ? "fUser" : "fPass", err.message), 300); }
    else toast(err.message || "Couldn't open Google. Please try again.", "err");
  }
}
function paintAvatar(el, name, pic) {
  el.textContent = ""; el.classList.remove("has-pic");
  const letter = () => { el.textContent = (name || "?")[0]; el.classList.remove("has-pic"); };
  if (!pic) { letter(); return; }
  const im = new Image(); im.alt = ""; im.referrerPolicy = "no-referrer"; im.onerror = () => { im.remove(); letter(); }; im.src = pic;
  el.appendChild(im); el.classList.add("has-pic");
}
const authEls = { form: $("authForm"), user: $("username"), pass: $("password"), err: $("authErr"), btn: $("authSubmit") };

function setMode(m, instant) {
  mode = m;
  document.querySelector(".tabs").dataset.mode = m;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.mode === m));
  authEls.pass.autocomplete = m === "login" ? "current-password" : "new-password";
  authEls.user.placeholder = m === "login" ? "Username or email" : "Username";
  $("forgotC").classList.remove("open");
  $("strengthC").classList.toggle("open", m === "signup");
  $("stepperC").classList.toggle("open", m === "signup");
  if (step !== 1) goStep(1, instant); else syncStep(!instant);
  authEls.err.textContent = "";
  document.querySelectorAll(".field.bad").forEach((f) => f.classList.remove("bad"));
}
document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => { if (t.dataset.mode !== mode) setMode(t.dataset.mode); }));

$("googleBtn").onclick = googleGo; $("googleBtn2").onclick = googleGo;
addEventListener("pageshow", (e) => { if (e.persisted) googleBusy(false); });   // coming back from Google with the Back button
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
["email", "username", "password", "emailR", "newpass"].forEach((id) => $(id).addEventListener("input", () => { $(id).closest(".field").classList.remove("bad"); authEls.err.textContent = ""; }));

// password reset: step 4 asks for the email, step 5 takes the code and the new password
async function submitForgot() {
  const email = $("emailR").value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fieldErr("fEmailR", "Enter a valid email address.");
  authEls.btn.classList.add("loading"); authEls.btn.disabled = true;
  try {
    const d = await api("/api/password/forgot", { method: "POST", noAuthRedirect: true, body: { email } });
    resetEmail = email; otpR.clear(); $("newpass").value = "";
    $("resetSub").textContent = `If ${email} belongs to an account with a password, a 6-digit code is on its way. Signed up with Google? Go back and use Continue with Google instead.`;
    startResendCooldown(d.cooldown || 30, "2"); goStep(5);
  } catch (err) { if (err.field === "email") fieldErr("fEmailR", err.message); else authEls.err.textContent = err.message; }
  finally { authEls.btn.classList.remove("loading"); authEls.btn.disabled = false; }
}
async function submitReset() {
  const pw = $("newpass").value;
  if (otpR.code().length < 6) { otpR.shake(); authEls.err.textContent = "Enter the 6-digit code."; return; }
  if (pw.length < 8) return fieldErr("fNewPass", "Password must be at least 8 characters.");
  authEls.btn.classList.add("loading"); authEls.btn.disabled = true;
  try {
    const data = await api("/api/password/reset", { method: "POST", noAuthRedirect: true, body: { email: resetEmail, code: otpR.code(), password: pw, remember: $("remember").checked } });
    $("newpass").value = ""; otpR.clear(); clearInterval(timers["2"]); authEls.pass.value = "";
    await enterApp(data); toast("Password changed. You're signed in.");
  } catch (err) {
    if (err.field === "code") { otpR.clear(); otpR.shake(); authEls.err.textContent = err.message; if (!err.expired) otpR.boxes[0].focus(); }
    else if (err.field === "password") fieldErr("fNewPass", err.message);
    else authEls.err.textContent = err.message;
  } finally { authEls.btn.classList.remove("loading"); authEls.btn.disabled = false; }
}
$("forgotBtn").onclick = () => { $("emailR").value = authEls.user.value.includes("@") ? authEls.user.value.trim() : ""; goStep(4); };

authEls.form.onsubmit = async (e) => {
  e.preventDefault();
  if (step === 4) return submitForgot();
  if (step === 5) return submitReset();
  const username = authEls.user.value.trim(), password = authEls.pass.value;
  if (!username) return fieldErr("fUser", mode === "login" ? "Enter your username or email." : "Enter a username.");
  if (mode === "signup" && !/^[A-Za-z0-9_.-]{3,24}$/.test(username)) return fieldErr("fUser", "Username: 3-24 characters, letters, numbers, . _ -");
  if (!password) return fieldErr("fPass", "Enter your password.");
  if (mode === "signup" && password.length < 8) return fieldErr("fPass", "Password must be at least 8 characters.");
  if (mode === "signup" && step === 1) { goStep(2); return; }
  const email = $("email").value.trim();
  if (mode === "signup" && step === 2 && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fieldErr("fEmail", "Enter a valid email address.");
  if (mode === "signup" && step === 3 && otpS.code().length < 6) { otpS.shake(); authEls.err.textContent = "Enter the 6-digit code."; return; }
  authEls.btn.classList.add("loading"); authEls.btn.disabled = true;
  try {
    let data;
    if (mode === "login") data = await api("/api/login", { method: "POST", noAuthRedirect: true, body: { username, password, remember: $("remember").checked } });
    else if (step === 2) {
      // email route: send the code, then slide to the code screen
      const d = await api("/api/signup/start", { method: "POST", noAuthRedirect: true, body: { username, password, email } });
      signupEmail = email.toLowerCase(); $("codeSub").textContent = `We sent a 6-digit code to ${d.email}. It's valid for 10 minutes.`;
      otpS.clear(); startResendCooldown(d.cooldown || 30); goStep(3);
      return;
    } else data = await api("/api/signup/verify", { method: "POST", noAuthRedirect: true, body: { email: signupEmail, code: otpS.code(), remember: $("remember").checked } });
    authEls.pass.value = ""; $("email").value = ""; otpS.clear(); clearInterval(timers[""]);
    await enterApp(data);
    if (mode === "signup") toast("Account created. Welcome aboard.");
  } catch (err) {
    const map = { email: "fEmail", username: "fUser", password: "fPass" };
    if (err.field === "code") { otpS.clear(); otpS.shake(); authEls.err.textContent = err.message; if (!err.expired) otpS.boxes[0].focus(); }
    else if (map[err.field]) {
      if (mode === "signup" && step >= 2 && err.field !== "email") { goStep(1); setTimeout(() => fieldErr(map[err.field], err.message), 300); }
      else fieldErr(map[err.field], err.message);
    }
    else { authEls.err.textContent = err.message; if (err.status === 401) { const f = $("fPass"); f.classList.remove("bad"); void f.offsetWidth; f.classList.add("bad"); if (mode === "login") $("forgotC").classList.add("open"); } }   // wrong details: offer "Forgot password?"
  } finally {
    authEls.btn.classList.remove("loading"); authEls.btn.disabled = false;
  }
};

function showAuth(msg = "") {
  clearInterval(syncTimer);
  if (busy) abortCtl?.abort();
  user = null; current = null; chats = [];
  gatePlans = false; $("plans").classList.add("hidden");
  $("app").classList.add("hidden");
  document.body.classList.remove("in-app");
  $("auth").classList.remove("hidden");
  setMode("login", true);
  authEls.err.textContent = msg;
  authEls.user.focus();
}


// ---------- plans ----------
const PLAN_COPY = {
  free: { badge: "", feats: ["50,000 Gemini tokens a day", "Gemini 3.5 Flash-Lite and 2.5 Flash", "Chats synced on every device", "Images, PDFs, Word and PowerPoint"], off: [], support: "Community support" },
  spark: { badge: "", feats: ["Unlimited Gemini, no daily cap", "Gemini 3.5 Flash-Lite and 2.5 Flash", "Chats synced on every device", "Images, PDFs, Word and PowerPoint"], off: [], support: "Email support" },
  plus: { badge: "Popular", feats: ["Everything in Spark", "Claude Sonnet and Haiku", "Fair use: 50 Claude messages a day", "Unlimited Gemini"], off: [], support: "Priority email support" },
  max: { badge: "Best value", feats: ["Everything in Plus", "Claude Opus, the smartest model", "No limit on Claude messages", "Early access to new features"], off: [], support: "Priority support, answered first" },
};
const tickIc = () => icon("check");
function planCardHTML(p, opts) {
  const c = PLAN_COPY[p.id] || { feats: [], off: [] };
  const price = p.price === 0 ? "Free" : "A$" + p.price;
  const cur = opts.current === p.id;
  const cta = opts.gate ? (p.price === 0 ? "Continue with Free" : "Choose " + p.name) : cur ? "Your plan" : p.price === 0 ? "Included" : (plan.requested === p.id ? "Requested" : "Choose plan");
  return `<button type="button" class="plan${cur ? " current" : ""}" data-id="${p.id}" role="button">
    ${c.badge ? `<span class="badge">${c.badge}</span>` : ""}
    <span class="pname">${p.name}</span><span class="ptag">${p.tag}</span>
    <span class="price"><b>${price}</b>${p.price ? "<span>/ month</span>" : "<span>forever</span>"}</span>
    <ul>${c.feats.map((f) => `<li>${tickIc()}<span>${f}</span></li>`).join("")}${(c.off || []).map((f) => `<li class="off">${icon("x")}<span>${f}</span></li>`).join("")}<li>${tickIc()}<span>${c.support}</span></li></ul>
    <span class="pcta">${cta}</span></button>`;
}
function renderPlanGrid(box, opts = {}) {
  box.innerHTML = (config.plans || []).map((p) => planCardHTML(p, opts)).join("");
  box.querySelectorAll(".plan").forEach((b) => (b.onclick = () => {
    const id = b.dataset.id;
    if (opts.gate) gateChoose(id); else choosePlan(id);
  }));
}
async function choosePlan(id) {
  if (id === plan.id) return;
  if (id === "free") { toast("You're on a paid plan; contact support to downgrade."); return; }
  try {
    const d = await api("/api/plan/request", { method: "POST", body: { plan: id } });
    plan = d.plan; renderPlans(); renderPlanSettings();
    toast("Got it. We'll switch on " + (config.plans.find((p) => p.id === id)?.name || "your plan") + " when payments open.");
  } catch (e) { toast(e.message, "err"); }
}
let gatePlans = false;
function renderPlans() { renderPlanGrid($("plansGrid"), { current: plan.id, gate: gatePlans }); }
function openPlans(gate) {
  gatePlans = gate === true;                                    // gate = new account: must choose before using the app, can't be closed
  $("plansTitle").textContent = gatePlans ? "Choose your plan to continue" : "Plans";
  $("closePlans").hidden = gatePlans;
  $("plansNote").textContent = gatePlans
    ? "Paid plans open soon. Pick one now and we'll switch it on for your account the moment payments go live. You start on Free today, no card needed."
    : "Paid plans open soon. Choose one and we'll switch it on for your account the moment payments go live. Until then you stay on your current plan.";
  renderPlans(); $("plans").classList.remove("hidden");
}
function closePlans() { if (gatePlans) return; $("plans").classList.add("hidden"); }
async function gateChoose(id) {
  try {
    const d = await api("/api/plan/choose", { method: "POST", body: { plan: id } });
    plan = d.plan; gatePlans = false; $("plans").classList.add("hidden"); renderPlanSettings();
    toast(id === "free" ? "You're on Free. Welcome aboard." : "Got it. You start on Free, and we'll switch on " + (config.plans.find((p) => p.id === id)?.name || "your plan") + " when payments open.");
  } catch (e) { toast(e.message, "err"); }
}
$("closePlans").onclick = closePlans;
$("plans").onmousedown = (e) => { if (e.target === $("plans")) closePlans(); };
$("seePlans").onclick = () => openPlans(false);
function renderPlanSettings() {
  const p = config.plans.find((x) => x.id === plan.id) || { name: "Free" };
  $("planName").textContent = user?.dev ? "Developer" : p.name + (plan.owner ? " (owner)" : "");
  const req = plan.requested ? ` Requested: ${config.plans.find((x) => x.id === plan.requested)?.name}, switches on when payments open.` : "";
  const box = $("usageBox");
  if (plan.id === "free") {
    const pct = Math.min(100, Math.round((plan.usedTokens / config.freeTokens) * 100));
    $("planSub").textContent = "Gemini only, with a daily token limit." + req;
    box.hidden = false; $("usageFill").style.width = pct + "%"; $("usageFill").classList.toggle("hot", pct >= 85);
    $("usageTxt").textContent = `${plan.usedTokens.toLocaleString()} of ${config.freeTokens.toLocaleString()} Gemini tokens used today. Resets at midnight UTC.`;
  } else if (plan.id === "plus") {
    $("planSub").textContent = "Unlimited Gemini, plus Claude Sonnet and Haiku." + req;
    box.hidden = false; const pct = Math.min(100, Math.round((plan.usedClaude / config.plusClaudeMsgs) * 100));
    $("usageFill").style.width = pct + "%"; $("usageFill").classList.toggle("hot", pct >= 85);
    $("usageTxt").textContent = `${plan.usedClaude} of ${config.plusClaudeMsgs} Claude messages used today.`;
  } else {
    $("planSub").textContent = (user?.dev ? "Dev account: full access, no limits." : plan.id === "max" ? "Everything, unlimited." : "Unlimited Gemini.") + req;
    box.hidden = true;
  }
}
const modelLocked = (id) => {
  const m = config.models.find((x) => x.id === id);
  if (!m || m.provider !== "claude") return false;
  if (plan.id === "max") return false;
  return plan.id !== "plus" || /opus/i.test(id);
};

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
  if (m.role === "user") paintAvatar(av, user?.username || "U", user?.picture); else av.innerHTML = icon("bolt");
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
  if (current.model && [...els.model.options].some((o) => o.value === current.model)) { els.model.value = current.model; syncModelUI(); }
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
      body: JSON.stringify({ messages: chat.messages, model: els.model.value, effort: settings.effort }),
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
        if (ev.th && !text) { const lb = bubble.querySelector(".thinking"); if (lb && !lb.dataset.l) { lb.dataset.l = 1; lb.insertAdjacentHTML("beforeend", '<span class="think-lbl">Thinking</span>'); } }
        if (ev.error) errMsg = ev.error;
        if (ev.tokens != null) { plan.usedTokens = ev.tokens; renderPlanSettings(); }
      }
    }
  } catch (e) {
    if (e.name !== "AbortError") errMsg = errMsg || e.message;
  }
  if (raf) cancelAnimationFrame(raf);
  setBusy(false); abortCtl = null;
  if (!user) return;
  if (text || errMsg) chat.messages.push({ role: "assistant", text, ...(errMsg ? { err: errMsg } : {}) });
  const saved = await persist(chat);
  if (current === chat) renderMessages();
  if (saved && !errMsg && text && chat.messages.length === 2) autoTitle(chat);
}

// give older chats (still titled with their first message) a short summary title, a few at a time
async function retitleOld() {
  try {
    const r = await api("/api/chats-retitle", { method: "POST", noAuthRedirect: true });
    if (!r?.updated?.length) return;
    r.updated.forEach((u) => {
      const m = chats.find((c) => c.id === u.id); if (m) m.title = u.title;
      if (current?.id === u.id) { current.title = u.title; els.title.textContent = u.title; }
    });
    renderList();
  } catch {}
}

// ask the server for a short summary title (a few words) after the first reply
async function autoTitle(chat) {
  const temp = chat.title;
  try {
    const r = await api(`/api/chats/${chat.id}/title`, { method: "POST", noAuthRedirect: true });
    if (!r?.title || chat.title !== temp) return;   // nothing new, or the user renamed it meanwhile
    chat.title = r.title; upsertMeta(chat); renderList();
    if (current === chat) els.title.textContent = r.title;
  } catch {}
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

// ---------- Word / PowerPoint: the text is read in your browser and sent like any other text file ----------
const NS = {
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
};
const MAX_DOC_CHARS = 400000;           // about 100k tokens; longer documents are cut off with a note
let zipLoader = null;
function loadZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!zipLoader) zipLoader = new Promise((res, rej) => {
    const sc = document.createElement("script");
    sc.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    sc.onload = () => res(window.JSZip);
    sc.onerror = () => { zipLoader = null; rej(new Error("Couldn't load the document reader. Check your connection and try again.")); };
    document.head.appendChild(sc);
  });
  return zipLoader;
}
const parseXml = (str) => {
  const d = new DOMParser().parseFromString(str, "application/xml");
  if (d.getElementsByTagName("parsererror").length) throw new Error("This file looks damaged, so I couldn't read it.");
  return d;
};
const kids = (el, ns, name) => [...el.children].filter((c) => c.localName === name && c.namespaceURI === ns);
const zipText = async (zip, path) => parseXml(await zip.file(path).async("string"));

// text of one paragraph (Word w:p or PowerPoint a:p) in reading order
function runsText(el) {
  let out = "";
  const walk = (n) => {
    for (const c of n.children) {
      switch (c.localName) {
        case "t": out += c.textContent; break;
        case "tab": out += "\t"; break;
        case "br": case "cr": out += "\n"; break;
        case "noBreakHyphen": out += "-"; break;
        case "pPr": case "rPr": case "endParaRPr": case "delText": case "instrText": case "Fallback": break;   // formatting, deleted text, field codes, duplicate fallbacks
        default: walk(c);
      }
    }
  };
  walk(el);
  return out;
}

// ----- Word (.docx) -----
function docxPara(p) {
  const text = runsText(p).replace(/\s+$/, "");
  if (!text.trim()) return "";
  const pPr = kids(p, NS.w, "pPr")[0];
  let prefix = "";
  if (pPr) {
    const style = kids(pPr, NS.w, "pStyle")[0]?.getAttributeNS(NS.w, "val") || "";
    const h = /^heading\s*(\d)/i.exec(style);
    if (h) prefix = "#".repeat(Math.min(6, +h[1])) + " ";
    else if (/^title$/i.test(style)) prefix = "# ";
    else if (/^list/i.test(style)) prefix = "- ";                         // "List Bullet" / "List Paragraph" styles
    const num = kids(pPr, NS.w, "numPr")[0];
    if (num && !prefix) prefix = "  ".repeat(+(kids(num, NS.w, "ilvl")[0]?.getAttributeNS(NS.w, "val") || 0)) + "- ";
  }
  return prefix + text;
}
const cellText = (tc, ns) => [...tc.getElementsByTagNameNS(ns, "p")].map((p) => runsText(p).trim()).filter(Boolean).join(" ");
const tableRows = (tbl, ns) => kids(tbl, ns, "tr").map((tr) => kids(tr, ns, "tc").map((tc) => cellText(tc, ns)).join(" | ")).filter((r) => r.replace(/[| ]/g, "")).join("\n");
function docxBlocks(parent, out) {
  for (const el of parent.children) {
    if (el.namespaceURI !== NS.w) continue;
    if (el.localName === "p") { const t = docxPara(el); if (t) out.push(t); }
    else if (el.localName === "tbl") { const t = tableRows(el, NS.w); if (t) out.push(t); }
    else if (["sdt", "sdtContent", "customXml"].includes(el.localName)) docxBlocks(el, out);
  }
}
async function readDocx(zip) {
  if (!zip.file("word/document.xml")) throw new Error("That doesn't look like a Word document.");
  const body = (await zipText(zip, "word/document.xml")).getElementsByTagNameNS(NS.w, "body")[0];
  const out = [];
  if (body) docxBlocks(body, out);
  if (zip.file("word/footnotes.xml")) {
    const notes = [...(await zipText(zip, "word/footnotes.xml")).getElementsByTagNameNS(NS.w, "footnote")]
      .filter((n) => +n.getAttributeNS(NS.w, "id") > 0)
      .map((n) => [...n.getElementsByTagNameNS(NS.w, "p")].map((p) => runsText(p).trim()).filter(Boolean).join(" ")).filter(Boolean);
    if (notes.length) out.push("Footnotes:\n" + notes.map((t, i) => `${i + 1}. ${t}`).join("\n"));
  }
  return out.join("\n\n");
}

// ----- PowerPoint (.pptx) -----
function aPara(p) {
  const t = runsText(p).replace(/\s+$/, "");
  if (!t.trim()) return "";
  const lvl = +(kids(p, NS.a, "pPr")[0]?.getAttribute("lvl") || 0);
  return (lvl ? "  ".repeat(lvl) + "- " : "") + t;
}
function pptxShapes(parent, out, info) {
  for (const el of parent.children) {
    if (el.namespaceURI !== NS.p) continue;
    const n = el.localName;
    if (n === "sp") {
      const type = el.getElementsByTagNameNS(NS.p, "ph")[0]?.getAttribute("type") || "";
      if (["sldNum", "dt", "ftr", "hdr"].includes(type)) continue;          // slide number, date, footer
      const lines = [...el.getElementsByTagNameNS(NS.a, "p")].map(aPara).filter(Boolean);
      if (!lines.length) continue;
      if ((type === "title" || type === "ctrTitle") && !info.title) info.title = lines.join(" ").replace(/\s+/g, " ").trim();
      else out.push(lines.join("\n"));
    } else if (n === "graphicFrame") {
      const tb = el.getElementsByTagNameNS(NS.a, "tbl")[0];
      if (tb) { const t = tableRows(tb, NS.a); if (t) out.push(t); }
    } else if (n === "grpSp") pptxShapes(el, out, info);
  }
}
// slides in presentation order (file names don't follow reordering), falling back to file number
async function slideFiles(zip) {
  try {
    const pres = await zipText(zip, "ppt/presentation.xml"), rels = await zipText(zip, "ppt/_rels/presentation.xml.rels");
    const map = {};
    for (const r of rels.getElementsByTagName("Relationship")) map[r.getAttribute("Id")] = r.getAttribute("Target");
    const ordered = [...pres.getElementsByTagNameNS(NS.p, "sldId")].map((s) => map[s.getAttributeNS(NS.r, "id")]).filter(Boolean)
      .map((t) => "ppt/" + t.replace(/^\/?(ppt\/)?/, "")).filter((f) => zip.file(f));
    if (ordered.length) return ordered;
  } catch {}
  return Object.keys(zip.files).map((f) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(f)).filter(Boolean).sort((x, y) => x[1] - y[1]).map((m) => m[0]);
}
async function readPptx(zip) {
  const files = await slideFiles(zip);
  if (!files.length) throw new Error("That doesn't look like a PowerPoint file.");
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const doc = await zipText(zip, files[i]), tree = doc.getElementsByTagNameNS(NS.p, "spTree")[0], body = [], info = { title: "" };
    if (tree) pptxShapes(tree, body, info);
    let notes = "";
    const relPath = files[i].replace(/([^/]+)$/, "_rels/$1.rels");
    if (zip.file(relPath)) {
      const rel = [...(await zipText(zip, relPath)).getElementsByTagName("Relationship")].find((r) => /\/notesSlide$/.test(r.getAttribute("Type") || ""));
      const target = rel && "ppt/" + rel.getAttribute("Target").replace(/^\.\.\//, "").replace(/^\/?(ppt\/)?/, "");
      if (target && zip.file(target)) {
        notes = [...(await zipText(zip, target)).getElementsByTagNameNS(NS.p, "sp")]
          .filter((sp) => sp.getElementsByTagNameNS(NS.p, "ph")[0]?.getAttribute("type") === "body")
          .map((sp) => [...sp.getElementsByTagNameNS(NS.a, "p")].map(aPara).filter(Boolean).join("\n")).filter(Boolean).join("\n");
      }
    }
    out.push(`## Slide ${i + 1}${info.title ? ": " + info.title : ""}\n` + [body.join("\n"), notes && "Speaker notes: " + notes].filter(Boolean).join("\n"));
  }
  return out.join("\n\n");
}

async function extractOffice(file, kind) {
  const JSZip = await loadZip();
  let zip;
  try { zip = await JSZip.loadAsync(await readAs(file, "readAsArrayBuffer")); }
  catch { throw new Error(`${file.name} isn't a valid .${kind} file (it may be password-protected or damaged).`); }
  let text = (kind === "docx" ? await readDocx(zip) : await readPptx(zip)).replace(/ /g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error(`I couldn't find any readable text in ${file.name}. (Images aren't read.)`);
  if (text.length > MAX_DOC_CHARS) text = text.slice(0, MAX_DOC_CHARS) + "\n\n[Truncated: the rest of this document is too long to send.]";
  return text;
}

async function addFiles(files) {
  for (const f of files) {
    const ext = (/\.(docx|pptx|doc|ppt)$/i.exec(f.name) || [])[1]?.toLowerCase();
    if (ext === "doc" || ext === "ppt") { toast(`${f.name}: old .${ext} files can't be read. Save it as .${ext}x and try again.`, "err"); continue; }
    if (ext === "docx" || ext === "pptx") {
      if (f.size > 25 * 1024 * 1024) { toast(`${f.name} is over 25 MB`, "err"); continue; }
      try { pending.push({ kind: "text", name: f.name, content: await extractOffice(f, ext), src: ext }); renderPending(); }
      catch (e) { toast(e.message || `Could not read ${f.name}`, "err"); }
      continue;
    }
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

// ----- custom model dropdown (native <select> stays hidden as the source of truth) -----
const MODEL_STYLE = { "claude-opus-5-5": ["#00e5ff", "0,229,255"], "claude-sonnet-5-5": ["#8b5cf6", "139,92,246"], "claude-haiku-5-5": ["#ff2bd6", "255,43,214"] };
const GEMINI_COLORS = [["#3dffa8", "61,255,168"], ["#ffb347", "255,179,71"], ["#5b8cff", "91,140,255"], ["#ff5c7a", "255,92,122"]];
const styleFor = (id) => MODEL_STYLE[id] || GEMINI_COLORS[Math.max(0, config.models.filter((m) => m.provider === "gemini").findIndex((m) => m.id === id)) % GEMINI_COLORS.length];
const dd = { root: $("modelDD"), btn: $("ddBtn"), menu: $("ddMenu"), label: $("ddLabel"), idx: -1 };
const modelParts = (name) => { const [n, d] = name.split("·").map((x) => x.trim()); return [n, d ? d[0].toUpperCase() + d.slice(1) : ""]; };
function buildModelMenu() {
  dd.menu.innerHTML = "";
  let lastProv = "";
  [...els.model.options].forEach((o, i) => {
    if (o.dataset.provider !== lastProv) {
      lastProv = o.dataset.provider;
      const head = document.createElement("div");
      head.className = "dd-head" + (i ? " sep" : "");
      head.textContent = lastProv === "gemini" ? "Gemini" : "Claude";
      dd.menu.appendChild(head);
      if (lastProv === "gemini" && !config.hasGemini) {
        const note = document.createElement("div");
        note.className = "dd-note"; note.textContent = "Add GEMINI_API_KEY in Render to use these.";
        dd.menu.appendChild(note);
      }
    }
    const [n, d] = modelParts(o.text), [c, rgb] = styleFor(o.value);
    const b = document.createElement("button");
    b.type = "button"; b.className = "dd-item"; b.setAttribute("role", "option"); b.dataset.v = o.value; b.dataset.i = i;
    b.style.setProperty("--c", c); b.style.setProperty("--rgb", rgb);
    b.innerHTML = `<span class="dd-dot"></span><span class="txt"><span class="nm"></span><span class="ds"></span></span>${icon("check", "tick")}`;
    b.querySelector(".nm").textContent = n; b.querySelector(".ds").textContent = d;
    if (modelLocked(o.value)) { b.classList.add("locked"); b.querySelector(".txt").insertAdjacentHTML("afterend", `<span class="lockTag">${plan.id === "plus" ? "Max" : "Plus"}</span>`); }
    b.onclick = () => {
      if (modelLocked(o.value)) { toggleDD(false); toast((plan.id === "plus" ? "Opus is part of the Max plan." : "Claude is part of Plus and Max.") + " Opening plans."); openPlans(false); return; } els.model.value = o.value; syncModelUI(); els.model.onchange(); toggleDD(false); dd.btn.focus(); };
    dd.menu.appendChild(b);
  });
  syncModelUI();
}
function syncModelUI() {
  const o = els.model.selectedOptions[0];
  if (!o) return;
  dd.label.textContent = modelParts(o.text)[0];
  dd.btn.style.setProperty("--c", styleFor(o.value)[0]);
  dd.btn.querySelector(".dd-dot").style.setProperty("--c", styleFor(o.value)[0]);
  syncEffortUI();
  dd.menu.querySelectorAll(".dd-item").forEach((b) => { const on = b.dataset.v === o.value; b.classList.toggle("sel", on); b.setAttribute("aria-selected", on); });
}
function focusItem(i) {
  const items = [...dd.menu.querySelectorAll(".dd-item")];
  if (!items.length) return;
  dd.idx = (i + items.length) % items.length;
  items.forEach((b, j) => b.classList.toggle("focus", j === dd.idx));
}
function toggleDD(open = !dd.root.classList.contains("open")) {
  if (open && typeof toggleEff === "function") toggleEff(false);
  dd.root.classList.toggle("open", open);
  dd.btn.setAttribute("aria-expanded", open);
  if (open) focusItem([...els.model.options].findIndex((o) => o.value === els.model.value));
}
dd.btn.onclick = () => toggleDD();
dd.btn.addEventListener("keydown", (e) => {
  const open = dd.root.classList.contains("open");
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!open) toggleDD(true); else focusItem(dd.idx + (e.key === "ArrowDown" ? 1 : -1)); }
  else if ((e.key === "Enter" || e.key === " ") && open) { e.preventDefault(); dd.menu.querySelectorAll(".dd-item")[dd.idx]?.click(); }
  else if (e.key === "Escape" && open) { e.stopPropagation(); toggleDD(false); }
});
document.addEventListener("pointerdown", (e) => { if (!dd.root.contains(e.target)) toggleDD(false); });

// ----- effort control -----
const EFFORTS = [
  { name: "Low", color: "#3dffa8", sub: "No extended thinking", desc: "Fastest replies. Best for simple questions and quick edits." },
  { name: "Medium", color: "#00e5ff", sub: "Light thinking", desc: "Balanced. A little reasoning before it answers." },
  { name: "High", color: "#8b5cf6", sub: "Deep thinking", desc: "Reasons for longer. Better for harder problems, code and maths." },
  { name: "Max", color: "#ff2bd6", sub: "Maximum thinking", desc: "Longest thinking. Slowest, and uses the most quota." },
];
const eff = { root: $("eff"), btn: $("effBtn"), range: $("effRange"), slider: $("effSlider") };
function syncEffortUI() {
  const e = EFFORTS[settings.effort] || EFFORTS[1];
  eff.root.style.setProperty("--ec", e.color);
  eff.range.value = settings.effort;
  eff.slider.style.setProperty("--p", settings.effort / 3);
  $("effTitle").textContent = e.name.toUpperCase();
  const m = els.model.selectedOptions[0];
  $("effSub").textContent = (m ? modelParts(m.text)[0] + " · " : "") + e.sub;
  $("effDesc").textContent = e.desc;
  $("effBtnLabel").textContent = e.name;
  document.querySelectorAll(".eff-ticks span").forEach((t, i) => t.classList.toggle("on", i === settings.effort));
}
let saveT = 0;
function settingsPayload(system) { return { system: system ?? settings.system ?? "", model: els.model.value, effort: settings.effort, retro: !!settings.retro, bg: settings.bg !== false, flicker: settings.flicker !== false }; }
function saveSettingsQuiet() { clearTimeout(saveT); saveT = setTimeout(() => api("/api/settings", { method: "PUT", body: settingsPayload() }).then((r) => { if (r?.settings) settings = { ...settings, ...r.settings }; }).catch(() => {}), 400); }
function setEffort(v) { settings.effort = Math.max(0, Math.min(3, Number(v))); syncEffortUI(); saveSettingsQuiet(); }
function toggleEff(open = !eff.root.classList.contains("open")) {
  eff.root.classList.toggle("open", open);
  eff.btn.setAttribute("aria-expanded", open);
  if (open) { toggleDD(false); setTimeout(() => eff.range.focus({ preventScroll: true }), 50); }
}
eff.btn.onclick = () => toggleEff();
eff.range.addEventListener("input", () => setEffort(eff.range.value));
$("effReset").onclick = () => setEffort(config.defaultEffort ?? 1);
eff.root.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); toggleEff(false); eff.btn.focus(); } });
document.addEventListener("pointerdown", (e) => { if (!eff.root.contains(e.target)) toggleEff(false); });

els.model.onchange = () => {
  settings.model = els.model.value;
  if (current) current.model = els.model.value;
  saveSettingsQuiet();
};
document.querySelectorAll(".chip").forEach((c) => (c.onclick = () => sendMessage(c.querySelector("span").textContent)));

// Settings are drafts: nothing is applied or saved until you press Save.
const setFields = { retro: $("optRetro"), bg: $("optBg"), flicker: $("optFlicker"), sys: $("sysPrompt"), gfxCpu: $("optGfxCpu"), gfxGpu: $("optGfxGpu") };
const draftGfx = () => (setFields.gfxGpu.checked ? "gpu" : "cpu");
function fillSettings() {
  setFields.retro.checked = !!settings.retro;
  setFields.bg.checked = settings.bg !== false;
  setFields.flicker.checked = settings.flicker !== false;
  setFields.sys.value = settings.system || "";
  setFields.gfxGpu.checked = settings.gfx === "gpu"; setFields.gfxCpu.checked = settings.gfx !== "gpu";
}
const isDirty = () =>
  setFields.retro.checked !== !!settings.retro || setFields.bg.checked !== (settings.bg !== false) ||
  setFields.flicker.checked !== (settings.flicker !== false) || setFields.sys.value.trim() !== (settings.system || "").trim() ||
  draftGfx() !== (settings.gfx === "gpu" ? "gpu" : "cpu");
function updateUnsaved() {
  const bar = $("unsaved"), dirty = isDirty();
  if (dirty && bar.hidden) { bar.hidden = false; bar.style.animation = "none"; void bar.offsetWidth; bar.style.animation = ""; }
  else if (!dirty) bar.hidden = true;
}
// what this device reports: helps explain why effects look the way they do
let gpuName = null;
function detectGpu() {
  if (gpuName !== null) return gpuName;
  gpuName = "";
  try {
    const c = document.createElement("canvas"), gl = c.getContext("webgl") || c.getContext("experimental-webgl");
    if (!gl) gpuName = "no WebGL (no graphics acceleration)";
    else { const x = gl.getExtension("WEBGL_debug_renderer_info"); gpuName = x ? String(gl.getParameter(x.UNMASKED_RENDERER_WEBGL)) : "a graphics adapter"; const l = gl.getExtension("WEBGL_lose_context"); if (l) l.loseContext(); }
  } catch { gpuName = "unknown"; }
  return gpuName;
}
function showGfxInfo() {
  const g = detectGpu(), soft = /swiftshader|llvmpipe|software|basic render|no webgl/i.test(g);
  const rm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  $("gfxInfo").textContent = `Detected: ${g || "unknown"}${soft ? " (software rendering, CPU mode is the right choice)" : ""}. ` +
    (rm ? "Your system asks apps to reduce motion; the effects are still shown. Use the switches here to calm them down." : "");
}
function openSettings() {
  fillSettings(); updateUnsaved(); showGfxInfo();
  $("settings").classList.remove("hidden");
  $("settings").querySelector(".set-body").scrollTop = 0;
}
function closeSettings(force = false) {
  if (force !== true && isDirty()) {           // refuse to close while there are unsaved changes: shake the warning
    const bar = $("unsaved"); bar.classList.remove("shake"); void bar.offsetWidth; bar.classList.add("shake"); return;
  }
  $("settings").classList.add("hidden"); fillSettings(); updateUnsaved();
}
async function saveDraft() {
  try {
    const r = await api("/api/settings", { method: "PUT", body: {
      ...settingsPayload(setFields.sys.value.trim()), retro: setFields.retro.checked, bg: setFields.bg.checked, flicker: setFields.flicker.checked,
    } });
    settings = { ...settings, ...r.settings, gfx: draftGfx() }; applyLook(); updateUnsaved(); return true;
  } catch (err) { toast(err.message, "err"); return false; }
}
$("settingsBtn").onclick = openSettings;
$("closeSettings").onclick = () => closeSettings();
$("settings").onmousedown = (e) => { if (e.target === $("settings")) closeSettings(); };
Object.values(setFields).forEach((el) => el.addEventListener(el === setFields.sys ? "input" : "change", updateUnsaved));
$("unsavedReset").onclick = () => { fillSettings(); updateUnsaved(); };
$("unsavedSave").onclick = async () => { if (await saveDraft()) toast("Settings saved."); };
$("saveSettings").onclick = async () => { if (!isDirty() || (await saveDraft())) closeSettings(true); };
$("signOutBtn").onclick = () => { closeSettings(true); $("logoutBtn").click(); };
$("clearAll").onclick = async () => {
  if (!(await dialog({ title: "Delete ALL chats?", message: "This permanently removes every chat on your account, on all devices.", ok: "Delete everything", danger: true }))) return;
  try {
    await api("/api/chats", { method: "DELETE" });
    chats = []; startNew(); closeSettings(true); toast("All chats deleted.");
  } catch (err) { toast(err.message, "err"); }
};
$("nukeBtn").onclick = async () => {
  if (!user?.dev) return;
  const ok1 = await dialog({
    title: "Take NEON AI offline?",
    message: "Warning: this shuts the ENTIRE website down for everyone, on freestudyresources.org and the Render address. Everyone sees a NEON AI has been NUKED page. Nobody can sign in or chat unless they know the bypass code.",
    ok: "I understand, continue", danger: true,
  });
  if (!ok1) return;
  const ok2 = await dialog({
    title: "Are you absolutely sure?",
    message: "The site stays off until you ask Claude to turn it back on. There is no button on the website to undo this. Only the bypass code gets anyone through while it's off.",
    ok: "Yes, keep going", danger: true,
  });
  if (!ok2) return;
  const typed = await dialog({
    title: "Final confirmation",
    message: "Type NUKE in capital letters to shut everything down now.",
    input: "", placeholder: "NUKE", ok: "Shut it all down", danger: true,
  });
  if (typed === null) return;
  if (typed !== "NUKE") { toast("That wasn't NUKE. Nothing was shut down.", "err"); return; }
  try {
    await api("/api/dev/nuke", { method: "POST", body: { confirm: "NUKE" }, noAuthRedirect: true });
    closeSettings(true);
    document.body.innerHTML = '<div style="position:fixed;inset:0;display:grid;place-items:center;background:#12062b;color:#f6e9ff;font-family:system-ui,sans-serif;text-align:center;padding:24px"><div><h1 style="letter-spacing:.2em;margin:0 0 10px;color:#ff5fd8">NEON AI</h1><p style="margin:0;color:#c9b4e8">NEON AI has been NUKED. Ask Claude to turn it back on.</p></div></div>';
  } catch (err) { toast(err.message, "err"); }
};

$("deleteAcct").onclick = async () => {
  // warning 1: are you sure?
  const first = await dialog({
    title: "Delete your account?",
    message: "This permanently deletes your account, every chat and all your settings, on every device. You will be signed out and can't get any of it back.",
    ok: "Continue", danger: true,
  });
  if (!first) return;
  // warning 2: final warning, password required (Google accounts have none, so they type their username)
  const viaGoogle = user.hasPassword === false;
  const pw = await dialog({
    title: "Final warning",
    message: viaGoogle ? `Last chance. "${user.username}" and all of its chats will be erased forever. Type your username to confirm.` : `Last chance. "${user.username}" and all of its chats will be erased forever. Enter your password to confirm.`,
    input: "", password: !viaGoogle, placeholder: viaGoogle ? user.username : "Your password", ok: "Delete my account forever", danger: true,
  });
  if (pw === null) return;
  if (!pw) { toast(viaGoogle ? "Type your username to confirm." : "Enter your password to confirm.", "err"); return; }
  try {
    await api("/api/account/delete", { method: "POST", body: viaGoogle ? { confirm: pw } : { password: pw }, noAuthRedirect: true });
    const name = user.username;
    try { localStorage.removeItem("neon-last-" + name); } catch {}
    closeSettings(true); showAuth(); toast("Your account was deleted.");
  } catch (err) { toast(err.message, "err"); }
};
$("logoutBtn").onclick = async () => {
  try { await api("/api/logout", { method: "POST", noAuthRedirect: true }); } catch {}
  showAuth(); toast("Signed out.");
};

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (dd.root.classList.contains("open")) toggleDD(false);
  else if (eff.root.classList.contains("open")) toggleEff(false);
  else if (!$("dialog").classList.contains("hidden")) $("dlgCancel").click();
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
  user = data.user; plan = data.plan || plan; settings = { system: "", model: "", effort: config.defaultEffort ?? 1, retro: true, bg: true, flicker: true, ...(data.settings || {}), gfx: readLook().gfx === "gpu" ? "gpu" : "cpu" };
  $("auth").classList.add("hidden"); $("app").classList.remove("hidden"); document.body.classList.add("in-app"); applyLook();
  $("meName").textContent = user.username; paintAvatar($("meAvatar"), user.username, user.picture);
  $("setName").textContent = user.username; paintAvatar($("setAvatar"), user.username, user.picture);
  els.model.innerHTML = "";
  config.models.forEach((m) => { const o = new Option(m.name, m.id); o.dataset.provider = m.provider; els.model.add(o); });
  const okModel = (id) => config.models.some((m) => m.id === id) && !modelLocked(id);
  els.model.value = okModel(settings.model) ? settings.model : okModel(config.defaultModel) ? config.defaultModel : (config.models.find((m) => !modelLocked(m.id)) || config.models[0]).id;
  buildModelMenu(); renderPlanSettings(); $("devSec").hidden = !user.dev;
  if (config.hasKey === false) $("emptyMsg").textContent = "The server has no ANTHROPIC_API_KEY yet. Add it in Render's environment settings.";
  els.search.value = "";
  current = null;
  try { chats = (await api("/api/chats")).chats; } catch { chats = []; }
  const last = ls.get("neon-last-" + user.username);
  if (last && chats.some((c) => c.id === last)) await openChat(last); else startNew();
  renderList();
  retitleOld();
  clearInterval(syncTimer);
  syncTimer = setInterval(syncNow, 25000);
  if (!plan.chosen && !user.dev) openPlans(true);               // first time in: the plan pop-up comes before anything else
}

(async function init() {
  const qs = new URLSearchParams(location.search), authErr = qs.get("auth_error"), welcome = qs.has("welcome");
  if (authErr || welcome) history.replaceState(null, "", location.pathname);
  try { config = await (await fetch("/api/config")).json(); } catch {}
  try {
    const data = await api("/api/me", { noAuthRedirect: true });
    await enterApp(data);
    if (welcome) toast("Account created with Google. Welcome aboard.");
  } catch {
    showAuth(authErr || "");
    if (authErr) toast(authErr, "err");
  }
})();
