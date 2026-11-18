"use strict";
/* Free Study Resources: simple flashcards. Everything is stored in this browser (localStorage). */

const view = document.getElementById("view");

// ---------- tiny DOM helper (user text always goes through textContent) ----------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const k in props || {}) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  kids.flat().forEach((c) => { if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c)); });
  return el;
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

let toastT = 0;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2600);
}

// ---------- storage ----------
const KEY = "fsr-sets-v1", SEEDED = "fsr-seeded-v1";
const mk = (title, desc, pairs) => ({ id: uid(), title, desc, sample: true, cards: pairs.map(([t, d]) => ({ id: uid(), t, d, star: false })) });
const SAMPLES = () => [
  mk("Spanish basics", "Everyday words and phrases", [
    ["hola", "hello"], ["adiós", "goodbye"], ["gracias", "thank you"], ["por favor", "please"],
    ["buenos días", "good morning"], ["buenas noches", "good night"], ["¿cómo estás?", "how are you?"],
    ["lo siento", "I'm sorry"], ["sí", "yes"], ["agua", "water"], ["comida", "food"], ["amigo", "friend"]]),
  mk("US state capitals", "Ten states and their capital cities", [
    ["California", "Sacramento"], ["Texas", "Austin"], ["Florida", "Tallahassee"], ["New York", "Albany"], ["Illinois", "Springfield"],
    ["Washington", "Olympia"], ["Pennsylvania", "Harrisburg"], ["Ohio", "Columbus"], ["Georgia", "Atlanta"], ["Arizona", "Phoenix"]]),
  mk("Cell biology", "Organelles and what they do", [
    ["Nucleus", "Stores DNA and controls cell activity"], ["Mitochondria", "Produces ATP through cellular respiration"],
    ["Ribosome", "Builds proteins from amino acids"], ["Chloroplast", "Site of photosynthesis in plant cells"],
    ["Cell membrane", "Controls what enters and leaves the cell"], ["Cell wall", "Rigid outer layer in plant cells"],
    ["Golgi apparatus", "Modifies, sorts and packages proteins"], ["Endoplasmic reticulum", "Network that makes and transports proteins and lipids"],
    ["Lysosome", "Contains enzymes that break down waste"], ["Vacuole", "Stores water, nutrients and waste"]]),
  mk("First ten elements", "Symbol to name", [
    ["H", "Hydrogen"], ["He", "Helium"], ["Li", "Lithium"], ["Be", "Beryllium"], ["B", "Boron"],
    ["C", "Carbon"], ["N", "Nitrogen"], ["O", "Oxygen"], ["F", "Fluorine"], ["Ne", "Neon"]]),
  mk("How to study", "The science of remembering", [
    ["Testing effect", "Retrieving information from memory strengthens it more than rereading it"],
    ["Spaced repetition", "Reviewing material at increasing intervals instead of all at once"],
    ["Leitner system", "Correct cards move to a box reviewed less often; missed cards return to box 1"],
    ["Hermann Ebbinghaus", "Published the first systematic forgetting-curve experiments in 1885"],
    ["Good flashcard", "One idea, a clear question and a short answer"],
    ["Cramming", "Helps for tomorrow, but spaced practice gives better long-term retention"]]),
];

let sets = [];
function load() {
  try {
    sets = JSON.parse(localStorage.getItem(KEY)) || [];
    if (!localStorage.getItem(SEEDED)) { if (!sets.length) sets = SAMPLES(); localStorage.setItem(SEEDED, "1"); save(); }
  } catch { sets = SAMPLES(); }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(sets)); } catch { toast("Could not save. Browser storage may be full or blocked."); } }
const getSet = (id) => sets.find((s) => s.id === id);

// ---------- router ----------
function route() {
  const [, page, id] = (location.hash || "#/").split("/");
  document.removeEventListener("keydown", keyHandler);
  keyHandler = null;
  view.replaceChildren();
  window.scrollTo(0, 0);
  if (page === "set" && getSet(id)) renderSet(getSet(id));
  else if (page === "new") renderEdit(null);
  else if (page === "edit" && getSet(id)) renderEdit(getSet(id));
  else renderHome();
  document.title = (page === "set" && getSet(id) ? getSet(id).title + " · " : "") + "Free Study Resources · Flashcards";
}
addEventListener("hashchange", route);
let keyHandler = null;
function bindKeys(fn) { keyHandler = fn; document.addEventListener("keydown", fn); }

// ---------- home ----------
function renderHome() {
  view.append(h("div", { class: "page-head" },
    h("h1", {}, "Your sets"),
    h("a", { class: "btn primary", href: "#/new" }, "Create a set")));

  if (!sets.length) {
    view.append(h("div", { class: "empty" },
      h("h3", {}, "No sets yet"),
      h("p", {}, "Create your first set, or load the sample sets to try things out."),
      h("a", { class: "btn primary", href: "#/new" }, "Create a set"),
      " ",
      h("button", { class: "btn", type: "button", onclick: restoreSamples }, "Load sample sets")));
    return;
  }
  const grid = h("div", { class: "sets" });
  sets.forEach((s) => grid.append(
    h("a", { class: "set", href: "#/set/" + s.id },
      h("span", { class: "pill" }, plural(s.cards.length, "term")),
      h("h3", {}, s.title),
      h("p", {}, s.desc || "No description"))));
  view.append(grid);
  view.append(h("p", { class: "fc-hint", style: "margin-top:26px" }, h("button", { class: "link", type: "button", onclick: restoreSamples }, "Add the sample sets again")));
}
function restoreSamples() { sets = sets.concat(SAMPLES()); save(); toast("Sample sets added"); route(); }

// ---------- set page ----------
function renderSet(set) {
  const area = h("div");
  const listBox = h("div");
  let mode = "cards";
  let redraw = () => {};
  const tabs = h("div", { class: "tabs", role: "tablist" });

  function setMode(m) {
    mode = m;
    tabs.replaceChildren(
      ...[["cards", "Flashcards"], ["learn", "Learn"]].map(([k, label]) =>
        h("button", { class: "tab" + (mode === k ? " on" : ""), type: "button", role: "tab", "aria-selected": String(mode === k), onclick: () => setMode(k) }, label)));
    document.removeEventListener("keydown", keyHandler);
    keyHandler = null;
    redraw = (mode === "cards" ? flashcards : learn)(set, area, drawList);
  }
  function drawList() {
    listBox.replaceChildren(
      h("h2", { class: "list-title" }, `Terms in this set (${set.cards.length})`),
      h("div", { class: "terms" }, set.cards.map((c) =>
        h("div", { class: "term-row" },
          h("div", { class: "t" }, c.t), h("div", { class: "d" }, c.d),
          h("button", { class: "star" + (c.star ? " on" : ""), type: "button", "aria-pressed": String(!!c.star), "aria-label": (c.star ? "Unstar " : "Star ") + c.t,
            onclick: () => { c.star = !c.star; save(); drawList(); redraw(); } }, c.star ? "Starred" : "Star")))));
  }

  view.append(
    h("div", { class: "crumbs" }, h("a", { href: "#/" }, "← Your sets")),
    h("div", { class: "set-head" },
      h("div", { class: "page-head", style: "margin:0" },
        h("h1", {}, set.title),
        h("a", { class: "btn", href: "#/edit/" + set.id }, "Edit set")),
      set.desc ? h("p", {}, set.desc) : null),
    tabs, area, listBox);
  setMode("cards");
  drawList();
}

// ---------- flashcards ----------
function flashcards(set, area, onChange) {
  const st = { ids: [], i: 0, flip: false, defFirst: false, starred: false, shuffled: false, know: new Set(), learn: new Set(), done: false };

  function pool(ids) {
    let list = ids || set.cards.filter((c) => !st.starred || c.star).map((c) => c.id);
    return st.shuffled ? shuffle(list) : list;
  }
  function restart(ids) { st.ids = pool(ids); st.i = 0; st.flip = false; st.done = false; st.know.clear(); st.learn.clear(); draw(); }
  const cur = () => set.cards.find((c) => c.id === st.ids[st.i]);

  function go(d) { const n = st.i + d; if (n < 0 || n >= st.ids.length) return; st.i = n; st.flip = false; draw(true); }
  function flipCard() { st.flip = !st.flip; const b = area.querySelector(".fcard"); if (b) { b.classList.toggle("flip", st.flip); b.setAttribute("aria-label", st.flip ? "Showing the back. Press to flip." : "Showing the front. Press to flip."); } }
  function rate(known) {
    const c = cur(); if (!c) return;
    (known ? st.know : st.learn).add(c.id); (known ? st.learn : st.know).delete(c.id);
    if (st.i >= st.ids.length - 1) { st.done = true; draw(); } else go(1);
  }

  function chip(label, on, fn) { return h("button", { class: "chip" + (on ? " on" : ""), type: "button", "aria-pressed": String(on), onclick: fn }, label); }

  function draw(focusCard) {
    area.replaceChildren();
    const c = cur();
    const controls = h("div", { class: "fc-top" },
      h("div", { class: "grp" },
        chip("Shuffle", st.shuffled, () => { st.shuffled = !st.shuffled; restart(); }),
        chip("Starred only", st.starred, () => { st.starred = !st.starred; restart(); }),
        chip("Definition first", st.defFirst, () => { st.defFirst = !st.defFirst; st.flip = false; draw(); })),
      h("span", {}, plural(set.cards.length, "term")));

    if (!st.ids.length) {
      area.append(h("div", { class: "fc-wrap" }, controls,
        h("div", { class: "empty" }, h("h3", {}, st.starred ? "No starred terms yet" : "This set has no terms"),
          h("p", {}, st.starred ? "Star terms in the list below, then study just those." : "Edit the set to add some terms."))));
      return;
    }
    if (st.done) {
      const again = st.learn.size;
      area.append(h("div", { class: "fc-wrap" }, controls,
        h("div", { class: "done" },
          h("h2", {}, again ? "Nice work. Keep going." : "You know them all!"),
          h("p", {}, again ? "Review the ones you are still learning, then try the full set again." : "Every card was marked as known."),
          h("div", { class: "stats" },
            h("div", { class: "stat g" }, h("b", {}, st.know.size), "Know"),
            h("div", { class: "stat o" }, h("b", {}, st.learn.size), "Still learning")),
          h("div", { class: "row" },
            again ? h("button", { class: "btn primary", type: "button", onclick: () => restart([...st.learn]) }, `Review ${again} still learning`) : null,
            h("button", { class: again ? "btn" : "btn primary", type: "button", onclick: () => restart() }, "Restart")))));
      return;
    }
    const front = st.defFirst ? c.d : c.t, back = st.defFirst ? c.t : c.d;
    const card = h("button", { class: "fcard" + (st.flip ? " flip" : ""), type: "button", "aria-label": "Showing the front. Press to flip.", onclick: flipCard },
      h("span", { class: "face front" }, h("span", { class: "lbl" }, st.defFirst ? "Definition" : "Term"), front),
      h("span", { class: "face back" }, h("span", { class: "lbl" }, st.defFirst ? "Term" : "Definition"), back));
    const star = h("button", { class: "star" + (c.star ? " on" : ""), type: "button", "aria-pressed": String(!!c.star), onclick: () => { c.star = !c.star; save(); onChange(); draw(true); } }, c.star ? "Starred" : "Star");

    area.append(h("div", { class: "fc-wrap" },
      controls,
      h("div", { class: "bar", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": st.ids.length, "aria-valuenow": st.i + 1 }, h("i", { style: `width:${((st.i + 1) / st.ids.length) * 100}%` })),
      h("div", { class: "scene-box" }, star, h("div", { class: "scene" }, card)),
      h("p", { class: "fc-hint" }, "Click the card or press Space to flip. Use the arrow keys to move."),
      h("div", { class: "rate" },
        h("button", { class: "btn learning", type: "button", onclick: () => rate(false) }, "Still learning"),
        h("button", { class: "btn know", type: "button", onclick: () => rate(true) }, "Know it")),
      h("div", { class: "fc-ctrl" },
        h("button", { class: "round", type: "button", "aria-label": "Previous card", disabled: st.i === 0, onclick: () => go(-1) }, "←"),
        h("span", { class: "count" }, `${st.i + 1} / ${st.ids.length}`),
        h("button", { class: "round", type: "button", "aria-label": "Next card", disabled: st.i >= st.ids.length - 1, onclick: () => go(1) }, "→")),
      h("div", { class: "tally" }, h("span", { class: "l" }, `Still learning: ${st.learn.size}`), h("span", { class: "k" }, `Know: ${st.know.size}`))));
    if (focusCard) area.querySelector(".fcard").focus({ preventScroll: true });
  }

  bindKeys((e) => {
    if (e.target.closest("input, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    else if ((e.key === " " || e.key === "ArrowUp" || e.key === "ArrowDown") && !e.target.closest("button, a")) { e.preventDefault(); flipCard(); }
  });
  restart();
  return () => draw();
}

// ---------- learn (multiple choice) ----------
function learn(set, area) {
  area.replaceChildren();
  if (set.cards.length < 2) {
    area.append(h("div", { class: "fc-wrap" }, h("div", { class: "empty" }, h("h3", {}, "Add at least 2 terms"), h("p", {}, "Learn mode needs a few terms to build answer choices."),
      h("a", { class: "btn primary", href: "#/edit/" + set.id }, "Edit set"))));
    return () => {};
  }
  const N = set.cards.length;
  const st = { queue: [], right: new Set(), missed: new Set(), picked: null, opts: [] };

  function start() { st.queue = shuffle(set.cards.map((c) => c.id)); st.right.clear(); st.missed.clear(); st.picked = null; ask(); }
  function ask() {
    const c = set.cards.find((x) => x.id === st.queue[0]);
    if (!c) return draw();
    const others = shuffle(set.cards.filter((x) => x.id !== c.id && x.d !== c.d)).map((x) => x.d);
    const uniq = [...new Set(others)].slice(0, 3);
    st.opts = shuffle([c.d, ...uniq]); st.picked = null; draw();
  }
  function pick(text) {
    if (st.picked !== null) return;
    const c = set.cards.find((x) => x.id === st.queue[0]);
    st.picked = text;
    st.queue.shift();
    if (text === c.d) st.right.add(c.id); else { st.missed.add(c.id); st.queue.push(c.id); }
    draw();
  }
  function next() { if (st.picked === null) return; st.picked = null; ask(); }

  function draw() {
    area.replaceChildren();
    if (!st.queue.length && st.picked === null) {
      const firstTry = N - st.missed.size;
      area.append(h("div", { class: "fc-wrap" }, h("div", { class: "done" },
        h("h2", {}, "Round complete"),
        h("p", {}, "Every term answered correctly. Words you missed came back until you got them."),
        h("div", { class: "stats" },
          h("div", { class: "stat g" }, h("b", {}, `${firstTry}/${N}`), "Right first try"),
          h("div", { class: "stat o" }, h("b", {}, st.missed.size), "Needed another go")),
        h("button", { class: "btn primary", type: "button", onclick: start }, "Go again"))));
      return;
    }
    // while feedback is showing, the answered card has already left the queue; remember it
    const cid = st.picked !== null ? st.last : st.queue[0];
    const c = set.cards.find((x) => x.id === cid);
    st.last = c.id;
    const answered = st.picked !== null;
    const isRight = answered && st.picked === c.d;
    const remaining = new Set(st.queue).size;
    const pct = (st.right.size / N) * 100;
    area.append(h("div", { class: "fc-wrap" },
      h("div", { class: "fc-top" }, h("span", {}, `${st.right.size} of ${N} learned`), h("span", {}, remaining ? `${remaining} to go` : "")),
      h("div", { class: "bar" }, h("i", { style: `width:${pct}%` })),
      h("div", { class: "q" },
        h("div", { class: "lbl" }, "Term"),
        h("div", { class: "term" }, c.t),
        h("div", { class: "lbl" }, "Choose the matching definition"),
        h("div", { class: "opts" }, st.opts.map((o, i) =>
          h("button", { class: "opt" + (answered ? (o === c.d ? " right" : o === st.picked ? " wrong" : "") : ""), type: "button", disabled: answered, onclick: () => pick(o) },
            h("span", { style: "color:#646f90;font-weight:700;margin-right:8px" }, i + 1 + "."), o))),
        answered ? h("div", { class: "feedback" },
          h("span", { class: isRight ? "ok" : "no" }, isRight ? "Correct!" : "Not quite. The answer is highlighted."),
          h("button", { class: "btn primary", type: "button", onclick: next }, "Continue")) : null)));
    const cont = area.querySelector(".feedback .btn"); if (cont) cont.focus({ preventScroll: true });
  }

  bindKeys((e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest("input, textarea")) return;
    if (st.picked !== null) { if (e.key === "Enter" && !e.target.closest("button")) next(); return; }
    const n = Number(e.key);
    if (n >= 1 && n <= st.opts.length) pick(st.opts[n - 1]);
  });
  start();
  return () => {};
}

// ---------- create / edit ----------
function renderEdit(existing) {
  const draft = existing
    ? { title: existing.title, desc: existing.desc || "", cards: existing.cards.map((c) => ({ ...c })) }
    : { title: "", desc: "", cards: [0, 1, 2].map(() => ({ id: uid(), t: "", d: "", star: false })) };
  const rowsBox = h("div", { class: "rows" });
  const err = h("div", { class: "err", role: "alert" });

  function drawRows(focusLast) {
    rowsBox.replaceChildren(...draft.cards.map((c, i) =>
      h("div", { class: "row" },
        h("div", { class: "row-head" }, h("span", {}, String(i + 1)),
          h("button", { class: "rm", type: "button", onclick: () => { draft.cards.splice(i, 1); drawRows(); } }, "Remove")),
        h("div", { class: "row-body" },
          h("div", {}, h("textarea", { class: "inp", rows: 2, "aria-label": `Term ${i + 1}`, value: c.t, oninput: (e) => (c.t = e.target.value) }), h("small", {}, "Term")),
          h("div", {}, h("textarea", { class: "inp", rows: 2, "aria-label": `Definition ${i + 1}`, value: c.d, oninput: (e) => (c.d = e.target.value) }), h("small", {}, "Definition"))))));
    if (focusLast) rowsBox.lastElementChild?.querySelector("textarea")?.focus();
  }
  function addRow() { draft.cards.push({ id: uid(), t: "", d: "", star: false }); drawRows(true); }

  const importBox = h("textarea", { class: "inp", rows: 5, placeholder: "hello, hola\ngoodbye, adiós\n(one per line: term, definition, or separated by a tab)" });
  function doImport() {
    const added = importBox.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const k = l.includes("\t") ? l.indexOf("\t") : l.indexOf(",");
      return k < 0 ? null : { id: uid(), t: l.slice(0, k).trim(), d: l.slice(k + 1).trim(), star: false };
    }).filter((c) => c && c.t && c.d);
    if (!added.length) { toast("Nothing to import. Use one line per card: term, definition"); return; }
    draft.cards = draft.cards.filter((c) => c.t.trim() || c.d.trim()).concat(added);
    importBox.value = ""; drawRows(); toast(`Added ${plural(added.length, "card")}`);
  }

  function saveSet() {
    const title = draft.title.trim();
    const cards = draft.cards.map((c) => ({ ...c, t: c.t.trim(), d: c.d.trim() })).filter((c) => c.t && c.d);
    if (!title) { err.textContent = "Give your set a title."; return; }
    if (cards.length < 2) { err.textContent = "Add at least two cards with both a term and a definition."; return; }
    const desc = draft.desc.trim();
    if (existing) { existing.title = title; existing.desc = desc; existing.cards = cards; delete existing.sample; }
    const made = existing || { id: uid(), title, desc, cards };
    if (!existing) sets.unshift(made);
    save();
    const id = made.id;
    toast("Saved");
    location.hash = "#/set/" + id;
  }

  view.append(h("div", { class: "editor" },
    h("div", { class: "crumbs" }, h("a", { href: existing ? "#/set/" + existing.id : "#/" }, "← Back")),
    h("div", { class: "page-head" }, h("h1", {}, existing ? "Edit set" : "Create a new set")),
    h("div", { class: "field" }, h("label", { for: "f-title" }, "Title"),
      h("input", { class: "inp", id: "f-title", maxlength: 80, placeholder: "e.g. Biology chapter 3", value: draft.title, oninput: (e) => (draft.title = e.target.value) })),
    h("div", { class: "field" }, h("label", { for: "f-desc" }, "Description (optional)"),
      h("input", { class: "inp", id: "f-desc", maxlength: 160, placeholder: "Add a short description", value: draft.desc, oninput: (e) => (draft.desc = e.target.value) })),
    h("details", { class: "field" },
      h("summary", { style: "cursor:pointer;font-weight:600;color:#4255ff" }, "Import from text"),
      h("div", { style: "margin-top:10px" }, importBox, h("button", { class: "btn small", type: "button", style: "margin-top:10px", onclick: doImport }, "Add these cards"))),
    rowsBox,
    h("button", { class: "add-row", type: "button", onclick: addRow }, "+ Add card"),
    err,
    h("div", { class: "actions" },
      h("button", { class: "btn primary", type: "button", onclick: saveSet }, existing ? "Save changes" : "Create set"),
      h("a", { class: "btn", href: existing ? "#/set/" + existing.id : "#/" }, "Cancel"),
      h("span", { class: "spacer" }),
      existing ? h("button", { class: "btn danger", type: "button", onclick: () => {
        if (!confirm(`Delete "${existing.title}"? This can't be undone.`)) return;
        sets = sets.filter((s) => s !== existing); save(); toast("Set deleted"); location.hash = "#/";
      } }, "Delete set") : null)));
  drawRows();
  if (!existing) document.getElementById("f-title").focus();
}

load();
route();
