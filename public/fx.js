"use strict";
// Visual effects: flickering neon letters, particle network background, cursor spotlight.
(function () {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ----- flickering neon lettering: every letter gets its own random flicker rhythm -----
  window.neonSplit = function neonSplit(root = document) {
    root.querySelectorAll(".flick").forEach((el) => {
      if (el.dataset.split) return;
      el.dataset.split = "1";
      const text = el.dataset.text || el.textContent;
      el.textContent = "";
      el.setAttribute("aria-label", text);
      const letters = [...text];
      // one or two letters behave like a failing tube
      const dying = new Set([1 + Math.floor(Math.random() * 3)]);
      letters.forEach((ch, i) => {
        const s = document.createElement("span");
        s.setAttribute("aria-hidden", "true");
        if (ch === " ") { s.className = "sp"; el.appendChild(s); return; }
        s.className = "l" + (dying.has(i) ? " dying" : "");
        s.textContent = ch;
        s.style.setProperty("--d", (4 + Math.random() * 7).toFixed(2) + "s");
        s.style.setProperty("--delay", (-Math.random() * 8).toFixed(2) + "s");
        el.appendChild(s);
      });
    });
  };
  neonSplit();

  // ----- spotlight that follows the cursor on glass panels -----
  document.addEventListener("pointermove", (e) => {
    const t = e.target.closest && e.target.closest(".spot");
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.style.setProperty("--sx", e.clientX - r.left + "px");
    t.style.setProperty("--sy", e.clientY - r.top + "px");
  }, { passive: true });

  // ----- particle network -----
  const cv = document.getElementById("fx");
  if (!cv || reduced) return;
  const ctx = cv.getContext("2d");
  const cv2 = document.getElementById("fx2"), c2 = cv2 && cv2.getContext("2d");
  let w = 0, h = 0, dpr = 1, pts = [], stars = [], raf = 0;
  let meteors = [], queue = [], nextMeteor = 0, embers = [], sparks = [], lastT = 0, wasRetro = false;
  const mouse = { x: -9999, y: -9999 };
  const COLORS = ["0,229,255", "255,43,214", "139,92,246"];

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = innerWidth; h = innerHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (cv2) { cv2.width = w * dpr; cv2.height = h * dpr; c2.setTransform(dpr, 0, 0, dpr, 0, 0); }
    const n = Math.round(Math.min(90, (w * h) / 22000));
    const ns = Math.round(Math.min(220, (w * h) / 7000));
    stars = Array.from({ length: ns }, () => ({
      x: Math.random() * w, y: Math.random() * h * 0.62, r: Math.random() * 1.3 + 0.3,
      ph: Math.random() * 6.28, sp: 0.6 + Math.random() * 1.6, c: Math.random() < 0.18 ? "255,150,230" : Math.random() < 0.12 ? "140,240,255" : "255,255,255",
    }));
    pts = Array.from({ length: n }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - .5) * .35, vy: (Math.random() - .5) * .35,
      r: Math.random() * 1.6 + .6, c: COLORS[Math.floor(Math.random() * COLORS.length)], ph: Math.random() * 6.28,
    }));
  }

  const rnd = (a, b) => a + Math.random() * (b - a);
  const hzY = () => h * (w <= 820 ? 0.66 : 0.70);

  function spawnMeteor(delay = 0) {
    const ltr = Math.random() < 0.72, ang = rnd(0.28, 0.62), sp = rnd(520, 1050);
    queue.push({ at: lastT + delay, m: {
      x: ltr ? rnd(-60, w * 0.75) : rnd(w * 0.25, w + 60), y: rnd(-30, h * 0.34),
      vx: (ltr ? 1 : -1) * Math.cos(ang) * sp, vy: Math.sin(ang) * sp, len: rnd(110, 280), wd: rnd(1.3, 2.6),
      c: Math.random() < 0.6 ? "255,140,225" : "120,240,255", life: 1,
    } });
  }

  function retroFrame(t) {
    ctx.clearRect(0, 0, w, h);
    for (const st of stars) {
      const a = 0.3 + 0.7 * Math.abs(Math.sin(t / 1000 * st.sp + st.ph));
      ctx.fillStyle = `rgba(${st.c},${a})`;
      ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, 6.283); ctx.fill();
      if (st.r > 1.05) {                       // little cross-shaped glints on the bigger stars
        const L = st.r * 6 * a;
        ctx.strokeStyle = `rgba(${st.c},${a * 0.6})`; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(st.x - L, st.y); ctx.lineTo(st.x + L, st.y); ctx.moveTo(st.x, st.y - L); ctx.lineTo(st.x, st.y + L); ctx.stroke();
      }
    }
  }

  // bright layer on top of the scene: shooting stars, showers, rising sparkles, cursor sparkle trail
  function retroTop(t, dt) {
    if (!c2) return;
    c2.clearRect(0, 0, w, h);
    c2.globalCompositeOperation = "lighter";
    const hz = hzY();

    // shooting stars: about one every 1-2.5 s, with the occasional shower of several in a row
    if (t > nextMeteor) {
      if (Math.random() < 0.16) { const n = 3 + Math.floor(Math.random() * 4); for (let i = 0; i < n; i++) spawnMeteor(i * rnd(120, 340)); nextMeteor = t + rnd(3500, 6000); }
      else { spawnMeteor(0); nextMeteor = t + rnd(900, 2400); }
    }
    for (let i = queue.length - 1; i >= 0; i--) if (t >= queue[i].at) { meteors.push(queue[i].m); queue.splice(i, 1); }
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i], sp = Math.hypot(m.vx, m.vy), ux = m.vx / sp, uy = m.vy / sp;
      const tx = m.x - ux * m.len, ty = m.y - uy * m.len;
      const g = c2.createLinearGradient(m.x, m.y, tx, ty);
      g.addColorStop(0, `rgba(255,255,255,${m.life})`); g.addColorStop(0.25, `rgba(${m.c},${m.life * 0.7})`); g.addColorStop(1, `rgba(${m.c},0)`);
      c2.strokeStyle = g; c2.lineWidth = m.wd; c2.lineCap = "round";
      c2.beginPath(); c2.moveTo(m.x, m.y); c2.lineTo(tx, ty); c2.stroke();
      c2.fillStyle = `rgba(255,255,255,${m.life})`; c2.shadowColor = `rgba(${m.c},1)`; c2.shadowBlur = 14;
      c2.beginPath(); c2.arc(m.x, m.y, m.wd * 0.9, 0, 6.283); c2.fill(); c2.shadowBlur = 0;
      m.x += m.vx * dt; m.y += m.vy * dt; m.life -= dt * 0.28;
      if (m.life <= 0 || m.x < -300 || m.x > w + 300 || m.y > hz * 0.92) meteors.splice(i, 1);
    }

    // sparkles rising from the neon grid
    if (embers.length < 70 && Math.random() < dt * 22) embers.push({ x: rnd(0, w), y: rnd(hz, h), vy: -rnd(18, 55), ph: rnd(0, 6.28), r: rnd(0.8, 2.1), life: 0, max: rnd(3.2, 6.5), c: ["255,120,225", "90,235,255", "255,190,140"][Math.floor(Math.random() * 3)] });
    for (let i = embers.length - 1; i >= 0; i--) {
      const e = embers[i]; e.life += dt; e.y += e.vy * dt; e.x += Math.sin(e.life * 1.6 + e.ph) * 14 * dt;
      const k = e.life / e.max, a = Math.sin(Math.min(1, k) * Math.PI) * 0.85;
      c2.fillStyle = `rgba(${e.c},${a})`; c2.shadowColor = `rgba(${e.c},1)`; c2.shadowBlur = 10;
      c2.beginPath(); c2.arc(e.x, e.y, e.r, 0, 6.283); c2.fill();
      if (k >= 1 || e.y < hz * 0.5) embers.splice(i, 1);
    }
    c2.shadowBlur = 0;

    // cursor sparkle trail
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i]; p.life -= dt * 1.5; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt;
      if (p.life <= 0) { sparks.splice(i, 1); continue; }
      const L = p.r * 3.2 * p.life;
      c2.strokeStyle = `rgba(${p.c},${p.life})`; c2.lineWidth = 1.1;
      c2.beginPath(); c2.moveTo(p.x - L, p.y); c2.lineTo(p.x + L, p.y); c2.moveTo(p.x, p.y - L); c2.lineTo(p.x, p.y + L); c2.stroke();
      c2.fillStyle = `rgba(255,255,255,${p.life})`; c2.beginPath(); c2.arc(p.x, p.y, p.r * 0.45, 0, 6.283); c2.fill();
    }
    c2.globalCompositeOperation = "source-over";
  }

  function frame(t) {
    const root = document.documentElement;
    if (root.classList.contains("no-bg-anim")) { raf = requestAnimationFrame(frame); return; }
    const dt = Math.min(0.05, (t - (lastT || t)) / 1000); lastT = t;
    if (root.dataset.theme === "retro") { wasRetro = true; retroFrame(t); retroTop(t, dt); raf = requestAnimationFrame(frame); return; }
    if (wasRetro) { wasRetro = false; if (c2) c2.clearRect(0, 0, w, h); }
    ctx.clearRect(0, 0, w, h);
    const LINK = 130;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      p.x += p.vx; p.y += p.vy;
      if (p.x < -10) p.x = w + 10; else if (p.x > w + 10) p.x = -10;
      if (p.y < -10) p.y = h + 10; else if (p.y > h + 10) p.y = -10;
      // gentle push away from the cursor
      const dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy;
      if (d2 < 14000) { const f = (1 - d2 / 14000) * .6; p.x += dx * f * .05; p.y += dy * f * .05; }
      const tw = .55 + .45 * Math.sin(t / 700 + p.ph);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 6.283);
      ctx.fillStyle = `rgba(${p.c},${.35 + tw * .55})`;
      ctx.shadowColor = `rgba(${p.c},1)`; ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;
      for (let j = i + 1; j < pts.length; j++) {
        const q = pts[j], ax = p.x - q.x, ay = p.y - q.y, dd = ax * ax + ay * ay;
        if (dd < LINK * LINK) {
          const a = (1 - Math.sqrt(dd) / LINK) * .22;
          ctx.strokeStyle = `rgba(${p.c},${a})`; ctx.lineWidth = .7;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        }
      }
    }
    // cursor halo
    if (mouse.x > 0) {
      const g = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 160);
      g.addColorStop(0, "rgba(0,229,255,.10)"); g.addColorStop(1, "rgba(0,229,255,0)");
      ctx.fillStyle = g; ctx.fillRect(mouse.x - 160, mouse.y - 160, 320, 320);
    }
    raf = requestAnimationFrame(frame);
  }

  addEventListener("resize", resize);
  addEventListener("pointermove", (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (document.documentElement.dataset.theme === "retro" && !document.documentElement.classList.contains("no-bg-anim") && sparks.length < 90) {
      for (let i = 0; i < 2; i++) sparks.push({ x: e.clientX, y: e.clientY, vx: rnd(-50, 50), vy: rnd(-70, 10), r: rnd(1.2, 2.6), life: 1, c: ["255,120,225", "90,235,255", "255,255,255"][Math.floor(Math.random() * 3)] });
    }
  }, { passive: true });
  addEventListener("pointerleave", () => { mouse.x = mouse.y = -9999; });
  document.addEventListener("visibilitychange", () => {
    cancelAnimationFrame(raf);
    if (!document.hidden) raf = requestAnimationFrame(frame);
  });
  resize();
  raf = requestAnimationFrame(frame);
})();
