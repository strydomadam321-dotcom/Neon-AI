// Support tickets. Anyone can send one (the pop-up opened from "Contact support"); dev accounts read them in the Support tickets inbox
// (Settings > Developer). The look follows the donuteco.xyz ticket pop-up: pick what you need, the form slides in, then a "sent" screen.
(function () {
  "use strict";
  const SPRING = "cubic-bezier(.3, 1.25, .4, 1)";
  let H = null;                                                    // helpers from app.js: { api, toast, dialog, icon, onCount }
  const CATS = [
    { id: "account", e: "🔑", t: "Sign-up & account", d: "Can't get in, want an account, login trouble" },
    { id: "billing", e: "💳", t: "Billing & plans", d: "Plans, payments, refunds" },
    { id: "bug", e: "🐞", t: "Report a bug", d: "Something is broken or looks wrong" },
    { id: "other", e: "💬", t: "Something else", d: "Questions, ideas, anything at all" },
  ];
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ago = (t) => { const s = Math.max(1, Math.round((Date.now() - t) / 1000)); return s < 60 ? "just now" : s < 3600 ? Math.floor(s / 60) + " min ago" : s < 86400 ? Math.floor(s / 3600) + " h ago" : s < 604800 ? Math.floor(s / 86400) + " d ago" : new Date(t).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }); };

  // ---------- the pop-up anyone can use ----------
  let box = null, cat = CATS[3];
  function build() {
    if (box) return box;
    box = document.createElement("div"); box.id = "support"; box.className = "overlay hidden";
    box.innerHTML = `<div class="card sup-card" role="dialog" aria-modal="true" aria-labelledby="supTitle">
      <div class="sup-head"><span class="sup-badge">Support</span><button type="button" class="icon" id="supX" aria-label="Close">${H.icon("x")}</button></div>
      <div class="sup-steps" id="supSteps">
        <div class="sup-step" data-s="choose">
          <h3 id="supTitle">What do you need?</h3><p class="sup-sub">Pick one and your message goes to the right place.</p>
          <div class="sup-opts">${CATS.map((c, i) => `<button type="button" class="sup-opt" data-c="${c.id}" style="--i:${i}"><span class="e">${c.e}</span><b>${c.t}</b><small>${c.d}</small></button>`).join("")}</div>
        </div>
        <div class="sup-step" data-s="form" hidden>
          <button type="button" class="sup-back" id="supBack">${H.icon("back")}Back</button>
          <h3 id="supFormTitle">Tell us what's up</h3><p class="sup-sub">We'll reply by email. The more detail the better.</p>
          <form id="supForm" novalidate>
            <div class="sup-row2">
              <label class="sup-f" data-f="name"><span>Name <em>(optional)</em></span><input id="supName" maxlength="60" autocomplete="name" placeholder="Your name"></label>
              <label class="sup-f" data-f="email"><span>Email</span><input id="supEmail" type="email" maxlength="120" autocomplete="email" placeholder="you@example.com" inputmode="email"></label>
            </div>
            <label class="sup-f" data-f="subject"><span>Subject</span><input id="supSubject" maxlength="120" placeholder="A few words about it"></label>
            <label class="sup-f" data-f="message"><span>Message <em id="supCount">0 / 4000</em></span><textarea id="supMsg" rows="6" maxlength="4000" placeholder="What's up? The more detail the better."></textarea></label>
            <label class="sup-trap" aria-hidden="true">Leave this empty <input name="website" id="supTrap" tabindex="-1" autocomplete="off"></label>
            <p class="sup-err" id="supErr" role="alert"></p>
            <button type="submit" class="btn primary big" id="supSend"><span class="lbl">Send ticket</span><span class="spin"></span></button>
          </form>
        </div>
        <div class="sup-step" data-s="done" hidden>
          <div class="sup-done"><svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="23"/><path d="M15 27 L23 35 L38 18"/></svg>
            <h3>Ticket sent</h3><p class="sup-ref" id="supRef"></p><p class="sup-sub" id="supDoneTxt"></p>
            <button type="button" class="btn primary" id="supClose"><span class="lbl">Close</span></button></div>
        </div>
      </div></div>`;
    document.body.appendChild(box);
    const $ = (s) => box.querySelector(s);
    $("#supX").onclick = $("#supClose").onclick = close;
    box.onmousedown = (e) => { if (e.target === box) close(); };
    box.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    box.querySelectorAll(".sup-opt").forEach((b) => (b.onclick = () => { cat = CATS.find((c) => c.id === b.dataset.c); $("#supFormTitle").textContent = cat.e + "  " + cat.t; go("form"); }));
    $("#supBack").onclick = () => go("choose");
    $("#supMsg").oninput = () => ($("#supCount").textContent = $("#supMsg").value.length + " / 4000");
    box.querySelectorAll(".sup-f input, .sup-f textarea").forEach((i) => i.addEventListener("input", () => i.closest(".sup-f").classList.remove("bad")));
    $("#supForm").onsubmit = send;
    return box;
  }
  function go(name) {
    const wrap = box.querySelector("#supSteps"), from = wrap.querySelector(".sup-step:not([hidden])"), to = wrap.querySelector(`[data-s="${name}"]`);
    if (!from || from === to) return;
    const h0 = wrap.offsetHeight; wrap.style.height = h0 + "px"; wrap.classList.add("morph"); from.classList.add("out");
    setTimeout(() => {
      from.hidden = true; from.classList.remove("out"); to.hidden = false; to.classList.add("in");
      wrap.style.height = "auto"; const h1 = wrap.offsetHeight; wrap.style.height = h1 + "px";
      const an = wrap.animate([{ height: h0 + "px" }, { height: h1 + "px" }], { duration: 650, easing: SPRING });
      an.onfinish = an.oncancel = () => { wrap.style.height = ""; wrap.classList.remove("morph"); to.classList.remove("in"); };
      const f = name === "form" ? box.querySelector("#supEmail") : null; if (f) f.focus({ preventScroll: true });
    }, 190);
  }
  function fieldErr(name, msg) {
    const f = box.querySelector(`[data-f="${name}"]`); if (f) { f.classList.remove("bad"); void f.offsetWidth; f.classList.add("bad"); f.querySelector("input,textarea").focus(); }
    box.querySelector("#supErr").textContent = msg;
  }
  async function send(e) {
    e.preventDefault();
    const $ = (s) => box.querySelector(s), v = { name: $("#supName").value.trim(), email: $("#supEmail").value.trim(), subject: $("#supSubject").value.trim(), message: $("#supMsg").value.trim() };
    $("#supErr").textContent = "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) return fieldErr("email", "Enter a valid email so we can reply.");
    if (v.subject.length < 3) return fieldErr("subject", "Add a short subject (at least 3 characters).");
    if (v.message.length < 10) return fieldErr("message", "Tell us a bit more (at least 10 characters).");
    const btn = $("#supSend"); btn.classList.add("loading"); btn.disabled = true;
    try {
      const d = await H.api("/api/support", { method: "POST", noAuthRedirect: true, body: { ...v, category: cat.id, website: $("#supTrap").value } });
      $("#supRef").textContent = d.ref; $("#supDoneTxt").textContent = `We'll reply to ${v.email}. Keep the reference above if you need to write to us again.`;
      ["#supSubject", "#supMsg"].forEach((s) => ($(s).value = "")); $("#supCount").textContent = "0 / 4000";
      go("done");
    } catch (err) { if (err.field) fieldErr(err.field, err.message); else $("#supErr").textContent = err.message || "Couldn't send that. Please try again."; }
    finally { btn.classList.remove("loading"); btn.disabled = false; }
  }
  function open(o) {
    build(); const wrap = box.querySelector("#supSteps");
    wrap.querySelectorAll(".sup-step").forEach((s) => { s.hidden = s.dataset.s !== "choose"; s.classList.remove("in", "out"); });
    box.querySelector("#supErr").textContent = ""; box.classList.remove("hidden", "out");
    box.querySelectorAll(".sup-opt").forEach((b) => b.classList.toggle("suggest", !!o && o.suggest === b.dataset.c));
  }
  function close() { if (!box) return; box.classList.add("out"); setTimeout(() => { box.classList.add("hidden"); box.classList.remove("out"); }, 240); }

  // ---------- the inbox for dev accounts ----------
  let inb = null, data = { tickets: [], counts: { open: 0, resolved: 0, unseen: 0 }, mail: true }, tab = "open", sel = 0, timer = 0;
  let follow = 0;                                                  // after approving or declining, the panel follows that ticket to the tab it moved to
  const drafts = new Map(), composing = new Set();             // an unsent reply survives the 30 s refresh and switching tickets
  function buildInbox() {
    if (inb) return inb;
    inb = document.createElement("div"); inb.id = "inbox"; inb.className = "overlay hidden";
    inb.innerHTML = `<div class="card inb-card" role="dialog" aria-modal="true" aria-label="Support tickets">
      <div class="inb-head"><div><h3>Support tickets</h3><p class="sup-sub" id="inbSub"></p></div>
        <div class="inb-acts"><button type="button" class="btn small" id="inbRefresh">${H.icon("refresh")}<span>Refresh</span></button><button type="button" class="icon" id="inbX" aria-label="Close">${H.icon("x")}</button></div></div>
      <div class="inb-tabs" id="inbTabs"><button data-t="open">Open <i></i></button><button data-t="resolved">Resolved <i></i></button><button data-t="all">All <i></i></button></div>
      <div class="inb-body" id="inbBody"><div class="inb-list" id="inbList"></div><div class="inb-detail" id="inbDetail"></div></div></div>`;
    document.body.appendChild(inb);
    const $ = (s) => inb.querySelector(s);
    $("#inbX").onclick = closeInbox; inb.onmousedown = (e) => { if (e.target === inb) closeInbox(); };
    inb.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closeInbox(); } });
    $("#inbRefresh").onclick = () => load(true);
    $("#inbTabs").querySelectorAll("button").forEach((b) => (b.onclick = () => { tab = b.dataset.t; sel = 0; paint(); }));
    return inb;
  }
  const shown = () => data.tickets.filter((t) => tab === "all" || (tab === "open" ? t.status === "open" : t.status !== "open"));
  function paint(animate) {
    const $ = (s) => inb.querySelector(s), list = shown(), cur = list.find((t) => t.id === sel) || null;
    $("#inbSub").textContent = data.counts.open ? `${data.counts.open} open${data.counts.unseen ? `, ${data.counts.unseen} new` : ""}` : "Nothing open. Nice.";
    $("#inbTabs").querySelectorAll("button").forEach((b) => { b.classList.toggle("on", b.dataset.t === tab); b.querySelector("i").textContent = b.dataset.t === "open" ? data.counts.open : b.dataset.t === "resolved" ? data.counts.resolved : data.counts.open + data.counts.resolved; });
    $("#inbList").innerHTML = list.length ? list.map((t, i) => `<button type="button" class="inb-row${t.id === sel ? " on" : ""}${t.seen ? "" : " new"}" data-id="${t.id}" style="--i:${animate ? Math.min(i, 8) : 0}"><span class="dot"></span><span class="mid"><b>${esc(t.subject)}</b><small>${esc(t.category)} · ${esc(t.name || t.email)}</small></span><time>${ago(t.at)}</time></button>`).join("") : `<p class="inb-empty">${tab === "resolved" ? "No resolved tickets yet." : "No tickets here. Nothing is on fire."}</p>`;
    $("#inbList").querySelectorAll(".inb-row").forEach((r) => (r.onclick = () => { sel = Number(r.dataset.id); markSeen(sel); paint(); inb.querySelector("#inbBody").classList.add("show-detail"); }));
    $("#inbDetail").innerHTML = cur ? `<button type="button" class="sup-back inb-back" id="inbBack">${H.icon("back")}All tickets</button>
      <div class="inb-dh"><span class="sup-ref">${esc(cur.ref)}</span><span class="chip ${cur.status === "open" ? "open" : "done"}">${cur.status === "open" ? "Open" : "Resolved"}</span><span class="chip">${esc(cur.category)}</span>${cur.account ? '<span class="chip">Signed in</span>' : ""}</div>
      <h4>${esc(cur.subject)}</h4><p class="inb-from">${esc(cur.name || "No name")} &lt;<a href="mailto:${esc(cur.email)}">${esc(cur.email)}</a>&gt; · ${esc(new Date(cur.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}</p>
      <div class="inb-msg">${esc(cur.message)}</div>
      ${data.mail ? "" : `<p class="inb-warn">Email isn't set up on the server yet (RESEND_API_KEY), so replies and approvals can't be sent.</p>`}
      ${(cur.thread || []).length ? `<div class="inb-thread">${cur.thread.map((m) => `<div class="inb-sent ${esc(m.kind)}"><b>${m.kind === "reply" ? "You replied" : m.kind === "approved" ? "Approved" : "Declined"} · ${esc(new Date(m.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}${m.by ? " · " + esc(m.by) : ""}</b><p>${esc(m.body)}</p></div>`).join("")}</div>` : ""}
      ${acctRow(cur)}
      <div class="inb-compose" id="inbCompose"${composing.has(cur.id) ? "" : " hidden"}><textarea id="inbDraft" maxlength="4000" placeholder="Write your reply. NEON AI emails it to ${esc(cur.email)}.">${esc(drafts.get(cur.id) || "")}</textarea>
        <div class="row"><small>Sent from the NEON AI address, with the ticket number in the subject.</small><span><button type="button" class="btn small" id="inbCancel">Cancel</button> <button type="button" class="btn primary small" id="inbSend">${H.icon("mail")}<span>Send reply</span></button></span></div></div>
      <div class="inb-btns"><button type="button" class="btn primary small" id="inbReply">${H.icon("mail")}<span>Reply</span></button>
        <button type="button" class="btn small" id="inbToggle">${cur.status === "open" ? "Mark resolved" : "Reopen"}</button><button type="button" class="btn small danger" id="inbDel">${H.icon("trash")}<span>Delete</span></button></div>`
      : `<div class="inb-none">Select a ticket to read it</div>`;
    const bk = $("#inbBack"); if (bk) bk.onclick = () => $("#inbBody").classList.remove("show-detail");
    if (cur && !cur.seen) markSeen(cur.id);                          // a ticket you are looking at counts as seen
    if (cur) {
      $("#inbToggle").onclick = () => act(cur, cur.status === "open" ? "resolve" : "reopen"); $("#inbDel").onclick = () => remove(cur);
      const comp = $("#inbCompose"), draft = $("#inbDraft");
      $("#inbReply").onclick = () => { composing.add(cur.id); comp.hidden = false; draft.focus(); };
      $("#inbCancel").onclick = () => { composing.delete(cur.id); comp.hidden = true; };
      draft.oninput = () => drafts.set(cur.id, draft.value);
      $("#inbSend").onclick = () => sendReply(cur, draft.value, $("#inbSend"));
      const ap = $("#inbApprove"), dc = $("#inbDecline"); if (ap) ap.onclick = () => approve(cur, ap); if (dc) dc.onclick = () => decline(cur, dc);
    }
  }
  // the "account" line of a ticket: is the email already registered, and has it been approved or declined?
  function acctRow(t) {
    if (t.registered) return `<div class="inb-acct"><span class="st"><b>This email already has an account.</b> Nothing to approve.</span></div>`;
    const a = t.approval, when = a ? new Date(a.at).toLocaleDateString([], { day: "numeric", month: "short" }) : "";
    const st = !a ? "This email has <b>no account</b> yet and sign-ups are closed." : a.status === "approved" ? `<b>Approved</b> on ${esc(when)}. A sign-up link was emailed; it works once.` : a.status === "expired" ? `<b>Approved</b> on ${esc(when)}, but the link has <b>expired</b>.` : a.status === "declined" ? `<b>Declined</b> on ${esc(when)}.` : `Account <b>created</b> from the approval.`;
    if (a && a.status === "used") return `<div class="inb-acct"><span class="st">${st}</span></div>`;
    return `<div class="inb-acct"><span class="st">${st}</span><button type="button" class="btn good small" id="inbApprove">${H.icon("check")}<span>${a && (a.status === "approved" || a.status === "expired") ? "Send a new link" : "Approve account"}</span></button>${a && a.status === "declined" ? "" : `<button type="button" class="btn danger small" id="inbDecline">${H.icon("x")}<span>Decline</span></button>`}</div>`;
  }
  async function busy(btn, fn) { const html = btn.innerHTML; btn.disabled = true; btn.innerHTML = "<span>Sending...</span>"; try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = html; } }
  async function sendReply(t, text, btn) {
    text = text.trim(); if (text.length < 2) { H.toast("Write a message first.", "err"); return; }
    try { await busy(btn, () => H.api(`/api/dev/tickets/${t.id}/reply`, { method: "POST", body: { message: text } })); drafts.delete(t.id); composing.delete(t.id); H.toast("Reply emailed to " + t.email + "."); await load(true); } catch (e) { H.toast(e.message, "err"); }
  }
  async function approve(t, btn) {
    if (!(await H.dialog({ title: "Approve this account?", message: `${t.email} will get an email from NEON AI with a one-time link to create an account, even though sign-ups are closed. The ticket will be marked resolved.`, ok: "Approve and email" }))) return;
    try { await busy(btn, () => H.api(`/api/dev/tickets/${t.id}/approve`, { method: "POST", body: {} })); H.toast("Approved. The sign-up link was emailed to " + t.email + "."); follow = t.id; await load(true); } catch (e) { H.toast(e.message, "err"); }
  }
  async function decline(t, btn) {
    const reason = await H.dialog({ title: "Decline this account?", message: `${t.email} will get an email saying we can't create an account right now. You can add a reason (they will see it), or leave it empty.`, input: "", placeholder: "Optional reason", ok: "Decline and email", danger: true });
    if (reason === null || reason === false) return;
    try { await busy(btn, () => H.api(`/api/dev/tickets/${t.id}/decline`, { method: "POST", body: { reason: String(reason).trim() } })); H.toast("Declined. They were emailed."); follow = t.id; await load(true); } catch (e) { H.toast(e.message, "err"); }
  }
  async function act(t, action) {
    try { await H.api("/api/dev/tickets/" + t.id, { method: "POST", body: { action } }); await load(); } catch (e) { H.toast(e.message, "err"); }
  }
  async function markSeen(id) { const t = data.tickets.find((x) => x.id === id); if (!t || t.seen) return; t.seen = true; data.counts.unseen = Math.max(0, data.counts.unseen - 1); H.onCount && H.onCount(data.counts); try { await H.api("/api/dev/tickets/" + id, { method: "POST", body: { action: "seen" } }); } catch {} }
  async function remove(t) {
    if (!(await H.dialog({ title: "Delete this ticket?", message: `${t.ref}: ${t.subject}. This can't be undone.`, ok: "Delete", danger: true }))) return;
    try { await H.api("/api/dev/tickets/" + t.id, { method: "DELETE" }); sel = 0; await load(); H.toast("Ticket deleted."); } catch (e) { H.toast(e.message, "err"); }
  }
  async function load(manual) {
    try { data = await H.api("/api/dev/tickets"); if (follow) { const ft = data.tickets.find((x) => x.id === follow); follow = 0; if (ft) { sel = ft.id; if (!shown().some((t) => t.id === ft.id)) tab = ft.status === "open" ? "open" : "resolved"; } } if (!shown().some((t) => t.id === sel)) sel = 0; H.onCount && H.onCount(data.counts); if (inb && !inb.classList.contains("hidden")) paint(!manual && !inb.dataset.painted); inb && (inb.dataset.painted = "1"); }
    catch (e) { H.toast(e.message, "err"); }
  }
  function openInbox() {
    buildInbox(); delete inb.dataset.painted; inb.classList.remove("hidden", "out"); inb.querySelector("#inbBody").classList.remove("show-detail");
    load().then(() => { const first = shown()[0]; if (first && !sel) { sel = first.id; paint(); } });
    clearInterval(timer); timer = setInterval(() => { if (inb.classList.contains("hidden")) clearInterval(timer); else load(true); }, 30000);
  }
  function closeInbox() { if (!inb) return; clearInterval(timer); inb.classList.add("out"); setTimeout(() => { inb.classList.add("hidden"); inb.classList.remove("out"); }, 240); }

  // Escape closes the top pop-up even when nothing inside it has the focus (a confirmation, if one is showing, closes first)
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return; const dlg = document.getElementById("dialog"); if (dlg && !dlg.classList.contains("hidden")) return;
    if (inb && !inb.classList.contains("hidden") && !inb.classList.contains("out")) { e.stopImmediatePropagation(); closeInbox(); }
    else if (box && !box.classList.contains("hidden") && !box.classList.contains("out")) { e.stopImmediatePropagation(); close(); }
  }, true);

  window.NeonSupport = { init(h) { H = h; }, open, openInbox, refreshCount: async () => { try { const d = await H.api("/api/dev/tickets"); H.onCount && H.onCount(d.counts); return d.counts; } catch { return null; } } };
})();
