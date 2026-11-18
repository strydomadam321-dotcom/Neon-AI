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
  let w = 0, h = 0, dpr = 1, pts = [], raf = 0;
  const mouse = { x: -9999, y: -9999 };
  const COLORS = ["0,229,255", "255,43,214", "139,92,246"];

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = innerWidth; h = innerHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(Math.min(90, (w * h) / 22000));
    pts = Array.from({ length: n }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - .5) * .35, vy: (Math.random() - .5) * .35,
      r: Math.random() * 1.6 + .6, c: COLORS[Math.floor(Math.random() * COLORS.length)], ph: Math.random() * 6.28,
    }));
  }

  function frame(t) {
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
  addEventListener("pointermove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
  addEventListener("pointerleave", () => { mouse.x = mouse.y = -9999; });
  document.addEventListener("visibilitychange", () => {
    cancelAnimationFrame(raf);
    if (!document.hidden) raf = requestAnimationFrame(frame);
  });
  resize();
  raf = requestAnimationFrame(frame);
})();
