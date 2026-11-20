// Real downloadable files made in your browser: PDF, Word (.docx), PowerPoint (.pptx), Excel / Google Sheets (.xlsx, .ods, .csv).
// The AI writes plain text in a fenced block (neon-pdf, neon-docx, neon-pptx, neon-xlsx); this file turns that text into the preview and the file.
(function () {
  "use strict";

  const KINDS = {
    pdf: { ext: "pdf", label: "PDF", name: "Document", mime: "application/pdf", color: "#ff5c7a" },
    docx: { ext: "docx", label: "Word", name: "Document", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", color: "#5b8cff" },
    pptx: { ext: "pptx", label: "PowerPoint", name: "Presentation", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", color: "#ffb347" },
    xlsx: { ext: "xlsx", label: "Excel", name: "Spreadsheet", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", color: "#3dffa8" },
  };
  const ALIAS = { pdf: "pdf", "neon-pdf": "pdf", docx: "docx", "neon-docx": "docx", word: "docx", pptx: "pptx", "neon-pptx": "pptx", powerpoint: "pptx", xlsx: "xlsx", "neon-xlsx": "xlsx", excel: "xlsx", "neon-sheet": "xlsx" };
  const langToKind = (lang) => ALIAS[String(lang || "").toLowerCase()] || null;

  // ---------- small helpers ----------
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const dec = (x) => String(x).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const slug = (t) => (String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)) || "neon-ai";

  // optional header lines at the top: "title: ...", "theme: dark"
  function parseMeta(src, kind) {
    const lines = String(src).replace(/\r/g, "").split("\n"), meta = {};
    let i = 0;
    while (i < lines.length) {
      const m = lines[i].match(/^(title|theme|author)\s*:\s*(.*)$/i);
      if (!m) break;
      meta[m[1].toLowerCase()] = m[2].trim(); i++;
    }
    if (i < lines.length && !lines[i].trim() && i > 0) i++;
    const body = lines.slice(i).join("\n");
    if (!meta.title) {
      const h = body.match(/^\s{0,3}#{1,2}\s+(.{1,80})$/m);
      meta.title = h ? h[1].replace(/[*_`]/g, "").trim() : (KINDS[kind] || {}).name || "File";
    }
    return { title: meta.title, theme: /dark/i.test(meta.theme || "") ? "dark" : "light", author: meta.author || "NEON AI", body };
  }

  // ---------- loading the libraries only when they're needed ----------
  const LIBS = {
    pdf: [["https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/pdfmake.min.js", () => window.pdfMake], ["https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/vfs_fonts.js", () => window.pdfMake && window.pdfMake.vfs]],
    docx: [["https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js", () => window.docx]],
    pptx: [["https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js", () => window.PptxGenJS]],
    xlsx: [["https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js", () => window.XLSX]],
  };
  const loading = {};
  function loadScript(url, ready) {
    if (ready()) return Promise.resolve();
    if (loading[url]) return loading[url];
    loading[url] = new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = url; s.onload = () => res();
      s.onerror = () => { delete loading[url]; rej(new Error("Couldn't load the file maker. Check your connection and try again.")); };
      document.head.appendChild(s);
    });
    return loading[url];
  }
  async function need(kind) { for (const [u, r] of LIBS[kind]) await loadScript(u, r); }

  // ---------- Markdown tokens, flattened to styled text pieces (shared by PDF, Word and PowerPoint) ----------
  function flat(tokens, st) {
    st = st || {};
    const out = [];
    for (const t of tokens || []) {
      if (t.type === "text" || t.type === "escape") { if (t.tokens && t.tokens.length) out.push(...flat(t.tokens, st)); else out.push({ text: dec(t.text), st }); }
      else if (t.type === "strong") out.push(...flat(t.tokens, { ...st, bold: true }));
      else if (t.type === "em") out.push(...flat(t.tokens, { ...st, italic: true }));
      else if (t.type === "del") out.push(...flat(t.tokens, { ...st, strike: true }));
      else if (t.type === "codespan") out.push({ text: dec(t.text), st: { ...st, code: true } });
      else if (t.type === "link") out.push(...flat(t.tokens, { ...st, link: t.href }));
      else if (t.type === "br") out.push({ text: "\n", st });
      else if (t.type === "image") out.push({ text: "[image" + (t.text ? ": " + dec(t.text) : "") + "]", st: { ...st, italic: true } });
      else if (t.type === "html") { /* raw HTML is ignored */ }
      else if (t.text) out.push({ text: dec(t.text), st });
    }
    return out;
  }
  const plain = (tokens) => flat(tokens).map((p) => p.text).join("");

  // ---------- PDF (pdfmake: real text, selectable and searchable) ----------
  function pdfInline(tokens) {
    const parts = flat(tokens).map((p) => {
      const o = { text: p.text };
      if (p.st.bold) o.bold = true;
      if (p.st.italic) o.italics = true;
      if (p.st.strike) o.decoration = "lineThrough";
      if (p.st.code) { o.background = "#f0ecff"; o.color = "#5b21b6"; }
      if (p.st.link) { o.link = p.st.link; o.color = "#1a56db"; o.decoration = "underline"; }
      return o;
    });
    return parts.length ? parts : "";
  }
  function pdfBlocks(tokens) {
    const out = [];
    for (const t of tokens) {
      if (t.type === "heading") out.push({ text: pdfInline(t.tokens), style: "h" + Math.min(t.depth, 4), margin: [0, t.depth <= 2 ? 14 : 10, 0, 6] });
      else if (t.type === "paragraph") out.push({ text: pdfInline(t.tokens), margin: [0, 0, 0, 8] });
      else if (t.type === "text") out.push({ text: t.tokens ? pdfInline(t.tokens) : dec(t.text), margin: [0, 0, 0, 4] });
      else if (t.type === "list") {
        const items = t.items.map((it) => {
          const inner = pdfBlocks(it.tokens);
          return inner.length === 1 && inner[0].text !== undefined && !inner[0].style ? { text: inner[0].text } : { stack: inner };
        });
        out.push(t.ordered ? { ol: items, start: Number(t.start) || 1, margin: [0, 0, 0, 8] } : { ul: items, margin: [0, 0, 0, 8] });
      }
      else if (t.type === "code") out.push({ table: { widths: ["*"], body: [[{ text: dec(t.text), fontSize: 9, fillColor: "#f3f1ff", margin: [8, 7, 8, 7] }]] }, layout: "noBorders", margin: [0, 0, 0, 10] });
      else if (t.type === "blockquote") out.push({ stack: pdfBlocks(t.tokens), margin: [16, 0, 0, 8], italics: true, color: "#555555" });
      else if (t.type === "table") {
        const head = t.header.map((c) => ({ text: pdfInline(c.tokens), bold: true, fillColor: "#f3f1ff" }));
        const rows = t.rows.map((r) => r.map((c) => ({ text: pdfInline(c.tokens) })));
        out.push({ table: { headerRows: 1, widths: t.header.map(() => "*"), body: [head, ...rows] }, layout: "lightHorizontalLines", margin: [0, 0, 0, 10] });
      }
      else if (t.type === "hr") out.push({ canvas: [{ type: "line", x1: 0, y1: 0, x2: 495, y2: 0, lineWidth: 1, lineColor: "#cccccc" }], margin: [0, 6, 0, 10] });
    }
    return out;
  }
  async function buildPdf(src) {
    await need("pdf");
    const m = parseMeta(src, "pdf");
    const content = pdfBlocks(marked.lexer(m.body));
    if (!content.length) content.push({ text: " " });
    const def = {
      info: { title: m.title, author: m.author, creator: "NEON AI" },
      pageSize: "A4", pageMargins: [50, 56, 50, 60], content,
      defaultStyle: { fontSize: 11, lineHeight: 1.2, color: "#1b1b2f" },
      styles: { h1: { fontSize: 22, bold: true }, h2: { fontSize: 17, bold: true }, h3: { fontSize: 14, bold: true }, h4: { fontSize: 12, bold: true } },
      footer: (cur, total) => ({ text: cur + " / " + total, alignment: "center", fontSize: 9, color: "#888888", margin: [0, 18, 0, 0] }),
    };
    const blob = await new Promise((res, rej) => { try { pdfMake.createPdf(def).getBlob(res); } catch (e) { rej(e); } });
    return { blob, filename: slug(m.title) + ".pdf" };
  }

  // ---------- Word (.docx) ----------
  async function buildDocx(src) {
    await need("docx");
    const D = window.docx, m = parseMeta(src, "docx");
    const numbering = [];
    const levelsCfg = () => [0, 1, 2, 3].map((l) => ({ level: l, format: D.LevelFormat.DECIMAL, text: "%" + (l + 1) + ".", alignment: D.AlignmentType.START, style: { paragraph: { indent: { left: 720 + l * 360, hanging: 300 } } } }));
    const runs = (tokens, extra) => flat(tokens).map((p) => {
      const base = { text: p.text, bold: p.st.bold, italics: p.st.italic, strike: p.st.strike, ...extra };
      if (p.st.code) { base.font = "Consolas"; base.shading = { type: D.ShadingType.CLEAR, fill: "F0ECFF", color: "auto" }; }
      if (p.text === "\n") return new D.TextRun({ break: 1 });
      if (p.st.link) return new D.ExternalHyperlink({ link: p.st.link, children: [new D.TextRun({ ...base, color: "1A56DB", underline: {} })] });
      return new D.TextRun(base);
    });
    const HEAD = [D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3, D.HeadingLevel.HEADING_4];
    function blocks(tokens, level, ref) {
      const out = [];
      for (const t of tokens) {
        if (t.type === "heading") out.push(new D.Paragraph({ heading: HEAD[Math.min(t.depth, 4) - 1], children: runs(t.tokens), spacing: { before: 240, after: 100 } }));
        else if (t.type === "paragraph") out.push(new D.Paragraph({ children: runs(t.tokens), spacing: { after: 140 } }));
        else if (t.type === "text") out.push(new D.Paragraph({ children: t.tokens ? runs(t.tokens) : [new D.TextRun(dec(t.text))], ...(ref ? { numbering: { reference: ref, level } } : { bullet: { level } }), spacing: { after: 60 } }));
        else if (t.type === "list") {
          const r = t.ordered ? "num-" + numbering.length : null;
          if (r) numbering.push({ reference: r, levels: levelsCfg() });
          for (const it of t.items) {
            const lead = it.tokens.find((x) => x.type === "text" || x.type === "paragraph");
            out.push(new D.Paragraph({ children: lead ? runs(lead.tokens || [{ type: "text", text: lead.text }]) : [new D.TextRun("")], ...(r ? { numbering: { reference: r, level: Math.min(level, 3) } } : { bullet: { level: Math.min(level, 3) } }), spacing: { after: 60 } }));
            const rest = it.tokens.filter((x) => x !== lead);
            if (rest.length) out.push(...blocks(rest, level + 1, null));
          }
        }
        else if (t.type === "code") out.push(new D.Paragraph({ children: dec(t.text).split("\n").flatMap((ln, i) => [new D.TextRun({ text: ln, font: "Consolas", size: 19, break: i ? 1 : 0 })]), shading: { type: D.ShadingType.CLEAR, fill: "F3F1FF", color: "auto" }, spacing: { before: 80, after: 160 } }));
        else if (t.type === "blockquote") for (const p of blocks(t.tokens, level, ref)) out.push(p);
        else if (t.type === "table") {
          const cell = (c, head) => new D.TableCell({ children: [new D.Paragraph({ children: runs(c.tokens, head ? { bold: true } : {}) })], shading: head ? { type: D.ShadingType.CLEAR, fill: "F3F1FF", color: "auto" } : undefined, margins: { top: 60, bottom: 60, left: 100, right: 100 } });
          out.push(new D.Table({ width: { size: 100, type: D.WidthType.PERCENTAGE }, rows: [new D.TableRow({ tableHeader: true, children: t.header.map((c) => cell(c, true)) }), ...t.rows.map((r) => new D.TableRow({ children: r.map((c) => cell(c, false)) }))] }));
          out.push(new D.Paragraph({ children: [] }));
        }
        else if (t.type === "hr") out.push(new D.Paragraph({ border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: "CCCCCC", space: 1 } }, spacing: { after: 160 } }));
      }
      return out;
    }
    const children = blocks(marked.lexer(m.body), 0, null);
    if (!children.length) children.push(new D.Paragraph({ children: [new D.TextRun(" ")] }));
    const doc = new D.Document({
      creator: m.author, title: m.title,
      numbering: { config: numbering },
      styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
      sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1247, right: 1247 } } }, children }],
    });
    return { blob: await D.Packer.toBlob(doc), filename: slug(m.title) + ".docx" };
  }

  // ---------- PowerPoint (.pptx) ----------
  const THEMES = { light: { bg: "FFFFFF", title: "2A1457", text: "2B2B3F", accent: "A66BFF", muted: "7A7A92", line: "D9D4F0", head: "F3F1FF" }, dark: { bg: "12062B", title: "FF8AE2", text: "F6E9FF", accent: "3DF0FF", muted: "B9A5DA", line: "5A3A99", head: "2A1457" } };
  function parseSlides(body) {
    return body.replace(/\r/g, "").split(/\n\s*---+\s*\n/).map((blk) => blk.trim()).filter(Boolean).map((blk, idx) => {
      const lines = blk.split("\n"), s = { title: "", depth: 2, items: [], notes: [], idx };
      let i = 0;
      for (; i < lines.length; i++) { const h = lines[i].match(/^\s{0,3}(#{1,3})\s+(.*)$/); if (h) { s.title = h[2].replace(/[*_`]/g, "").trim(); s.depth = h[1].length; i++; break; } if (lines[i].trim()) break; }
      for (; i < lines.length; i++) {
        const ln = lines[i];
        if (!ln.trim()) continue;
        const note = ln.match(/^\s*notes?\s*:\s*(.*)$/i);
        if (note) { s.notes.push(note[1]); continue; }
        if (/^\s*\|/.test(ln)) {                       // a Markdown table
          const rows = []; while (i < lines.length && /^\s*\|/.test(lines[i])) { if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i]) || !/-/.test(lines[i])) rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim())); i++; }
          i--; s.items.push({ type: "table", rows }); continue;
        }
        const b = ln.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (b) s.items.push({ type: "bullet", level: Math.min(3, Math.floor(b[1].replace(/\t/g, "  ").length / 2)), ordered: /\d/.test(b[2]), text: b[3] });
        else s.items.push({ type: "text", text: ln.trim() });
      }
      return s;
    });
  }
  const inlineRuns = (text, base) => flat(marked.Lexer.lexInline(text) || []).map((p) => ({ text: p.text, options: { ...base, bold: p.st.bold || base.bold, italic: p.st.italic, strike: p.st.strike ? "sngStrike" : undefined, fontFace: p.st.code ? "Consolas" : base.fontFace, hyperlink: p.st.link ? { url: p.st.link } : undefined } }));
  async function buildPptx(src) {
    await need("pptx");
    const m = parseMeta(src, "pptx"), T = THEMES[m.theme], slides = parseSlides(m.body);
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE"; pptx.title = m.title; pptx.author = m.author; pptx.company = "NEON AI";
    const font = "Calibri";
    slides.forEach((sd, n) => {
      const s = pptx.addSlide();
      s.background = { color: T.bg };
      const cover = n === 0 && sd.depth === 1;
      if (cover) {
        s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.35, h: 7.5, fill: { color: T.accent } });
        s.addText(sd.title || m.title, { x: 0.9, y: 2.2, w: 11.5, h: 1.6, fontSize: 44, bold: true, color: T.title, fontFace: font, valign: "bottom", fit: "shrink" });
        const sub = sd.items.filter((x) => x.type !== "table").map((x) => x.text).join("  ·  ");
        if (sub) s.addText(inlineRuns(sub, { color: T.muted, fontSize: 20, fontFace: font }), { x: 0.9, y: 3.95, w: 11.5, h: 1, valign: "top", fit: "shrink" });
      } else {
        s.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.32, w: 1.2, h: 0.07, fill: { color: T.accent } });
        s.addText(sd.title || " ", { x: 0.6, y: 0.4, w: 12.1, h: 0.9, fontSize: 32, bold: true, color: T.title, fontFace: font, valign: "middle", fit: "shrink" });
        let y = 1.65; const textItems = [];
        const flush = () => {
          if (!textItems.length) return;
          const h = Math.max(0.6, Math.min(7 - y, 0.5 * textItems.length + 0.4));
          s.addText(textItems.splice(0), { x: 0.6, y, w: 12.1, h, valign: "top", fit: "shrink", color: T.text, fontFace: font, paraSpaceAfter: 8 });
          y += h + 0.15;
        };
        for (const it of sd.items) {
          if (it.type === "table") {
            flush();
            const rows = it.rows.map((r, ri) => r.map((c) => ({ text: c, options: { bold: ri === 0, fill: ri === 0 ? { color: T.head } : undefined, color: T.text } })));
            const h = Math.min(7 - y, 0.42 * rows.length + 0.1);
            s.addTable(rows, { x: 0.6, y, w: 12.1, fontSize: 14, fontFace: font, border: { type: "solid", color: T.line, pt: 1 }, valign: "middle" });
            y += h + 0.2;
          } else if (it.type === "bullet") {
            const runs = inlineRuns(it.text, { color: T.text, fontSize: it.level ? 18 : 22, fontFace: font });
            runs.forEach((r, k) => { if (k === 0) r.options = { ...r.options, bullet: it.ordered ? { type: "number" } : true, indentLevel: it.level }; if (k === runs.length - 1) r.options = { ...r.options, breakLine: true }; });
            textItems.push(...runs);
          } else {
            const runs = inlineRuns(it.text, { color: T.text, fontSize: 20, fontFace: font });
            runs.forEach((r, k) => { if (k === runs.length - 1) r.options = { ...r.options, breakLine: true }; });
            textItems.push(...runs);
          }
        }
        flush();
      }
      if (sd.notes.length) s.addNotes(sd.notes.join("\n"));
      if (!cover) s.addText(String(n + 1), { x: 12.2, y: 6.95, w: 0.7, h: 0.35, fontSize: 11, color: T.muted, align: "right", fontFace: font });
    });
    const blob = await pptx.write({ outputType: "blob" });
    return { blob, filename: slug(m.title) + ".pptx" };
  }

  // ---------- Excel / Google Sheets ----------
  function parseSheets(body) {
    const sheets = []; let cur = null, buf = [];
    const done = () => { if (cur) { const rows = parseCsv(buf.join("\n")); cur.rows = rows.filter((r) => r.length && !(r.length === 1 && r[0] === "")); sheets.push(cur); } };
    for (const ln of body.replace(/\r/g, "").split("\n")) {
      const m = ln.match(/^\s*sheet\s*:\s*(.*)$/i);
      if (m) { done(); cur = { name: (m[1] || "Sheet" + (sheets.length + 1)).replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || "Sheet" + (sheets.length + 1), rows: [] }; buf = []; continue; }
      if (!cur) { if (!ln.trim()) continue; cur = { name: "Sheet1", rows: [] }; buf = []; }
      buf.push(ln);
    }
    done();
    if (!sheets.length) sheets.push({ name: "Sheet1", rows: [[""]] });
    const seen = new Set();
    sheets.forEach((s) => { let n = s.name, k = 2; while (seen.has(n.toLowerCase())) n = s.name.slice(0, 28) + " " + k++; seen.add(n.toLowerCase()); s.name = n; });
    return sheets;
  }
  function parseCsv(text) {
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  const cellValue = (raw) => {
    const t = String(raw).trim();
    if (t.startsWith("=") && t.length > 1) return { t: "n", f: t.slice(1) };
    if (/^-?\d+(\.\d+)?$/.test(t) && !/^0\d/.test(t)) return { t: "n", v: Number(t) };
    if (/^(true|false)$/i.test(t)) return { t: "b", v: /true/i.test(t) };
    return { t: "s", v: String(raw) };
  };
  async function buildXlsx(src, format) {
    await need("xlsx");
    const m = parseMeta(src, "xlsx"), sheets = parseSheets(m.body), wb = XLSX.utils.book_new();
    wb.Props = { Title: m.title, Author: m.author };
    for (const sh of sheets) {
      const ws = XLSX.utils.aoa_to_sheet(sh.rows.map((r) => r.map(cellValue)));
      const widths = []; sh.rows.forEach((r) => r.forEach((c, i) => { widths[i] = Math.max(widths[i] || 8, Math.min(60, String(c).length + 2)); }));
      ws["!cols"] = widths.map((w) => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws, sh.name);
    }
    format = format || "xlsx";
    if (format === "csv") return { blob: new Blob([XLSX.utils.sheet_to_csv(wb.Sheets[sheets[0].name])], { type: "text/csv;charset=utf-8" }), filename: slug(m.title) + ".csv" };
    const out = XLSX.write(wb, { bookType: format, type: "array" });
    return { blob: new Blob([out], { type: format === "ods" ? "application/vnd.oasis.opendocument.spreadsheet" : KINDS.xlsx.mime }), filename: slug(m.title) + "." + format };
  }

  // ---------- previews (shown in a locked-down frame) ----------
  const PAGE_CSS = 'html{background:#e7e3f4}body{margin:0;padding:22px 14px;font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1b1b2f}.page{background:#fff;max-width:800px;margin:0 auto 22px;padding:54px 62px;box-shadow:0 6px 30px rgba(40,20,90,.18);border-radius:3px}h1,h2,h3{line-height:1.25}h1{font-size:28px}h2{font-size:22px}pre{background:#f3f1ff;padding:12px;border-radius:8px;overflow:auto}code{background:#f3f1ff;padding:1px 5px;border-radius:5px;font-size:.92em}pre code{background:none;padding:0}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #d9d4f0;padding:7px 11px;text-align:left}th{background:#f3f1ff}blockquote{border-left:3px solid #a66bff;margin:12px 0;padding-left:14px;color:#555}hr{border:0;border-top:1px solid #ccc;margin:18px 0}a{color:#1a56db}@media(max-width:600px){.page{padding:28px 20px}}';
  const wrapDoc = (css, body, extraHead) => '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + "</style>" + (extraHead || "") + body;

  function previewDoc(kind, src, sanitize) {
    const m = parseMeta(src, kind);
    if (kind === "pdf" || kind === "docx") return wrapDoc(PAGE_CSS, '<div class="page">' + sanitize(marked.parse(m.body)) + "</div>");
    if (kind === "pptx") {
      const T = THEMES[m.theme], css = "html{background:#e7e3f4}body{margin:0;padding:18px 14px;font-family:Calibri,system-ui,sans-serif}.s{position:relative;max-width:820px;margin:0 auto 18px;aspect-ratio:16/9;background:#" + T.bg + ";color:#" + T.text + ";border-radius:6px;box-shadow:0 6px 26px rgba(40,20,90,.22);padding:4.2% 5%;box-sizing:border-box;overflow:hidden;container-type:inline-size}.s h2{margin:0 0 .3em;font-size:4.2cqw;color:#" + T.title + "}.s .bar{width:9cqw;height:.7cqw;background:#" + T.accent + ";margin-bottom:2.2cqw}.s ul{margin:0;padding-left:3cqw;font-size:2.6cqw;line-height:1.5}.s li ul{font-size:2.2cqw}.s p{font-size:2.5cqw;margin:.4em 0}.s table{border-collapse:collapse;font-size:2cqw}.s td,.s th{border:1px solid #" + T.line + ";padding:.5cqw 1.2cqw}.s th{background:#" + T.head + "}.cover{display:grid;align-content:center}.cover h2{font-size:7cqw}.cover .sub{font-size:3cqw;color:#" + T.muted + "}.cover:before{content:'';position:absolute;left:0;top:0;bottom:0;width:2.4cqw;background:#" + T.accent + "}.n{position:absolute;right:2.5cqw;bottom:1.5cqw;font-size:1.8cqw;color:#" + T.muted + "}.notes{font-size:1.9cqw;color:#" + T.muted + ";border-top:1px dashed #" + T.line + ";margin-top:2cqw;padding-top:1cqw}";
      const htm = parseSlides(m.body).map((sd, n) => {
        const cover = n === 0 && sd.depth === 1;
        if (cover) return '<div class="s cover"><h2>' + esc(sd.title || m.title) + '</h2><div class="sub">' + sd.items.filter((x) => x.type !== "table").map((x) => esc(x.text)).join(" · ") + "</div></div>";
        let inner = "", list = false;
        for (const it of sd.items) {
          if (it.type === "bullet") { if (!list) { inner += "<ul>"; list = true; } inner += "<li" + (it.level ? ' style="margin-left:' + it.level * 2 + 'cqw"' : "") + ">" + sanitize(marked.parseInline(it.text)) + "</li>"; continue; }
          if (list) { inner += "</ul>"; list = false; }
          inner += it.type === "table" ? "<table>" + it.rows.map((r, ri) => "<tr>" + r.map((c) => (ri ? "<td>" : "<th>") + esc(c) + (ri ? "</td>" : "</th>")).join("") + "</tr>").join("") + "</table>" : "<p>" + sanitize(marked.parseInline(it.text)) + "</p>";
        }
        if (list) inner += "</ul>";
        return '<div class="s"><h2>' + esc(sd.title) + '</h2><div class="bar"></div>' + inner + '<span class="n">' + (n + 1) + "</span></div>";
      }).join("");
      return wrapDoc(css, htm);
    }
    // spreadsheet: tabs per sheet, formulas shown as written
    const sheets = parseSheets(m.body), col = (i) => { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
    const css = "html,body{margin:0;height:100%;font:13px system-ui,-apple-system,'Segoe UI',sans-serif;color:#1b1b2f;background:#fff}.tabs{position:sticky;top:0;display:flex;gap:2px;background:#f3f1ff;border-bottom:1px solid #d9d4f0;padding:6px 8px 0;z-index:2}.tabs button{border:0;background:#e6e1f7;padding:6px 14px;border-radius:7px 7px 0 0;font:inherit;cursor:pointer;color:#4b3a7a}.tabs button.on{background:#fff;font-weight:600;color:#1b1b2f}table{border-collapse:collapse;margin:0}td,th{border:1px solid #e1ddf0;padding:4px 9px;min-width:64px;white-space:nowrap}th{background:#f3f1ff;color:#6a5a9a;font-weight:500;text-align:center}td.r{background:#f3f1ff;color:#6a5a9a;text-align:center}td.n{text-align:right}td.f{font-style:italic;color:#0b6b4a}.sh{display:none}.sh.on{display:block}.sc{overflow:auto}";
    const tabs = '<div class="tabs">' + sheets.map((s, i) => '<button class="' + (i ? "" : "on") + '" data-i="' + i + '">' + esc(s.name) + "</button>").join("") + "</div>";
    const body = sheets.map((s, i) => { const w = Math.max(1, ...s.rows.map((r) => r.length)); return '<div class="sh sc' + (i ? "" : " on") + '"><table><tr><th></th>' + Array.from({ length: w }, (_, c) => "<th>" + col(c) + "</th>").join("") + "</tr>" + s.rows.map((r, ri) => "<tr><td class='r'>" + (ri + 1) + "</td>" + Array.from({ length: w }, (_, c) => { const v = r[c] == null ? "" : r[c], t = String(v).trim(); return "<td class='" + (t.startsWith("=") ? "f" : /^-?\d+(\.\d+)?$/.test(t) ? "n" : "") + "'>" + esc(v) + "</td>"; }).join("") + "</tr>").join("") + "</table></div>"; }).join("");
    const js = '<script>document.querySelector(".tabs").addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;document.querySelectorAll(".tabs button").forEach(function(x){x.classList.toggle("on",x===b)});document.querySelectorAll(".sh").forEach(function(x,i){x.classList.toggle("on",i==b.dataset.i)})})<\/script>';
    return wrapDoc(css, tabs + body + js);
  }

  async function build(kind, src, format) {
    const out = kind === "pdf" ? await buildPdf(src) : kind === "docx" ? await buildDocx(src) : kind === "pptx" ? await buildPptx(src) : await buildXlsx(src, format);
    return out;
  }

  window.NeonFiles = { KINDS, langToKind, parseMeta, previewDoc, build, slug };
})();
