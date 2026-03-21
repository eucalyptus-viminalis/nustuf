#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import enquirer from "enquirer";
import { isAddress } from "viem";
const { Select } = enquirer;

import {
  defaultFacilitatorUrlForMode,
  redactConfig,
  readConfig,
  writeConfig,
} from "./config_store.js";
import { resolveSupportedChain } from "../src/chain_meta.js";
import {
  ACCESS_MODE_VALUES,
  DEFAULT_ACCESS_MODE,
  accessModeRequiresDownloadCode,
  accessModeRequiresPayment,
  isValidAccessMode,
} from "../src/access_mode.js";
import { hashDownloadCode } from "../src/download_code.js";
import { createUi } from "./ui.js";

const ALLOWED_FACILITATOR_MODES = new Set(["testnet", "cdp_mainnet"]);
const ALLOWED_CONFIRMATION_POLICIES = new Set(["confirmed", "optimistic"]);
const outUi = createUi(output);
const errUi = createUi(process.stderr);

function logInfo(message) {
  console.log(outUi.statusLine("info", message));
}

function logOk(message) {
  console.log(outUi.statusLine("ok", message));
}

function logWarn(message) {
  console.error(errUi.statusLine("warn", message));
}

function logError(message) {
  console.error(errUi.statusLine("error", message));
}

function usageAndExit(code = 0) {
  console.log(outUi.heading("Leak Config CLI"));
  console.log("");
  console.log(outUi.section("Usage"));
  console.log("  nustuf config");
  console.log("  nustuf config show");
  console.log("  nustuf config --write-env");
  console.log("");
  console.log(outUi.section("Notes"));
  console.log("  - Stores defaults in ~/.nustuf/config.json");
  console.log("  - `--write-env` writes a project .env scaffold in the current directory");
  process.exit(code);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--help" || token === "-h") usageAndExit(0);
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
      continue;
    }
    args._.push(token);
  }
  return args;
}

function parsePositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function parseNonNegativeInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function parseDurationToSeconds(s) {
  if (!s) return null;
  const str = String(s).trim().toLowerCase();
  const spaced = str.replace(/\s+/g, "");
  if (/^\d+$/.test(spaced)) return Number(spaced);
  const m = spaced.match(
    /^(\d+(?:\.\d+)?)(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/,
  );
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  if (["s", "sec", "secs", "second", "seconds"].includes(unit)) return Math.round(n);
  if (["m", "min", "mins", "minute", "minutes"].includes(unit)) return Math.round(n * 60);
  if (["h", "hr", "hrs", "hour", "hours"].includes(unit)) return Math.round(n * 3600);
  if (["d", "day", "days"].includes(unit)) return Math.round(n * 86400);
  return null;
}

async function askWithDefault(rl, label, currentValue = "") {
  const current = String(currentValue ?? "").trim();
  const suffix = current ? ` [${current}]` : "";
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer || current;
}

async function askOgField(rl, label, currentValue, fieldType) {
  const current = String(currentValue || "").trim();
  const defaultText = fieldType === 'title'
    ? 'filename (recommended)'
    : 'auto-generated description';

  if (!current) {
    // No existing value - simple prompt
    const answer = (await rl.question(`${label} [blank to use ${defaultText}]: `)).trim();
    return answer;
  }

  // Has existing value - use interactive select
  const prompt = new Select({
    name: label,
    message: `${label} (current: "${current}")`,
    choices: [
      { name: 'keep', message: `Keep: "${current}"` },
      { name: 'clear', message: `Clear → use ${defaultText}` },
      { name: 'new', message: 'Enter new value' }
    ],
    initial: 0
  });

  const choice = await prompt.run();

  if (choice === 'keep') return current;
  if (choice === 'clear') return '';
  if (choice === 'new') {
    const answer = (await rl.question(`New ${label}: `)).trim();
    return answer;
  }
}

async function askDownloadCodeHash(rl, existingHash, accessMode) {
  if (!accessModeRequiresDownloadCode(accessMode)) return "";

  if (existingHash) {
    const prompt = new Select({
      name: "DOWNLOAD_CODE",
      message: "DOWNLOAD_CODE (required by selected ACCESS_MODE)",
      choices: [
        { name: "keep", message: "Keep existing stored download code hash" },
        { name: "replace", message: "Replace with new download code" },
      ],
      initial: 0,
    });
    const choice = await prompt.run();
    if (choice === "keep") return existingHash;
  }

  let raw = (await rl.question("DOWNLOAD_CODE (input visible): ")).trim();
  while (!raw) {
    logError("DOWNLOAD_CODE is required for the selected ACCESS_MODE.");
    raw = (await rl.question("DOWNLOAD_CODE (input visible): ")).trim();
  }
  return hashDownloadCode(raw);
}

function printShow() {
  const loaded = readConfig();
  if (loaded.error) {
    logWarn(loaded.error);
  }
  if (!loaded.exists) {
    logInfo(`No nustuf config found at ${loaded.path}`);
    logInfo("Run `nustuf config` to initialize your config file.");
    return;
  }

  const redacted = redactConfig(loaded.config);
  console.log(outUi.section("Leak Config"));
  for (const line of outUi.formatRows([{ key: "path", value: loaded.path }])) {
    console.log(line);
  }
  console.log("");
  console.log(JSON.stringify(redacted, null, 2));
}

function buildEnvScaffold(defaults) {
  const facilitatorMode = defaults.facilitatorMode || "testnet";
  const facilitatorUrl = defaults.facilitatorUrl || defaultFacilitatorUrlForMode(facilitatorMode);
  const windowSeconds = parseDurationToSeconds(defaults.window || "");

  const lines = [
    "# Generated by `nustuf config --write-env`",
    "",
    "# Server",
    `PORT=${defaults.port || 4021}`,
    "",
    "# x402",
    `FACILITATOR_MODE=${facilitatorMode}`,
    `FACILITATOR_URL=${facilitatorUrl}`,
    `SELLER_PAY_TO=${defaults.sellerPayTo || ""}`,
    `PRICE_USD=${defaults.priceUsd || "0.01"}`,
    `CHAIN_ID=${defaults.chainId || "eip155:84532"}`,
    `WINDOW_SECONDS=${windowSeconds ?? 3600}`,
    "",
    "# Access control",
    `ACCESS_MODE=${defaults.accessMode || DEFAULT_ACCESS_MODE}`,
    `DOWNLOAD_CODE_HASH=${defaults.downloadCodeHash || ""}`,
    "",
    "# Required when FACILITATOR_MODE=cdp_mainnet (Base mainnet path)",
    `CDP_API_KEY_ID=${defaults.cdpApiKeyId || ""}`,
    `CDP_API_KEY_SECRET=${defaults.cdpApiKeySecret || ""}`,
    "",
    "# Settlement / confirmation policy",
    `CONFIRMATION_POLICY=${defaults.confirmationPolicy || "confirmed"}`,
    "CONFIRMATIONS_REQUIRED=1",
    "",
    "# Artifact to serve",
    "ARTIFACT_PATH=./protected/asset.bin",
    "PROTECTED_MIME=application/octet-stream",
    "",
    "# OpenGraph metadata (optional - leave blank to use filename as title)",
    "# OG_TITLE=",
    "# OG_DESCRIPTION=",
    "",
  ];

  return `${lines.join("\n")}\n`;
}

function maybeWriteEnvScaffold(defaults) {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    logWarn(`${envPath} already exists; skipping .env scaffold write.`);
    return;
  }

  const body = buildEnvScaffold(defaults);
  fs.writeFileSync(envPath, body);
  logOk(`Wrote ${envPath}`);
}

async function runWizard({ writeEnv }) {
  const loaded = readConfig();
  if (loaded.error) {
    logWarn(loaded.error);
  }

  const existing = loaded.config.defaults || {};
  const rl = readline.createInterface({ input, output });

  try {
    let sellerPayTo = await askWithDefault(
      rl,
      "SELLER_PAY_TO (seller payout address)",
      existing.sellerPayTo || "",
    );
    sellerPayTo = String(sellerPayTo || "").trim();
    while (sellerPayTo && !isAddress(sellerPayTo)) {
      logError("Invalid SELLER_PAY_TO. Expected a valid Ethereum address (0x + 40 hex chars).");
      sellerPayTo = String(
        await askWithDefault(rl, "SELLER_PAY_TO (seller payout address)", sellerPayTo),
      ).trim();
    }

    let chainIdInput = await askWithDefault(
      rl,
      "CHAIN_ID",
      existing.chainId || "eip155:84532",
    );
    let chainId;
    while (true) {
      try {
        chainId = resolveSupportedChain(chainIdInput).caip2;
        break;
      } catch (err) {
        logError(err.message || String(err));
        chainIdInput = await askWithDefault(rl, "CHAIN_ID", chainIdInput || "eip155:84532");
      }
    }

    let facilitatorMode = await askWithDefault(
      rl,
      "FACILITATOR_MODE (testnet|cdp_mainnet)",
      existing.facilitatorMode || "testnet",
    );
    facilitatorMode = facilitatorMode.toLowerCase();
    while (!ALLOWED_FACILITATOR_MODES.has(facilitatorMode)) {
      logError("Invalid FACILITATOR_MODE. Use: testnet or cdp_mainnet");
      facilitatorMode = (await askWithDefault(rl, "FACILITATOR_MODE", "testnet")).toLowerCase();
    }

    const modeDefaultUrl = defaultFacilitatorUrlForMode(facilitatorMode);
    const existingModeUrl =
      existing.facilitatorMode === facilitatorMode
        ? existing.facilitatorUrl || ""
        : "";
    const facilitatorUrl = await askWithDefault(
      rl,
      "FACILITATOR_URL",
      existingModeUrl || modeDefaultUrl,
    );

    let cdpApiKeyId = existing.cdpApiKeyId || "";
    let cdpApiKeySecret = existing.cdpApiKeySecret || "";
    if (facilitatorMode === "cdp_mainnet") {
      cdpApiKeyId = await askWithDefault(
        rl,
        "CDP_API_KEY_ID",
        existing.cdpApiKeyId || "",
      );
      while (!cdpApiKeyId) {
        logError("CDP_API_KEY_ID is required when FACILITATOR_MODE=cdp_mainnet");
        cdpApiKeyId = await askWithDefault(rl, "CDP_API_KEY_ID", "");
      }

      cdpApiKeySecret = await askWithDefault(
        rl,
        "CDP_API_KEY_SECRET",
        existing.cdpApiKeySecret || "",
      );
      while (!cdpApiKeySecret) {
        logError("CDP_API_KEY_SECRET is required when FACILITATOR_MODE=cdp_mainnet");
        cdpApiKeySecret = await askWithDefault(rl, "CDP_API_KEY_SECRET", "");
      }
    }

    let confirmationPolicy = await askWithDefault(
      rl,
      "CONFIRMATION_POLICY (confirmed|optimistic)",
      existing.confirmationPolicy || "confirmed",
    );
    confirmationPolicy = confirmationPolicy.toLowerCase();
    while (!ALLOWED_CONFIRMATION_POLICIES.has(confirmationPolicy)) {
      logError("Invalid CONFIRMATION_POLICY. Use: confirmed or optimistic");
      confirmationPolicy = (
        await askWithDefault(rl, "CONFIRMATION_POLICY", "confirmed")
      ).toLowerCase();
    }

    let accessMode = await askWithDefault(
      rl,
      `ACCESS_MODE (${ACCESS_MODE_VALUES.join("|")})`,
      existing.accessMode || DEFAULT_ACCESS_MODE,
    );
    accessMode = accessMode.toLowerCase();
    while (!isValidAccessMode(accessMode)) {
      logError(`Invalid ACCESS_MODE. Use one of: ${ACCESS_MODE_VALUES.join(", ")}`);
      accessMode = (
        await askWithDefault(
          rl,
          "ACCESS_MODE",
          existing.accessMode || DEFAULT_ACCESS_MODE,
        )
      ).toLowerCase();
    }

    if (accessModeRequiresPayment(accessMode)) {
      while (!sellerPayTo) {
        logError("SELLER_PAY_TO is required for payment access modes.");
        sellerPayTo = String(
          await askWithDefault(rl, "SELLER_PAY_TO (seller payout address)", ""),
        ).trim();
      }
      while (!isAddress(sellerPayTo)) {
        logError("Invalid SELLER_PAY_TO. Expected a valid Ethereum address (0x + 40 hex chars).");
        sellerPayTo = String(
          await askWithDefault(rl, "SELLER_PAY_TO (seller payout address)", sellerPayTo),
        ).trim();
      }
    }

    const downloadCodeHash = await askDownloadCodeHash(
      rl,
      existing.downloadCodeHash || "",
      accessMode,
    );

    const priceUsd = await askWithDefault(
      rl,
      "PRICE_USD",
      existing.priceUsd || "0.01",
    );
    const window = await askWithDefault(
      rl,
      "WINDOW (e.g. 15m, 1h, 3600)",
      existing.window || "15m",
    );

    let portRaw = await askWithDefault(
      rl,
      "PORT",
      String(existing.port || 4021),
    );
    let port = parsePositiveInt(portRaw);
    while (port === null) {
      logError("PORT must be a positive integer");
      portRaw = await askWithDefault(rl, "PORT", "4021");
      port = parsePositiveInt(portRaw);
    }

    let endedWindowRaw = await askWithDefault(
      rl,
      "ENDED_WINDOW_SECONDS",
      String(existing.endedWindowSeconds ?? 0),
    );
    let endedWindowSeconds = parseNonNegativeInt(endedWindowRaw);
    while (endedWindowSeconds === null) {
      logError("ENDED_WINDOW_SECONDS must be a non-negative integer");
      endedWindowRaw = await askWithDefault(rl, "ENDED_WINDOW_SECONDS", "0");
      endedWindowSeconds = parseNonNegativeInt(endedWindowRaw);
    }

    const ogTitle = await askOgField(rl, "OG_TITLE", existing.ogTitle, "title");
    const ogDescription = await askOgField(rl, "OG_DESCRIPTION", existing.ogDescription, "description");

    const defaults = {
      sellerPayTo,
      chainId,
      facilitatorMode,
      facilitatorUrl,
      cdpApiKeyId,
      cdpApiKeySecret,
      confirmationPolicy,
      priceUsd,
      window,
      port,
      endedWindowSeconds,
      ogTitle,
      ogDescription,
      accessMode,
      downloadCodeHash,
    };

    const written = writeConfig({ version: 1, defaults });
    logOk(`Saved ${written.path}`);
    console.log("");
    console.log(JSON.stringify(redactConfig(written.config), null, 2));

    if (writeEnv) {
      maybeWriteEnvScaffold(written.config.defaults);
    }
  } finally {
    rl.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sub = args._[0];

  if (sub === "show") {
    printShow();
    return;
  }

  if (sub && sub !== "show") {
    usageAndExit(1);
  }

  await runWizard({ writeEnv: Boolean(args["write-env"]) });
}

main().catch((err) => {
  const detail = err?.stack || err?.message || String(err);
  logError(detail);
  process.exit(1);
});
