// /videos: a library card with a YouTube player. Your place (time, speed, volume, mute) is saved on your account, so closing the tab
// and coming back (in this chat or through a new /videos) resumes where you stopped.
(function () {
  const SPRING = "cubic-bezier(.3, 1.25, .4, 1)";
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hms = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };

  // ----- the YouTube player script, loaded once -----
  let ytReady = null;
  function loadYT() {
    return (ytReady = ytReady || new Promise((res, rej) => {
      if (window.YT && window.YT.Player) return res();
      const prev = window.onYouTubeIframeAPIReady; window.onYouTubeIframeAPIReady = () => { if (prev) prev(); res(); };
      const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api";
      s.onerror = () => { ytReady = null; rej(new Error("Couldn't load the video player. Check your connection.")); }; document.head.appendChild(s);
    }));
  }

  // ----- the library and your saved places (loaded once per page; every save also updates this copy at once) -----
  let lib = null, libP = null, apiFn = null;
  async function library(api, fresh) {
    apiFn = api;
    if (lib && !fresh) return lib;
    libP = libP || api("/api/videos").then((d) => { lib = d.videos; return lib; }).finally(() => { libP = null; });
    return libP;
  }
  const find = (id) => (lib || []).find((v) => v.id === id);
  const active = new Set();                                     // players that are on screen right now
  function save(p, beacon) {
    const v = find(p.id); if (!v) return;
    Object.assign(v, { pos: p.done ? 0 : p.pos, dur: p.dur || v.dur, rate: p.rate, vol: p.vol, muted: p.muted, done: !!p.done, at: Date.now() });
    const body = JSON.stringify({ id: p.id, pos: p.done ? 0 : p.pos, dur: p.dur || v.dur, rate: p.rate, vol: p.vol, muted: p.muted, done: !!p.done });
    try { fetch("/api/videos/progress", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body, keepalive: !!beacon }).catch(() => {}); } catch {}
  }
  const flushAll = () => active.forEach((p) => { p.read(); if (p.played || p.done) save(p.state, true); });
  addEventListener("pagehide", flushAll);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushAll(); });

  function defaults() { return { view: "list", id: "" }; }

  // ----- the card -----
  function card(m, ctx) {
    const st = m.video || (m.video = defaults());
    const el = document.createElement("div"); el.className = "vd-card";
    const body = document.createElement("div"); body.className = "vd-body"; el.appendChild(body);
    let player = null, timer = 0, ps = null, seen = false;

    function stopPlayer() {
      if (ps) { ps.read(); if (ps.played || ps.done) save(ps.state, false); active.delete(ps); ps = null; }
      clearInterval(timer); timer = 0;
      if (player) { try { player.destroy(); } catch {} player = null; }
    }
    // swap the content with the springy size morph and a blur fade
    function morph(build) {
      const h0 = body.getBoundingClientRect().height;
      if (!el.isConnected || !h0) { build(); return; }
      body.style.height = h0 + "px"; body.style.overflow = "hidden";
      body.animate([{ opacity: 1, filter: "blur(0)" }, { opacity: 0, filter: "blur(5px)" }], { duration: 160, fill: "forwards" }).finished.then(() => {
        build(); body.getAnimations().forEach((a) => a.cancel());
        body.style.height = "auto"; const h1 = body.getBoundingClientRect().height; body.style.height = h0 + "px";
        body.animate([{ height: h0 + "px" }, { height: h1 + "px" }], { duration: 650, easing: SPRING }).finished.catch(() => {}).then(() => { body.style.height = ""; body.style.overflow = ""; });
      });
    }

    function listView() {
      stopPlayer();
      body.innerHTML = `<div class="vd-head"><b>Videos</b><span>Your place is saved in every video, so you can stop and carry on any time.</span></div><div class="vd-list" id="vdList"><p class="vd-note">Loading...</p></div>`;
      library(ctx.api).then(() => paintList()).catch((e) => { const l = body.querySelector("#vdList"); if (l) l.innerHTML = `<p class="vd-note">${esc(e.message || "Couldn't load the videos.")}</p>`; });
    }
    function paintList() {
      const l = body.querySelector("#vdList"); if (!l) return;
      l.innerHTML = (lib || []).map((v, i) => {
        const pct = v.dur ? Math.min(100, (v.pos / v.dur) * 100) : 0, label = v.done ? "Watched" : v.pos > 5 ? `Resume at ${hms(v.pos)}${v.dur ? " of " + hms(v.dur) : ""}` : "Not started";
        return `<button type="button" class="vd-item" data-id="${esc(v.id)}" style="--i:${i}"><span class="vd-thumb"><img alt="" loading="lazy" src="https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg"><span class="vd-play">${ctx.icon("play")}</span><span class="vd-prog"><i style="width:${pct}%"></i></span></span><span class="vd-info"><b>${esc(v.title)}</b><small>${esc(v.by || "")}</small><em class="${v.done ? "done" : v.pos > 5 ? "resume" : ""}">${esc(label)}</em></span></button>`;
      }).join("") || `<p class="vd-note">No videos yet.</p>`;
      l.querySelectorAll(".vd-item").forEach((b) => (b.onclick = () => open(b.dataset.id, true)));
    }

    function open(id, fromClick) {
      st.view = "play"; st.id = id; ctx.save && ctx.save();
      morph(() => playView(id, fromClick));
    }
    function back() { st.view = "list"; st.id = ""; ctx.save && ctx.save(); stopPlayer(); morph(listView); }

    async function playView(id, fromClick) {
      stopPlayer();
      body.innerHTML = `<div class="vd-top"><button type="button" class="btn small" id="vdBack">${ctx.icon("back")}<span class="lbl">All videos</span></button><span class="vd-saved" id="vdSaved"></span></div>
        <div class="vd-frame"><div id="vdYT"></div><p class="vd-fail" id="vdFail" hidden></p></div>
        <div class="vd-meta"><b id="vdTitle"></b><small id="vdBy"></small></div>
        <div class="vd-bar"><i id="vdBarFill"></i></div>
        <div class="vd-foot"><span id="vdTime"></span><span class="vd-acts"><button type="button" class="vd-link" id="vdRestart">Start from the beginning</button><a class="vd-link" id="vdYTlink" target="_blank" rel="noopener noreferrer">Open on YouTube</a></span></div>`;
      body.querySelector("#vdBack").onclick = back;
      const say = (t) => { const s = body.querySelector("#vdSaved"); if (s) s.textContent = t; };
      try { await library(ctx.api); } catch (e) { body.querySelector("#vdFail").hidden = false; body.querySelector("#vdFail").textContent = e.message || "Couldn't load your saved place."; return; }
      const v = find(id); if (!v) { back(); return; }
      body.querySelector("#vdTitle").textContent = v.title; body.querySelector("#vdBy").textContent = v.by || "";
      body.querySelector("#vdYTlink").href = "https://www.youtube.com/watch?v=" + encodeURIComponent(v.id);
      let startAt = v.done ? 0 : Math.max(0, v.pos - 2);              // pick up two seconds early, so you don't miss the line you stopped on
      const state = { id: v.id, pos: v.done ? 0 : v.pos, dur: v.dur, rate: v.rate || 1, vol: v.vol == null ? 100 : v.vol, muted: !!v.muted, done: false };
      say(state.pos > 5 ? `Resuming at ${hms(startAt)}` : "Starting from the beginning");
      const paint = () => {
        const dur = state.dur || v.dur, pct = dur ? Math.min(100, (state.pos / dur) * 100) : 0;
        const f = body.querySelector("#vdBarFill"); if (f) f.style.width = pct + "%";
        const t = body.querySelector("#vdTime"); if (t) t.textContent = `${hms(state.pos)}${dur ? " / " + hms(dur) : ""}`;
      };
      paint();
      try { await loadYT(); } catch (e) { const f = body.querySelector("#vdFail"); f.hidden = false; f.textContent = e.message; return; }
      if (!body.querySelector("#vdYT")) return;                       // they went back while the player script loaded
      const me = { state, pos: state.pos, done: false, played: false, read() { readNow(); } };
      ps = me; active.add(me);
      let last5 = 0;
      function readNow() {
        const p = player; if (!p || typeof p.getCurrentTime !== "function") return;
        try {
          const t = p.getCurrentTime() || 0, d = p.getDuration() || state.dur, ps2 = p.getPlayerState();
          if (ps2 === 0 || ps2 === 1 || ps2 === 2 || ps2 === 3) { state.pos = t; me.played = true; }       // only once it has really played: a cued video reports its 2-second-early start, which must not move your saved place back
          if (d) state.dur = d; state.rate = p.getPlaybackRate() || 1; state.vol = p.getVolume(); state.muted = p.isMuted();
          me.pos = state.pos;
        } catch {}
      }
      player = new YT.Player("vdYT", {
        host: "https://www.youtube-nocookie.com", videoId: v.id, width: "100%", height: "100%",
        playerVars: { autoplay: fromClick ? 1 : 0, controls: 1, rel: 0, modestbranding: 1, playsinline: 1, start: Math.floor(startAt), origin: location.origin },
        events: {
          onReady: (e) => {
            try { const r = e.target.getAvailablePlaybackRates ? e.target.getAvailablePlaybackRates() : []; if (state.rate !== 1 && (!r.length || r.includes(state.rate))) e.target.setPlaybackRate(state.rate); e.target.setVolume(state.vol); if (state.muted) e.target.mute(); else e.target.unMute(); } catch {}
            readNow(); paint();
          },
          onStateChange: (e) => {
            readNow(); paint();
            if (e.data === 0) { state.done = true; me.done = true; say("Finished. It will start from the beginning next time."); save(state); }
            else if (e.data === 1) { if (me.done) { me.done = false; state.done = false; } say("Playing. Your place saves as you watch."); }
            else if (e.data === 2) { say(`Saved at ${hms(state.pos)}`); save(state); }
          },
          onError: () => { const f = body.querySelector("#vdFail"); if (f) { f.hidden = false; f.innerHTML = "This video can't be played inside NEON AI. Use <b>Open on YouTube</b> below."; } },
        },
      });
      body.querySelector("#vdRestart").onclick = () => { try { player.seekTo(0, true); } catch {} state.pos = 0; me.pos = 0; me.done = false; state.done = false; paint(); save(state); say("Back at the start"); };
      timer = setInterval(() => {
        if (el.isConnected) seen = true;
        if (seen && !el.isConnected) { stopPlayer(); return; }       // the chat was re-drawn or closed: save the place and let go
        if (!seen) return;
        readNow(); paint();
        let playing = false; try { playing = player.getPlayerState() === 1; } catch {}
        if (playing && Date.now() - last5 > 5000) { last5 = Date.now(); save(state); }
      }, 1000);
    }

    if (st.view === "play" && st.id) playView(st.id, false); else listView();
    return el;
  }

  window.NeonVideos = { card, defaults };
})();
