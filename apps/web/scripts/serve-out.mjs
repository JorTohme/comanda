// Minimal static server for apps/web/out, mimicking Cloudflare Pages (/caja -> caja.html). Used by browser tests.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../out/", import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".txt": "text/plain", ".json": "application/json" };
const isFile = (path) => existsSync(path) && statSync(path).isFile();

createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const base = normalize(join(root, pathname));
  const file = [base, `${base}.html`, join(base, "index.html")].find((path) => path.startsWith(root) && isFile(path));
  res.writeHead(file ? 200 : 404, { "Content-Type": types[extname(file ?? "x.html")] ?? "application/octet-stream" });
  createReadStream(file ?? join(root, "404.html")).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`serving ${root} on http://127.0.0.1:${port}`));
