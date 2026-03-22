#!/usr/bin/env node
import "dotenv/config";
import { createServer } from "http";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3000", 10);
const NO_TUNNEL = process.argv.includes("--no-tunnel");

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

  if (NO_TUNNEL) return;

  // Start cloudflare tunnel
  const tunnel = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${PORT}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const handleOutput = (data) => {
    const line = data.toString();
    const match = line.match(/https:\/\/[^\s]+\.trycloudflare\.com/);
    if (match) {
      console.log(`\nPublic URL: ${match[0]}`);
      console.log(`Share this link to let anyone browse the live feed.`);
    }
  };

  tunnel.stdout.on("data", handleOutput);
  tunnel.stderr.on("data", handleOutput);

  tunnel.on("error", (err) => {
    if (err.code === "ENOENT") {
      console.log("\ncloudflared not found — skipping tunnel. Install from https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/");
      console.log("Or use --no-tunnel to suppress this message.");
    }
  });

  tunnel.on("close", () => {
    console.log("Tunnel closed.");
  });

  process.on("SIGINT", () => {
    tunnel.kill();
    process.exit();
  });
  process.on("SIGTERM", () => {
    tunnel.kill();
    process.exit();
  });
});
