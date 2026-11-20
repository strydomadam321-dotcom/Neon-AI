// Chess sounds, made from scratch with the browser's audio engine (no audio files): a wooden "tok" for a move, a heavier clack for a
// capture, a double tap for castling, a sharp ping for check, and short jingles for the start and end of a game.
(function () {
  "use strict";
  const KEY = "neon-chess-sound";
  let ac = null, master = null;
  const noiseBufs = new WeakMap();
  const enabled = () => { try { return localStorage.getItem(KEY) !== "0"; } catch { return true; } };
  const setEnabled = (on) => { try { localStorage.setItem(KEY, on ? "1" : "0"); } catch {} };

  function audio() {
    if (!ac) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ac = new C(); master = ac.createGain(); master.gain.value = 0.8; master.connect(ac.destination);
    }
    if (ac.state === "suspended") ac.resume();
    return ac;
  }
  function noise(c) {
    if (!noiseBufs.has(c)) {
      const b = c.createBuffer(1, Math.floor(c.sampleRate * 0.5), c.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      noiseBufs.set(c, b);
    }
    return noiseBufs.get(c);
  }

  // one piece landing on a wooden board: a low thump that drops in pitch, plus a short filtered tick
  function tok(c, out, t, o) {
    o = o || {};
    const pitch = o.pitch || 1, vol = o.vol || 1, body = (o.body || 210) * pitch, decay = o.decay || 0.075, bright = (o.bright || 1500) * pitch;
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = "sine"; osc.frequency.setValueAtTime(body, t); osc.frequency.exponentialRampToValueAtTime(body * 0.5, t + decay);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.55 * vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g); g.connect(out); osc.start(t); osc.stop(t + decay + 0.02);
    const n = c.createBufferSource(), f = c.createBiquadFilter(), ng = c.createGain();
    n.buffer = noise(c); f.type = "bandpass"; f.frequency.value = bright; f.Q.value = 1.3;
    ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.8 * vol, t + 0.002); ng.gain.exponentialRampToValueAtTime(0.0001, t + (o.tick || 0.032));
    n.connect(f); f.connect(ng); ng.connect(out); n.start(t, Math.random() * 0.3); n.stop(t + 0.06);
  }
  // a soft musical note
  function note(c, out, t, freq, len, vol, type) {
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = type || "sine"; osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(g); g.connect(out); osc.start(t); osc.stop(t + len + 0.02);
  }

  const VOICES = {
    move: (c, o, t) => tok(c, o, t, { pitch: 0.96 + Math.random() * 0.08 }),
    capture: (c, o, t) => { tok(c, o, t, { vol: 1.3, body: 150, bright: 2000, decay: 0.1, tick: 0.045, pitch: 0.97 + Math.random() * 0.06 }); tok(c, o, t + 0.04, { vol: 0.5, body: 320, bright: 2600, decay: 0.05, tick: 0.025 }); },
    castle: (c, o, t) => { tok(c, o, t, { pitch: 1.02 }); tok(c, o, t + 0.13, { pitch: 0.84, vol: 0.9 }); },
    check: (c, o, t) => { tok(c, o, t, { vol: 1.1, bright: 1900 }); note(c, o, t + 0.045, 880, 0.2, 0.2, "triangle"); note(c, o, t + 0.09, 1175, 0.22, 0.16, "triangle"); },
    start: (c, o, t) => { tok(c, o, t, { pitch: 1.15, vol: 0.8 }); tok(c, o, t + 0.1, { pitch: 1.25, vol: 0.8 }); },
    win: (c, o, t) => { [523.25, 659.25, 783.99].forEach((f, i) => note(c, o, t + i * 0.12, f, 0.45, 0.22)); note(c, o, t + 0.36, 1046.5, 0.55, 0.16); },
    lose: (c, o, t) => { [392, 311.13].forEach((f, i) => note(c, o, t + i * 0.18, f, 0.55, 0.22)); },
    draw: (c, o, t) => { [440, 440].forEach((f, i) => note(c, o, t + i * 0.16, f, 0.4, 0.2)); },
    // trading sim (/larp)
    fill: (c, o, t) => { tok(c, o, t, { pitch: 1.5, vol: 0.55, body: 260, bright: 3000, decay: 0.045, tick: 0.02 }); },
    cash: (c, o, t) => { note(c, o, t, 1318.5, 0.16, 0.16, "triangle"); note(c, o, t + 0.07, 1760, 0.3, 0.14, "triangle"); },
    loss: (c, o, t) => { note(c, o, t, 330, 0.22, 0.17, "sawtooth"); note(c, o, t + 0.1, 247, 0.3, 0.15, "sawtooth"); },
    alert: (c, o, t) => { [880, 660, 880].forEach((f, i) => note(c, o, t + i * 0.11, f, 0.16, 0.14, "square")); },
    level: (c, o, t) => { [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => note(c, o, t + i * 0.09, f, 0.4, 0.17)); },
  };

  function play(kind) {
    if (!enabled() || !VOICES[kind]) return;
    const c = audio();
    if (c) VOICES[kind](c, master, c.currentTime + 0.01);
  }
  // for testing: draw a sound into any (offline) audio context
  function render(kind, c, out, t) { VOICES[kind](c, out, t || 0); }

  window.NeonChessSound = { play, enabled, setEnabled, render, kinds: Object.keys(VOICES) };
})();
