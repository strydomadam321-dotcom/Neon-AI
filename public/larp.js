// /larp: a trading practice game inside the chat. Fake money, made-up prices, a full beginner tutorial (skippable),
// then free play on different "market days", with an AI coach (Gemini 3.5 Flash-Lite) writing the stories and the debrief.
// Everything is SIMULATED. The state lives in the chat message (m.larp), so a session comes back when the chat is reopened.
(function () {
  "use strict";
  const L = window.NeonLarp, SND = window.NeonChessSound || { play() {}, enabled: () => false, setEnabled() {} };
  const TUT_DAY = { kind: "trend", seed: 11, start: 12.4, vol: 2, bars: 390 };
  const SPEEDS = [0.5, 1, 2, 5, 10, 30];
  const SIZES = [10, 50, 100, 500, 1000];
  const COL = { up: "#27f5a0", down: "#ff4d7d", ema9: "#ffd166", ema20: "#3df0ff", vwap: "#c792ff", grid: "rgba(255,255,255,.07)", txt: "rgba(232,220,255,.72)", entry: "#7aa7ff", buy: "#27f5a0", sell: "#ff4d7d" };

  const money = (n, d) => (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d });
  const signed = (n, d) => (n > 0.004 ? "+" : n < -0.004 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d });
  const clock = (i) => { const m = 570 + i, h = Math.floor(m / 60), mm = m % 60; return ((h % 12) || 12) + ":" + String(mm).padStart(2, "0") + (h >= 12 ? " PM" : " AM"); };
  const kfmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(Math.round(n)));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  const newSeed = () => ((Math.random() * 2147483646) | 0) + 1;
  const todayKey = () => new Date().toISOString().slice(0, 10);

  // ---------- local scenario flavour (used when the AI is unavailable, or while it is thinking) ----------
  const NAMES = [["NEON", "Neon Dynamics"], ["BYTE", "Bytewave Labs"], ["KOAL", "Koala Cloud"], ["FLUX", "Fluxline Energy"], ["MOON", "Moonshot Rockets"], ["PIXL", "Pixelforge Games"], ["TACO", "Taco Futures Inc"], ["VIBE", "Vibecheck Media"], ["GLOW", "Glowcell Batteries"], ["YOLO", "YoloBio Therapeutics"], ["ZAP", "Zapwire Telecom"], ["BOLT", "Boltgrid Power"]];
  const HEAD = {
    trend: ["Quarterly sales beat forecasts; analysts nudge targets up", "Steady buying as the sector firms up", "New product line gets a warm reception"],
    range: ["No news today: traders waiting for a catalyst", "Shares drift between support and resistance ahead of earnings", "Quiet session expected, low conviction"],
    runner: ["PRE-MARKET: shares jump on surprise announcement, volume exploding", "Social media is buzzing about this tiny stock", "Gapping up on huge volume, everyone is talking about it"],
    breakdown: ["Stock sits just above a key floor, bulls and bears undecided", "Sleepy morning, but a few big sellers are lurking", "Shares coil in a tight range ahead of a regulatory update"],
    vshape: ["Overnight sell-off drags the stock lower at the open", "Shares open weak after a rough market day yesterday", "Nervous start: traders hunt for a bottom"],
  };
  const ALERT = {
    trend: ["Analyst upgrade crosses the wire", "Company confirms strong demand"],
    range: ["Rumour of a partnership (unconfirmed)", "Sector news moves nothing"],
    runner: ["BREAKING: Company announces 'strategic partnership'", "BREAKING: Mystery buyer rumoured, volume spikes"],
    breakdown: ["BREAKING: Regulator opens an investigation", "BREAKING: Key customer cancels its contract"],
    vshape: ["Buyers step in at the lows", "Sell-off looks exhausted"],
  };
  function localFlavor(kind) {
    const n = rnd(NAMES);
    return { ticker: n[0], company: n[1], headline: rnd(HEAD[kind] || HEAD.range), alert: rnd(ALERT[kind] || ALERT.range), local: true };
  }

  // ---------- the tutorial, from zero ----------
  const TUT = [
    { id: "hi", title: "Welcome to the trading floor", spot: null, text: `This is a <b>simulator</b>. The prices are made up and the money is fake, so you can't lose a cent here. It's a flight simulator for trading: make every beginner mistake now, for free, and learn from it.<br><br>The goal of this short course: you'll learn what a stock is, how to read a price chart, how to buy and sell, and how <b>professionals protect themselves</b> from big losses. About 5 minutes. You can press <b>Skip tutorial</b> any time.` },
    { id: "what", title: "What is a stock?", spot: null, text: `A <b>stock</b> (or share) is a tiny slice of ownership in a company. If you own 100 shares of a company with 1,000,000 shares, you own 0.01% of it.<br><br>The <b>price</b> moves all day because buyers and sellers keep disagreeing about what the slice is worth. <b>Trading</b> means trying to profit from those moves: buy at one price, sell at a better one. In a <b>day trade</b> you finish everything before the market closes, which is what this game is.` },
    { id: "candle", title: "Reading a candle", spot: ".lp-chartwrap", text: `The chart is made of <b>candles</b>. Each candle is <b>one minute</b> of trading.<br><br>• The thick <b>body</b> runs from where the minute <i>opened</i> to where it <i>closed</i>.<br>• A <span class="lp-g">green</span> candle closed higher than it opened (buyers won that minute). A <span class="lp-r">red</span> candle closed lower (sellers won).<br>• The thin lines (<b>wicks</b>) show the highest and lowest price reached.<br>• The bars along the bottom are <b>volume</b>: how many shares changed hands. Big volume means lots of people care.<br><br>Move your mouse over the chart to see the exact numbers (Open, High, Low, Close) for any candle.` },
    { id: "play", title: "Make time move", spot: ".lp-play", task: "Press ▶ Play and let 10 minutes pass", check: (c) => c.moved >= 10, text: `Real markets don't wait for you, but here <b>you control time</b>. Press <b>▶ Play</b> and watch candles form one after another (1x speed is one candle per second).` },
    { id: "speed", title: "Speed, pause and step", spot: ".lp-speeds", task: "Change the speed, then press Pause and use Step (⏭) once", check: (c) => c.ev.speed && c.ev.step, text: `Pick a faster <b>speed</b> (up to 30x) when nothing is happening and slow down when you need to think. <b>Pause</b> freezes time, and <b>⏭ Step</b> shows just the next candle. Use the mouse wheel on the chart to zoom, and drag it to look at earlier candles (double-click snaps back to now).` },
    { id: "inds", title: "Indicators: helpers on the chart", spot: ".lp-inds", task: "Switch VWAP on", check: (c) => c.ev.ind, text: `Indicators are lines calculated from past prices. They never predict anything, but they make patterns easier to see.<br><br>• <b>EMA 9 / EMA 20</b> (yellow and blue): the average price of the last 9 and 20 minutes, giving recent minutes more weight. When price is above them and they point up, that's an uptrend.<br>• <b>VWAP</b> (purple): the day's average price weighted by volume. Institutions use it as a "fair price": above it feels strong, below it feels weak.<br>• <b>MACD</b> (bottom pane): compares a fast and a slow average. When the bars flip from red to green, momentum is turning up.<br><br>Click <b>VWAP</b> to switch it on.` },
    { id: "q1", title: "Quick check", spot: ".lp-chartwrap", quiz: { q: "A candle has a long lower wick and closed near its high. What happened that minute?", opts: ["Price crashed all minute and stayed down", "Sellers pushed price down, but buyers took it all the way back up", "Nothing happened"], ans: 1, why: "Right: a long lower wick means price dipped a lot, but buyers refused to let it stay down. That is a sign of buying interest." } },
    { id: "acct", title: "Your account", spot: ".lp-acct", text: `Top right is your account. You start with <b>$100,000</b> of fake cash.<br><br>• <b>Equity</b> = cash + the value of what you hold. It's your real score.<br>• <b>Day P&amp;L</b> = profit and loss today. (<b>P&amp;L</b> is the number every trader watches.)<br>• <b>Buying power</b> = how many shares you could hold at this price. There is <b>no borrowing</b> here: you can't hold more than your account is worth.<br><br>Heads up: every market order pays a tiny <b>spread</b> (1 cent): you buy at the "ask" and sell at the "bid". Overtrading quietly eats your account that way.` },
    { id: "buy", title: "Your first trade: buy", spot: ".lp-trade", task: "Choose a size (try 100) and press BUY", check: (c) => c.acc.qty > 0, text: `<b>Buying</b> (going <b>long</b>) is a bet the price will go <i>up</i>. Choose how many shares with the <b>size</b> buttons, then press <b>BUY</b>. It fills instantly at the current price (a <b>market order</b>).<br><br>Tip: the size decides how much each 1-cent move is worth. 100 shares means each cent is $1. Start small!` },
    { id: "pnl", title: "Your open position", spot: ".lp-pos", task: "Let 5 minutes pass (Play or Step)", check: (c) => c.moved >= 5, text: `Now you <b>own</b> the shares. Watch the <b>Position</b> box: it shows how many shares, your <b>average price</b>, and <b>unrealized P&amp;L</b>.<br><br>"Unrealized" means the profit or loss is still on paper: it changes every minute and is only <b>locked in</b> when you close the trade. The dashed blue line on the chart is your entry price: above it you're winning, below it you're losing.` },
    { id: "flat", title: "Closing the trade", spot: '[data-t="flat"]', task: "Press FLAT to close the position", check: (c) => c.acc.qty === 0 && c.ev.flat, text: `To take profits (or a loss), you sell what you own. <b>FLAT</b> closes your whole position in one click and cancels any waiting orders. The result is now <b>realized</b>: it's in your cash for good. Check <b>Trades</b> to see it logged.` },
    { id: "short", title: "Selling first: shorting", spot: ".lp-trade", task: "Press SELL to open a short, let 2 minutes pass, then FLAT", check: (c) => c.ev.shortOpened && c.moved >= 2 && c.acc.qty === 0, enter: (c) => c.autoFlat(), text: `You can also profit when a price <b>falls</b>. If you press <b>SELL</b> while owning nothing, you <b>short</b>: you sell shares you borrowed and plan to buy them back cheaper later. Your position shows as negative (e.g. -100).<br><br>Be careful: a long can only lose what you put in, but a short can lose <b>more than that</b> if the price keeps climbing. That's why shorting needs a plan (next lessons).` },
    { id: "stop", title: "The stop-loss: your seatbelt", spot: ".lp-ord", task: "Buy 100 shares, then press 'Stop-loss' to place an automatic exit", check: (c) => c.acc.qty > 0 && c.acc.orders.some((o) => o.type === "sell-stop"), enter: (c) => c.autoFlat(), text: `The most important tool in trading. A <b>stop-loss</b> is an order that sits below your entry and says: "if the price falls to here, sell automatically". You decide your worst case <b>before</b> you're emotional.<br><br>First BUY 100 shares, then press <b>Stop-loss</b> (it puts a stop about 1% under the price). A red dashed line appears on the chart. Pros never open a trade without knowing where they'll get out.` },
    { id: "target", title: "Take-profit with a limit order", spot: ".lp-ord", task: "Press 'Take profit' to place a sell limit above the price", check: (c) => c.acc.orders.some((o) => o.type === "sell-limit"), text: `A <b>limit order</b> is "only at this price or better". A <b>sell limit</b> above the market is a <b>take-profit</b>: it waits, and sells for you if the price rises to your target.<br><br>Now you have a bracket: a stop below and a target above. Whichever triggers first closes the trade and cancels the other (broker folks call this OCO, "one cancels the other"). A good plan risks <b>1</b> to make <b>2</b>: that's a 2:1 reward-to-risk ratio.<br><br>You can also place any order by hand with the order box: pick Buy/Sell, Limit/Stop, type a price.` },
    { id: "fill", title: "Let the orders work", spot: ".lp-chartwrap", task: "Press ▶ until your stop or target fills (or press FLAT)", check: (c) => c.acc.qty === 0, text: `Now watch what happens. <b>Stops</b> fill at the first price at or beyond them (in fast markets that can be a bit <i>worse</i> than your stop, called <b>slippage</b>). Press <b>▶ Play</b> and let the market decide.`, },
    { id: "q2", title: "Position sizing", spot: ".lp-trade", quiz: { q: "You're willing to lose $200 on a trade. You'd buy at $10.00 with a stop at $9.50 (50 cents of risk per share). How many shares?", opts: ["100 shares", "400 shares", "1,000 shares"], ans: 1, why: "$200 ÷ $0.50 = 400 shares. That's the 1% rule: decide what you can lose, then let the distance to your stop set the size, not your excitement." } },
    { id: "psy", title: "Traps that beat most beginners", spot: null, text: `• <b>FOMO</b>: chasing a stock that's already exploded. In the "Gap and run" day, the top is where beginners buy.<br>• <b>Revenge trading</b>: doubling down right after a loss. Take a break instead.<br>• <b>Hoping</b>: holding a loser because "it'll come back". Cut it. Small losses are the cost of doing business.<br>• <b>Overtrading</b>: more trades means more spread paid and more mistakes. Wait for a setup.<br><br>Real-world note: tiny stocks that rocket on "news" and social media are the classic <b>pump and dump</b>: insiders sell to the people who arrive late. This is a game, not financial advice, and real trading can lose real money, so never risk money you can't afford to lose.` },
    { id: "final", title: "Final exam: trade the rest of the day", spot: ".lp-chartwrap", task: "Trade for at least 20 minutes, then press Finish", check: (c) => c.moved >= 20 || c.i >= c.last, text: `Last step: it's yours. Trade the rest of this practice day however you like. Try to use what you learned: <b>small size, a stop, a target</b>, and don't force trades.<br><br>When you press <b>Finish</b> (or the day ends) we'll grade you like a real session, and then you unlock free play with new market days. Ask the <b>Coach</b> tab anything if you get stuck.` },
  ];

  const GLOSS = [
    [/stop/i, "A stop-loss is an order that sells (or buys, if you're short) automatically when price reaches a level you picked, so a bad trade can't run away from you."],
    [/limit/i, "A limit order only fills at your price or better. A buy limit waits below the market; a sell limit waits above it (that's a take-profit)."],
    [/short/i, "Shorting is selling shares you don't own, hoping to buy them back cheaper. You profit if the price falls, but losses are unlimited if it rises, so use a stop."],
    [/vwap/i, "VWAP is the volume-weighted average price of the day so far. Price above it is considered strong, below it weak."],
    [/ema|average/i, "An EMA is a moving average that weights recent prices more. Price above a rising EMA suggests an uptrend."],
    [/macd/i, "MACD compares a fast and a slow EMA. When the histogram moves from red to green, short-term momentum is turning up."],
    [/volume/i, "Volume is how many shares traded. Moves on high volume are more believable than moves on low volume."],
    [/spread|slippage/i, "The spread is the small gap between the buy price and sell price. Slippage is when you fill at a worse price than expected, common in fast markets."],
    [/p&l|pnl|profit/i, "P&L means profit and loss. Unrealized is on paper while the trade is open; realized is locked in after you close."],
    [/risk|size|1%/i, "Rule of thumb: risk about 1% of your account per trade. Divide that dollar amount by the distance to your stop to get the share count."],
  ];

  // ---------- state ----------
  function defaults() {
    return { v: 1, phase: "welcome", tut: { step: 0, max: 0, done: false, skipped: false }, prof: { xp: 0, ach: [], runs: 0, best: null, wins: 0, tutDone: false, dailyDone: "" }, run: null, last: null, chat: [] };
  }
  function newRun(kind, seed, flavor, mode, o) {
    o = o || {};
    const r = L.rng(seed), vol = o.vol || 1 + Math.floor(r() * 4), start = o.start || +(3 + r() * 40).toFixed(2);
    return { mode: mode || "free", kind, seed, start, vol, bars: o.bars || L.BARS, i: 26, speed: 1, ind: { ema: true, vwap: false, macd: false, vol: true }, flavor, acc: new L.Account(100000), size: 100, news: [], view: { n: 90, off: 0 }, done: false, started: Date.now() };
  }
  function rehydrate(st) {
    if (st.run && !(st.run.acc instanceof L.Account)) { const a = new L.Account(0); Object.assign(a, st.run.acc); st.run.acc = a; }
    if (st.run && !st.run.view) st.run.view = { n: 90, off: 0 };
  }

  function card(m, ctx) {
    const { icon, api, toast, save } = ctx, st = m.larp;
    rehydrate(st);
    const token = {};
    Object.defineProperty(st, "_rt", { value: token, writable: true, enumerable: false, configurable: true });
    const alive = () => st._rt === token && el.isConnected !== false;

    const el = document.createElement("div");
    el.className = "artifact larp";
    el.dataset.kind = "larp";
    el.tabIndex = -1;
    el.innerHTML = `
      <div class="art-head">
        <span class="art-title"><i class="art-badge" style="--c:#ffd166">Trade sim</i><b class="lp-title">Trading practice</b></span>
        <div class="art-acts">
          <button type="button" class="art-btn" data-a="menu" title="Menu">${icon("bolt")}<span>Menu</span></button>
          <button type="button" class="art-btn ico" data-a="snd" title="Sound on">${icon("sound")}</button>
          <button type="button" class="art-btn ico" data-a="fs" title="Fullscreen">${icon("expand")}</button>
          <button type="button" class="art-btn ico" data-a="x" title="Close">${icon("x")}</button>
        </div>
      </div>
      <div class="collapse open art-wrap"><div class="collapse-in"><div class="lp-body">
        <div class="lp-main">
          <div class="lp-top">
            <div class="lp-sym"><b class="lp-tk">----</b><span class="lp-co"></span></div>
            <div class="lp-px"><b class="lp-last">0.00</b><span class="lp-chg"></span></div>
            <div class="lp-clock"><span class="lp-time"></span><div class="lp-prog"><i></i></div></div>
          </div>
          <div class="lp-news"></div>
          <div class="collapse lp-tutwrap"><div class="collapse-in"><div class="lp-tut"></div></div></div>
          <div class="lp-chartwrap"><canvas class="lp-cv"></canvas><button type="button" class="lp-live hidden">Back to live</button></div>
          <div class="lp-bar">
            <div class="lp-transport">
              <button type="button" class="lp-play btn-lp" title="Play / pause (space)"></button>
              <button type="button" class="lp-stepb btn-lp" title="Next candle (.)">${icon("back")}</button>
            </div>
            <div class="lp-speeds" role="group" aria-label="Speed"></div>
            <div class="lp-inds" role="group" aria-label="Indicators">
              <button type="button" data-i="ema">EMA</button><button type="button" data-i="vwap">VWAP</button><button type="button" data-i="macd">MACD</button><button type="button" data-i="vol">Vol</button>
            </div>
            <div class="lp-zoom"><button type="button" data-z="in" title="Zoom in">+</button><button type="button" data-z="out" title="Zoom out">−</button></div>
          </div>
        </div>
        <div class="lp-side">
          <div class="lp-acct">
            <div><span>Equity</span><b class="lp-eq">$0</b></div>
            <div><span>Day P&amp;L</span><b class="lp-day">$0</b></div>
            <div><span>Cash</span><b class="lp-cash">$0</b></div>
            <div><span>Buying power</span><b class="lp-bp">0 sh</b></div>
          </div>
          <div class="lp-pos"><div class="lp-pos-h"><span>Position</span><b class="lp-pos-q">Flat</b></div><div class="lp-pos-r"><span class="lp-pos-avg"></span><b class="lp-pos-pl"></b></div></div>
          <div class="lp-trade">
            <div class="lp-sizes"></div>
            <div class="lp-btns">
              <button type="button" class="lp-buy" data-t="buy">BUY</button>
              <button type="button" class="lp-sell" data-t="sell">SELL</button>
              <button type="button" class="lp-rev" data-t="rev">Reverse</button>
              <button type="button" class="lp-flat" data-t="flat">FLAT</button>
            </div>
          </div>
          <div class="lp-ord">
            <div class="lp-ord-h"><span>Orders</span><div class="lp-quick"><button type="button" data-q="stop" title="Automatic exit about 1% against you">Stop-loss</button><button type="button" data-q="tp" title="Automatic exit about 2% in your favour">Take profit</button></div></div>
            <div class="lp-ord-f">
              <select class="lp-o-side"><option value="buy">Buy</option><option value="sell">Sell</option></select>
              <select class="lp-o-type"><option value="limit">Limit</option><option value="stop">Stop</option></select>
              <input class="lp-o-px" type="number" step="0.01" min="0.01" inputmode="decimal" placeholder="Price" aria-label="Order price">
              <button type="button" class="lp-o-go">Place</button>
            </div>
            <div class="lp-orders"></div>
          </div>
          <div class="lp-tabs"><button type="button" data-tab="trades" class="on">Trades</button><button type="button" data-tab="coach">Coach</button><button type="button" data-tab="stats">Profile</button></div>
          <div class="lp-tabbody">
            <div class="lp-pane" data-pane="trades"></div>
            <div class="lp-pane hidden" data-pane="coach"><div class="lp-chat" aria-live="polite"></div><form class="lp-say"><input maxlength="240" placeholder="Ask the coach anything (what is a stop?)" aria-label="Ask the coach"><button type="submit" class="btn primary small">Ask</button></form></div>
            <div class="lp-pane hidden" data-pane="stats"></div>
          </div>
        </div>
        <div class="lp-screen hidden"></div>
      </div></div></div>`;
    const $ = (s) => el.querySelector(s), $$ = (s) => [...el.querySelectorAll(s)];
    const cv = $(".lp-cv"), screen = $(".lp-screen"), tutEl = $(".lp-tut"), tutWrap = $(".lp-tutwrap");

    let data = null, ind = null, hover = null, timer = 0, playing = false, raf = 0, lay = null, aiOff = false, ev = {}, baseI = 0, saveN = 0;
    const run = () => st.run;

    function loadData() {
      const r = run(); if (!r) { data = null; ind = null; return; }
      data = L.generate({ kind: r.kind, seed: r.seed, start: r.start, vol: r.vol, bars: r.bars });
      const closes = data.bars.map((b) => b.c);
      ind = { e9: L.ema(closes, 9), e20: L.ema(closes, 20), vw: L.vwap(data.bars), mc: L.macd(closes) };
      if (r.kind === "runner" && data.meta.spike) r.peakPrice = Math.max(...data.bars.slice(data.meta.spike[0], data.meta.spike[1] + 6).map((b) => b.h));
    }
    const last = () => (run() ? run().bars - 1 : 0);
    const bar = () => data.bars[run().i];
    const price = () => (data && run() ? bar().c : 0);
    const persist = () => { save(); };
    const persistSoon = () => { if (++saveN % 8 === 0) persist(); };

    // ---------- header / account / position ----------
    function paintTop() {
      const r = run(); if (!r || !data) { $(".lp-tk").textContent = "----"; $(".lp-co").textContent = ""; $(".lp-last").textContent = "0.00"; $(".lp-chg").textContent = ""; $(".lp-time").textContent = ""; $(".lp-prog i").style.width = "0"; return; }
      const b = bar(), open = data.bars[0].o, ch = b.c - open;
      $(".lp-tk").textContent = r.flavor.ticker; $(".lp-co").textContent = r.flavor.company;
      $(".lp-last").textContent = b.c.toFixed(2);
      const chg = $(".lp-chg"); chg.textContent = (ch >= 0 ? "+" : "") + ch.toFixed(2) + " (" + (ch >= 0 ? "+" : "") + ((ch / open) * 100).toFixed(1) + "%)"; chg.className = "lp-chg " + (ch >= 0 ? "up" : "dn");
      $(".lp-time").textContent = clock(r.i);
      $(".lp-prog i").style.width = (r.i / last()) * 100 + "%";
    }
    function paintAcct() {
      const r = run(); if (!r || !data) { ["lp-eq", "lp-cash"].forEach((c) => ($("." + c).textContent = "$0")); $(".lp-day").textContent = "$0"; $(".lp-bp").textContent = "0 sh"; return; }
      const a = r.acc, p = price(), eq = a.equity(p), pl = eq - a.start;
      $(".lp-eq").textContent = money(eq);
      const d = $(".lp-day"); d.textContent = signed(pl); d.className = "lp-day " + (pl > 0.004 ? "up" : pl < -0.004 ? "dn" : "");
      $(".lp-cash").textContent = money(a.cash);
      $(".lp-bp").textContent = a.cap(p).toLocaleString("en-US") + " sh";
      const q = $(".lp-pos-q"), avg = $(".lp-pos-avg"), plb = $(".lp-pos-pl");
      if (!a.qty) { q.textContent = "Flat"; q.className = "lp-pos-q"; avg.textContent = "No open position"; plb.textContent = ""; plb.className = "lp-pos-pl"; }
      else { const u = a.unreal(p); q.textContent = (a.qty > 0 ? "Long " : "Short ") + Math.abs(a.qty).toLocaleString("en-US"); q.className = "lp-pos-q " + (a.qty > 0 ? "up" : "dn"); avg.textContent = "avg " + a.avg.toFixed(2); plb.textContent = signed(u); plb.className = "lp-pos-pl " + (u >= 0 ? "up" : "dn"); }
      $$(".lp-sizes button").forEach((b) => b.classList.toggle("on", String(r.size) === b.dataset.s));
    }
    function paintOrders() {
      const r = run(), box = $(".lp-orders"); if (!r) return;
      const os = r.acc.orders;
      box.innerHTML = os.length ? "" : `<em>No waiting orders</em>`;
      os.forEach((o) => {
        const row = document.createElement("div"); row.className = "lp-oi " + (o.type.startsWith("buy") ? "b" : "s");
        row.innerHTML = `<span>${o.type.replace("-", " ").toUpperCase()} ${o.qty.toLocaleString("en-US")} @ ${o.price.toFixed(2)}</span><button type="button" title="Cancel order" aria-label="Cancel order">${icon("x")}</button>`;
        row.querySelector("button").onclick = () => { r.acc.cancel(o.id); paintOrders(); draw(); persist(); };
        box.appendChild(row);
      });
    }
    function paintTrades() {
      const r = run(), box = $('[data-pane="trades"]'); if (!r) { box.innerHTML = ""; return; }
      const T = r.acc.trades.slice().reverse();
      box.innerHTML = T.length ? "" : `<em class="lp-empty">Closed trades show up here with their profit or loss.</em>`;
      T.slice(0, 30).forEach((t) => {
        const row = document.createElement("div"); row.className = "lp-tr";
        row.innerHTML = `<span class="${t.pnl >= 0 ? "up" : "dn"}">${t.side === "long" ? "LONG" : "SHORT"}</span><span>${t.entry.toFixed(2)} → ${t.exit.toFixed(2)}</span><span>${t.bars}m${t.stopped ? " · stop" : ""}</span><b class="${t.pnl >= 0 ? "up" : "dn"}">${signed(t.pnl)}</b>`;
        box.appendChild(row);
      });
    }
    function paintProfile() {
      const p = st.prof, lv = L.levelFor(p.xp), box = $('[data-pane="stats"]');
      box.innerHTML = `<div class="lp-lv"><b>Lv ${lv.level}</b> ${esc(lv.name)}</div><div class="lp-xp"><i style="width:${Math.round(lv.pct * 100)}%"></i></div><div class="lp-xpt">${p.xp} XP${lv.next ? " · " + (lv.next - p.xp) + " to next level" : " · max level"}</div>
        <div class="lp-ach">${Object.keys(L.ACH).map((k) => `<div class="${p.ach.includes(k) ? "got" : ""}" title="${esc(L.ACH[k][1])}"><b>${esc(L.ACH[k][0])}</b><span>${esc(L.ACH[k][1])}</span></div>`).join("")}</div>
        <div class="lp-xpt">${p.runs} sessions played${p.best != null ? " · best day " + signed(p.best) : ""}</div>`;
    }
    function paintAll() { paintTop(); paintAcct(); paintOrders(); paintTrades(); paintProfile(); paintTransport(); draw(); }

    // ---------- the chart ----------
    function draw() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; if (alive()) chart(); }); }
    function chart() {
      const r = run(); if (!r || !data) { const g0 = cv.getContext("2d"); g0.clearRect(0, 0, cv.width, cv.height); return; }
      const dpr = window.devicePixelRatio || 1, rect = cv.getBoundingClientRect(), W = Math.max(40, rect.width), H = Math.max(40, rect.height);
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      const bars = data.bars, i = r.i, pad = 6, n = Math.max(20, Math.min(r.bars + pad, Math.round(r.view.n)));
      r.view.off = Math.max(0, Math.min(Math.max(0, i - 10), r.view.off));
      const lastIdx = i + pad - r.view.off, first = lastIdx - n + 1;
      const left = 4, right = 56, top = 8, bot = 22, plotW = W - left - right;
      const macdOn = r.ind.macd, macdH = macdOn ? Math.round((H - top - bot) * 0.24) : 0, gap = macdOn ? 8 : 0;
      const pTop = top, pBot = H - bot - macdH - gap, mTop = pBot + gap, mBot = H - bot;
      const bw = plotW / n, X = (k) => left + (k - first + 0.5) * bw;
      const vis = []; for (let k = Math.max(0, first); k <= Math.min(i, lastIdx); k++) vis.push(k);
      let lo = Infinity, hi = -Infinity; vis.forEach((k) => { lo = Math.min(lo, bars[k].l); hi = Math.max(hi, bars[k].h); });
      if (!isFinite(lo)) { lo = bars[i].l; hi = bars[i].h; }
      const span0 = Math.max(hi - lo, hi * 0.004), pr = (p) => (p >= lo - span0 * 0.35 && p <= hi + span0 * 0.35);
      const lines = [];
      if (r.acc.qty) lines.push({ p: r.acc.avg, c: COL.entry, label: (r.acc.qty > 0 ? "LONG " : "SHORT ") + Math.abs(r.acc.qty) + " @ " + r.acc.avg.toFixed(2), solid: false, entry: true });
      r.acc.orders.forEach((o) => lines.push({ p: o.price, c: o.type.startsWith("buy") ? COL.buy : COL.sell, label: o.type.replace("-", " ").toUpperCase() + " " + o.qty + " @ " + o.price.toFixed(2) }));
      lines.forEach((l) => { if (pr(l.p)) { lo = Math.min(lo, l.p); hi = Math.max(hi, l.p); } });
      const margin = (hi - lo) * 0.08 || 0.05; lo -= margin; hi += margin;
      const Y = (p) => pTop + (1 - (p - lo) / (hi - lo)) * (pBot - pTop), P = (y) => lo + (1 - (y - pTop) / (pBot - pTop)) * (hi - lo);
      lay = { left, right: W - right, pTop, pBot, mTop, mBot, first, lastIdx, bw, X, Y, P, W, H, n };
      g.font = "11px ui-monospace,SFMono-Regular,Menlo,monospace"; g.textBaseline = "middle";
      // grid + price axis
      const rawStep = (hi - lo) / 6, mag = Math.pow(10, Math.floor(Math.log10(rawStep))), stp = [1, 2, 2.5, 5, 10].map((x) => x * mag).find((x) => x >= rawStep) || mag * 10;
      g.strokeStyle = COL.grid; g.fillStyle = COL.txt; g.lineWidth = 1; g.textAlign = "left";
      for (let p = Math.ceil(lo / stp) * stp; p <= hi; p += stp) { const y = Math.round(Y(p)) + 0.5; g.beginPath(); g.moveTo(left, y); g.lineTo(W - right, y); g.stroke(); g.fillText(p.toFixed(stp < 0.1 ? 3 : 2), W - right + 6, y); }
      // time axis
      const tstep = [5, 10, 15, 30, 60].find((s) => s * bw >= 62) || 60;
      g.textAlign = "center";
      for (let k = Math.max(0, Math.ceil(first / tstep) * tstep); k <= lastIdx; k += tstep) { const x = Math.round(X(k)) + 0.5; g.beginPath(); g.moveTo(x, pTop); g.lineTo(x, mBot); g.stroke(); g.fillText(clock(k).replace(" AM", "").replace(" PM", ""), x, H - 9); }
      // volume
      if (r.ind.vol) {
        let vm = 1; vis.forEach((k) => (vm = Math.max(vm, bars[k].v)));
        const vh = (pBot - pTop) * 0.18;
        vis.forEach((k) => { const b = bars[k], h = (b.v / vm) * vh; g.fillStyle = b.c >= b.o ? "rgba(39,245,160,.22)" : "rgba(255,77,125,.22)"; g.fillRect(X(k) - bw * 0.34, pBot - h, Math.max(1, bw * 0.68), h); });
      }
      g.save(); g.beginPath(); g.rect(left, pTop, plotW, pBot - pTop); g.clip();
      // VWAP / EMA
      const line = (arr, c, w) => { g.strokeStyle = c; g.lineWidth = w || 1.4; g.beginPath(); let started = false; vis.forEach((k) => { const x = X(k), y = Y(arr[k]); if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y); }); g.stroke(); };
      if (r.ind.vwap) line(ind.vw, COL.vwap, 1.6);
      if (r.ind.ema) { line(ind.e20, COL.ema20); line(ind.e9, COL.ema9); }
      // candles
      vis.forEach((k) => {
        const b = bars[k], x = X(k), up = b.c >= b.o, c = up ? COL.up : COL.down;
        g.strokeStyle = c; g.fillStyle = c; g.lineWidth = 1;
        g.beginPath(); g.moveTo(Math.round(x) + 0.5, Y(b.h)); g.lineTo(Math.round(x) + 0.5, Y(b.l)); g.stroke();
        const bwid = Math.max(1, bw * 0.66), yo = Y(b.o), yc = Y(b.c);
        g.fillRect(x - bwid / 2, Math.min(yo, yc), bwid, Math.max(1, Math.abs(yc - yo)));
      });
      // fill markers
      r.acc.fills.forEach((f) => {
        if (f.i < first || f.i > lastIdx) return; const x = X(f.i), b = bars[f.i], up = f.side === "buy", y = up ? Y(b.l) + 11 : Y(b.h) - 11, c = up ? COL.buy : COL.sell;
        g.fillStyle = c; g.beginPath(); if (up) { g.moveTo(x, y - 6); g.lineTo(x - 5, y + 3); g.lineTo(x + 5, y + 3); } else { g.moveTo(x, y + 6); g.lineTo(x - 5, y - 3); g.lineTo(x + 5, y - 3); } g.closePath(); g.fill();
      });
      // entry + order lines
      lines.forEach((l) => {
        if (!pr(l.p)) return; const y = Math.round(Y(l.p)) + 0.5;
        g.strokeStyle = l.c; g.lineWidth = 1.2; g.setLineDash(l.entry ? [2, 4] : [7, 4]); g.beginPath(); g.moveTo(left, y); g.lineTo(W - right, y); g.stroke(); g.setLineDash([]);
        g.font = "10.5px ui-monospace,monospace"; const tw = g.measureText(l.label).width + 10;
        g.fillStyle = "rgba(14,6,32,.82)"; g.fillRect(left + 6, y - 9, tw, 18); g.strokeStyle = l.c; g.lineWidth = 1; g.strokeRect(left + 6.5, y - 8.5, tw, 17); g.fillStyle = l.c; g.textAlign = "left"; g.fillText(l.label, left + 11, y);
      });
      g.restore();
      // last price tag
      const lp = bars[i].c, ly = Y(lp), upc = bars[i].c >= bars[i].o ? COL.up : COL.down;
      g.setLineDash([2, 3]); g.strokeStyle = upc; g.lineWidth = 1; g.beginPath(); g.moveTo(left, Math.round(ly) + 0.5); g.lineTo(W - right, Math.round(ly) + 0.5); g.stroke(); g.setLineDash([]);
      g.fillStyle = upc; g.fillRect(W - right + 1, ly - 9, right - 2, 18); g.fillStyle = "#06020f"; g.textAlign = "left"; g.font = "bold 11px ui-monospace,monospace"; g.fillText(lp.toFixed(2), W - right + 5, ly);
      // MACD pane
      if (macdOn) {
        const mc = ind.mc; let mx = 1e-9; vis.forEach((k) => (mx = Math.max(mx, Math.abs(mc.macd[k]), Math.abs(mc.signal[k]), Math.abs(mc.hist[k]))));
        const MY = (v) => mTop + (1 - (v / mx + 1) / 2) * (mBot - mTop);
        g.strokeStyle = COL.grid; g.lineWidth = 1; g.beginPath(); g.moveTo(left, Math.round(MY(0)) + 0.5); g.lineTo(W - right, Math.round(MY(0)) + 0.5); g.stroke();
        g.fillStyle = COL.txt; g.font = "10px ui-monospace,monospace"; g.textAlign = "left"; g.fillText("MACD 12 26 9", left + 6, mTop + 8);
        vis.forEach((k) => { const h = mc.hist[k]; g.fillStyle = h >= 0 ? "rgba(39,245,160,.55)" : "rgba(255,77,125,.55)"; const y0 = MY(0), y1 = MY(h); g.fillRect(X(k) - bw * 0.3, Math.min(y0, y1), Math.max(1, bw * 0.6), Math.max(1, Math.abs(y1 - y0))); });
        const ml = (arr, c) => { g.strokeStyle = c; g.lineWidth = 1.3; g.beginPath(); vis.forEach((k, j) => (j ? g.lineTo(X(k), MY(arr[k])) : g.moveTo(X(k), MY(arr[k])))); g.stroke(); };
        ml(mc.macd, COL.ema20); ml(mc.signal, COL.ema9);
      }
      // OHLC read-out (hovered candle, or the newest one)
      const hk = hover && hover.k != null && hover.k >= 0 && hover.k <= i ? hover.k : i, hb = bars[hk];
      g.font = "11px ui-monospace,monospace"; g.textAlign = "left"; g.fillStyle = COL.txt;
      const items = [["O", hb.o], ["H", hb.h], ["L", hb.l], ["C", hb.c]]; let tx = left + 6;
      items.forEach(([k, v]) => { g.fillStyle = COL.txt; g.fillText(k, tx, pTop + 10); tx += 10; g.fillStyle = hb.c >= hb.o ? COL.up : COL.down; const s = v.toFixed(2); g.fillText(s, tx, pTop + 10); tx += g.measureText(s).width + 9; });
      g.fillStyle = COL.txt; g.fillText("Vol " + kfmt(hb.v), tx, pTop + 10); tx += 80;
      if (r.ind.ema && tx < W - 290) { g.fillStyle = COL.ema9; g.fillText("EMA9 " + ind.e9[hk].toFixed(2), tx, pTop + 10); tx += 86; g.fillStyle = COL.ema20; g.fillText("EMA20 " + ind.e20[hk].toFixed(2), tx, pTop + 10); tx += 94; }
      if (r.ind.vwap && tx < W - 150) { g.fillStyle = COL.vwap; g.fillText("VWAP " + ind.vw[hk].toFixed(2), tx, pTop + 10); }
      // crosshair
      if (hover && hover.x >= left && hover.x <= W - right && hover.y >= pTop && hover.y <= mBot) {
        g.setLineDash([3, 3]); g.strokeStyle = "rgba(255,255,255,.4)"; g.lineWidth = 1;
        g.beginPath(); g.moveTo(Math.round(hover.x) + 0.5, pTop); g.lineTo(Math.round(hover.x) + 0.5, mBot); g.stroke();
        if (hover.y <= pBot) { g.beginPath(); g.moveTo(left, Math.round(hover.y) + 0.5); g.lineTo(W - right, Math.round(hover.y) + 0.5); g.stroke(); }
        g.setLineDash([]);
        if (hover.y <= pBot) { g.fillStyle = "#3df0ff"; g.fillRect(W - right + 1, hover.y - 9, right - 2, 18); g.fillStyle = "#06020f"; g.font = "bold 11px ui-monospace,monospace"; g.textAlign = "left"; g.fillText(P(hover.y).toFixed(2), W - right + 5, hover.y); }
      }
      $(".lp-live").classList.toggle("hidden", r.view.off === 0);
    }

    // chart interaction: wheel zoom, drag to pan, crosshair
    let drag = null;
    cv.addEventListener("pointermove", (e) => {
      const rect = cv.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (drag && run()) { const dx = x - drag.x; const move = Math.round(dx / (lay ? lay.bw : 8)); run().view.off = drag.off + move; if (lay && Math.abs(dx) > 3) drag.moved = true; }
      hover = lay ? { x, y, k: Math.round((x - lay.left) / lay.bw + lay.first - 0.5) } : null; draw();
    });
    cv.addEventListener("pointerleave", () => { hover = null; draw(); });
    cv.addEventListener("pointerdown", (e) => { if (!run()) return; const rect = cv.getBoundingClientRect(); drag = { x: e.clientX - rect.left, off: run().view.off }; try { cv.setPointerCapture(e.pointerId); } catch {} cv.classList.add("grab"); });
    const endDrag = () => { drag = null; cv.classList.remove("grab"); };
    cv.addEventListener("pointerup", endDrag); cv.addEventListener("pointercancel", endDrag);
    cv.addEventListener("wheel", (e) => { if (!run()) return; e.preventDefault(); zoom(e.deltaY > 0 ? 1.18 : 1 / 1.18); }, { passive: false });
    cv.addEventListener("dblclick", () => { if (run()) { run().view.off = 0; run().view.n = 90; draw(); } });
    function zoom(f) { const r = run(); if (!r) return; r.view.n = Math.max(20, Math.min(r.bars + 6, r.view.n * f)); ev.zoom = true; draw(); }
    $('[data-z="in"]').onclick = () => zoom(1 / 1.3); $('[data-z="out"]').onclick = () => zoom(1.3);
    $(".lp-live").onclick = () => { run().view.off = 0; draw(); };
    if (window.ResizeObserver) { const ro = new ResizeObserver(() => draw()); ro.observe(cv); }

    // ---------- replay ----------
    function paintTransport() {
      const r = run(), pb = $(".lp-play"); if (!r) return;
      pb.innerHTML = playing ? `<svg class="ic" viewBox="0 0 24 24"><path fill="currentColor" d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg><span>Pause</span>` : `<svg class="ic" viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg><span>${r.done ? "Finished" : "Play"}</span>`;
      pb.classList.toggle("on", playing); pb.disabled = r.done;
      $(".lp-stepb").disabled = r.done;
      $$(".lp-speeds button").forEach((b) => b.classList.toggle("on", Number(b.dataset.sp) === r.speed));
      $$(".lp-inds button").forEach((b) => b.classList.toggle("on", !!r.ind[b.dataset.i]));
    }
    function setPlaying(on) {
      const r = run(); playing = !!on && !!r && !r.done; clearInterval(timer);
      if (playing) { const hz = Math.min(r.speed, 10), per = r.speed > 10 ? Math.round(r.speed / 10) : 1; timer = setInterval(() => { if (!alive()) { clearInterval(timer); return; } advance(per); }, 1000 / hz); }
      paintTransport();
    }
    function advance(nBars) {
      const r = run(); if (!r || r.done) return;
      for (let k = 0; k < nBars && !r.done; k++) {
        if (r.i >= last()) { finishSession(); return; }
        r.i++; moved++;
        const f = r.acc.step(bar(), r.i);
        f.forEach((x) => { SND.play(x.why === "stop" ? "loss" : x.pnl > 0 ? "cash" : "fill"); if (x.why === "stop") ev.stopped = true; toast((x.why === "stop" ? "Stop hit: " : x.why === "limit" ? "Limit filled: " : "") + (x.side === "buy" ? "Bought " : "Sold ") + x.qty + " @ " + x.price.toFixed(2) + (x.pnl ? " · " + signed(x.pnl) : "")); });
        news();
        if (r.i >= last()) { finishSession(); return; }
      }
      paintTop(); paintAcct(); paintOrders(); paintTrades(); draw(); persistSoon(); tutCheck();
    }
    let moved = 0;
    function news() {
      const r = run(), m = data.meta; if (r.mode === "tut") return;
      const at = r.kind === "runner" && m.spike ? m.spike[0] : r.kind === "breakdown" ? m.breakAt : r.kind === "vshape" ? m.flush + 4 : null;
      if (at != null && r.i === at && !r.news.includes(at)) { r.news.push(at); flash(r.flavor.alert, r.kind === "breakdown" || r.kind === "runner"); SND.play("alert"); if (r.speed > 5) { r.speed = 2; setPlaying(true); } }
    }
    function flash(text, hot) { const n = $(".lp-news"); n.textContent = text; n.className = "lp-news show" + (hot ? " hot" : ""); clearTimeout(n._t); n._t = setTimeout(() => n.classList.remove("show"), 9000); }

    // ---------- trading ----------
    const SPREAD = 0.01;
    function trade(kind) {
      const r = run(); if (!r || r.done) return;
      const a = r.acc, p = price(); let q = r.size, side = kind;
      if (kind === "flat") {
        if (!a.qty) { toast("You have no open position."); return; }
        a.cancelAll(); const side2 = a.qty > 0 ? "sell" : "buy", f = a.fill(side2, Math.abs(a.qty), side2 === "sell" ? p - SPREAD : p + SPREAD, r.i, "market");
        ev.flat = true; if (f) SND.play(f.pnl >= 0 ? "cash" : "loss");
      } else {
        if (kind === "rev") { if (!a.qty) { toast("Reverse flips an open position the other way. Open one first."); return; } side = a.qty > 0 ? "sell" : "buy"; q = Math.abs(a.qty) * 2; }
        const px = side === "buy" ? p + SPREAD : p - SPREAD, ok = a.allow(side, q, px);
        if (!ok) { toast("Not enough buying power for that size.", "err"); return; }
        const wasFlat = a.qty === 0;
        if (ok < q) toast("Size reduced to " + ok + " shares (buying power).");
        const f = a.fill(side, ok, px, r.i, "market"); if (f) SND.play("fill");
        if (side === "buy") ev.bought = true; else { ev.sold = true; if (wasFlat) ev.shortOpened = true; moved = kind === "sell" && wasFlat ? 0 : moved; }
      }
      paintAcct(); paintOrders(); paintTrades(); draw(); persist(); tutCheck();
    }
    function placeOrder(side, type, pricev, qty) {
      const r = run(); if (!r || r.done) return;
      const p = price(), pv = Math.round(Number(pricev) * 100) / 100;
      if (!(pv > 0)) { toast("Type a price for the order.", "err"); return; }
      const t = side + "-" + type;
      if (t === "buy-limit" && pv >= p) { toast("A buy limit waits BELOW the price (" + p.toFixed(2) + "). To buy now use BUY.", "err"); return; }
      if (t === "sell-limit" && pv <= p) { toast("A sell limit waits ABOVE the price (" + p.toFixed(2) + "). To sell now use SELL.", "err"); return; }
      if (t === "buy-stop" && pv <= p) { toast("A buy stop triggers ABOVE the price (" + p.toFixed(2) + "): it buys a breakout.", "err"); return; }
      if (t === "sell-stop" && pv >= p) { toast("A sell stop triggers BELOW the price (" + p.toFixed(2) + "): it protects a long.", "err"); return; }
      if (r.acc.orders.length >= 12) { toast("That's plenty of orders. Cancel some first.", "err"); return; }
      const o = r.acc.place(t, pv, qty || r.size); if (!o) return;
      if (type === "stop") ev.stop = true; else ev.limit = true;
      SND.play("fill"); paintOrders(); draw(); persist(); tutCheck();
    }
    function quick(kind) {
      const r = run(); if (!r || r.done) return; const a = r.acc, p = price();
      if (!a.qty) { toast("Open a position first (BUY or SELL), then add a stop or a target for it."); return; }
      const long = a.qty > 0, q = Math.abs(a.qty);
      if (kind === "stop") { const px = long ? Math.min(a.avg, p) * 0.99 : Math.max(a.avg, p) * 1.01; placeOrder(long ? "sell" : "buy", "stop", Math.round(px * 100) / 100 + (long ? -0.0 : 0), q); }
      else { const px = long ? Math.max(a.avg, p) * 1.02 : Math.min(a.avg, p) * 0.98; placeOrder(long ? "sell" : "buy", "limit", Math.round(px * 100) / 100, q); }
    }

    // ---------- finishing a session ----------
    function finishSession() {
      const r = run(); if (!r || r.done) return;
      setPlaying(false);
      const a = r.acc, p = bar().c; a.cancelAll();
      if (a.qty) { const side = a.qty > 0 ? "sell" : "buy"; a.fill(side, Math.abs(a.qty), p, r.i, "market"); }
      r.done = true; r.view.off = 0;
      if (r.mode === "tut") return finishTutorial();
      const res = L.score(a, p, Object.assign({}, data.meta, { peakPrice: r.peakPrice })), pr = st.prof, before = L.levelFor(pr.xp).level;
      const fresh = res.achievements.filter((k) => !pr.ach.includes(k)); pr.ach.push(...fresh);
      if (r.daily) { pr.dailyDone = todayKey(); res.xp += 25; }
      pr.xp += res.xp; pr.runs++; pr.best = pr.best == null ? res.pnl : Math.max(pr.best, res.pnl);
      const after = L.levelFor(pr.xp);
      st.last = { res, fresh, level: after.level, up: after.level > before, kind: r.kind, flavor: r.flavor, daily: !!r.daily, coach: "" };
      st.phase = "done"; paintAll(); persist();
      SND.play(res.pnl > 0 ? "win" : "lose"); if (after.level > before) setTimeout(() => SND.play("level"), 900);
      showDebrief();
    }
    function showDebrief() {
      const d = st.last, res = d.res, lv = L.levelFor(st.prof.xp);
      const K = L.KINDS[d.kind];
      screen.innerHTML = `<div class="lp-card lp-debrief">
        <div class="lp-st" style="--d:0"><span class="lp-kick">${d.daily ? "Daily challenge" : "Session over"} · ${esc(K.label)}</span><h3 class="${res.pnl >= 0 ? "up" : "dn"}">${signed(res.pnl)} <small>(${(res.pct * 100).toFixed(2)}%)</small></h3><p class="lp-sub">${esc(d.flavor.company)} (${esc(d.flavor.ticker)}) · ${esc(K.blurb)}</p></div>
        <div class="lp-stats lp-st" style="--d:1">
          <div><span>Trades</span><b>${res.trades}</b></div><div><span>Win rate</span><b>${Math.round(res.winRate * 100)}%</b></div><div><span>Best</span><b class="up">${signed(res.best)}</b></div><div><span>Worst</span><b class="dn">${signed(res.worst)}</b></div><div><span>Avg win</span><b>${signed(res.avgWin)}</b></div><div><span>Avg loss</span><b>${signed(res.avgLoss)}</b></div>
        </div>
        <div class="lp-st" style="--d:2"><div class="lp-lv"><b>Lv ${lv.level}</b> ${esc(lv.name)} <em>+${res.xp} XP</em>${d.up ? ` <strong class="lp-up">LEVEL UP!</strong>` : ""}</div><div class="lp-xp"><i style="width:${Math.round(lv.pct * 100)}%"></i></div></div>
        ${d.fresh.length ? `<div class="lp-st lp-newach" style="--d:3">${d.fresh.map((k) => `<span title="${esc(L.ACH[k][1])}">★ ${esc(L.ACH[k][0])}</span>`).join("")}</div>` : ""}
        <div class="lp-st lp-mist" style="--d:4">${res.mistakes.length ? res.mistakes.map((x) => `<div>⚠ ${esc(x.text)}</div>`).join("") : `<div class="ok">✓ No big mistakes spotted. Clean session.</div>`}</div>
        <div class="lp-st lp-coachbox" style="--d:5"><b>Coach</b><p class="lp-coachtxt"><span class="lp-dots"><i></i><i></i><i></i></span></p></div>
        <div class="lp-st lp-act" style="--d:6"><button type="button" class="btn primary" data-d="again"><span class="lbl">New session</span></button><button type="button" class="btn" data-d="review"><span class="lbl">Review the chart</span></button></div>
      </div>`;
      openScreen();
      screen.querySelector('[data-d="again"]').onclick = () => showMenu();
      screen.querySelector('[data-d="review"]').onclick = () => { closeScreen(); run().view.n = run().bars + 6; run().view.off = 0; draw(); };
      coachDebrief();
    }
    async function coachDebrief() {
      const d = st.last, box = screen.querySelector(".lp-coachtxt"); if (!box) return;
      if (d.coach) { box.textContent = d.coach; return; }
      const res = d.res, trades = run().acc.trades.slice(0, 12).map((t) => ({ side: t.side, pnl: Math.round(t.pnl), mins: t.bars, stopped: t.stopped }));
      let text = "";
      if (!aiOff) {
        const j = await ai({ mode: "coach", kind: d.kind, company: d.flavor.company, stats: { pnl: Math.round(res.pnl), pct: +(res.pct * 100).toFixed(2), trades: res.trades, winRate: Math.round(res.winRate * 100), avgWin: Math.round(res.avgWin), avgLoss: Math.round(res.avgLoss) }, mistakes: res.mistakes.map((x) => x.id), trades });
        text = j && j.text || "";
      }
      if (!text) text = localCoach(d);
      d.coach = text; persist();
      if (box.isConnected) { box.style.opacity = 0; setTimeout(() => { box.textContent = text; box.style.opacity = 1; }, 160); }
    }
    function localCoach(d) {
      const res = d.res, k = L.KINDS[d.kind], out = [];
      out.push(res.trades === 0 ? "You didn't trade at all. That's a valid choice when there's no setup, but you only learn by playing, so try a small position next time." : res.pnl > 0 ? `Nice, you finished up ${signed(res.pnl)}. Check whether it came from a plan or from luck.` : `You finished ${signed(res.pnl)}. Losing days are normal: what matters is that the losses were small and planned.`);
      out.push(`This was a "${k.label}" day: ${k.blurb}`);
      out.push(res.mistakes.length ? "Biggest lesson: " + res.mistakes[0].text : "Next goal: keep using a stop and a target on every trade, and try to make your winners bigger than your losers (2:1).");
      return out.join(" ");
    }

    // ---------- the AI (Gemini via the server) ----------
    async function ai(body) {
      try {
        const j = await api("/api/larp/ai", { method: "POST", noAuthRedirect: true, body });
        if (j && (j.unavailable || j.limited)) { if (j.unavailable) aiOff = true; return j.limited ? { limited: true, text: "" } : null; }
        return j;
      } catch { return null; }
    }
    async function askCoach(q) {
      const chat = $(".lp-chat"), r = run();
      addChat("you", q);
      const typing = document.createElement("div"); typing.className = "lp-bubble coach"; typing.innerHTML = `<span class="lp-dots"><i></i><i></i><i></i></span>`; chat.appendChild(typing); chat.scrollTop = chat.scrollHeight;
      let text = "";
      if (!aiOff) {
        const step = st.phase === "tut" ? TUT[st.tut.step] : null;
        const j = await ai({ mode: "ask", q, tutorial: step ? step.title : "", price: r && data ? price() : null, qty: r ? r.acc.qty : 0, avg: r && r.acc.qty ? r.acc.avg : null, history: st.chat.slice(-6) });
        text = j && j.text || "";
        if (j && j.limited) text = "You've used today's free AI messages. Here's the built-in glossary instead: " + gloss(q);
      }
      if (!text) text = gloss(q);
      typing.remove(); addChat("coach", text); st.chat.push({ f: "you", t: q }, { f: "coach", t: text }); st.chat = st.chat.slice(-20); persist();
    }
    function gloss(q) { const g = GLOSS.find((x) => x[0].test(q)); return g ? g[1] : "I can explain: stop-loss, limit orders, shorting, VWAP, EMA, MACD, volume, spread, P&L and position sizing. (The AI coach is not available right now.)"; }
    function addChat(who, t) { const d = document.createElement("div"); d.className = "lp-bubble " + who; d.textContent = t; const chat = $(".lp-chat"); chat.appendChild(d); chat.scrollTop = chat.scrollHeight; }
    $(".lp-say").onsubmit = (e) => { e.preventDefault(); const i = e.target.querySelector("input"), t = i.value.trim(); if (!t) return; i.value = ""; askCoach(t); };

    // ---------- tutorial ----------
    function tutCtx() { const r = run(); return { run: r, acc: r.acc, i: r.i, last: last(), moved, ev, autoFlat() { if (r.acc.qty) { r.acc.cancelAll(); const side = r.acc.qty > 0 ? "sell" : "buy"; r.acc.fill(side, Math.abs(r.acc.qty), price(), r.i, "market"); toast("I closed your position so you start this lesson clean."); } } }; }
    function startTutorial(fresh) {
      st.phase = "tut"; closeScreen();
      if (fresh || !st.run || st.run.mode !== "tut" || st.run.done) { st.run = newRun(TUT_DAY.kind, TUT_DAY.seed, { ticker: "DEMO", company: "Demo Corp (practice day)", headline: "", alert: "" }, "tut", TUT_DAY); st.run.i = 20; st.tut = { step: 0, max: 0, done: false, skipped: false }; tutDoneMap = {}; tutQuizDone = {}; }
      loadData(); setPlaying(false); enterStep(st.tut.step, true); paintAll(); persist();
    }
    function enterStep(k, first) {
      const s = TUT[k]; st.tut.step = k; st.tut.max = Math.max(st.tut.max, k); ev = {}; moved = 0;
      if (s.enter) s.enter(tutCtx());
      renderTut(true); paintAll();
    }
    function tutDoneNow() { const s = TUT[st.tut.step]; if (s.quiz) return !!tutQuizDone[st.tut.step]; if (!s.check) return true; return tutDoneMap[st.tut.step] || (tutDoneMap[st.tut.step] = !!s.check(tutCtx())); }
    let tutDoneMap = {}, tutQuizDone = {};
    function tutCheck() { if (st.phase !== "tut" || !run()) return; const k = st.tut.step, s = TUT[k]; if (s.check && !tutDoneMap[k] && s.check(tutCtx())) { tutDoneMap[k] = true; SND.play("cash"); renderTut(false); } }
    function renderTut(animate) {
      $$(".lp-spot").forEach((x) => x.classList.remove("lp-spot"));
      if (st.phase !== "tut") { tutWrap.classList.remove("open"); return; }
      const k = st.tut.step, s = TUT[k], total = TUT.length, done = tutDoneNow();
      if (s.spot) $$(s.spot).forEach((x) => x.classList.add("lp-spot"));
      const html = `<div class="lp-tut-h"><span class="lp-step">Lesson ${k + 1} of ${total}</span><div class="lp-tdots">${TUT.map((_, j) => `<i class="${j < k ? "d" : j === k ? "c" : ""}"></i>`).join("")}</div><button type="button" class="lp-skipall" data-t2="skip">Skip tutorial</button></div>
        <h4>${esc(s.title)}</h4><div class="lp-tut-t">${s.text || ""}</div>
        ${s.quiz ? `<div class="lp-quiz"><p><b>${esc(s.quiz.q)}</b></p>${s.quiz.opts.map((o, j) => `<button type="button" data-q="${j}">${esc(o)}</button>`).join("")}<p class="lp-why"></p></div>` : ""}
        ${s.task ? `<div class="lp-task ${done ? "ok" : ""}"><i>${done ? "✓" : "▶"}</i><span>${esc(s.task)}</span></div>` : ""}
        <div class="lp-tut-b"><button type="button" class="btn small" data-t2="back" ${k ? "" : "disabled"}>Back</button><button type="button" class="btn primary small" data-t2="next"><span class="lbl">${k === total - 1 ? "Finish" : done ? "Next" : s.task || s.quiz ? "Skip step" : "Next"}</span></button></div>`;
      const swap = () => {
        tutEl.innerHTML = html; tutEl.classList.remove("swap");
        if (s.quiz) {
          if (tutQuizDone[k]) { tutEl.querySelector(".lp-why").textContent = s.quiz.why; tutEl.querySelectorAll(".lp-quiz button")[s.quiz.ans].classList.add("ok"); }
          tutEl.querySelectorAll(".lp-quiz button").forEach((b) => (b.onclick = () => {
            const j = Number(b.dataset.q), why = tutEl.querySelector(".lp-why");
            if (j === s.quiz.ans) { tutQuizDone[k] = true; b.classList.add("ok"); why.textContent = s.quiz.why; SND.play("cash"); renderTutTask(); }
            else { b.classList.add("bad"); why.textContent = "Not quite, think about it and try another."; SND.play("loss"); }
          }));
        }
        tutEl.querySelector('[data-t2="skip"]').onclick = skipTutorial;
        tutEl.querySelector('[data-t2="back"]').onclick = () => { if (st.tut.step > 0) enterStepKeep(st.tut.step - 1); };
        tutEl.querySelector('[data-t2="next"]').onclick = () => { if (st.tut.step >= TUT.length - 1) finishSession(); else enterStepKeep(st.tut.step + 1); };
      };
      tutWrap.classList.add("open");
      if (animate && tutEl.innerHTML) { tutEl.classList.add("swap"); setTimeout(swap, 170); } else swap();
    }
    function renderTutTask() { if (st.phase === "tut") renderTut(false); }
    function enterStepKeep(k) { const was = tutDoneMap[k], wq = tutQuizDone[k]; enterStep(k); if (was) tutDoneMap[k] = true; if (wq) tutQuizDone[k] = true; renderTut(false); }
    function skipTutorial() {
      st.tut.skipped = true; st.phase = "menu"; st.prof.tutDone = st.prof.tutDone || false;
      setPlaying(false); tutWrap.classList.remove("open"); $$(".lp-spot").forEach((x) => x.classList.remove("lp-spot"));
      st.run = null; data = null; paintAll(); persist(); showMenu();
    }
    function finishTutorial() {
      const pr = st.prof, first = !pr.tutDone, res = L.score(run().acc, bar().c, data.meta);
      pr.tutDone = true; st.tut.done = true; const before = L.levelFor(pr.xp).level;
      if (first) { pr.xp += 120; if (!pr.ach.includes("grad")) pr.ach.push("grad"); }
      const lv = L.levelFor(pr.xp); st.phase = "menu"; tutWrap.classList.remove("open"); $$(".lp-spot").forEach((x) => x.classList.remove("lp-spot"));
      SND.play("win"); if (lv.level > before) setTimeout(() => SND.play("level"), 900);
      persist();
      screen.innerHTML = `<div class="lp-card"><div class="lp-st" style="--d:0"><span class="lp-kick">Tutorial complete</span><h3>You're a graduate 🎓</h3><p class="lp-sub">Practice day: ${signed(res.pnl)} · ${res.trades} trade${res.trades === 1 ? "" : "s"}${first ? " · +120 XP" : ""}</p></div>
        <div class="lp-st" style="--d:1"><p>You now know how to read candles, place market, limit and stop orders, size a position, and protect yourself. Free play has five different kinds of market days, a daily challenge, and an AI coach that reviews every session.</p></div>
        <div class="lp-st lp-act" style="--d:2"><button type="button" class="btn primary" data-d="go"><span class="lbl">Start free play</span></button></div></div>`;
      st.run = null; data = null; paintAll(); openScreen(); screen.querySelector('[data-d="go"]').onclick = () => showMenu();
    }

    // ---------- screens: welcome / menu ----------
    function openScreen() { screen.classList.remove("hidden"); screen.scrollTop = 0; requestAnimationFrame(() => screen.classList.add("in")); }
    function closeScreen() { screen.classList.remove("in"); setTimeout(() => { if (!screen.classList.contains("in")) screen.classList.add("hidden"); }, 280); }
    function showWelcome() {
      screen.innerHTML = `<div class="lp-card lp-welcome">
        <div class="lp-st" style="--d:0"><span class="lp-kick">Trading practice · simulated</span><h3>Learn to trade, for free</h3><p class="lp-sub">Real-looking charts, fake money. Nothing here is real, and it's not financial advice.</p></div>
        <div class="lp-st lp-feat" style="--d:1"><div><b>📘 Tutorial</b><span>Zero to your first trade with a stop-loss in about 5 minutes.</span></div><div><b>🎲 Market days</b><span>Uptrends, chop, news pumps, crashes and reversals.</span></div><div><b>🤖 AI coach</b><span>Gemini writes the stories and reviews your mistakes.</span></div></div>
        <div class="lp-st lp-act" style="--d:2"><button type="button" class="btn primary" data-d="tut"><span class="lbl">Start the tutorial</span></button><button type="button" class="btn" data-d="skip"><span class="lbl">Skip, I know the basics</span></button></div>
      </div>`;
      openScreen();
      screen.querySelector('[data-d="tut"]').onclick = () => startTutorial(true);
      screen.querySelector('[data-d="skip"]').onclick = () => { st.tut.skipped = true; showMenu(); };
    }
    let pick = "surprise";
    function showMenu() {
      setPlaying(false); st.phase = "menu"; if (run() && run().mode === "tut") st.run = null;
      const p = st.prof, lv = L.levelFor(p.xp), dailyDone = p.dailyDone === todayKey();
      const opts = [["surprise", "🎲", "Surprise me", "A random market day. Kind revealed at the end."], ["daily", "📅", "Daily challenge", dailyDone ? "Done today, come back tomorrow (replay for fun)" : "Same day for everyone today. +25 XP bonus."]].concat(Object.keys(L.KINDS).map((k) => [k, { trend: "📈", range: "↔️", runner: "🚀", breakdown: "📉", vshape: "🔁" }[k], L.KINDS[k].label, L.KINDS[k].blurb]));
      screen.innerHTML = `<div class="lp-card lp-menu">
        <div class="lp-st" style="--d:0"><span class="lp-kick">Lv ${lv.level} · ${esc(lv.name)} · ${p.xp} XP</span><h3>Pick your market day</h3></div>
        <div class="lp-picks lp-st" style="--d:1">${opts.map((o) => `<button type="button" data-k="${o[0]}" class="${pick === o[0] ? "on" : ""}"><span class="e">${o[1]}</span><b>${esc(o[2])}</b><em>${esc(o[3])}</em></button>`).join("")}</div>
        <div class="lp-st lp-act" style="--d:2"><button type="button" class="btn primary" data-d="go"><span class="lbl">Start trading</span></button><button type="button" class="btn" data-d="tut"><span class="lbl">${p.tutDone ? "Replay the tutorial" : "Take the tutorial"}</span></button>${run() && !run().done ? `<button type="button" class="btn" data-d="back"><span class="lbl">Resume session</span></button>` : ""}</div>
        <p class="lp-note lp-st" style="--d:3">All prices are randomly generated, not real market data. Fake money only. This is education, not financial advice.</p>
      </div>`;
      openScreen();
      screen.querySelectorAll(".lp-picks button").forEach((b) => (b.onclick = () => { pick = b.dataset.k; screen.querySelectorAll(".lp-picks button").forEach((x) => x.classList.toggle("on", x === b)); SND.play("fill"); }));
      screen.querySelector('[data-d="tut"]').onclick = () => startTutorial(true);
      const back = screen.querySelector('[data-d="back"]'); if (back) back.onclick = () => { st.phase = "play"; closeScreen(); paintAll(); };
      screen.querySelector('[data-d="go"]').onclick = (e) => beginFree(e.currentTarget);
      paintAll();
    }
    async function beginFree(btn) {
      let kind = pick, seed = newSeed(), daily = false;
      if (pick === "daily") { seed = L.hash("larp-" + todayKey()) || 1; const ks = Object.keys(L.KINDS); kind = ks[seed % ks.length]; daily = true; }
      else if (pick === "surprise") kind = rnd(Object.keys(L.KINDS));
      btn.disabled = true; btn.querySelector(".lbl").textContent = "Writing today's briefing...";
      let flavor = localFlavor(kind);
      if (!aiOff) { const j = await Promise.race([ai({ mode: "scenario", kind, seed }), new Promise((r) => setTimeout(() => r(null), 5000))]); if (j && j.flavor) flavor = j.flavor; }
      if (!alive()) return;
      st.run = newRun(kind, seed, flavor, "free"); st.run.daily = daily; st.run.reveal = pick !== "surprise" && pick !== "daily"; st.phase = "play"; st.last = null; moved = 0; ev = {};
      loadData(); closeScreen(); setPlaying(false); paintAll(); persist();
      flash(flavor.headline || "Market open. Good luck!", false); SND.play("start");
      setTimeout(() => { if (alive() && st.phase === "play" && run() && !playing && run().i === 26) setPlaying(true); }, 1200);
    }
    function skipTo(phase) { st.phase = phase; }

    // ---------- wiring ----------
    $(".lp-play").onclick = () => { if (!run() || run().done) return; if (st.phase === "menu") return; setPlaying(!playing); };
    $(".lp-stepb").onclick = () => { if (!run() || run().done) return; setPlaying(false); ev.step = true; advance(1); };
    const sp = $(".lp-speeds"); SPEEDS.forEach((s) => { const b = document.createElement("button"); b.type = "button"; b.dataset.sp = s; b.textContent = s + "x"; b.onclick = () => { if (!run()) return; run().speed = s; ev.speed = true; if (playing) setPlaying(true); paintTransport(); tutCheck(); persist(); }; sp.appendChild(b); });
    $$(".lp-inds button").forEach((b) => (b.onclick = () => { const r = run(); if (!r) return; r.ind[b.dataset.i] = !r.ind[b.dataset.i]; ev.ind = true; paintTransport(); draw(); tutCheck(); persist(); }));
    const szBox = $(".lp-sizes");
    SIZES.forEach((s) => { const b = document.createElement("button"); b.type = "button"; b.dataset.s = s; b.textContent = s >= 1000 ? s / 1000 + "K" : s; b.onclick = () => { if (!run()) return; run().size = s; customSz.value = ""; paintAcct(); persist(); }; szBox.appendChild(b); });
    const mx = document.createElement("button"); mx.type = "button"; mx.dataset.s = "max"; mx.textContent = "Max"; mx.onclick = () => { const r = run(); if (!r) return; r.size = Math.max(1, r.acc.cap(price())); customSz.value = ""; paintAcct(); }; szBox.appendChild(mx);
    const customSz = document.createElement("input"); customSz.type = "number"; customSz.min = 1; customSz.placeholder = "Custom"; customSz.setAttribute("aria-label", "Custom size"); customSz.onchange = () => { const v = Math.floor(Number(customSz.value)); if (v >= 1 && run()) { run().size = v; paintAcct(); persist(); } }; szBox.appendChild(customSz);
    $$("[data-t]").forEach((b) => (b.onclick = () => trade(b.dataset.t)));
    $$("[data-q]").forEach((b) => { if (b.closest(".lp-quick")) b.onclick = () => quick(b.dataset.q); });
    $(".lp-o-go").onclick = () => placeOrder($(".lp-o-side").value, $(".lp-o-type").value, $(".lp-o-px").value);
    $(".lp-o-px").addEventListener("keydown", (e) => { if (e.key === "Enter") $(".lp-o-go").click(); });
    $$(".lp-tabs button").forEach((b) => (b.onclick = () => { $$(".lp-tabs button").forEach((x) => x.classList.toggle("on", x === b)); $$(".lp-pane").forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== b.dataset.tab)); if (b.dataset.tab === "stats") paintProfile(); }));
    el.addEventListener("keydown", (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ""))) return;
      const k = e.key.toLowerCase(); if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (k === " ") { e.preventDefault(); $(".lp-play").click(); } else if (k === ".") $(".lp-stepb").click(); else if (k === "b") trade("buy"); else if (k === "s") trade("sell"); else if (k === "f") trade("flat");
    });
    el.addEventListener("pointerdown", () => { if (!el.contains(document.activeElement) || document.activeElement === document.body) el.focus({ preventScroll: true }); });
    $('[data-a="menu"]').onclick = () => { if (!screen.classList.contains("hidden")) return; if (st.phase === "tut") { skipTutorial(); return; } showMenu(); };
    const snd = $('[data-a="snd"]');
    const showSnd = () => { const on = SND.enabled(); snd.innerHTML = icon(on ? "sound" : "mute"); snd.title = on ? "Sound on" : "Sound off"; snd.classList.toggle("off", !on); };
    snd.onclick = () => { SND.setEnabled(!SND.enabled()); showSnd(); SND.play("fill"); }; showSnd();
    const setFs = (on) => { const b = $('[data-a="fs"]'); b.innerHTML = icon(on ? "shrink" : "expand"); b.title = on ? "Exit fullscreen" : "Fullscreen"; setTimeout(draw, 80); };
    el.addEventListener("fullscreenchange", () => { const on = document.fullscreenElement === el; el.classList.toggle("is-fs", on); setFs(on); });
    $('[data-a="fs"]').onclick = () => {
      if (document.fullscreenElement === el) document.exitFullscreen();
      else if (el.requestFullscreen) el.requestFullscreen().catch(() => { el.classList.toggle("is-fs"); setFs(el.classList.contains("is-fs")); });
      else { el.classList.toggle("is-fs"); setFs(el.classList.contains("is-fs")); }
    };
    const wrap = $(".art-wrap");
    $('[data-a="x"]').onclick = (e) => { const open = !wrap.classList.contains("open"); wrap.classList.toggle("open", open); el.classList.toggle("closed", !open); if (!open) setPlaying(false); e.currentTarget.innerHTML = icon(open ? "x" : "chev"); e.currentTarget.title = open ? "Close" : "Open"; setTimeout(draw, 700); };
    window.addEventListener("resize", draw);

    // ---------- first paint (and resuming a saved session) ----------
    st.chat.forEach((c) => addChat(c.f, c.t));
    if (!st.chat.length) addChat("coach", "Hi, I'm your trading coach. Ask me anything: what is a stop-loss? what does VWAP mean? how big should I trade?");
    if (run()) loadData();
    if (st.phase === "tut" && run() && run().mode === "tut" && !run().done) { renderTut(false); }
    else if (st.phase === "tut") st.phase = "menu";
    paintAll();
    if (st.phase === "welcome") showWelcome();
    else if (st.phase === "done" && st.last) { st.phase = "menu"; showDebrief(); }
    else if (st.phase === "menu" || !run()) showMenu();
    else if (st.phase === "play") { /* resume paused */ }
    requestAnimationFrame(draw);
    return el;
  }

  window.NeonLarpGame = { card, defaults };
})();
