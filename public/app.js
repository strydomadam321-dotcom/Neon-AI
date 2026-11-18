"use strict";
const $ = (id) => document.getElementById(id);

// ---------- practice deck (Leitner boxes, session only) ----------
const CARDS = [
  ["What is the testing effect?", "Retrieving information from memory strengthens it more than rereading the same material."],
  ["What is spaced repetition?", "Reviewing material at increasing intervals instead of all at once."],
  ["Who published the first systematic forgetting-curve experiments, and when?", "Hermann Ebbinghaus, in 1885."],
  ["How does the Leitner system work?", "Correct cards move to a box reviewed less often. Missed cards return to box 1."],
  ["Why should you write your own cards?", "Turning material into questions forces you to process it, which is itself a form of studying."],
  ["What makes a good flashcard?", "One idea, a clear question and a short answer."],
  ["Cramming versus spacing: which gives better long-term retention?", "Spacing. Cramming can help for tomorrow, but spaced practice lasts longer."],
  ["When should a daily session end?", "When the cards that are due are finished. Stopping early keeps the habit sustainable."],
];

const deck = $("deck"), card = $("card"), rate = $("rate");
let queue = [], box = [], learned = 0, flipped = false;

function counts() {
  const c = [0, 0, 0];
  queue.forEach((i) => c[box[i] - 1]++);
  [1, 2, 3].forEach((n) => ($("b" + n).textContent = c[n - 1]));
  $("b4").textContent = learned;
  const pct = Math.round((learned / CARDS.length) * 100);
  $("bar").firstElementChild.style.width = pct + "%";
  $("bar").setAttribute("aria-valuenow", pct);
}
function bump(n) { const el = $("b" + n).parentElement; el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }

function show(delay = 0) {
  flipped = false;
  card.classList.remove("flipped");
  card.setAttribute("aria-pressed", "false");
  card.setAttribute("aria-label", "Flashcard. Press to reveal the answer.");
  rate.hidden = true;
  if (!queue.length) return finish();
  const [q, a] = CARDS[queue[0]];
  // when the card is turning back, swap the text only once it is face-down, so the next answer is never glimpsed
  const set = () => { $("qText").textContent = q; $("aText").textContent = a; };
  delay ? setTimeout(set, delay) : set();
  $("count").textContent = `${learned} of ${CARDS.length} learned`;
  counts();
}

function flip() {
  if (deck.classList.contains("complete")) return;
  flipped = !flipped;
  card.classList.toggle("flipped", flipped);
  card.setAttribute("aria-pressed", String(flipped));
  card.setAttribute("aria-label", flipped ? "Answer shown. Press to see the question again." : "Flashcard. Press to reveal the answer.");
  rate.hidden = !flipped;
  if (flipped) $("good").focus({ preventScroll: true });
}

function answer(good) {
  if (!flipped) return;
  const i = queue.shift();
  if (good) {
    box[i]++;
    if (box[i] > 3) { learned++; bump(4); }
    else { queue.push(i); bump(box[i]); }
  } else {
    box[i] = 1; queue.push(i); bump(1);
  }
  // keep the queue ordered so lower boxes come back first, with a stable order inside a box
  queue.sort((a, b) => box[a] - box[b] || a - b);
  show(320);
  if (queue.length) card.focus({ preventScroll: true });
}

function finish() {
  deck.classList.add("complete");
  $("finish").hidden = false;
  $("count").textContent = `${CARDS.length} of ${CARDS.length} learned`;
  $("finishMsg").textContent = `You moved every card through three boxes. In real use, box 1 is reviewed daily, box 2 every few days and box 3 weekly, so this would be spread over about two weeks.`;
  counts();
}

function start() {
  deck.classList.remove("complete");
  $("finish").hidden = true;
  queue = CARDS.map((_, i) => i);
  box = CARDS.map(() => 1);
  learned = 0;
  show();
}

card.addEventListener("click", flip);
$("good").onclick = () => answer(true);
$("again").onclick = () => answer(false);
$("restart").onclick = () => { start(); card.focus({ preventScroll: true }); };
document.addEventListener("keydown", (e) => {
  if (!flipped || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "1") answer(false);
  if (e.key === "2") answer(true);
});
start();

// ---------- illustrative forgetting curves ----------
(function curve() {
  const svg = $("curve"), W = 520, H = 320, L = 52, R = 18, T = 20, B = 48;
  const x = (t) => L + (t / 30) * (W - L - R);
  const y = (r) => T + (1 - r) * (H - T - B);
  const NS = "http://www.w3.org/2000/svg";
  const el = (n, a, txt) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); if (txt !== undefined) e.textContent = txt; svg.appendChild(e); return e; };

  [0, .25, .5, .75, 1].forEach((r) => {
    el("line", { x1: L, x2: W - R, y1: y(r), y2: y(r), stroke: "#ece7da", "stroke-width": 1 });
    el("text", { x: L - 10, y: y(r) + 4, "text-anchor": "end" }, Math.round(r * 100) + "%");
  });
  [0, 10, 20, 30].forEach((d) => el("text", { x: x(d), y: H - B + 22, "text-anchor": "middle" }, d));
  el("text", { x: (L + W - R) / 2, y: H - 6, "text-anchor": "middle" }, "Days since learning");
  const yl = el("text", { x: 14, y: (T + H - B) / 2, "text-anchor": "middle", transform: `rotate(-90 14 ${(T + H - B) / 2})` }, "Recall");

  const path = (reviews, stab0, grow) => {
    let d = "", t0 = 0, s = stab0, pts = [];
    const marks = [...reviews, 30];
    marks.forEach((m, k) => {
      for (let t = t0; t <= m; t += 0.25) pts.push([t, Math.exp(-(t - t0) / s)]);
      t0 = m; s *= grow;
    });
    pts.forEach(([t, r], i) => (d += (i ? "L" : "M") + x(t).toFixed(1) + " " + y(r).toFixed(1)));
    return d;
  };
  el("path", { d: path([], 2.2, 1), fill: "none", stroke: "#9aa3b5", "stroke-width": 2.2, "stroke-dasharray": "6 5" });
  const reviews = [1, 4, 10, 20];
  el("path", { d: path(reviews, 2.2, 2.3), fill: "none", stroke: "#7a1f2b", "stroke-width": 2.6, "stroke-linejoin": "round" });
  reviews.forEach((d) => { el("circle", { cx: x(d), cy: y(1), r: 4.5, fill: "#7a1f2b" }); });

  el("text", { x: x(5.3), y: y(.12) - 4, fill: "#5a6477" }, "No review");
  el("text", { x: x(11), y: y(.42), style: "fill:#7a1f2b;font-weight:600" }, "With spaced reviews");
})();

// ---------- gentle reveal on scroll ----------
(function reveal() {
  const items = document.querySelectorAll(".steps li, .grid li, .sched, .chart, .deck, .refs li");
  if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: .12 });
  items.forEach((n) => { n.classList.add("rv"); io.observe(n); });
})();
