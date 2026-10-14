#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createUi } from "./ui.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_JSON_PATH = path.resolve(__dirname, "..", "package.json");
const outUi = createUi(process.stdout);
const errUi = createUi(process.stderr);

const sub = process.argv[2];

function readVersion() {
  try {
    const parsed = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8"));
    const version = String(parsed?.version || "").trim();
    return version || "unknown";
  } catch {
    return "unknown";
  }
}

function printVersion() {
  console.log(outUi.section(`nustuf ${readVersion()}`));
}

function printHelp() {
  console.log(outUi.heading("nustuf"));
  console.log(outUi.muted(`Agent-native content marketplace — v${readVersion()}`));
  console.log("");
  console.log(outUi.section("Usage"));
  console.log("  nustuf publish --file <path> [options]    Publish content behind payment gate");
  console.log("  nustuf discover [options]                 Find live releases");
  console.log("  nustuf feed-ui [--port <port>] [--testnet] [--public [--tunnel <tailscale|cloudflared>]]");
  console.log("                                            Browse live releases in the browser");
  console.log("  nustuf buy <url> [options]                Purchase content");
  console.log("  nustuf announce --url <url> [options]     List a drop in the on-chain registry");
  console.log("  nustuf host --config <path> [options]     Multi-host server");
  console.log("  nustuf status [--json] [--all]            Show what this machine is serving right now");
  console.log("  nustuf stop <id>|all                      Stop a published item (or everything)");
  console.log("  nustuf config [show|set|unset|--write-env] Manage saved defaults (profile)");
  console.log("  nustuf wallet <create|show|export>        Generate and check a buyer or seller wallet");
  console.log("  nustuf identity <register|show>           ERC-8004 agent identity (testnet, draft)");
  console.log("  nustuf version                            Show version");
  console.log("");
  console.log(outUi.section("Publish Options"));
  console.log("  --file <path>              File to publish");
  console.log("  --price <usdc>             Price in USDC");
  console.log("  --window <duration>        Sale window (e.g., 1h, 24h, 7d)");
  console.log("  --pay-to <address>         Payout address");
  console.log("  --title <text>             Release title (for discovery)");
  console.log("  --description <text>       Release description");
  console.log("  --access-mode <mode>       Access mode");
  console.log("  --download-code <code>     Set download code");
  console.log("  --public                   Expose publicly (requires confirmation)");
  console.log("  --announce                 List the drop on-chain once the public URL is live (needs --public)");
  console.log("");
  console.log(outUi.section("Buy Options"));
  console.log("  (default)                  Pay from the nustuf buyer wallet (nustuf wallet create --role buyer)");
  console.log("  --locus                    Pay via Locus wallet");
  console.log("  --buyer-private-key-file   Pay with local key file");
  console.log("  --download-code <code>     Include download code");
  console.log("  --out <path>               Output file path");
  console.log("");
  console.log(outUi.section("Discover Options"));
  console.log("  --active                   Show only active releases");
  console.log("  --creator <address>        Filter by creator");
  console.log("  --max-price <usdc>         Filter by max price");
  console.log("  --limit <n>                Max results to show");
  console.log("");
  console.log(outUi.section("Examples"));
  console.log("  nustuf publish --file ./track.mp3 --price 0.50 --window 24h --pay-to 0x...");
  console.log("  nustuf discover --active");
  console.log("  nustuf buy https://<machine>.<tailnet>.ts.net/");
  console.log("  nustuf buy https://<machine>.<tailnet>.ts.net/ --download-code friends-only");
  console.log("");
  console.log(outUi.section("Locus Integration"));
  console.log("  Set LOCUS_API_KEY env var or create .locus.json with apiKey field.");
  console.log("  Manage spending limits via Locus dashboard.");
  console.log("");
  console.log(outUi.section("More Info"));
  console.log("  https://github.com/eucalyptus-viminalis/nustuf");
}

function runSubcommand(scriptName, argv) {
  const scriptPath = path.resolve(__dirname, scriptName);

  const child = spawn(process.execPath, [scriptPath, ...argv], {
    stdio: "inherit",
  });

  child.on("error", (err) => {
    console.error(errUi.statusLine("error", `Failed to launch ${scriptName}: ${err.message}`));
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      console.error(errUi.statusLine("error", `${scriptName} exited via signal ${signal}`));
      process.exit(1);
    }
    process.exit(code ?? 1);
  });
}

if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
  printHelp();
  process.exit(0);
}

if (sub === "--version" || sub === "-v" || sub === "version") {
  printVersion();
  process.exit(0);
}

if (sub === "publish") {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  runSubcommand("publish.js", [...(interactive ? ["--wizard"] : []), ...process.argv.slice(3)]);
} else if (sub === "buy") {
  runSubcommand("buy.js", process.argv.slice(3));
} else if (sub === "discover") {
  runSubcommand("discover.js", process.argv.slice(3));
} else if (sub === "announce") {
  runSubcommand("announce.js", process.argv.slice(3));
} else if (sub === "feed-ui") {
  runSubcommand("feed-ui.js", process.argv.slice(3));
} else if (sub === "host") {
  runSubcommand("host.js", process.argv.slice(3));
} else if (sub === "status") {
  runSubcommand("status.js", ["status", ...process.argv.slice(3)]);
} else if (sub === "stop") {
  runSubcommand("status.js", ["stop", ...process.argv.slice(3)]);
} else if (sub === "config") {
  runSubcommand("config.js", process.argv.slice(3));
} else if (sub === "identity") {
  runSubcommand("identity.js", process.argv.slice(3));
} else if (sub === "wallet") {
  runSubcommand("wallet.js", process.argv.slice(3));
} else if (sub === "leak") {
  runSubcommand("publish.js", process.argv.slice(3));
} else {
  printHelp();
  process.exit(1);
}
