import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin" });
  next();
});
app.use(express.static(path.join(__dirname, "public"), { maxAge: "5m", extensions: ["html"] }));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, "public", "index.html")));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Free Study Resources running on :${port}`));
