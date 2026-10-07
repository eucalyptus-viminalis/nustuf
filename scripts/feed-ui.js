#!/usr/bin/env node
import "dotenv/config";
import { createServer } from "http";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { normalizeTunnelProvider, pickFunnelPublicPort, startTunnel, tunnelPreflight } from "./tunnel.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

function flagValue(name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

const PORT = parseInt(flagValue("--port") || process.env.PORT || "3000", 10);
const PUBLIC = argv.includes("--public");
const TESTNET = argv.includes("--testnet");
const PAGE_PATH = TESTNET ? "/?network=sepolia" : "/";

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`Invalid --port "${flagValue("--port") ?? process.env.PORT}". Use a number from 1 to 65535.`);
  process.exit(1);
}

const tunnelProvider = normalizeTunnelProvider(flagValue("--tunnel"));
if (!tunnelProvider) {
  console.error(`Unknown --tunnel value "${flagValue("--tunnel")}". Use tailscale or cloudflared.`);
  process.exit(1);
}

const feedHtml = readFileSync(resolve(__dirname, "../public/feed.html"), "utf-8");

const server = createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/" || pathname === "/feed") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(feedHtml);
  } else if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

let tunnelProc = null;
let shuttingDown = false;

// Same providers as `nustuf publish --public`. Tailscale Funnel gives a stable URL and picks a
// public port no other Funnel is using; cloudflared gives a temporary quick-tunnel URL.
function openTunnel() {
  const preflight = tunnelPreflight(tunnelProvider);
  if (!preflight.ok) {
    console.log(`\nNo public URL: ${preflight.reason}`);
    console.log("Use --tunnel cloudflared for a temporary URL. The feed is still available locally.");
    return null;
  }

  let publicPort = 443;
  if (tunnelProvider === "tailscale") {
    publicPort = pickFunnelPublicPort();
    if (publicPort === null) {
      console.log("\nNo public URL: Funnel public ports 443, 8443 and 10000 are all in use.");
      return null;
    }
  }

  const { proc } = startTunnel({
    provider: tunnelProvider,
    port: PORT,
    hostname: preflight.hostname,
    publicPort,
    onUrl: (origin) => {
      console.log(`\nPublic URL: ${origin}${PAGE_PATH}`);
      console.log("Share this link to let anyone browse the live feed.");
    },
    onFatal: (detail) => {
      console.log(`\nPublic tunnel failed: ${detail}`);
    },
  });
  proc.on("exit", (code, signal) => {
    if (!shuttingDown) console.log(`Tunnel exited (${signal || `code ${code}`}).`);
  });
  return proc;
}

function shutdown() {
  shuttingDown = true;
  tunnelProc?.kill("SIGTERM");
  process.exit();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(PORT, () => {
  console.log(`nustuf feed UI running at http://localhost:${PORT}${PAGE_PATH}`);
  console.log(`Browse live releases from the on-chain registry${TESTNET ? " (Base Sepolia)" : ""}.`);

  if (PUBLIC) tunnelProc = openTunnel();
});
