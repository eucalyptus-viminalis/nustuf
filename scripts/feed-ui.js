#!/usr/bin/env node
import "dotenv/config";
import { createServer } from "http";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3000", 10);

const feedHtml = readFileSync(resolve(__dirname, "../public/feed.html"), "utf-8");

const server = createServer((req, res) => {
  if (req.url === "/" || req.url === "/feed") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(feedHtml);
  } else if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`nustuf feed UI running at http://localhost:${PORT}`);
  console.log(`Browse live releases from the on-chain registry.`);
});
