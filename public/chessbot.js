// The chess bot's brain: turns an Elo (100-2000) into how Stockfish is asked to play, and picks the move.
// Works in the browser and in Node (so the strength levels can be tested). Engine: Stockfish (GPLv3), see /engine/NOTICE.txt.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NeonChessBot = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // linear interpolation through a table of [elo, value] anchors
  function interp(table, x) {
    if (x <= table[0][0]) return table[0][1];
    for (let i = 1; i < table.length; i++) {
      if (x <= table[i][0]) { const [x0, y0] = table[i - 1], [x1, y1] = table[i]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
    }
    return table[table.length - 1][1];
  }

  // How hard the bot thinks (search depth), how many ideas it considers, how loosely it chooses between them (temperature, in
  // centipawns), and how often it just plays a random legal move. Tuned so that levels are roughly 100-250 rating points apart.
  const DEPTH = [[100, 1], [700, 1], [1000, 2], [1450, 2], [1600, 3], [1850, 3], [2000, 4]];   // search depth; each extra ply is a big jump in strength, so between levels it is a mix of the two depths and the noise below does the fine-tuning
  const TEMP = [[100, 800], [400, 500], [800, 300], [1100, 190], [1400, 110], [1700, 70], [1850, 45], [2000, 30]];
  const RANDOM = [[100, 0.75], [200, 0.62], [300, 0.5], [400, 0.4], [500, 0.31], [600, 0.24], [800, 0.14], [1000, 0.08], [1200, 0.05], [1400, 0.025], [1600, 0.01], [1800, 0]];

  function levelParams(elo, rng) {
    elo = Math.max(100, Math.min(2000, Number(elo) || 1000));
    const df = interp(DEPTH, elo), lo = Math.floor(df);
    return {
      elo,
      depth: lo + ((rng || Math.random)() < df - lo ? 1 : 0),
      multipv: elo < 1700 ? 8 : 4,
      temp: interp(TEMP, elo),
      pRandom: interp(RANDOM, elo),
      movetime: elo >= 1600 ? 900 : 500,        // upper limit per move, in milliseconds
    };
  }

  const tier = (elo) => (elo < 500 ? "Beginner" : elo < 900 ? "Casual" : elo < 1300 ? "Club player" : elo < 1700 ? "Intermediate" : "Strong");

  // pick the bot's move from the engine's candidate lines
  function chooseMove(cands, legalUci, elo, rng) {
    rng = rng || Math.random;
    const p = levelParams(elo);
    if (!legalUci.length) return null;
    if (rng() < p.pRandom) return legalUci[Math.floor(rng() * legalUci.length)];
    const list = cands.filter((c) => c && c.move && legalUci.includes(c.move));
    if (!list.length) return legalUci[Math.floor(rng() * legalUci.length)];
    const score = (c) => (c.mate != null ? (c.mate > 0 ? 10000 - c.mate * 10 : -10000 - c.mate * 10) : c.cp);
    const best = Math.max(...list.map(score));
    const w = list.map((c) => Math.exp((score(c) - best) / Math.max(1, p.temp)));
    let r = rng() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i].move; }
    return list[0].move;
  }

  // a small UCI wrapper around anything that has postMessage(cmd) and an onmessage callback (a Web Worker, or stockfish.js in Node)
  class Engine {
    constructor(worker) {
      this.w = worker; this.queue = []; this.job = null; this.ready = null; this.readyRes = null;
      worker.onmessage = (ev) => this._line(typeof ev === "string" ? ev : ev && ev.data !== undefined ? String(ev.data) : String(ev));
      this.ready = new Promise((res) => (this.readyRes = res));
      this._send("uci");
    }
    _send(c) { this.w.postMessage(c); }
    _line(l) {
      if (l === "uciok") { this._send("setoption name Skill Level value 20"); this._send("setoption name Hash value 16"); this._send("setoption name Ponder value false"); this._send("isready"); return; }
      if (l === "readyok") { if (this.readyRes) { this.readyRes(); this.readyRes = null; } return; }
      const job = this.job;
      if (!job) return;
      if (l.startsWith("info ") && l.includes(" pv ")) {
        const k = Number((l.match(/ multipv (\d+)/) || [])[1] || 1), d = Number((l.match(/ depth (\d+)/) || [])[1] || 0);
        const cp = l.match(/ score cp (-?\d+)/), mate = l.match(/ score mate (-?\d+)/), pv = l.match(/ pv ([a-h][1-8][a-h][1-8][qrbn]?)/);
        if (pv && (cp || mate)) job.lines[k] = { move: pv[1], cp: cp ? Number(cp[1]) : null, mate: mate ? Number(mate[1]) : null, depth: d, pv: l.split(" pv ")[1].trim().split(" ").slice(0, 8) };
      } else if (l.startsWith("bestmove")) {
        const best = (l.split(" ")[1] || "").trim();
        const cands = Object.keys(job.lines).map(Number).sort((a, b) => a - b).map((k) => job.lines[k]);
        this.job = null; job.resolve({ best: best === "(none)" ? null : best, cands });
        this._pump();
      }
    }
    // search a position (FEN). Returns { best, cands: [{move, cp, mate, depth}] } with scores from the side to move's point of view
    search(fen, o) { return new Promise((resolve) => { this.queue.push({ fen, o: o || {}, resolve, lines: {} }); this._pump(); }); }
    async _pump() {
      if (this.job || !this.queue.length) return;
      await this.ready;
      if (this.job || !this.queue.length) return;
      const job = (this.job = this.queue.shift()), o = job.o;
      this._send("setoption name MultiPV value " + (o.multipv || 1));
      this._send("position fen " + job.fen);
      this._send("go depth " + (o.depth || 8) + (o.movetime ? " movetime " + o.movetime : ""));
    }
    stop() { this.queue.length = 0; if (this.job) this._send("stop"); }
  }

  return { levelParams, chooseMove, Engine, tier };
});
