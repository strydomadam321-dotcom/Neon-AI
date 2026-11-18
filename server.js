import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const client = new Anthropic(); // reads ANTHROPIC_API_KEY

const MODELS = [
  { id: "claude-opus-5-5", name: "Opus 5.5 — smartest" },
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5 — fast" },
  { id: "claude-haiku-5-5", name: "Haiku 5.5 — fastest" },
];
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || MODELS[0].id;
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const SYSTEM =
  "You are a helpful, sharp AI assistant inside a futuristic neon chat app. " +
  "Answer clearly and concisely. Use Markdown, and fenced code blocks with language tags for code.";

app.use(express.json({ limit: "60mb" }));
app.use(express.static(path.join(__dirname, "public")));

function auth(req, res, next) {
  if (!APP_PASSWORD) return next();
  if (req.get("x-app-password") === APP_PASSWORD) return next();
  res.status(401).json({ error: "Wrong or missing password" });
}

app.get("/api/config", (req, res) => {
  res.json({
    models: MODELS,
    defaultModel: DEFAULT_MODEL,
    needsPassword: !!APP_PASSWORD,
    hasKey: !!process.env.ANTHROPIC_API_KEY,
  });
});

app.post("/api/check", auth, (req, res) => res.json({ ok: true }));

const IMG_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

function toContent(msg) {
  if (msg.role === "assistant") return msg.text || "(no response)";
  const blocks = [];
  for (const a of msg.attachments || []) {
    if (a.kind === "image" && IMG_TYPES.includes(a.mediaType)) {
      blocks.push({ type: "image", source: { type: "base64", media_type: a.mediaType, data: a.data } });
    } else if (a.kind === "pdf") {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data } });
    } else if (a.kind === "text") {
      blocks.push({ type: "text", text: `<file name="${String(a.name).replace(/"/g, "")}">\n${a.content}\n</file>` });
    }
  }
  blocks.push({ type: "text", text: msg.text?.trim() ? msg.text : "(see attached files)" });
  return blocks;
}

app.post("/api/chat", auth, async (req, res) => {
  const { messages, model, system } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: "No messages" });
  const useModel = MODELS.some((m) => m.id === model) ? model : DEFAULT_MODEL;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  let stream;
  res.on("close", () => stream?.abort());
  try {
    stream = client.messages.stream({
      model: useModel,
      max_tokens: 16000,
      system: (system && String(system).slice(0, 4000)) || SYSTEM,
      messages: messages.slice(-40).map((m) => ({ role: m.role, content: toContent(m) })),
    });
    stream.on("text", (t) => send({ t }));
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") send({ t: "\n\n*(The model declined to answer this request.)*" });
    if (final.stop_reason === "max_tokens") send({ t: "\n\n*(Reached max length.)*" });
    send({ done: true, usage: final.usage });
  } catch (err) {
    if (!res.writableEnded) send({ error: err?.message || "Request failed" });
  }
  res.end();
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Neon AI running on :${port}`));
