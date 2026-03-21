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
  console.log("  nustuf buy <url> [options]                Purchase content");
  console.log("  nustuf host --config <path> [options]     Multi-host server");
  console.log("  nustuf config [show|--write-env]          Manage configuration");
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
  console.log("  --announce                 Announce on-chain for discovery");
  console.log("");
  console.log(outUi.section("Buy Options"));
  console.log("  --locus                    Pay via Locus wallet (recommended)");
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
  console.log("  nustuf buy https://xxx.trycloudflare.com/ --locus");
  console.log("  nustuf buy https://xxx.trycloudflare.com/ --download-code friends-only --locus");
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
  // Use publish.js for publish (will rebrand later)
  runSubcommand("publish.js", ["--wizard", ...process.argv.slice(3)]);
} else if (sub === "buy") {
  runSubcommand("buy.js", process.argv.slice(3));
} else if (sub === "discover") {
  runSubcommand("discover.js", process.argv.slice(3));
} else if (sub === "announce") {
  runSubcommand("announce.js", process.argv.slice(3));
} else if (sub === "host") {
  runSubcommand("host.js", process.argv.slice(3));
} else if (sub === "config") {
  runSubcommand("config.js", process.argv.slice(3));
} else if (sub === "leak") {
  // Backward compatibility
  runSubcommand("publish.js", process.argv.slice(3));
} else {
  // Default: show help
  printHelp();
  process.exit(1);
}
