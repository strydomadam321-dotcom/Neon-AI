// /chess: an interactive chess game inside the chat. You play a bot whose strength you choose (100-2000), powered by Stockfish,
// and "a person" (written live by Gemini 3.5 Flash-Lite) chats with you beside the board.
// The game's state lives in the chat message (m.chess), so it comes back when you reopen the chat.
(function () {
  "use strict";
  const Bot = window.NeonChessBot;
  const FILES = "abcdefgh", GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" }, VS = "︎";
  const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  const PRESETS = [
    { id: "india", label: "India", country: "India", name: "Arjun", text: "From Mumbai, India. Warm, enthusiastic club champion who grew up on Anand's games. Chatty and encouraging, loves a good tactic, uses an occasional Hindi word like 'arre' or 'wah', and compares chess to cricket now and then." },
    { id: "china", label: "China", country: "China", name: "Wei", text: "From Shanghai, China. Calm, disciplined and patient. Thinks long-term, speaks politely and thoughtfully, and occasionally drops a short proverb about patience or strategy. Never rattled, even when losing." },
    { id: "usa", label: "USA", country: "USA", name: "Jake", text: "From Austin, Texas, USA. Loud, confident, sporty and a bit of a streamer. Playful trash talk, 'let's gooo' energy, big reactions to captures, and a good sport at the end." },
    { id: "russia", label: "Russia", country: "Russia", name: "Dmitri", text: "From Moscow, Russia. Raised in a strict chess school. Serious, terse and deadpan, with dry humour. Respects good endgames and doesn't waste words." },
    { id: "germany", label: "Germany", country: "Germany", name: "Lukas", text: "From Munich, Germany. Precise, methodical and a little pedantic, with dry wit. Loves rules, efficiency and clean technique, and occasionally says 'genau' or 'na ja'." },
  ];

  const clampElo = (v) => Math.max(100, Math.min(2000, Math.round((Number(v) || 1000) / 50) * 50));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const uci = (m) => m.from + m.to + (m.promotion || "");

  function defaults(o) {
    o = o || {};
    const p = PRESETS[0];
    return { v: 1, elo: clampElo(o.elo || 1000), color: o.color || "r", started: false, humanColor: "w", fen: "", pgn: "", over: false, result: "", name: p.name, preset: p.id, personality: p.text, log: [], lastEval: null };
  }

  // ---------- loading the rules library and the engine only when a game is opened ----------
  let libP = null, engP = null;
  function loadRules() {
    if (window.Chess) return Promise.resolve();
    return (libP = libP || new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js"; s.onload = () => res();
      s.onerror = () => { libP = null; rej(new Error("Couldn't load the chess rules. Check your connection and try again.")); };
      document.head.appendChild(s);
    }));
  }
  function getEngine() {
    return (engP = engP || (async () => {
      const w = new Worker("/engine/stockfish.js#/engine/stockfish.wasm");
      const e = new Bot.Engine(w);
      await Promise.race([e.ready, sleep(20000).then(() => { throw new Error("engine timeout"); })]);
      return e;
    })().catch((err) => { engP = null; throw err; }));
  }
  // if the engine can't start (very old browser), still play: grab a piece when possible, otherwise move at random
  function fallbackMove(game) {
    const mv = game.moves({ verbose: true }), caps = mv.filter((m) => m.captured), list = caps.length && Math.random() < 0.7 ? caps : mv;
    return uci(list[Math.floor(Math.random() * list.length)]);
  }

  function card(m, ctx) {
    const { icon, api, toast, save } = ctx, st = m.chess;
    const token = {};
    Object.defineProperty(st, "_rt", { value: token, writable: true, enumerable: false, configurable: true });   // newest card for this game wins
    const alive = () => st._rt === token;

    const el = document.createElement("div");
    el.className = "artifact chess";
    el.dataset.kind = "chess";
    el.innerHTML = `
      <div class="art-head">
        <span class="art-title"><i class="art-badge" style="--c:#3dffa8">Chess</i><b class="ch-title"></b></span>
        <div class="art-acts">
          <button type="button" class="art-btn ico" data-a="fs" title="Fullscreen">${icon("expand")}</button>
          <button type="button" class="art-btn ico" data-a="x" title="Close">${icon("x")}</button>
        </div>
      </div>
      <div class="collapse open art-wrap"><div class="collapse-in"><div class="chess-body">
        <div class="ch-left">
          <div class="ch-who"><span class="ch-nm ch-botname"></span><span class="ch-elo-chip"></span><span class="ch-country"></span><span class="ch-cap" data-for="bot"></span></div>
          <div class="ch-boardwrap">
            <div class="ch-board"></div><div class="ch-pieces"></div>
            <div class="ch-promo hidden"></div><div class="ch-over hidden"></div>
          </div>
          <div class="ch-who me"><span class="ch-nm">You</span><span class="ch-cap" data-for="you"></span></div>
          <div class="ch-status" role="status"></div>
        </div>
        <div class="ch-right">
          <div class="ch-controls">
            <button type="button" class="art-btn" data-c="undo" title="Take back your last move">${icon("refresh")}<span>Take back</span></button>
            <button type="button" class="art-btn" data-c="flip" title="Flip the board">${icon("sliders")}<span>Flip</span></button>
            <button type="button" class="art-btn" data-c="resign" title="Resign">${icon("x")}<span>Resign</span></button>
            <button type="button" class="art-btn" data-c="settings" title="Opponent settings">${icon("bolt")}<span>Opponent</span></button>
          </div>
          <div class="collapse ch-setupwrap"><div class="collapse-in"><div class="ch-setup">
            <div class="ch-row"><label>Strength <b class="ch-elo-v"></b> <em class="ch-tier"></em></label><input type="range" class="ch-elo" min="100" max="2000" step="50"><div class="ch-scale"><span>100</span><span>Roughly chess.com ratings</span><span>2000</span></div></div>
            <div class="ch-row"><label>You play</label><div class="ch-seg"><button type="button" data-col="w">White</button><button type="button" data-col="r">Random</button><button type="button" data-col="b">Black</button></div></div>
            <div class="ch-row"><label>Who are you playing?</label><div class="ch-chips"></div><input class="ch-name" maxlength="24" placeholder="Name" aria-label="Opponent name"><textarea class="ch-persona" rows="2" maxlength="400" placeholder="Describe their personality..." aria-label="Opponent personality"></textarea></div>
            <button type="button" class="btn primary ch-play"><span class="lbl">Play</span></button>
          </div></div></div>
          <div class="ch-moves" aria-label="Moves"></div>
          <div class="ch-chat">
            <div class="ch-log" aria-live="polite"></div>
            <form class="ch-say"><input maxlength="300" placeholder="Say something..." aria-label="Message your opponent"><button type="submit" class="art-btn ico" title="Send">${icon("send")}</button></form>
          </div>
          <p class="ch-credit">Engine: <a href="/engine/NOTICE.txt" target="_blank" rel="noopener">Stockfish</a> (GPLv3)</p>
        </div>
      </div></div></div>`;
    const $ = (s) => el.querySelector(s), $$ = (s) => [...el.querySelectorAll(s)];
    const boardEl = $(".ch-board"), piecesEl = $(".ch-pieces"), statusEl = $(".ch-status"), logEl = $(".ch-log"), movesEl = $(".ch-moves");
    const setupWrap = $(".ch-setupwrap"), wrap = $(".art-wrap");

    let nextEval = null, game = null, flipped = false, sel = null, targets = new Map(), gen = 0, botBusy = false, talking = false, pieceEls = new Map(), noticed = false, newArmed = 0, ready = false;
    const orient = () => (flipped ? (st.humanColor === "w" ? "b" : "w") : st.humanColor);
    const botColor = () => (st.humanColor === "w" ? "b" : "w");
    const pos = (sq) => { const f = FILES.indexOf(sq[0]), r = Number(sq[1]); return orient() === "w" ? [f, 8 - r] : [7 - f, r - 1]; };
    const place = (e, sq) => { const [x, y] = pos(sq); e.style.transform = `translate(${x * 100}%, ${y * 100}%)`; };
    const persist = () => { st.fen = game ? game.fen() : ""; st.pgn = game ? game.pgn() : ""; save(); };

    // ---------- the board ----------
    function drawBoard() {
      boardEl.innerHTML = "";
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const f = orient() === "w" ? x : 7 - x, r = orient() === "w" ? 8 - y : y + 1, sq = FILES[f] + r;
        const d = document.createElement("div"); d.className = "sq " + ((f + r) % 2 ? "lt" : "dk"); d.dataset.sq = sq;
        if (x === 0) d.insertAdjacentHTML("beforeend", `<i class="rk">${r}</i>`);
        if (y === 7) d.insertAdjacentHTML("beforeend", `<i class="fl">${FILES[f]}</i>`);
        boardEl.appendChild(d);
      }
      highlight();
    }
    function drawPieces() {
      piecesEl.innerHTML = ""; pieceEls = new Map();
      if (!game) return;
      game.board().forEach((row, i) => row.forEach((p, j) => {
        if (!p) return;
        const sq = FILES[j] + (8 - i), d = document.createElement("div");
        d.className = "cp " + p.color; d.dataset.sq = sq; d.dataset.t = p.type; d.innerHTML = `<span>${GLYPH[p.type]}${VS}</span>`;
        place(d, sq); piecesEl.appendChild(d); pieceEls.set(sq, d);
      }));
    }
    function sqEl(sq) { return boardEl.querySelector(`[data-sq="${sq}"]`); }
    function highlight() {
      boardEl.querySelectorAll(".last, .sel, .tgt, .cap, .chk").forEach((e) => e.classList.remove("last", "sel", "tgt", "cap", "chk"));
      if (!game) return;
      const h = game.history({ verbose: true }), last = h[h.length - 1];
      if (last) { sqEl(last.from)?.classList.add("last"); sqEl(last.to)?.classList.add("last"); }
      if (sel) sqEl(sel)?.classList.add("sel");
      targets.forEach((mv, sq) => sqEl(sq)?.classList.add(mv.captured || mv.flags.includes("e") ? "cap" : "tgt"));
      if (game.in_check()) { const k = game.board().flat().find((p) => p && p.type === "k" && p.color === game.turn()); if (k) { for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { const p = game.board()[i][j]; if (p === k) sqEl(FILES[j] + (8 - i))?.classList.add("chk"); } } }
    }
    // slide the moved piece (and the captured / castling pieces) instead of redrawing
    function animate(mv) {
      const mover = pieceEls.get(mv.from);
      const capSq = mv.flags.includes("e") ? mv.to[0] + mv.from[1] : mv.to;
      if (mv.captured) { const c = pieceEls.get(capSq); if (c && c !== mover) { c.classList.add("gone"); setTimeout(() => c.remove(), 320); pieceEls.delete(capSq); } }
      if (mover) {
        pieceEls.delete(mv.from); pieceEls.set(mv.to, mover); mover.dataset.sq = mv.to; place(mover, mv.to);
        if (mv.promotion) setTimeout(() => { mover.dataset.t = mv.promotion; mover.firstChild.textContent = GLYPH[mv.promotion] + VS; }, 220);
      }
      if (mv.flags.includes("k") || mv.flags.includes("q")) {
        const rank = mv.to[1], [a, b] = mv.flags.includes("k") ? ["h", "f"] : ["a", "d"], rk = pieceEls.get(a + rank);
        if (rk) { pieceEls.delete(a + rank); pieceEls.set(b + rank, rk); rk.dataset.sq = b + rank; place(rk, b + rank); }
      }
      setTimeout(() => { if (alive() && game && pieceEls.size !== game.board().flat().filter(Boolean).length) drawPieces(); }, 450);   // safety net
    }

    // ---------- text around the board ----------
    function sanList() { return game ? game.history() : []; }
    function renderMoves() {
      const h = sanList(); let out = "";
      for (let i = 0; i < h.length; i += 2) out += `<span class="mv"><i>${i / 2 + 1}.</i>${h[i]}${h[i + 1] ? " " + h[i + 1] : ""}</span>`;
      movesEl.innerHTML = out || '<span class="ch-hint">Moves appear here</span>';
      movesEl.scrollTop = movesEl.scrollHeight;
    }
    function captured() {
      const got = { w: [], b: [] }; let score = 0;
      (game ? game.history({ verbose: true }) : []).forEach((mv) => { if (mv.captured) { got[mv.color].push(mv.captured); score += (mv.color === "w" ? 1 : -1) * VAL[mv.captured]; } });
      const show = (list, c) => list.sort((a, b) => VAL[b] - VAL[a]).map((t) => `<span class="${c}">${GLYPH[t]}${VS}</span>`).join("");
      const me = st.humanColor, you = got[me], bot = got[me === "w" ? "b" : "w"], diff = (me === "w" ? score : -score);
      $('.ch-cap[data-for="you"]').innerHTML = show(you, me === "w" ? "bk" : "wt") + (diff > 0 ? `<b>+${diff}</b>` : "");
      $('.ch-cap[data-for="bot"]').innerHTML = show(bot, me === "w" ? "wt" : "bk") + (diff < 0 ? `<b>+${-diff}</b>` : "");
    }
    function setStatus(txt, cls) { statusEl.textContent = txt; statusEl.className = "ch-status" + (cls ? " " + cls : ""); }
    function status() {
      if (!st.started) return setStatus("Choose your opponent, then press Play.");
      if (st.over) return setStatus(st.result, "end");
      if (!game) return setStatus("Loading the board...");
      if (game.in_check()) return setStatus(game.turn() === st.humanColor ? "Check! Your move." : `${st.name} is in check.`, "warn");
      setStatus(game.turn() === st.humanColor ? "Your move" : `${st.name} is thinking`, game.turn() === st.humanColor ? "" : "think");
    }
    function head() {
      $(".ch-title").textContent = st.started ? `Chess vs ${st.name} · ${st.elo}` : "Chess";
      $(".ch-botname").textContent = st.name; $(".ch-elo-chip").textContent = String(st.elo);
      const pre = PRESETS.find((x) => x.id === st.preset), cc = $(".ch-country");
      cc.textContent = pre ? pre.country : ""; cc.hidden = !pre;
      $(".ch-who.me .ch-nm").textContent = ((ctx.me && ctx.me()) || {}).username || "You";
    }
    function refreshButtons() {
      const playing = st.started && !st.over;
      $('[data-c="undo"]').disabled = !playing || !game || game.history().length < 2 || botBusy;
      $('[data-c="resign"]').disabled = !playing;
      $('[data-c="flip"]').disabled = !st.started;
      $(".ch-play .lbl").textContent = st.started ? (newArmed ? "Click again: new game" : "New game") : "Play";
      $$(".ch-seg button").forEach((b) => b.classList.toggle("on", b.dataset.col === st.color));
      $$(".ch-chips button").forEach((b) => b.classList.toggle("on", b.dataset.p === st.preset));
    }
    function refreshAll() { head(); status(); renderMoves(); captured(); refreshButtons(); }

    // ---------- the chat beside the board ----------
    function addLog(f, t, quiet) {
      st.log.push({ f, t }); if (st.log.length > 40) st.log.shift();
      drawLogLine(f, t); if (!quiet) save();
    }
    function drawLogLine(f, t) {
      const d = document.createElement("div"); d.className = "ch-msg " + f;
      if (f === "bot") d.innerHTML = `<span class="who"></span><p></p>`, d.querySelector(".who").textContent = st.name;
      else d.innerHTML = "<p></p>";
      d.querySelector("p").textContent = t; logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight;
    }
    function typing(on) {
      logEl.querySelector(".ch-typing")?.remove();
      if (on) { const d = document.createElement("div"); d.className = "ch-msg bot ch-typing"; d.innerHTML = "<p><i></i><i></i><i></i></p>"; logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight; }
    }
    async function say(event, extra) {
      extra = extra || {};
      if (talking && event !== "user_message" && event !== "game_over") return;
      talking = true; typing(true);
      try {
        const d = await api("/api/chess/talk", { method: "POST", noAuthRedirect: true, body: { name: st.name, personality: st.personality, elo: st.elo, botColor: botColor(), fen: game ? game.fen() : "", moves: sanList(), event, text: extra.text, flags: extra.flags || {}, log: st.log.slice(-8) } });
        if (!alive()) return;
        if (d.text) { await sleep(300 + Math.min(1400, d.text.length * 18)); if (alive()) { typing(false); addLog("bot", d.text); } }
        else if (d.limited && !noticed) { noticed = true; addLog("sys", "Out of free Gemini tokens for today, so your opponent will stay quiet. The game still works."); }
      } catch (e) { /* the bot just stays quiet */ }
      finally { talking = false; if (alive()) typing(false); }
    }

    // ---------- playing ----------
    function over() {
      if (!game.game_over()) return false;
      const me = st.humanColor;
      if (game.in_checkmate()) st.result = game.turn() === me ? `Checkmate. ${st.name} wins.` : "Checkmate. You win!";
      else if (game.in_stalemate()) st.result = "Draw by stalemate.";
      else if (game.in_threefold_repetition()) st.result = "Draw by repetition.";
      else if (game.insufficient_material()) st.result = "Draw: not enough pieces to checkmate.";
      else st.result = "Draw.";
      finish(); return true;
    }
    function finish() {
      st.over = true; sel = null; targets = new Map(); highlight(); persist(); refreshAll();
      const o = $(".ch-over"); o.innerHTML = `<div class="ch-overcard"><b></b><button type="button" class="btn primary small">Play again</button></div>`; o.querySelector("b").textContent = st.result;
      o.querySelector("button").onclick = () => { o.classList.add("hidden"); setupWrap.classList.add("open"); el.scrollIntoView({ block: "nearest", behavior: "smooth" }); };
      o.classList.remove("hidden");
      say("game_over", { flags: { result: st.result } });
    }
    function canHumanMove() { return ready && st.started && !st.over && game && game.turn() === st.humanColor && !botBusy; }
    function select(sq) {
      sel = sq; targets = new Map();
      game.moves({ verbose: true, square: sq }).forEach((mv) => { if (!targets.has(mv.to)) targets.set(mv.to, mv); });
      highlight();
    }
    function clearSel() { sel = null; targets = new Map(); highlight(); }
    function onSquare(sq) {
      if (!canHumanMove()) return;
      if (sel && targets.has(sq)) return attempt(sel, sq);
      const p = game.get(sq);
      if (p && p.color === st.humanColor && sq !== sel) select(sq); else clearSel();
    }
    function attempt(from, to) {
      const opts = game.moves({ verbose: true }).filter((m) => m.from === from && m.to === to);
      if (opts.length > 1) {                                           // a pawn reaching the last rank: choose the piece
        const pr = $(".ch-promo"); pr.innerHTML = "";
        ["q", "r", "b", "n"].forEach((t) => { const b = document.createElement("button"); b.type = "button"; b.className = "pp " + st.humanColor; b.innerHTML = `<span>${GLYPH[t]}${VS}</span>`; b.onclick = () => { pr.classList.add("hidden"); humanMove(from, to, t); }; pr.appendChild(b); });
        pr.classList.remove("hidden"); return;
      }
      humanMove(from, to, opts[0] && opts[0].promotion);
    }
    function humanMove(from, to, promotion) {
      const mv = game.move({ from, to, promotion });
      if (!mv) return;
      clearSel(); animate(mv); highlight(); persist();
      const flags = { capture: !!mv.captured, check: game.in_check() };
      renderMoves(); captured();
      if (over()) return;
      status(); refreshButtons();
      botTurn(flags);
    }
    async function botTurn(prior) {
      if (botBusy || st.over || !st.started || !game || game.turn() === st.humanColor) return;
      botBusy = true; const myGen = gen; status(); refreshButtons();
      try {
        const t0 = Date.now(), legal = game.moves({ verbose: true }).map(uci);
        let pick = null, bestCp = null;
        try {
          const eng = await getEngine(), lp = Bot.levelParams(st.elo);
          const r = await eng.search(game.fen(), { depth: lp.depth, multipv: Math.min(lp.multipv, legal.length), movetime: lp.movetime });
          pick = Bot.chooseMove(r.cands, legal, st.elo);
          const top = r.cands[0]; bestCp = top ? (top.mate != null ? (top.mate > 0 ? 3000 : -3000) : top.cp) : null;
          const chosen = r.cands.find((c) => c.move === pick); nextEval = chosen ? (chosen.mate != null ? (chosen.mate > 0 ? 3000 : -3000) : chosen.cp) : bestCp;
        } catch (e) { pick = fallbackMove(game); }
        await sleep(Math.max(0, 450 + Math.random() * 650 - (Date.now() - t0)));       // a person doesn't answer instantly
        if (!alive() || gen !== myGen || st.over || game.turn() === st.humanColor) return;
        const mv = game.move({ from: pick.slice(0, 2), to: pick.slice(2, 4), promotion: pick[4] }) || game.move(game.moves({ verbose: true })[0]);
        animate(mv); highlight(); renderMoves(); captured();
        // was the player's last move a mistake (or a great one)? Only used to decide when the bot reacts.
        const flags = { capture: !!(prior && prior.capture) || !!mv.captured, check: game.in_check() || !!(prior && prior.check) };
        if (bestCp != null && st.lastEval != null && st.elo >= 500) { const delta = bestCp - st.lastEval; if (delta >= 300) flags.blunder = true; else if (delta <= -300) flags.great = true; }
        st.lastEval = nextEval != null ? nextEval : null; nextEval = null;
        persist();
        if (over()) return;
        status();
        const p = Math.min(0.95, 0.12 + (flags.capture ? 0.25 : 0) + (flags.check ? 0.3 : 0) + (flags.blunder ? 0.6 : 0) + (flags.great ? 0.5 : 0));
        if (Math.random() < p) say(flags.blunder || flags.great || (prior && (prior.capture || prior.check)) ? "user_move" : "bot_move", { flags });
      } finally { botBusy = false; if (alive()) refreshButtons(); }
    }

    // ---------- starting, undoing, settings ----------
    function startGame() {
      gen++; botBusy = false;
      st.humanColor = st.color === "r" ? (Math.random() < 0.5 ? "w" : "b") : st.color;
      game = new Chess(); st.started = true; st.over = false; st.result = ""; st.lastEval = null; st.log = []; logEl.innerHTML = "";
      $(".ch-over").classList.add("hidden"); $(".ch-promo").classList.add("hidden");
      sel = null; targets = new Map(); flipped = false; drawBoard(); drawPieces(); persist(); refreshAll();
      setupWrap.classList.remove("open");
      say("start");
      if (game.turn() !== st.humanColor) botTurn();
    }
    function undo() {
      if (!canHumanMove() || game.history().length < 2) return;
      gen++; game.undo(); game.undo(); st.lastEval = null; clearSel(); drawPieces(); highlight(); persist(); refreshAll();
    }
    function resign() {
      if (!st.started || st.over) return;
      gen++; st.result = "You resigned."; finish();
    }

    // ---------- wiring ----------
    boardEl.addEventListener("click", (e) => { const s = e.target.closest(".sq"); if (s) onSquare(s.dataset.sq); });
    $('[data-c="undo"]').onclick = undo;
    $('[data-c="resign"]').onclick = resign;
    $('[data-c="flip"]').onclick = () => { flipped = !flipped; drawBoard(); drawPieces(); };
    $('[data-c="settings"]').onclick = () => setupWrap.classList.toggle("open");
    const elo = $(".ch-elo"), eloV = $(".ch-elo-v"), tier = $(".ch-tier");
    const showElo = () => { eloV.textContent = st.elo; tier.textContent = Bot.tier(st.elo); elo.style.setProperty("--p", ((st.elo - 100) / 1900) * 100 + "%"); };
    elo.value = st.elo; showElo();
    elo.oninput = () => { st.elo = clampElo(elo.value); showElo(); head(); };
    elo.onchange = () => { st.elo = clampElo(elo.value); showElo(); head(); save(); };
    $$(".ch-seg button").forEach((b) => (b.onclick = () => { st.color = b.dataset.col; refreshButtons(); save(); }));
    const chips = $(".ch-chips"), nameIn = $(".ch-name"), personaIn = $(".ch-persona");
    PRESETS.forEach((p) => { const b = document.createElement("button"); b.type = "button"; b.dataset.p = p.id; b.textContent = p.label; b.onclick = () => { st.preset = p.id; st.name = p.name; st.personality = p.text; nameIn.value = p.name; personaIn.value = p.text; head(); refreshButtons(); save(); }; chips.appendChild(b); });
    nameIn.value = st.name; personaIn.value = st.personality;
    nameIn.oninput = () => { st.name = nameIn.value.trim().slice(0, 24) || "Alex"; st.preset = ""; head(); refreshButtons(); };
    personaIn.oninput = () => { st.personality = personaIn.value.trim().slice(0, 400); st.preset = ""; refreshButtons(); };
    nameIn.onchange = personaIn.onchange = save;
    $(".ch-play").onclick = () => {
      if (st.started && !st.over && !newArmed) { newArmed = Date.now(); refreshButtons(); setTimeout(() => { newArmed = 0; if (alive()) refreshButtons(); }, 3000); return; }   // a game is running: ask once more
      newArmed = 0; startGame();
    };
    $(".ch-say").onsubmit = (e) => {
      e.preventDefault(); const i = e.target.querySelector("input"), t = i.value.trim(); if (!t) return; i.value = "";
      if (!st.started) { toast("Press Play first."); return; }
      addLog("you", t); say("user_message", { text: t });
    };
    // fullscreen + close, same behaviour as the code panels
    const setFs = (on) => { const b = $('[data-a="fs"]'); b.innerHTML = icon(on ? "shrink" : "expand"); b.title = on ? "Exit fullscreen" : "Fullscreen"; };
    el.addEventListener("fullscreenchange", () => { const on = document.fullscreenElement === el; el.classList.toggle("is-fs", on); setFs(on); });
    $('[data-a="fs"]').onclick = () => {
      if (document.fullscreenElement === el) document.exitFullscreen();
      else if (el.requestFullscreen) el.requestFullscreen().catch(() => { el.classList.toggle("is-fs"); setFs(el.classList.contains("is-fs")); });
      else { el.classList.toggle("is-fs"); setFs(el.classList.contains("is-fs")); }
    };
    $('[data-a="x"]').onclick = (e) => {
      const open = !wrap.classList.contains("open"); wrap.classList.toggle("open", open); el.classList.toggle("closed", !open);
      e.currentTarget.innerHTML = icon(open ? "x" : "chev"); e.currentTarget.title = open ? "Close" : "Open";
    };

    // ---------- first paint (and resuming a saved game) ----------
    drawBoard(); refreshAll();
    st.log.forEach((l) => drawLogLine(l.f, l.t));
    if (!st.started) setupWrap.classList.add("open");
    setStatus("Loading the chess board...");
    loadRules().then(() => {
      if (!alive()) return;
      game = new Chess();
      if (st.pgn) { try { game.load_pgn(st.pgn); } catch { game = new Chess(); } }
      else if (st.fen) { try { game.load(st.fen); } catch {} }
      ready = true; drawBoard(); drawPieces(); refreshAll();
      getEngine().catch(() => {});                                      // warm the engine up while the player reads the settings
      if (st.started && !st.over && game.turn() !== st.humanColor) botTurn();
      if (st.over) { const o = $(".ch-over"); o.innerHTML = `<div class="ch-overcard"><b></b><button type="button" class="btn primary small">Play again</button></div>`; o.querySelector("b").textContent = st.result; o.querySelector("button").onclick = () => { o.classList.add("hidden"); setupWrap.classList.add("open"); }; o.classList.remove("hidden"); }
    }).catch((e) => setStatus(e.message || "Couldn't start chess.", "warn"));
    return el;
  }

  window.NeonChess = { card, defaults, clampElo };
})();
