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
let config = { hasGoogle: false, mailReady: true, models: [], defaultModel: "", plans: [], freeTokens: 25000, plusClaudeMsgs: 50, hasKey: true, hasGemini: false, defaultEffort: 1 };
let user = null;
let plan = { id: "free", requested: null, owner: false, usedTokens: 0, usedClaude: 0, resetAt: null };
const readLook = () => { try { return JSON.parse(localStorage.getItem("neon-look") || "{}") || {}; } catch { return {}; } };
let settings = { system: "", model: "", effort: 1, retro: true, bg: true, flicker: true, gfx: readLook().gfx === "gpu" ? "gpu" : "cpu" };
let chats = [];          // metadata list for the sidebar: {id,title,model,created,updated}
let bootOpen = false;   // true while the last chat is re-opened on page load
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

function dialog({ title, message = "", input = null, ok = "OK", danger = false, password = false, placeholder = "", cancel = true }) {
  return new Promise((resolve) => {
    const box = $("dialog"), form = $("dlgForm"), inp = $("dlgInput");
    $("dlgTitle").textContent = title;
    $("dlgMsg").textContent = message; $("dlgMsg").hidden = !message;
    inp.hidden = input === null; if (input !== null) inp.value = input;
    inp.type = password ? "password" : "text"; inp.placeholder = placeholder; inp.autocomplete = password ? "current-password" : "off"; inp.maxLength = password ? 72 : 120;
    $("dlgCancel").hidden = !cancel;
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
  if (!res.ok) { const e = new Error(data?.error || `Request failed (${res.status})`); e.status = res.status; e.field = data?.field; e.gone = !!data?.gone; throw e; }
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

// ---------- Terms of Service / Privacy Policy viewer ----------
const legalCache = {};
let legalDoc = "";
async function showLegal(doc) {
  if (!["terms", "privacy"].includes(doc)) return;
  const ov = $("legal"), body = $("legalBody"), tabs = ov.querySelector(".legal-tabs");
  tabs.dataset.t = doc; tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.t === doc));
  $("legalOpen").href = "/" + doc;
  const first = ov.classList.contains("hidden");
  if (first) { body.innerHTML = ""; ov.classList.remove("hidden"); }
  else if (legalDoc !== doc) { body.classList.add("swap"); await new Promise((r) => setTimeout(r, 180)); }
  legalDoc = doc;
  try {
    if (!legalCache[doc]) legalCache[doc] = await (await fetch("/api/legal/" + doc)).text();
    body.innerHTML = legalCache[doc];
  } catch { body.innerHTML = "<p>Couldn't load this page. <a href='/" + doc + "' target='_blank'>Open it on its own</a>.</p>"; }
  $("legalScroll").scrollTop = 0;
  body.classList.remove("swap"); body.style.animation = "none"; void body.offsetWidth; body.style.animation = "";   // replay the fade-in for the new text
}
function closeLegal() { $("legal").classList.add("hidden"); }
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-legal]");
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;     // ctrl/cmd-click still opens the plain page in a new tab
  e.preventDefault(); showLegal(a.dataset.legal);
});
$("legal").querySelectorAll(".legal-tabs button").forEach((b) => (b.onclick = () => showLegal(b.dataset.t)));
$("closeLegal").onclick = closeLegal; $("legalOk").onclick = closeLegal;
$("legal").onmousedown = (e) => { if (e.target === $("legal")) closeLegal(); };
addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("legal").classList.contains("hidden")) { e.stopImmediatePropagation(); closeLegal(); } }, true);

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
function needAgree() {
  if ($("agree").checked) return false;
  const l = $("fAgree"); l.classList.remove("bad"); void l.offsetWidth; l.classList.add("bad");
  authEls.err.textContent = "Please agree to the Terms of Service and Privacy Policy to continue.";
  return true;
}
$("agree").addEventListener("change", () => { $("fAgree").classList.remove("bad"); authEls.err.textContent = ""; });
async function googleGo() {
  if (!config.hasGoogle) { toast("Google sign-in isn't set up yet.", "err"); return; }
  if (mode === "signup" && needAgree()) return;                          // creating an account needs the Terms ticked
  googleBusy(true);
  try {
    const body = { remember: $("remember").checked };
    if (mode === "signup") { body.username = authEls.user.value.trim(); body.password = authEls.pass.value; body.agree = true; if (approval.ok) body.approval = approval.token; }   // the username they chose is kept
    const d = await api("/api/auth/google/start", { method: "POST", noAuthRedirect: true, body });
    location.href = d.url;
  } catch (err) {
    googleBusy(false);
    if (err.field === "closed") { config.signupsOpen = false; dropApproval(); setMode("signup"); return; }
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

// "Create account" while sign-ups are closed: the form and the notice swap places with the same springy height morph as the sign-up steps
let closedShown = false, swapT = 0;
const approval = { token: "", email: "", ok: false };      // set when the page is opened from an approval email (?signup=...)
function showClosedNote(on, instant) {
  if (on === closedShown) return;
  const wrap = $("authBody"), form = $("formC"), note = $("closedC");
  clearTimeout(swapT); [form, note].forEach((e) => e.classList.remove("swap-out", "swap-in"));      // a quick second click finishes the first swap at once
  closedShown = on; const from = on ? form : note, to = on ? note : form;
  if (instant || !wrap.offsetParent) { from.hidden = true; to.hidden = false; wrap.style.height = ""; wrap.classList.remove("morphing"); return; }
  const h0 = wrap.getBoundingClientRect().height; wrap.style.height = h0 + "px"; wrap.classList.add("morphing"); from.classList.add("swap-out");
  swapT = setTimeout(() => {
    from.hidden = true; from.classList.remove("swap-out"); to.hidden = false; to.classList.add("swap-in");
    wrap.style.height = "auto"; const h1 = wrap.getBoundingClientRect().height; wrap.style.height = h1 + "px";
    const an = wrap.animate([{ height: h0 + "px" }, { height: h1 + "px" }], { duration: 700, easing: SPRING });
    an.onfinish = an.oncancel = () => { wrap.style.height = ""; wrap.classList.remove("morphing"); to.classList.remove("swap-in"); };
  }, 220);
}
// an approval email's link: the page opens the normal sign-up with the approved email locked in
function dropApproval() { approval.ok = false; approval.token = ""; $("email").readOnly = false; }
async function checkApproval(token) {
  try {
    const d = await api("/api/signup/approval", { method: "POST", noAuthRedirect: true, body: { token } });
    Object.assign(approval, { token, email: d.email, ok: true });
    $("approvedEmail").textContent = d.email; $("email").value = d.email; $("email").readOnly = true;
    setMode("signup"); toast("You're approved! Create your account below.", "ok");
  } catch (e) { toast(e.message || "That approval link isn't valid.", "err"); }
}
function setMode(m, instant) {
  mode = m;
  document.querySelector(".tabs").dataset.mode = m;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.mode === m));
  authEls.pass.autocomplete = m === "login" ? "current-password" : "new-password";
  authEls.user.placeholder = m === "login" ? "Username or email" : "Username";
  $("forgotC").classList.remove("open");
  $("strengthC").classList.toggle("open", m === "signup");
  $("stepperC").classList.toggle("open", m === "signup");
  const closed = m === "signup" && config.signupsOpen !== true && !approval.ok;        // sign-ups are switched off for now: show the notice instead of the form
  showClosedNote(closed, instant);
  $("approvedNote").hidden = !(approval.ok && m === "signup");
  if (step !== 1) goStep(1, instant); else syncStep(!instant);
  authEls.err.textContent = "";
  document.querySelectorAll(".field.bad").forEach((f) => f.classList.remove("bad"));
}
document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => { if (t.dataset.mode !== mode) setMode(t.dataset.mode); }));

$("closedBack").onclick = () => setMode("login");
$("closedSupport").onclick = () => NeonSupport.open({ suggest: "account" });
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
  if (mode === "signup" && step === 2 && needAgree()) return;
  if (mode === "signup" && step === 3 && otpS.code().length < 6) { otpS.shake(); authEls.err.textContent = "Enter the 6-digit code."; return; }
  authEls.btn.classList.add("loading"); authEls.btn.disabled = true;
  try {
    let data;
    if (mode === "login") data = await api("/api/login", { method: "POST", noAuthRedirect: true, body: { username, password, remember: $("remember").checked } });
    else if (step === 2) {
      // email route: send the code, then slide to the code screen
      const d = await api("/api/signup/start", { method: "POST", noAuthRedirect: true, body: { username, password, email, agree: true, ...(approval.ok ? { approval: approval.token } : {}) } });
      signupEmail = email.toLowerCase(); $("codeSub").textContent = `We sent a 6-digit code to ${d.email}. It's valid for 10 minutes.`;
      otpS.clear(); startResendCooldown(d.cooldown || 30); goStep(3);
      return;
    } else data = await api("/api/signup/verify", { method: "POST", noAuthRedirect: true, body: { email: signupEmail, code: otpS.code(), remember: $("remember").checked } });
    authEls.pass.value = ""; $("email").value = ""; otpS.clear(); clearInterval(timers[""]);
    await enterApp(data);
    if (mode === "signup") toast("Account created. Welcome aboard.");
  } catch (err) {
    const map = { email: "fEmail", username: "fUser", password: "fPass" };
    if (err.field === "closed") { config.signupsOpen = false; dropApproval(); setMode("signup"); }
    else if (err.field === "code") { otpS.clear(); otpS.shake(); authEls.err.textContent = err.message; if (!err.expired) otpS.boxes[0].focus(); }
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
  free: { badge: "", feats: ["25,000 Gemini tokens every 12 hours", "Gemini 3.5 Flash-Lite and 2.5 Flash", "Chats synced on every device", "Images, PDFs, Word and PowerPoint"], off: [], support: "Community support" },
  spark: { badge: "", feats: ["Unlimited Gemini, no daily cap", "Gemini 3.5 Flash-Lite and 2.5 Flash", "Chats synced on every device", "Images, PDFs, Word and PowerPoint"], off: [], support: "Email support" },
  plus: { badge: "Popular", feats: ["Everything in Spark", "Claude Sonnet and Haiku", "Fair use: 50 Claude messages every 12 hours", "Unlimited Gemini"], off: [], support: "Priority email support" },
  max: { badge: "Best value", feats: ["Everything in Plus", "Claude Opus, the smartest model", "No limit on Claude messages", "Early access to new features"], off: [], support: "Priority support, answered first" },
};
const tickIc = () => icon("check");
function planCardHTML(p, opts) {
  const c = PLAN_COPY[p.id] || { feats: [], off: [] };
  const price = p.price === 0 ? "Free" : "A$" + p.price;
  const cur = opts.current === p.id;
  const pay = !!plan.billing?.enabled;
  const cta = opts.gate ? (p.price === 0 ? "Continue with Free" : (pay ? "Subscribe to " : "Choose ") + p.name) : cur ? "Your plan" : p.price === 0 ? "Included" : pay ? "Subscribe" : (plan.requested === p.id ? "Requested" : "Choose plan");
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
// ---------- paying: Stripe Checkout and the customer portal (the server decides what the plan is; the webhook switches it on) ----------
async function goBilling(path, body) {
  try { const d = await api(path, { method: "POST", body: body || {} }); if (d?.url) location.href = d.url; }
  catch (e) { toast(e.message, "err"); }
}
async function choosePlan(id) {
  if (id === plan.id) return;
  if (id === "free") { if (plan.billing?.customer) goBilling("/api/billing/portal"); else toast("You're already on Free."); return; }
  if (plan.billing?.enabled) { toast("Taking you to secure checkout..."); goBilling("/api/billing/checkout", { plan: id }); return; }
  try {
    const d = await api("/api/plan/request", { method: "POST", body: { plan: id } });
    plan = d.plan; renderPlans(); renderPlanSettings();
    toast("Got it. We'll switch on " + (config.plans.find((p) => p.id === id)?.name || "your plan") + " when payments open.");
  } catch (e) { toast(e.message, "err"); }
}
let gatePlans = false;
// after paying, the webhook may take a few seconds to switch the plan on: look every 2 seconds
async function watchPlanChange() {
  const before = plan.id; toast("Payment received. Switching on your plan...");
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try { const d = await api("/api/me", { noAuthRedirect: true }); if (d?.plan && d.plan.id !== before) { plan = d.plan; renderPlanSettings(); renderPlans(); toast("You're on " + (config.plans.find((p) => p.id === plan.id)?.name || "your new plan") + ". Thank you!"); return; } } catch {}
  }
  toast("Your payment went through. If your plan hasn't changed in a minute, refresh the page.");
}
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
    if (id !== "free" && d.plan.billing?.enabled) { plan = d.plan; toast("Taking you to secure checkout..."); goBilling("/api/billing/checkout", { plan: id }); return; }
    plan = d.plan; gatePlans = false; $("plans").classList.add("hidden"); renderPlanSettings(); maybeWhatsNew();
    toast(id === "free" ? "You're on Free. Welcome aboard." : "Got it. You start on Free, and we'll switch on " + (config.plans.find((p) => p.id === id)?.name || "your plan") + " when payments open.");
  } catch (e) { toast(e.message, "err"); }
}
// ---------- update log: pops up once per new version (unless "Don't show again" is ticked) ----------
const wnKey = (k) => "neon-" + k + "-" + (user?.username || "");
let wnShowing = false;
function fillWhatsNew() {
  const list = (config.changelog || []), cur = list[0]; if (!cur) return false;
  $("wnTag").textContent = cur.tag || "Update"; $("wnTitle").textContent = cur.title || "What's new";
  $("wnMeta").textContent = "Version " + cur.version + (cur.date ? " · " + cur.date : "");
  const box = $("wnList"); box.innerHTML = "";
  cur.items.forEach((it, i) => { const d = document.createElement("div"); d.className = "wn-item"; d.style.animationDelay = 0.12 + i * 0.07 + "s"; d.innerHTML = `<span class="wn-ic"></span><span class="wn-tx"></span>`; d.querySelector(".wn-ic").textContent = it.icon || "•"; d.querySelector(".wn-tx").innerHTML = DOMPurify.sanitize(it.text || "", { ALLOWED_TAGS: ["b", "i", "em", "strong", "code", "br"], ALLOWED_ATTR: ["class"] }); box.appendChild(d); });
  return true;
}
function openWhatsNew(manual) {
  if (wnShowing || !fillWhatsNew()) return;
  wnShowing = true; $("wnNever").checked = !!ls.get(wnKey("nolog"));
  $("wnOk").querySelector(".lbl").textContent = manual ? "Close" : "Got it";
  const o = $("whatsnew"); o.classList.remove("hidden", "out");
}
function closeWhatsNew() {
  if (!wnShowing) return; wnShowing = false;
  try { ls.set(wnKey("seen"), config.version); if ($("wnNever").checked) ls.set(wnKey("nolog"), "1"); else localStorage.removeItem(wnKey("nolog")); } catch {}
  const o = $("whatsnew"); o.classList.add("out"); setTimeout(() => { if (!wnShowing) o.classList.add("hidden"); o.classList.remove("out"); }, 260);
}
function maybeWhatsNew() { if (!user || !config.version || ls.get(wnKey("nolog")) || ls.get(wnKey("seen")) === config.version) return; setTimeout(() => openWhatsNew(false), 700); }
$("wnOk").onclick = closeWhatsNew; $("wnX").onclick = closeWhatsNew;
$("whatsnew").onmousedown = (e) => { if (e.target === $("whatsnew")) closeWhatsNew(); };
$("wnOpen").onclick = () => { closeSettings(true); setTimeout(() => openWhatsNew(true), 200); };
addEventListener("keydown", (e) => { if (e.key === "Escape" && wnShowing) { e.stopImmediatePropagation(); closeWhatsNew(); } }, true);
$("closePlans").onclick = closePlans;
$("plans").onmousedown = (e) => { if (e.target === $("plans")) closePlans(); };
$("seePlans").onclick = () => openPlans(false);
$("manageBilling").onclick = () => goBilling("/api/billing/portal");
function renderPlanSettings() {
  const p = config.plans.find((x) => x.id === plan.id) || { name: "Free" };
  $("planName").textContent = user?.dev ? "Developer" : p.name + (plan.owner ? " (owner)" : "");
  const req = plan.requested ? ` Requested: ${config.plans.find((x) => x.id === plan.requested)?.name}, switches on when payments open.` : "";
  $("planSub").textContent = (plan.id === "free" ? "Gemini only, with a token limit that resets every 12 hours." : plan.id === "plus" ? "Unlimited Gemini, plus Claude Sonnet and Haiku." : user?.dev ? "Dev account: full access, no limits." : plan.id === "max" ? "Everything, unlimited." : "Unlimited Gemini.") + req;
  const b = plan.billing || {}, mb = $("manageBilling");
  mb.hidden = !b.customer;
  if (b.customer && b.renews && plan.id !== "free" && !user?.dev) $("planSub").textContent += " " + (b.cancelling ? "Ends on " : "Renews on ") + new Date(b.renews).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) + (b.status === "past_due" ? ". Your last payment failed, please update your card." : ".");
  renderUsage();
}
// ---------- daily usage: the ring beside your name, its pop-up, and the Settings section ----------
const DEV_TIERS = [["Light green", "#6dffae"], ["Dark green", "#1fb865"], ["Light yellow", "#ffe27a"], ["Dark yellow", "#e0a800"], ["Light red", "#ff8f9d"], ["Dark red", "#d1203a"]];   // each step is 20,000 tokens, then rainbow
const devTier = () => { const i = Math.floor(plan.usedTokens / 20000); return i >= DEV_TIERS.length ? null : { i, name: DEV_TIERS[i][0], color: DEV_TIERS[i][1] }; };
function usageInfo() {
  const rows = [
    { name: "Gemini", used: plan.usedTokens, limit: plan.id === "free" ? config.freeTokens : null, unit: "tokens", on: true },
    { name: "Claude", used: plan.usedClaude, limit: plan.id === "plus" ? config.plusClaudeMsgs : null, unit: "messages", on: plan.id === "plus" || plan.id === "max" },
  ];
  rows.forEach((r) => (r.pct = r.limit ? Math.min(100, Math.round((r.used / r.limit) * 100)) : null));
  const top = rows.filter((r) => r.on && r.limit).sort((a, b) => b.pct - a.pct)[0] || null;   // the one you've used the most of
  return { rows, top };
}
// limits reset 12 hours after the first message on an empty limit: show the time left, with seconds, counting down live
const fmtLeft = (ms) => { const t = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60, p = (n) => String(n).padStart(2, "0"); return h ? `${h}h ${p(m)}m ${p(s)}s` : m ? `${m}m ${p(s)}s` : `${s}s`; };
const resetText = () => (plan.resetAt && plan.resetAt > Date.now() ? "Resets in " + fmtLeft(plan.resetAt - Date.now()) : "Resets 12h after your first message");
setInterval(() => {                                                // tick every second while the numbers are on screen
  if (!user) return;
  if (plan.resetAt && plan.resetAt <= Date.now()) { plan.resetAt = null; plan.usedTokens = 0; plan.usedClaude = 0; renderUsage(); return; }
  document.querySelectorAll(".rst").forEach((e) => (e.textContent = resetText()));
}, 1000);
function usageRowsHTML() {
  const { rows } = usageInfo();
  let h = rows.map((r) => {
    const hot = r.pct >= 85 ? "hot" : "";
    const right = !r.on ? "Not on your plan" : r.limit ? resetText() : "Unlimited";
    const foot = r.on ? `${r.used.toLocaleString()}${r.limit ? " of " + r.limit.toLocaleString() : ""} ${r.unit} used` : "Claude comes with Plus and Max";
    return `<div class="up-row${r.on ? "" : " off"}"><div class="up-l"><b>${r.name}</b><span${r.limit && r.on ? ' class="rst"' : ""}>${right}</span>${r.limit ? `<strong class="${hot}">${r.pct}%</strong>` : ""}</div>${r.limit ? `<div class="usage-bar"><i class="${hot}" style="width:${r.pct}%"></i></div>` : ""}<small>${foot}</small></div>`;
  }).join("");
  if (user?.dev) { const t = devTier(); h += `<div class="up-dev"><span class="inf ${t ? "" : "rainbow"}" style="${t ? "--ic:" + t.color : ""}">∞</span><span>${t ? t.name + ": under " + ((t.i + 1) * 20) + "k Gemini tokens in this 12-hour window" : "Rainbow: over 120k Gemini tokens in this 12-hour window"}</span></div>`; }
  return h;
}
let usageOpen = false;
function renderUsage() {
  const btn = $("usageBtn"); if (!user) return;
  const { top } = usageInfo(), dev = !!user.dev;
  btn.hidden = false;
  if (dev) { const t = devTier(); btn.innerHTML = `<span class="inf ${t ? "" : "rainbow"}" style="${t ? "--ic:" + t.color : ""}">∞</span>`; btn.title = "Developer · " + plan.usedTokens.toLocaleString() + " Gemini tokens today"; }
  else if (top) {
    const C = 2 * Math.PI * 10, col = top.pct >= 85 ? "#ff5c7a" : top.pct >= 60 ? "#ffb347" : "var(--cyan)";
    btn.innerHTML = `<svg viewBox="0 0 26 26"><circle class="tr" cx="13" cy="13" r="10"/><circle class="pg" cx="13" cy="13" r="10" style="--rc:${col};stroke-dasharray:${C.toFixed(1)};stroke-dashoffset:${(C * (1 - top.pct / 100)).toFixed(1)}"/></svg>`;
    btn.title = `${top.pct}% of your ${top.name} limit used`;
  } else { btn.innerHTML = `<span class="inf dim">∞</span>`; btn.title = "Unlimited"; }
  const pop = $("usagePop");
  pop.innerHTML = `<div class="up-h"><b>${dev ? "Developer" : "Usage · " + (config.plans.find((x) => x.id === plan.id)?.name || "Free")}</b><button type="button" class="up-all">See all →</button></div>${usageRowsHTML()}`;
  pop.querySelector(".up-all").onclick = () => { toggleUsage(false); openSettings(); setTimeout(() => $("usageBox").scrollIntoView({ behavior: "smooth", block: "center" }), 60); };
  $("usageBox").innerHTML = usageRowsHTML();
}
function toggleUsage(on) {
  usageOpen = on == null ? !usageOpen : on; $("usagePop").classList.toggle("open", usageOpen);
  if (usageOpen) api("/api/me", { noAuthRedirect: true }).then((d) => { if (usageOpen && d && d.plan) { plan = { ...plan, usedTokens: d.plan.usedTokens, usedClaude: d.plan.usedClaude, resetAt: d.plan.resetAt }; renderUsage(); } }).catch(() => {});
}
$("usageBtn").onclick = (e) => { e.stopPropagation(); toggleUsage(); };
document.addEventListener("mousedown", (e) => { if (usageOpen && !e.target.closest("#usagePop, #usageBtn")) toggleUsage(false); });
const modelLocked = (id) => {
  const m = config.models.find((x) => x.id === id);
  if (!m || m.provider !== "claude") return false;
  if (plan.id === "max") return false;
  return plan.id !== "plus" || /opus/i.test(id);
};

// ---------- markdown + code panels (live preview, copy, download, fullscreen) ----------
marked.setOptions({ breaks: true, gfm: true });

const EXT = { html: "html", htm: "html", xhtml: "html", svg: "svg", md: "md", markdown: "md", csv: "csv", json: "json", javascript: "js", js: "js", jsx: "jsx", typescript: "ts", ts: "ts", tsx: "tsx", python: "py", py: "py", css: "css", scss: "scss",
  java: "java", c: "c", cpp: "cpp", "c++": "cpp", csharp: "cs", cs: "cs", "c#": "cs", go: "go", rust: "rs", rs: "rs", ruby: "rb", rb: "rb", php: "php", bash: "sh", sh: "sh", shell: "sh", zsh: "sh", sql: "sql", xml: "xml",
  yaml: "yaml", yml: "yml", kotlin: "kt", kt: "kt", swift: "swift", lua: "lua", r: "r", dart: "dart", toml: "toml", ini: "ini", dockerfile: "Dockerfile", tex: "tex", latex: "tex", txt: "txt", text: "txt" };
const MIME = { html: "text/html", svg: "image/svg+xml", md: "text/markdown", csv: "text/csv", json: "application/json", css: "text/css", js: "text/javascript", xml: "application/xml" };
const slug = (t) => (String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)) || "neon-ai";
function downloadText(name, text, ext) {
  const blob = new Blob([text], { type: (MIME[ext] || "text/plain") + ";charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

// which code blocks get the full panel
function artifactKind(lang, code) {
  const t = code.trim();
  const fk = window.NeonFiles && NeonFiles.langToKind(lang);             // pdf / docx / pptx / xlsx files the AI makes
  if (fk) return t ? fk : null;
  if (["html", "htm", "xhtml"].includes(lang)) return /^<!doctype|^<html|^<head|^<body|<script|<style/i.test(t) || t.length > 400 ? "html" : null;
  if (lang === "svg") return /^<svg/i.test(t) ? "svg" : null;
  if (["md", "markdown"].includes(lang)) return t.length > 200 ? "md" : null;
  if (lang === "csv") return t.split("\n").length >= 2 ? "csv" : null;
  return null;
}
function artifactTitle(kind, code) {
  if (window.NeonFiles && NeonFiles.KINDS[kind]) return NeonFiles.parseMeta(code, kind).title;
  if (kind === "html") { const m = code.match(/<title[^>]*>([^<]{1,60})<\/title>/i); return m ? m[1].trim() : "Web page"; }
  if (kind === "svg") return "SVG image";
  if (kind === "md") { const m = code.match(/^\s{0,3}#{1,3}\s+(.{1,60})$/m); return m ? m[1].trim() : "Document"; }
  return "Table";
}
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const DOC_CSS = 'body{font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1b1b2f;background:#fff;margin:0;padding:28px;max-width:860px;margin:0 auto}h1,h2,h3{line-height:1.25}pre{background:#f3f1ff;padding:12px;border-radius:8px;overflow:auto}code{background:#f3f1ff;padding:1px 5px;border-radius:5px}pre code{background:none;padding:0}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d9d4f0;padding:7px 11px;text-align:left}th{background:#f3f1ff}blockquote{border-left:3px solid #a66bff;margin:0;padding-left:14px;color:#555}img{max-width:100%}';
const PRINT_HOOK = '<script>addEventListener("message",function(e){if(e.data==="neon-print")print()})<\/script>';   // lets the Save-as-PDF button ask this page to print itself
// A sandboxed page isn't allowed to touch localStorage / cookies (it would crash on the first read), so give it harmless in-memory ones
const STORAGE_SHIM = '<script>(function(){function mem(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}["localStorage","sessionStorage"].forEach(function(n){try{window[n].getItem("x")}catch(e){try{Object.defineProperty(window,n,{value:mem(),configurable:true})}catch(e2){}}});try{document.cookie}catch(e){var c="";try{Object.defineProperty(document,"cookie",{get:function(){return c},set:function(v){c=String(v).split(";")[0]}})}catch(e3){}}})()<\/script>';
function injectHead(code, js) {
  for (const re of [/<head[^>]*>/i, /<html[^>]*>/i, /^\s*<!doctype[^>]*>/i]) { const m = code.match(re); if (m) return code.slice(0, m.index + m[0].length) + js + code.slice(m.index + m[0].length); }
  return js + code;
}
function previewDoc(kind, code) {
  if (window.NeonFiles && NeonFiles.KINDS[kind]) return NeonFiles.previewDoc(kind, code, (h) => DOMPurify.sanitize(h));
  if (kind === "html") { const c = injectHead(code, STORAGE_SHIM); return /<\/body>/i.test(c) ? c.replace(/<\/body>(?![\s\S]*<\/body>)/i, PRINT_HOOK + "</body>") : c + PRINT_HOOK; }
  if (kind === "svg") return '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%}body{display:grid;place-items:center;background:#fff}svg{max-width:96%;max-height:96vh;height:auto}</style>' + code + PRINT_HOOK;
  if (kind === "md") return '<!doctype html><meta charset="utf-8"><style>' + DOC_CSS + "</style>" + DOMPurify.sanitize(marked.parse(code)) + PRINT_HOOK;
  const rows = parseCsv(code.trim()), esc = (x) => String(x).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])), cells = (r, t) => r.map((c) => `<${t}>${esc(c)}</${t}>`).join("");
  return '<!doctype html><meta charset="utf-8"><style>' + DOC_CSS + "</style><table><thead><tr>" + cells(rows[0] || [], "th") + "</tr></thead><tbody>" + rows.slice(1).map((r) => "<tr>" + cells(r, "td") + "</tr>").join("") + "</tbody></table>" + PRINT_HOOK;
}

function artifactCard(code, lang, kind, live) {
  const title = artifactTitle(kind, code), ext = EXT[lang] || kind;
  const file = window.NeonFiles && NeonFiles.KINDS[kind];                      // a real file (PDF / Word / PowerPoint / Excel) built from the text
  const card = document.createElement("div");
  card.className = "artifact" + (live ? " live" : "");
  card.dataset.kind = kind;
  card.innerHTML = `
    <div class="art-head">
      <span class="art-title">${file ? `<i class="art-badge" style="--c:${file.color}">${file.label}</i>` : icon("sparkle")}<b></b></span>
      <div class="art-tabs" data-t="${live ? "code" : "preview"}"><span class="art-ink"></span><button type="button" data-t="code">Code</button><button type="button" data-t="preview"${live ? " disabled" : ""}>Preview</button></div>
      <div class="art-acts">
        <button type="button" class="art-btn" data-a="copy" title="Copy code">${icon("copy")}<span>Copy</span></button>
        <button type="button" class="art-btn" data-a="dl" title="Download as .${ext}">${icon("download")}<span>Download</span></button>
        ${file ? "" : `<button type="button" class="art-btn ico" data-a="pdf" title="Save as PDF"${live ? " disabled" : ""}>${icon("printer")}</button>`}
        <button type="button" class="art-btn ico" data-a="fs" title="Fullscreen">${icon("expand")}</button>
        <button type="button" class="art-btn ico" data-a="x" title="Close">${icon("x")}</button>
      </div>
    </div>
    <div class="collapse open art-wrap"><div class="collapse-in"><div class="art-body">
      <div class="art-pane art-codepane${live ? " on" : ""}"><pre><code class="language-${file ? (kind === "xlsx" ? "plaintext" : "markdown") : lang}"></code></pre></div>
      <div class="art-pane art-prevpane${live ? "" : " on"}"></div>
    </div></div></div>`;
  card.querySelector(".art-title b").textContent = live ? (file ? `Creating your ${file.label} file…` : "Writing code…") : title;
  const codeEl = card.querySelector("code"); codeEl.textContent = code;
  if (window.hljs) { try { hljs.highlightElement(codeEl); } catch {} }
  const tabs = card.querySelector(".art-tabs"), prev = card.querySelector(".art-prevpane"), codePane = card.querySelector(".art-codepane");
  if (live) { requestAnimationFrame(() => { codePane.scrollTop = codePane.scrollHeight; }); return card; }

  let frame = null;
  const buildPreview = () => {
    if (frame) return;
    prev.innerHTML = '<div class="art-loading"><i></i><span>Loading preview…</span></div>';
    frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock");   // no same-origin: the page can't touch your account
    frame.referrerPolicy = "no-referrer"; frame.title = title; frame.loading = "eager";
    frame.addEventListener("load", () => prev.querySelector(".art-loading")?.classList.add("gone"));
    frame.srcdoc = previewDoc(kind, code);
    prev.appendChild(frame);
  };
  const show = (t) => {
    tabs.dataset.t = t; codePane.classList.toggle("on", t === "code"); prev.classList.toggle("on", t === "preview");
    tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.t === t));
    if (t === "preview") buildPreview();
  };
  tabs.querySelectorAll("button").forEach((b) => (b.onclick = () => show(b.dataset.t)));
  show("preview");

  // build the real file in the browser (the libraries load the first time), then save it
  const makeFile = async (btn, k, format) => {
    if (btn.dataset.busy) return; btn.dataset.busy = "1";
    const old = btn.innerHTML; btn.innerHTML = `<i class="art-spin"></i><span>Making ${file.label} file…</span>`; btn.disabled = true;
    try {
      const out = await NeonFiles.build(k, code, format);
      const a = document.createElement("a"); a.href = URL.createObjectURL(out.blob); a.download = out.filename; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      btn.innerHTML = `${icon("check")}<span>Saved ${out.filename.split(".").pop().toUpperCase()}</span>`;
      setTimeout(() => { btn.innerHTML = old; btn.disabled = false; delete btn.dataset.busy; }, 1600);
    } catch (e) {
      console.error(e); toast("Couldn't make that file: " + (e.message || "unknown error"), "err");
      btn.innerHTML = old; btn.disabled = false; delete btn.dataset.busy;
    }
  };
  let menu = null;
  const closeMenu = () => { if (!menu) return; const m = menu; menu = null; m.classList.add("out"); setTimeout(() => m.remove(), 220); document.removeEventListener("pointerdown", outside, true); };
  const outside = (e) => { if (menu && !menu.contains(e.target) && !e.target.closest('[data-a="dl"]')) closeMenu(); };
  const toggleMenu = (btn) => {
    if (menu) { closeMenu(); return; }
    menu = document.createElement("div"); menu.className = "art-menu";
    menu.innerHTML = '<button type="button" data-f="xlsx"><b>Excel / Google Sheets</b><span>.xlsx</span></button><button type="button" data-f="ods"><b>OpenDocument</b><span>.ods</span></button><button type="button" data-f="csv"><b>CSV (first sheet)</b><span>.csv</span></button>';
    menu.querySelectorAll("button").forEach((b) => (b.onclick = () => { const f = b.dataset.f; closeMenu(); makeFile(btn, kind, f); }));
    card.querySelector(".art-head").appendChild(menu);
    document.addEventListener("pointerdown", outside, true);
  };

  const wrap = card.querySelector(".art-wrap"), setFsIcon = (on) => { card.querySelector('[data-a="fs"]').innerHTML = icon(on ? "shrink" : "expand"); card.querySelector('[data-a="fs"]').title = on ? "Exit fullscreen" : "Fullscreen"; };
  const flash = (btn, txt) => { const old = btn.innerHTML; btn.innerHTML = `${icon("check")}<span>${txt}</span>`; setTimeout(() => (btn.innerHTML = old), 1400); };
  card.addEventListener("fullscreenchange", () => { const on = document.fullscreenElement === card; card.classList.toggle("is-fs", on); setFsIcon(on); });
  card.querySelectorAll(".art-btn").forEach((btn) => (btn.onclick = () => {
    const a = btn.dataset.a;
    if (a === "copy") { navigator.clipboard.writeText(code); flash(btn, "Copied"); }
    else if (a === "dl" && file) {
      if (kind === "xlsx") { toggleMenu(btn); return; }                       // Excel / Google Sheets / CSV choices
      makeFile(btn, kind);
    }
    else if (a === "dl") { downloadText(slug(title) + "." + ext, code, ext); flash(btn, "Saved"); }
    else if (a === "pdf") { show("preview"); toast("In the print window, choose Save as PDF."); setTimeout(() => frame?.contentWindow?.postMessage("neon-print", "*"), 250); }
    else if (a === "fs") {
      if (document.fullscreenElement === card) document.exitFullscreen();
      else if (card.requestFullscreen) card.requestFullscreen().catch(() => { card.classList.toggle("is-fs"); setFsIcon(card.classList.contains("is-fs")); });
      else { card.classList.toggle("is-fs"); setFsIcon(card.classList.contains("is-fs")); }                 // browsers without element fullscreen (iPhone): fill the screen instead
    }
    else if (a === "x") {
      const open = !wrap.classList.contains("open"); wrap.classList.toggle("open", open); card.classList.toggle("closed", !open);
      btn.innerHTML = icon(open ? "x" : "chev"); btn.title = open ? "Close" : "Open";
    }
  }));
  return card;
}

// ---------- math: $...$, $$...$$, \(...\) and \[...\] are drawn with KaTeX ----------
const mathCache = new Map();
function texHTML(src, display) {
  const k = (display ? "D" : "I") + src;
  if (mathCache.has(k)) return mathCache.get(k);
  let out;
  try { out = window.katex.renderToString(src.trim(), { displayMode: display, throwOnError: false, strict: "ignore", trust: false, output: "htmlAndMathml" }); }
  catch { out = null; }
  if (mathCache.size > 400) mathCache.clear();
  mathCache.set(k, out);
  return out;
}
// pulls maths out of the text (never from code) and leaves plain tokens that survive the markdown step
function extractMath(text) {
  const found = [];
  const put = (src, display, raw) => { found.push({ src, display, raw }); return (display ? "\n\n" : "") + "zzmath" + (found.length - 1) + "zz" + (display ? "\n\n" : ""); };
  const parts = String(text || "").split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i]
      .replace(/\$\$([\s\S]+?)\$\$/g, (m, s) => put(s, true, m))
      .replace(/\\\[([\s\S]+?)\\\]/g, (m, s) => put(s, true, m))
      .replace(/\\\(([\s\S]+?)\\\)/g, (m, s) => put(s, false, m))
      .replace(/(?<![\\$\w])\$(?![\s$])((?:\\.|[^$\\\n])+?)(?<![\s\\])\$(?![\d$\w])/g, (m, s) => put(s, false, m));
  }
  return { text: parts.join(""), found };
}
function injectMath(html, found) {
  if (!found.length) return html;
  return html.replace(/zzmath(\d+)zz/g, (m, n) => {
    const f = found[Number(n)]; if (!f) return m;
    const r = window.katex ? texHTML(f.src, f.display) : null;
    if (!r) return DOMPurify.sanitize(f.raw.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])));
    return f.display ? `<div class="math-block">${r}</div>` : r;
  });
}
// ---------- what the AI did while answering (web searches, sources) ----------
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
function actRow(a, done) {
  const d = document.createElement("div");
  d.className = "act " + (done ? "done" : "cur"); d.dataset.k = a.k;
  d.innerHTML = '<span class="act-i"></span><span class="act-t"></span>';
  d.querySelector(".act-t").textContent = a.t;
  return d;
}
function actsSummary(m) {
  const qs = m.acts.filter((a) => a.k === "search").length, reads = m.acts.find((a) => a.k === "read");
  const wrap = document.createElement("div"); wrap.className = "acts-sum";
  const label = `Searched the web${qs > 1 ? " " + qs + " times" : ""}${m.sources?.length ? " · " + m.sources.length + " sources" : reads ? " · " + reads.t.replace(/^Reading /, "") : ""}`;
  wrap.innerHTML = `<button type="button" class="acts-btn">${icon("search")}<span></span>${icon("chev", "chev")}</button><div class="collapse"><div class="collapse-in"><div class="steps"></div></div></div>`;
  wrap.querySelector(".acts-btn span").textContent = label;
  const list = wrap.querySelector(".steps"); m.acts.forEach((a) => list.appendChild(actRow(a, true)));
  wrap.querySelector(".acts-btn").onclick = (e) => { const open = wrap.querySelector(".collapse").classList.toggle("open"); e.currentTarget.classList.toggle("open", open); };
  return wrap;
}
function sourceChips(src) {
  const box = document.createElement("div"); box.className = "srcs";
  src.slice(0, 8).forEach((s, i) => {
    if (!/^https?:\/\//.test(s.u)) return;
    const a = document.createElement("a"); a.href = s.u; a.target = "_blank"; a.rel = "noopener noreferrer"; a.style.animationDelay = i * 0.05 + "s";
    a.innerHTML = '<span class="s-n"></span><span class="s-h"></span>'; a.querySelector(".s-n").textContent = i + 1;
    a.querySelector(".s-h").textContent = (s.t && !/^https?:/.test(s.t) ? s.t : hostOf(s.u)).slice(0, 40); a.title = s.u;
    box.appendChild(a);
  });
  return box;
}
function md(text, live = false) {
  const mx = extractMath(text);
  const html = injectMath(DOMPurify.sanitize(marked.parse(mx.text)), mx.found);
  const d = document.createElement("div");
  d.className = "md";
  d.innerHTML = html;
  d.querySelectorAll("a").forEach((a) => { a.target = "_blank"; a.rel = "noopener noreferrer"; });
  d.querySelectorAll("pre").forEach((pre) => {
    const code = pre.querySelector("code");
    const lang = (code?.className.match(/language-([\w+#-]+)/) || [])[1] || "code";
    const raw = code ? code.textContent : pre.textContent;
    const kind = artifactKind(lang.toLowerCase(), raw);
    if (kind) { pre.replaceWith(artifactCard(raw, lang.toLowerCase(), kind, live)); return; }
    if (code && window.hljs) { try { hljs.highlightElement(code); } catch {} }
    const ext = EXT[lang.toLowerCase()] || "txt";
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.innerHTML = `<span></span><span class="grp"><button class="copy dl" type="button" title="Download as .${ext}">${icon("download")}<span>Download</span></button><button class="copy cp" type="button">${icon("copy")}<span>Copy</span></button></span>`;
    bar.firstChild.textContent = lang;
    const b = bar.querySelector(".cp"), dl = bar.querySelector(".dl");
    b.onclick = () => {
      navigator.clipboard.writeText(raw);
      b.innerHTML = `${icon("check")}<span>Copied</span>`;
      setTimeout(() => (b.innerHTML = `${icon("copy")}<span>Copy</span>`), 1400);
    };
    dl.onclick = () => { downloadText((lang === "code" ? "code" : slug(lang)) + "." + ext, raw, ext); dl.innerHTML = `${icon("check")}<span>Saved</span>`; setTimeout(() => (dl.innerHTML = `${icon("download")}<span>Download</span>`), 1400); };
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

// resend from the failed reply: drop it and everything after it, clear the other warnings, and ask again with the model now selected
function retryFrom(m, chat) {
  const i = chat.messages.indexOf(m);
  if (i < 0) return false;
  chat.messages.splice(i);
  chat.messages = chat.messages.filter((x) => !(x.role === "assistant" && x.err && !x.text));
  while (chat.messages.length && chat.messages.at(-1).role === "assistant") chat.messages.pop();
  if (!chat.messages.length) return false;
  chat.model = els.model.value;
  renderMessages(); streamReply(); persist(chat);
  return true;
}
function errBlock(text, m, chat) {
  const e = document.createElement("div");
  e.className = "msg-err";
  e.innerHTML = icon("alert") + '<div class="err-body"><span></span></div>';
  const span = e.querySelector("span"); span.textContent = text;
  // any failed request on another model: point to Flash-Lite, which almost always works, with a one-click switch
  const usedM = m?.errModel || chat?.model;
  if (usedM && usedM !== "gemini-3.5-flash-lite" && !/free Gemini tokens|Not signed in|expired/i.test(text) && config.models.some((x) => x.id === "gemini-3.5-flash-lite")) {
    span.textContent = text + " Try Gemini 3.5 Flash-Lite instead, it's the most reliable.";
    const b = document.createElement("button"); b.type = "button"; b.className = "err-switch"; b.textContent = "Switch to 3.5 Flash-Lite";
    b.onclick = () => {
      if (busy) { toast("Wait for the current reply to finish."); return; }
      els.model.value = "gemini-3.5-flash-lite"; syncModelUI(); els.model.onchange();
      if (chat && chat === current && retryFrom(m, chat)) toast("Switched to Gemini 3.5 Flash-Lite and resent your message.");
      else toast("Switched to Gemini 3.5 Flash-Lite. Send your message again.");
    };
    e.querySelector(".err-body").appendChild(b);
  }
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
  if (m.chess) {                                            // a /chess game: the board is the whole message
    row.classList.add("chessmsg");
    body.appendChild(NeonChess.card(m, { icon, api, toast, me: () => user, paint: paintAvatar, save: () => saveChessSoon(chat) }));
    row.append(av, body);
    return row;
  }
  if (m.larp) {                                             // a /larp trading practice: the card is the whole message
    row.classList.add("chessmsg", "larpmsg");
    body.appendChild(NeonLarpGame.card(m, { icon, api, toast, me: () => user, save: () => saveChessSoon(chat) }));
    row.append(av, body);
    return row;
  }
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (m.role === "user") {
    if (m.attachments?.length) body.appendChild(attachmentsView(m.attachments));
    if (m.text) bubble.textContent = m.text; else bubble.style.display = "none";
    body.appendChild(bubble);
  } else {
    if (m.text) bubble.appendChild(md(m.text));
    if (m.acts?.length) body.appendChild(actsSummary(m));
    body.appendChild(bubble);
    if (m.sources?.length) body.appendChild(sourceChips(m.sources));
    if (m.err) body.appendChild(errBlock(m.err, m, chat));
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
  if (!bootOpen && current.model && [...els.model.options].some((o) => o.value === current.model)) { els.model.value = current.model; syncModelUI(); }
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
  const actsEl = document.createElement("div"); actsEl.className = "steps live";
  const acts = [], sources = []; let searched = false;
  const finishCur = () => actsEl.querySelectorAll(".act.cur").forEach((r) => { r.classList.remove("cur"); r.classList.add("done"); });
  const addAct = (k, t) => {                                   // a new step: the one before it is finished
    finishCur(); const a = { k, t }; acts.push(a);
    const r = actRow(a, !!text); actsEl.appendChild(r);
    if (k !== "think") searched = true;
    if (bubble.isConnected && !text) { bubble.innerHTML = ""; bubble.appendChild(actsEl); scrollDown(); }
  };
  actsEl.appendChild(actRow({ k: "think", t: "Thinking" }, false));
  bubble.innerHTML = ""; bubble.appendChild(actsEl);
  els.msgs.appendChild(row);
  els.empty.style.display = "none";
  scrollDown(true);

  const usedModel = els.model.value;
  let text = "", raf = 0, errMsg = "", downNote = "";
  const paint = () => {
    raf = 0;
    if (current !== chat) return;
    bubble.innerHTML = "";
    if (searched) { finishCur(); bubble.appendChild(actsEl); } else if (actsEl.isConnected) actsEl.remove();   // plain answers just show the text; searches stay listed above it
    const d = md(text, true); d.classList.add("cursor");
    bubble.appendChild(d);
    scrollDown();
  };

  abortCtl = new AbortController();
  setBusy(true);
  try {
    const res = await fetch("/api/chat", {
      method: "POST", signal: abortCtl.signal, credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: chat.messages, model: usedModel, effort: settings.effort }),
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
        if (ev.act) {
          const a = ev.act;
          if (a.k === "search") addAct("search", "Searching the web");
          else if (a.k === "query") { const last = [...actsEl.querySelectorAll('.act[data-k="search"]')].pop(), ar = [...acts].reverse().find((x) => x.k === "search"); if (ar) { ar.t = "Searching the web for “" + a.q + "”"; if (last) last.querySelector(".act-t").textContent = ar.t; } }
          else if (a.k === "read") addAct("read", "Reading " + a.n + " source" + (a.n === 1 ? "" : "s"));
        }
        if (ev.switched) toast("That model had a problem, so I switched to " + ev.switched.name + " for this answer.");
        if (ev.down) downNote = ev.down;
        if (ev.src) ev.src.forEach((s) => { if (s.u && !sources.some((x) => x.u === s.u)) sources.push(s); });
        if (ev.error) errMsg = ev.error;
        if (ev.reset) plan.resetAt = ev.reset;
        if (ev.tokens != null) { plan.usedTokens = ev.tokens; renderPlanSettings(); }
      }
    }
  } catch (e) {
    if (e.name !== "AbortError") errMsg = errMsg || e.message;
  }
  if (raf) cancelAnimationFrame(raf);
  setBusy(false); abortCtl = null;
  if (!user) return;
  if (downNote && !text) dialog({ title: downNote === "limit" ? "Gemini's limit is used up" : "Gemini is having trouble", message: downNote === "limit" ? "Gemini's free limit is used up for now. Try again in a little while." : "Sorry, gemini server might be down rn.", ok: "OK", cancel: false });
  if (text || errMsg) chat.messages.push({ role: "assistant", text, ...(errMsg ? { err: errMsg, errModel: usedModel } : {}), ...(searched && acts.length ? { acts: acts.map((a) => ({ k: a.k, t: a.t.replace(/^Searching the web for/, "Searched the web for") })), sources: sources.slice(0, 8) } : {}) });
  if (text && !errMsg && config.models.find((m) => m.id === usedModel)?.provider === "claude") { plan.usedClaude++; if (!plan.resetAt) plan.resetAt = Date.now() + 12 * 3600e3; renderUsage(); }
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

// ---------- slash commands (/chess) ----------
let chessSaveT = 0;
function saveChessSoon(chat) { clearTimeout(chessSaveT); chessSaveT = setTimeout(() => { if (user) persist(chat); }, 700); }
function startChess(args) {
  const chat = current; if (!chat) return;
  const o = {}, n = String(args || "").match(/\b(\d{3,4})\b/);
  if (n) o.elo = Math.max(100, Math.min(2000, Number(n[1])));
  if (/\bwhite\b/i.test(args)) o.color = "w"; else if (/\bblack\b/i.test(args)) o.color = "b";
  chat.messages.push({ role: "assistant", text: "", chess: NeonChess.defaults(o) });
  if (chat.messages.length === 1) chat.title = "Chess game";
  chat.model = els.model.value;
  els.input.value = ""; autoGrow(); hideSlash();
  renderMessages(); scrollDown(true);
  ls.set("neon-last-" + user.username, chat.id);
  persist(chat);
}
function startLarp() {
  const chat = current; if (!chat) return;
  chat.messages.push({ role: "assistant", text: "", larp: NeonLarpGame.defaults() });
  if (chat.messages.length === 1) chat.title = "Trading practice";
  chat.model = els.model.value;
  els.input.value = ""; autoGrow(); hideSlash();
  renderMessages(); scrollDown(true);
  ls.set("neon-last-" + user.username, chat.id);
  persist(chat);
}
const slashEl = $("slashHint"), SLASH_CMDS = ["/chess", "/larp"];
function showSlash() {
  const v = els.input.value.trim().toLowerCase(), on = v.startsWith("/") && !v.includes(" ") && SLASH_CMDS.some((c) => c.startsWith(v));
  if (on) slashEl.querySelectorAll("button").forEach((b) => (b.hidden = !b.dataset.cmd.startsWith(v)));
  if (on && slashEl.hidden) { slashEl.hidden = false; slashEl.classList.remove("out"); }
  else if (!on && !slashEl.hidden) hideSlash();
}
function hideSlash() { if (slashEl.hidden) return; slashEl.classList.add("out"); setTimeout(() => { slashEl.hidden = true; slashEl.classList.remove("out"); }, 200); }
slashEl.querySelectorAll("button").forEach((b) => (b.onclick = () => { if (b.dataset.cmd === "/larp") startLarp(); else startChess(""); els.input.focus(); }));

async function sendMessage(textOverride) {
  if (busy) { abortCtl?.abort(); return; }
  let text = (textOverride ?? els.input.value).trim();
  if (/^\/c[a-z]*(\s|$)/i.test(text) && "/chess".startsWith(text.split(/\s/)[0].toLowerCase()) && !pending.length) { startChess(text.slice(text.split(/\s/)[0].length)); return; }   // "/chess", "/chess 1200", "/ch"
  if (/^\/l[a-z]*(\s|$)/i.test(text) && "/larp".startsWith(text.split(/\s/)[0].toLowerCase()) && !pending.length) { startLarp(); return; }   // "/larp", "/l"
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
els.input.addEventListener("input", () => { autoGrow(); showSlash(); });
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !slashEl.hidden) { e.stopPropagation(); hideSlash(); return; }
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (els.input.value.trim() === "/") return; sendMessage(); }
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
const MODEL_STYLE = { "claude-opus-5-5": ["#00e5ff", "0,229,255"], "claude-sonnet-5-5": ["#8b5cf6", "139,92,246"], "claude-haiku-5-5": ["#ff2bd6", "255,43,214"],
  "gemini-3.5-flash-lite": ["#3dffa8", "61,255,168"], "gemini-3.6-flash": ["#5b8cff", "91,140,255"], "gemini-2.5-flash": ["#ffb347", "255,179,71"] };
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
  try { sessionStorage.setItem("neon-model", o.value); } catch {}   // survives a refresh, but not closing the tab or browser
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
// ---------- support tickets (public pop-up and the dev inbox live in support.js) ----------
function devTicketCount(c) {
  const n = c ? c.open : 0, el = $("devTicketsCount"); el.textContent = n; el.hidden = !n;
  $("settingsBtn").classList.toggle("has-unread", !!(c && c.unseen));              // a dot on the settings button while there are new tickets
  const u = c ? c.unseen : 0, bd = $("ticketsBadge"), shown = u > 0 ? (u > 99 ? "99+" : String(u)) : "";
  if (bd.textContent !== shown) { bd.textContent = shown; bd.hidden = !shown; if (shown) { bd.classList.remove("pop"); void bd.offsetWidth; bd.classList.add("pop"); } }   // the red-pink circle on the top-right of the ticket button
  $("ticketsTop").title = u ? `Support tickets (${u} new)` : "Support tickets";
}
setInterval(() => { if (user && user.dev && document.visibilityState === "visible") api("/api/dev/tickets/count", { noAuthRedirect: true }).then(devTicketCount).catch(() => {}); }, 45000);
NeonSupport.init({ api, toast, dialog, icon, onCount: devTicketCount });
$("ticketsTop").onclick = () => NeonSupport.openInbox();
$("devTickets").onclick = () => { closeSettings(true); setTimeout(() => NeonSupport.openInbox(), 150); };
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
  let kept = ""; try { kept = sessionStorage.getItem("neon-model") || ""; } catch {}   // a refresh keeps the model; a fresh open starts on the default
  els.model.value = okModel(kept) ? kept : okModel(config.defaultModel) ? config.defaultModel : okModel(settings.model) ? settings.model : (config.models.find((m) => !modelLocked(m.id)) || config.models[0]).id;
  buildModelMenu(); renderPlanSettings(); $("devSec").hidden = !user.dev;
  $("ticketsTop").hidden = !user.dev;
  if (user.dev) { devTicketCount(data.tickets); if (data.tickets && data.tickets.unseen) toast(`You have ${data.tickets.unseen} new support ticket${data.tickets.unseen > 1 ? "s" : ""}.`); }
  if (config.hasKey === false) $("emptyMsg").textContent = "The server has no ANTHROPIC_API_KEY yet. Add it in Render's environment settings.";
  els.search.value = "";
  current = null;
  try { chats = (await api("/api/chats")).chats; } catch { chats = []; }
  const last = ls.get("neon-last-" + user.username);
  bootOpen = true; try { if (last && chats.some((c) => c.id === last)) await openChat(last); else startNew(); } finally { bootOpen = false; }   // on page load the last chat does not change the model (a refresh keeps it, a fresh open uses the default)
  renderList();
  retitleOld();
  clearInterval(syncTimer);
  syncTimer = setInterval(syncNow, 25000);
  if (!plan.chosen && !user.dev) openPlans(true);               // first time in: the plan pop-up comes before anything else
  else maybeWhatsNew();
}

(async function init() {
  const qs = new URLSearchParams(location.search), authErr = qs.get("auth_error"), welcome = qs.has("welcome"), billing = qs.get("billing"), signupTok = qs.get("signup");
  if (authErr || welcome || billing || signupTok) history.replaceState(null, "", location.pathname);
  try { config = await (await fetch("/api/config")).json(); } catch {}
  try {
    const data = await api("/api/me", { noAuthRedirect: true });
    await enterApp(data);
    if (welcome) toast("Account created with Google. Welcome aboard.");
    if (billing === "cancel") toast("Checkout cancelled. You haven't been charged.");
    if (billing === "success") watchPlanChange();
  } catch {
    showAuth(authErr || "");
    if (authErr) toast(authErr, "err");
    if (signupTok) checkApproval(signupTok);
  }
})();
