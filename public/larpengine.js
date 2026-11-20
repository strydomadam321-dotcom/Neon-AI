// /larp trading simulator: the engine. Price generation, indicators, orders, profit and loss, scoring.
// Everything here is SIMULATED (made-up prices, fake money). It runs in the browser and in Node (so it can be tested).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NeonLarp = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- random numbers (same seed = same day, for everyone) ----------
  function rng(seed) {
    let a = seed >>> 0;
    return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0; }

  const KINDS = {
    trend: { label: "Steady uptrend", blurb: "A healthy trend with pullbacks. Buy dips, don't chase." },
    range: { label: "Choppy range", blurb: "Price bounces between a floor and a ceiling. Breakouts often fail." },
    runner: { label: "Gap and run", blurb: "News spike, huge volume, then a fade. Easy to buy the top." },
    breakdown: { label: "Breakdown", blurb: "Quiet range, then the floor gives way on heavy volume." },
    vshape: { label: "V-shaped reversal", blurb: "A sell-off, a flush, then a sharp recovery." },
  };
  const BARS = 390;   // a trading day: 9:30 to 16:00, one bar per minute

  // ---------- price generation ----------
  // returns { bars: [{o,h,l,c,v}], meta }
  function generate(opts) {
    const kind = KINDS[opts.kind] ? opts.kind : "trend", seed = (opts.seed >>> 0) || 1, r = rng(seed), start = Math.max(1.5, Math.min(200, opts.start || 10));
    const vol = Math.max(1, Math.min(5, opts.vol || 2)), sig0 = 0.0012 * vol, n = opts.bars || BARS;
    const drift = new Array(n).fill(0), sig = new Array(n).fill(sig0), vmul = new Array(n).fill(1);
    const seg = (a, b, d, s, v) => { for (let i = Math.max(0, a); i < Math.min(n, b); i++) { drift[i] = d; if (s) sig[i] = sig0 * s; if (v) vmul[i] = v; } };
    let center = Math.log(start), meta = { kind };
    if (kind === "trend") {
      let t = 0, up = true;
      while (t < n) { const len = 22 + Math.floor(r() * 26); seg(t, t + len, up ? 0.00085 * vol * (0.8 + r() * 0.6) : -0.0005 * vol * (0.6 + r() * 0.8), up ? 1 : 0.85, up ? 1.25 : 0.7); t += len; up = !up; }
    } else if (kind === "range") {
      meta.mean = true;
    } else if (kind === "runner") {
      const t0 = 14 + Math.floor(r() * 16), up = 10 + Math.floor(r() * 8), top = t0 + up, fade = 55 + Math.floor(r() * 30);
      seg(0, t0, 0, 0.8, 0.6);
      seg(t0, top, (Math.log(1.6 + r() * 0.9)) / up, 2.2, 9);
      seg(top, top + 6, 0, 3, 6);
      seg(top + 6, top + 6 + fade, Math.log(0.55 + r() * 0.1) / fade, 1.7, 3);
      seg(top + 6 + fade, n, 0, 1.0, 1.0);
      meta.spike = [t0, top];
    } else if (kind === "breakdown") {
      const t0 = 140 + Math.floor(r() * 50);
      meta.mean = true; meta.until = t0;
      seg(t0, t0 + 18, -0.0028 * vol, 2.2, 5);
      seg(t0 + 18, t0 + 38, 0.0004 * vol, 1.2, 1.6);
      seg(t0 + 38, t0 + 90, -0.0012 * vol, 1.3, 2);
      seg(t0 + 90, n, 0.0001 * vol, 1, 1);
      meta.breakAt = t0;
    } else if (kind === "vshape") {
      const f = 90 + Math.floor(r() * 50);
      seg(0, f, -0.0006 * vol, 1, 1.4);
      seg(f, f + 4, -0.0035 * vol, 3, 8);
      seg(f + 4, f + 12, 0.0045 * vol, 2.4, 6);
      seg(f + 12, n, 0.0007 * vol, 1, 1.4);
      meta.flush = f;
    }
    const round = (x) => Math.max(0.01, Math.round(x * 100) / 100), bars = [];
    let p = start;
    const baseVol = (8000 + r() * 22000) * (start < 5 ? 3 : start < 20 ? 1.5 : 1);
    for (let i = 0; i < n; i++) {
      let lp = Math.log(p), ret = drift[i] + sig[i] * gauss(r);
      if (meta.mean && (kind === "range" || i < meta.until)) ret += -0.045 * (lp - center) + 0.0004 * Math.sin(i / 11);
      ret = Math.max(-0.12, Math.min(0.12, ret));
      const o = p, c = o * Math.exp(ret);
      // a few steps inside the bar decide the wicks
      let hi = Math.max(o, c), lo = Math.min(o, c);
      for (let k = 0; k < 3; k++) { const q = o * Math.exp(ret * r() + sig[i] * 0.8 * gauss(r)); hi = Math.max(hi, q); lo = Math.min(lo, q); }
      const co = round(c), oo = round(o);
      bars.push({ o: oo, h: round(Math.max(hi, oo, co)), l: round(Math.min(lo, oo, co)), c: co, v: Math.max(100, Math.round(baseVol * vmul[i] * Math.exp(0.45 * gauss(r)) * (1 + Math.abs(ret) / sig0 * 0.18))) });
      p = co;
    }
    meta.start = start; meta.seed = seed; meta.vol = vol;
    return { bars, meta };
  }

  // ---------- indicators ----------
  function ema(vals, n) { const k = 2 / (n + 1), out = []; let e = vals[0]; for (let i = 0; i < vals.length; i++) { e = i ? vals[i] * k + e * (1 - k) : vals[0]; out.push(e); } return out; }
  function macd(closes) {
    const a = ema(closes, 12), b = ema(closes, 26), m = a.map((x, i) => x - b[i]), s = ema(m, 9);
    return { macd: m, signal: s, hist: m.map((x, i) => x - s[i]) };
  }
  function vwap(bars) { let pv = 0, vv = 0; return bars.map((b) => { pv += ((b.h + b.l + b.c) / 3) * b.v; vv += b.v; return pv / vv; }); }

  // ---------- the account: orders, fills, profit and loss ----------
  class Account {
    constructor(cash) { this.start = cash || 100000; this.cash = this.start; this.qty = 0; this.avg = 0; this.realized = 0; this.orders = []; this.fills = []; this.trades = []; this.cur = null; this.nextId = 1; this.stopUsed = false; this.maxExposure = 0; }
    equity(price) { return this.cash + this.qty * price; }
    unreal(price) { return this.qty ? (price - this.avg) * this.qty : 0; }
    // the biggest position (in shares) you may hold at this price: no borrowing, so it can't be worth more than your account
    cap(price) { return Math.max(0, Math.floor(this.equity(price) / price)); }
    // how many shares of this order are allowed
    allow(side, q, price) {
      q = Math.max(0, Math.floor(q)); const cap = this.cap(price);
      const after = this.qty + (side === "buy" ? q : -q);
      if (Math.abs(after) <= cap || Math.abs(after) < Math.abs(this.qty)) return q;
      const room = side === "buy" ? cap - this.qty : cap + this.qty;
      return Math.max(0, Math.min(q, Math.floor(room)));
    }
    fill(side, qty, price, i, why) {
      qty = Math.abs(Math.floor(qty)); if (!qty) return null;
      const signed = side === "buy" ? qty : -qty;
      let pnl = 0;
      if (this.qty && Math.sign(this.qty) !== Math.sign(signed)) { const closed = Math.min(Math.abs(this.qty), qty); pnl = (price - this.avg) * closed * Math.sign(this.qty); }
      const before = this.qty, after = before + signed;
      this.cash -= signed * price;
      if (!before || Math.sign(before) === Math.sign(signed)) this.avg = (Math.abs(before) * this.avg + qty * price) / (Math.abs(before) + qty);
      else if (Math.abs(signed) > Math.abs(before)) this.avg = price;
      else if (after === 0) this.avg = 0;
      this.qty = after; this.realized += pnl;
      this.maxExposure = Math.max(this.maxExposure, Math.abs(after) * price);
      const f = { i, side, qty, price, pnl, why: why || "market", after };
      this.fills.push(f);
      // bookkeeping for round trips (open -> flat)
      if (before === 0) this.cur = { side: after > 0 ? "long" : "short", openI: i, pnl: 0, peak: Math.abs(after), entry: price, stop: false };
      else if (this.cur) { this.cur.pnl += pnl; this.cur.peak = Math.max(this.cur.peak, Math.abs(after)); if (why === "stop") this.cur.stop = true; }
      if (this.cur && before !== 0 && (after === 0 || Math.sign(after) !== Math.sign(before))) {
        this.trades.push({ side: this.cur.side, openI: this.cur.openI, closeI: i, bars: i - this.cur.openI, pnl: +this.cur.pnl.toFixed(2), peak: this.cur.peak, entry: this.cur.entry, exit: price, stopped: this.cur.stop || this.stopUsed });
        this.cur = after === 0 ? null : { side: after > 0 ? "long" : "short", openI: i, pnl: 0, peak: Math.abs(after), entry: price, stop: false };
      }
      return f;
    }
    place(type, price, qty) {
      if (!/^(buy|sell)-(limit|stop)$/.test(type) || !(price > 0) || !(qty >= 1)) return null;
      const o = { id: this.nextId++, type, price: Math.round(price * 100) / 100, qty: Math.floor(qty) };
      if (type.endsWith("stop")) this.stopUsed = true;
      this.orders.push(o); return o;
    }
    cancel(id) { const n = this.orders.length; this.orders = this.orders.filter((o) => o.id !== id); return this.orders.length < n; }
    cancelAll() { this.orders = []; }
    // a new bar arrives: do any waiting limit / stop orders trigger? (stops first, to be cautious)
    step(bar, i) {
      const out = [], list = this.orders.slice().sort((a, b) => (a.type.endsWith("stop") ? 0 : 1) - (b.type.endsWith("stop") ? 0 : 1));
      for (const o of list) {
        const side = o.type.startsWith("buy") ? "buy" : "sell", stop = o.type.endsWith("stop");
        let px = null;
        if (side === "buy" && !stop && bar.l <= o.price) px = Math.min(o.price, bar.o);
        else if (side === "sell" && !stop && bar.h >= o.price) px = Math.max(o.price, bar.o);
        else if (side === "buy" && stop && bar.h >= o.price) px = Math.max(o.price, bar.o);
        else if (side === "sell" && stop && bar.l <= o.price) px = Math.min(o.price, bar.o);
        if (px == null) continue;
        if (!this.orders.some((x) => x.id === o.id)) continue;           // already cancelled by an earlier fill in this bar
        const q = this.allow(side, o.qty, px), was = this.qty;
        this.orders = this.orders.filter((x) => x.id !== o.id);
        if (q > 0) {
          const f = this.fill(side, q, px, i, stop ? "stop" : "limit"); if (f) out.push(f);
          // the position is closed: its other exit orders (the stop, or the target) are cancelled, like a broker's "one cancels the other"
          if (was !== 0 && this.qty === 0) this.orders = this.orders.filter((x) => !x.type.startsWith(side));
        }
      }
      return out;
    }
  }

  // ---------- levels, scoring, achievements ----------
  const LEVELS = [[0, "Paper Hands"], [100, "Chart Squinter"], [250, "Candle Reader"], [500, "Tape Watcher"], [900, "Swing Cadet"], [1400, "Risk Manager"], [2000, "Setup Hunter"], [3000, "Momentum Rider"], [4500, "Market Wizard"], [6500, "Trading Legend"]];
  function levelFor(xp) {
    let lv = 0; for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i][0]) lv = i;
    const next = LEVELS[lv + 1];
    return { level: lv + 1, name: LEVELS[lv][1], from: LEVELS[lv][0], next: next ? next[0] : null, pct: next ? (xp - LEVELS[lv][0]) / (next[0] - LEVELS[lv][0]) : 1 };
  }
  const ACH = {
    first: ["First Blood", "Made your first trade"],
    green: ["Green Day", "Finished a session in profit"],
    stop: ["Safety Net", "Used a stop-loss order"],
    patient: ["Diamond Hands", "Held a winning trade for 30+ minutes"],
    survivor: ["Survived the Pump", "Came out of a Gap and run without losing money"],
    sniper: ["Sniper", "Won 3 trades in a row"],
    calm: ["Cool Head", "Ended with 3 or fewer trades and no big mistakes"],
    grad: ["Graduate", "Finished the tutorial"],
  };
  // sums up one finished session. xpBoost: extra XP.
  function score(acc, lastPrice, meta) {
    const end = acc.equity(lastPrice), pnl = end - acc.start, pct = pnl / acc.start, T = acc.trades;
    const wins = T.filter((t) => t.pnl > 0), losses = T.filter((t) => t.pnl < 0);
    const sum = (a) => a.reduce((x, t) => x + t.pnl, 0);
    const res = { pnl, pct, end, trades: T.length, wins: wins.length, losses: losses.length, winRate: T.length ? wins.length / T.length : 0, avgWin: wins.length ? sum(wins) / wins.length : 0, avgLoss: losses.length ? sum(losses) / losses.length : 0, profitFactor: losses.length ? Math.abs(sum(wins) / sum(losses)) : wins.length ? 99 : 0, best: T.length ? Math.max(...T.map((t) => t.pnl)) : 0, worst: T.length ? Math.min(...T.map((t) => t.pnl)) : 0 };
    const mistakes = [], big = acc.start * 0.015;
    const bigLoss = losses.filter((t) => t.pnl < -big);
    if (bigLoss.length && !acc.stopUsed) mistakes.push({ id: "nostop", text: "You took a big loss without a stop-loss order. A stop decides your worst case before the trade, not after." });
    if (acc.maxExposure > acc.start * 0.9 && res.pct < -0.01) mistakes.push({ id: "size", text: "Your position was almost the whole account. One bad move then costs a lot. Try smaller size." });
    if (T.length > 14) mistakes.push({ id: "over", text: "That is a lot of trades. More trades means more mistakes, and you can't beat the fake spread forever." });
    const slow = losses.filter((t) => t.bars > 60);
    if (slow.length) mistakes.push({ id: "hope", text: "You held a losing trade for over an hour hoping it would come back. Cutting losers early is the whole game." });
    for (let i = 1; i < T.length; i++) if (T[i - 1].pnl < 0 && T[i].openI - T[i - 1].closeI <= 3 && T[i].peak > T[i - 1].peak * 1.3) { mistakes.push({ id: "revenge", text: "After a loss you jumped straight back in with a bigger size. That is revenge trading." }); break; }
    if (meta && meta.kind === "runner" && meta.spike) {
      const top = meta.peakPrice || 0;
      if (top && T.some((t) => t.side === "long" && t.entry > top * 0.9 && t.pnl < 0)) mistakes.push({ id: "chase", text: "You bought near the top of the spike. After a huge news run, the easy money is usually gone: that's chasing." });
    }
    res.mistakes = mistakes;
    const ach = [];
    if (T.length) ach.push("first");
    if (res.pnl > 0) ach.push("green");
    if (acc.stopUsed) ach.push("stop");
    if (T.some((t) => t.pnl > 0 && t.bars >= 30)) ach.push("patient");
    if (meta && meta.kind === "runner" && res.pnl >= 0 && T.length) ach.push("survivor");
    let run = 0, best = 0; T.forEach((t) => { run = t.pnl > 0 ? run + 1 : 0; best = Math.max(best, run); }); if (best >= 3) ach.push("sniper");
    if (T.length && T.length <= 3 && !mistakes.length) ach.push("calm");
    res.achievements = ach;
    res.xp = 40 + Math.round(Math.max(0, Math.min(0.06, res.pct)) / 0.06 * 160) + (acc.stopUsed ? 25 : 0) + (mistakes.length ? 0 : 30) + (T.length ? 10 : 0);
    return res;
  }

  return { rng, hash, gauss, generate, ema, macd, vwap, Account, KINDS, BARS, LEVELS, levelFor, ACH, score };
});
