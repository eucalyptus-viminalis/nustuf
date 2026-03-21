#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import enquirer from "enquirer";
import { isAddress } from "viem";
import {
  defaultFacilitatorUrlForMode,
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
import {
  hashDownloadCode,
  isValidDownloadCodeHash,
} from "../src/download_code.js";
import { createUi } from "./ui.js";
const { Select, Input } = enquirer;
const HiddenCodePrompt = enquirer["Pass" + "word"];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ENTRY = path.resolve(__dirname, "..", "src", "index.js");
const PUBLIC_CONFIRM_PHRASE = "I_UNDERSTAND_PUBLIC_EXPOSURE";
const ABSOLUTE_SENSITIVE_PATHS = ["/etc", "/proc", "/sys", "/var/run/secrets"];
const ALLOWED_CONFIRMATION_POLICIES = new Set(["confirmed", "optimistic"]);
const ALLOWED_FACILITATOR_MODES = new Set(["testnet", "cdp_mainnet"]);
const RUNS_DIR = ".nustuf/runs";
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

function usageAndExit(code = 1, hint = "") {
  if (hint) logWarn(`Hint: ${hint}`);
  console.log(outUi.heading("nustuf publish"));
  console.log("");
  console.log(outUi.section("Usage"));
  console.log(`  nustuf publish [--file <path>] [--access-mode <${ACCESS_MODE_VALUES.join("|")}>]`);
  console.log(`  nustuf --file <path> [--access-mode <${ACCESS_MODE_VALUES.join("|")}>] [--download-code <code> | --download-code-stdin] [--price <usdc>] [--window <duration>] [--pay-to <address>] [--network <caip2>] [--port <port>] [--confirmed] [--public] [--public-confirm ${PUBLIC_CONFIRM_PHRASE}] [--allow-sensitive-path --acknowledge-sensitive-path-risk] [--og-title <text>] [--og-description <text>] [--og-image-url <https://...|./image.png>] [--ended-window-seconds <seconds>]`);
  console.log(`  nustuf --file <path> [--access-mode <${ACCESS_MODE_VALUES.join("|")}>] [--download-code <code> | --download-code-stdin] [--price <usdc>] [--window <duration>] [--pay-to <address>] [--network <caip2>] [--port <port>] [--confirmed] [--public] [--public-confirm ${PUBLIC_CONFIRM_PHRASE}] [--allow-sensitive-path --acknowledge-sensitive-path-risk] [--og-title <text>] [--og-description <text>] [--og-image-url <https://...|./image.png>] [--ended-window-seconds <seconds>]`);
  console.log("");
  console.log(outUi.section("Notes"));
  console.log("  --public requires cloudflared (Cloudflare Tunnel) installed.");
  console.log("");
  console.log(outUi.section("Examples"));
  console.log("  nustuf publish");
  console.log("  nustuf --file ./vape.jpg");
  console.log("  nustuf --file ./vape.jpg --price 0.01 --window 1h --confirmed");
  console.log('  nustuf --file ./vape.jpg --access-mode download-code-only-no-payment --download-code "friends-only"');
  console.log('  nustuf --file ./vape.jpg --public --og-title "My New Drop" --og-description "Agent-assisted purchase"');
  console.log(`  nustuf --file ./vape.jpg --public --public-confirm ${PUBLIC_CONFIRM_PHRASE}`);
  console.log("  nustuf --file ./vape.jpg --public --og-image-url ./cover.png");
  console.log("  npm run nustuf -- --file ./vape.jpg");
  console.log("  npm run nustuf -- --file ./vape.jpg --price 0.01 --window 1h --confirmed");
  process.exit(code);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") usageAndExit(0);
    if (a === "--confirmed") {
      args.confirmed = true;
      continue;
    }
    if (a === "--public") {
      args.public = true;
      continue;
    }
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val && !val.startsWith("--")) {
      args[key] = val;
      i++;
    } else {
      args[key] = true;
    }
    continue;
  }
  for (const a of argv) {
    if (!a.startsWith("--")) args._.push(a);
  }
  return args;
}

function parseNonNegativeInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function parsePositiveInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function trim(value) {
  return String(value || "").trim();
}

function yesNoChoices() {
  return [
    { name: "yes", message: "Yes" },
    { name: "no", message: "No" },
  ];
}

async function promptYesNo(message, initialYes = true) {
  const prompt = new Select({
    name: "choice",
    message,
    choices: yesNoChoices(),
    initial: initialYes ? 0 : 1,
  });
  const choice = await prompt.run();
  return choice === "yes";
}

async function promptSelect(message, options, initialName) {
  const normalizedOptions = options.map((opt) => ({ name: String(opt), message: String(opt) }));
  const initialIndex = Math.max(
    0,
    normalizedOptions.findIndex((opt) => opt.name === initialName),
  );
  const prompt = new Select({
    name: "choice",
    message,
    choices: normalizedOptions,
    initial: initialIndex,
  });
  return prompt.run();
}

async function promptMaskedDownloadCode(existingHash) {
  if (existingHash) {
    const keepExisting = await promptYesNo(
      "Keep current stored download-code hash from config/env?",
      true,
    );
    if (keepExisting) return { raw: "", hashOverride: existingHash };
  }

  const prompt = new HiddenCodePrompt({
    name: "downloadCode",
    message: "DOWNLOAD_CODE (hidden input)",
  });
  const raw = trim(await prompt.run());
  if (!raw) throw new Error("DOWNLOAD_CODE cannot be empty");
  return { raw, hashOverride: "" };
}

async function askWithDefaultReadline(rl, label, currentValue = "") {
  const current = trim(currentValue);
  const suffix = current ? ` [${current}]` : "";
  const answer = trim(await rl.question(`${label}${suffix}: `));
  return answer || current;
}

async function askWithDefault(label, currentValue = "") {
  const current = trim(currentValue);
  const prompt = new Input({
    name: "value",
    message: label,
    initial: current,
  });
  const answer = trim(await prompt.run());
  return answer || current;
}

function resolveInputPathForAutocomplete(inputPath) {
  const raw = String(inputPath || "");
  const expanded = expandHomePath(raw);
  if (expanded !== raw) return expanded;
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(process.cwd(), raw);
}

function pathAutocomplete(line) {
  const raw = String(line || "");
  if (raw === "~") return [["~/"], raw];

  const hasSlash = raw.includes("/");
  const endsWithSlash = raw.endsWith("/");
  const splitIndex = raw.lastIndexOf("/");
  const dirPart = endsWithSlash
    ? raw
    : (hasSlash ? raw.slice(0, splitIndex + 1) : ".");
  const prefix = endsWithSlash ? "" : (hasSlash ? raw.slice(splitIndex + 1) : raw);

  const fsDir = resolveInputPathForAutocomplete(dirPart);
  let entries = [];
  try {
    entries = fs.readdirSync(fsDir, { withFileTypes: true });
  } catch {
    return [[], raw];
  }

  const base = raw.slice(0, raw.length - prefix.length);
  const hits = entries
    .filter((entry) => entry.name.startsWith(prefix))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const suffix = entry.isDirectory() ? "/" : "";
      return `${base}${entry.name}${suffix}`;
    });

  return [hits.length ? hits : [], raw];
}

function readDownloadCodeFromStdin() {
  let data = "";
  try {
    data = fs.readFileSync(0, "utf8");
  } catch {
    throw new Error("Failed to read download code from stdin");
  }
  const firstLine = String(data).split(/\r?\n/, 1)[0]?.trim() || "";
  if (!firstLine) {
    throw new Error("No download code received on stdin");
  }
  return firstLine;
}

async function resolveDownloadCodeHash({
  args,
  configDefaults,
  accessMode,
  persistedHashOverride = undefined,
}) {
  const requiresDownloadCode = accessModeRequiresDownloadCode(accessMode);
  const hasInlineCode = typeof args["download-code"] !== "undefined";
  const useStdinCode = Boolean(args["download-code-stdin"]);

  if (hasInlineCode && useStdinCode) {
    throw new Error("Use exactly one download code input: --download-code or --download-code-stdin");
  }

  let inlineCode = "";
  if (hasInlineCode) {
    if (args["download-code"] === true) {
      throw new Error("--download-code requires a value");
    }
    inlineCode = String(args["download-code"] || "").trim();
    if (!inlineCode) throw new Error("--download-code cannot be empty");
  }

  let stdinCode = "";
  if (useStdinCode) {
    stdinCode = readDownloadCodeFromStdin();
  }

  const persistedHash = persistedHashOverride === undefined
    ? trim(process.env.DOWNLOAD_CODE_HASH || configDefaults.downloadCodeHash || "")
    : trim(persistedHashOverride);

  if (!requiresDownloadCode) {
    if (inlineCode || stdinCode || persistedHash) {
      throw new Error(
        `ACCESS_MODE=${accessMode} does not accept download code input. Remove --download-code/--download-code-stdin and clear DOWNLOAD_CODE_HASH.`,
      );
    }
    return "";
  }

  if (inlineCode) return hashDownloadCode(inlineCode);
  if (stdinCode) return hashDownloadCode(stdinCode);
  if (!persistedHash) {
    throw new Error(
      `ACCESS_MODE=${accessMode} requires a download code. Provide --download-code, --download-code-stdin, or DOWNLOAD_CODE_HASH.`,
    );
  }
  if (!isValidDownloadCodeHash(persistedHash)) {
    throw new Error("Invalid DOWNLOAD_CODE_HASH format");
  }
  return persistedHash;
}

function resolvePublishPrefill({ args, configDefaults }) {
  const accessModeInput = trim(
    args["access-mode"] ||
      process.env.ACCESS_MODE ||
      configDefaults.accessMode ||
      DEFAULT_ACCESS_MODE,
  ).toLowerCase();
  const accessMode = isValidAccessMode(accessModeInput)
    ? accessModeInput
    : DEFAULT_ACCESS_MODE;

  const requiresPayment = accessModeRequiresPayment(accessMode);
  const requiresDownloadCode = accessModeRequiresDownloadCode(accessMode);

  const networkInput = trim(
    args.network || process.env.CHAIN_ID || configDefaults.chainId || "eip155:84532",
  );

  const facilitatorModeInput = trim(
    args["facilitator-mode"] ||
      process.env.FACILITATOR_MODE ||
      configDefaults.facilitatorMode ||
      "testnet",
  ).toLowerCase();
  const facilitatorMode = ALLOWED_FACILITATOR_MODES.has(facilitatorModeInput)
    ? facilitatorModeInput
    : "testnet";

  const facilitatorUrl = trim(
    args["facilitator-url"] ||
      process.env.FACILITATOR_URL ||
      configDefaults.facilitatorUrl ||
      defaultFacilitatorUrlForMode(facilitatorMode),
  );

  const confirmationPolicyInput = trim(
    args["confirmation-policy"] ||
      (args.confirmed
        ? "confirmed"
        : process.env.CONFIRMATION_POLICY || configDefaults.confirmationPolicy || "confirmed"),
  ).toLowerCase();
  const confirmationPolicy = ALLOWED_CONFIRMATION_POLICIES.has(confirmationPolicyInput)
    ? confirmationPolicyInput
    : "confirmed";

  const publicEnabled = Boolean(args.public);
  const endedWindowArg =
    args["ended-window-seconds"] ??
    process.env.ENDED_WINDOW_SECONDS ??
    configDefaults.endedWindowSeconds;
  const endedWindowExplicit =
    endedWindowArg !== undefined && endedWindowArg !== null && String(endedWindowArg) !== "";
  const parsedEndedWindow = parseNonNegativeInt(endedWindowArg);
  const endedWindowSeconds =
    parsedEndedWindow !== null ? parsedEndedWindow : publicEnabled ? 86400 : 0;

  const parsedPort = parsePositiveInt(
    args.port || process.env.PORT || configDefaults.port || 4021,
  );
  const port = parsedPort || 4021;

  return {
    file: trim(args.file || ""),
    accessMode,
    requiresPayment,
    requiresDownloadCode,
    payTo: trim(
      args["pay-to"] || process.env.SELLER_PAY_TO || configDefaults.sellerPayTo || "",
    ),
    price: trim(args.price || process.env.PRICE_USD || configDefaults.priceUsd || "0.01"),
    window: trim(args.window || process.env.WINDOW_SECONDS || configDefaults.window || "1h"),
    networkInput,
    publicEnabled,
    endedWindowSeconds,
    endedWindowExplicit,
    port,
    confirmationPolicy,
    facilitatorMode,
    facilitatorUrl,
    cdpApiKeyId: trim(
      args["cdp-api-key-id"] || process.env.CDP_API_KEY_ID || configDefaults.cdpApiKeyId || "",
    ),
    cdpApiKeySecret: trim(
      args["cdp-api-key-secret"] ||
        process.env.CDP_API_KEY_SECRET ||
        configDefaults.cdpApiKeySecret ||
        "",
    ),
    ogTitle: trim(
      typeof args["og-title"] === "string"
        ? args["og-title"]
        : process.env.OG_TITLE || configDefaults.ogTitle || "",
    ),
    ogDescription: trim(
      typeof args["og-description"] === "string"
        ? args["og-description"]
        : process.env.OG_DESCRIPTION || configDefaults.ogDescription || "",
    ),
    ogImageInput: trim(
      typeof args["og-image-url"] === "string"
        ? args["og-image-url"]
        : process.env.OG_IMAGE_URL || "",
    ),
    downloadCodeHash: trim(
      args["download-code-hash"] ||
        process.env.DOWNLOAD_CODE_HASH ||
        configDefaults.downloadCodeHash ||
        "",
    ),
    rawDownloadCode: trim(
      typeof args["download-code"] === "string" ? args["download-code"] : "",
    ),
  };
}

async function runPublishWizard({ args, configDefaults }) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error("Interactive publish wizard requires a TTY. Use direct flags in non-interactive mode.");
  }

  const prefill = resolvePublishPrefill({ args, configDefaults });
  const filePathRl = readline.createInterface({
    input,
    output,
    completer: pathAutocomplete,
  });
  let state = { ...prefill };

  console.log(outUi.heading("Interactive Publish Wizard"));
  console.log(outUi.muted("Press Enter to keep defaults shown in brackets."));
  console.log(outUi.muted("FILE_PATH supports Tab autocomplete."));
  console.log("");

  try {
    state.file = await askWithDefaultReadline(filePathRl, "FILE_PATH", state.file);
    while (true) {
      state.file = trim(state.file);
      if (!state.file) {
        logError("FILE_PATH is required.");
      } else {
        try {
          resolveAndValidateArtifactPath(state.file, args);
          break;
        } catch (err) {
          logError(err.message || String(err));
        }
      }
      state.file = await askWithDefaultReadline(filePathRl, "FILE_PATH", state.file);
    }
    filePathRl.close();

    state.accessMode = await promptSelect(
      "ACCESS_MODE",
      ACCESS_MODE_VALUES,
      state.accessMode,
    );
    state.requiresPayment = accessModeRequiresPayment(state.accessMode);
    state.requiresDownloadCode = accessModeRequiresDownloadCode(state.accessMode);

    state.rawDownloadCode = "";
    state.downloadCodeHash = state.requiresDownloadCode ? state.downloadCodeHash : "";
    if (
      state.requiresDownloadCode &&
      state.downloadCodeHash &&
      !isValidDownloadCodeHash(state.downloadCodeHash)
    ) {
      logWarn("Existing DOWNLOAD_CODE_HASH is invalid; please enter a new download-code.");
      state.downloadCodeHash = "";
    }
    if (state.requiresDownloadCode) {
      const resolved = await promptMaskedDownloadCode(state.downloadCodeHash);
      state.rawDownloadCode = resolved.raw;
      state.downloadCodeHash = resolved.hashOverride;
    }

    if (state.requiresPayment) {
      state.price = await askWithDefault("PRICE_USD", state.price || "0.01");
      while (!state.price || Number.isNaN(Number(state.price))) {
        logError("PRICE_USD must be numeric.");
        state.price = await askWithDefault("PRICE_USD", state.price || "0.01");
      }
    } else {
      state.price = "0";
    }

    let windowInput = await askWithDefault("WINDOW (e.g. 15m, 1h, 3600)", state.window || "1h");
    let parsedWindowSeconds = parseDurationToSeconds(windowInput);
    while (!parsedWindowSeconds || parsedWindowSeconds <= 0) {
      logError("Invalid WINDOW. Use formats like 15m, 1h, or 3600.");
      windowInput = await askWithDefault("WINDOW (e.g. 15m, 1h, 3600)", windowInput || "1h");
      parsedWindowSeconds = parseDurationToSeconds(windowInput);
    }
    state.window = `${parsedWindowSeconds}s`;

    if (state.requiresPayment) {
      state.payTo = await askWithDefault("SELLER_PAY_TO", state.payTo);
      while (!state.payTo || !isAddress(state.payTo)) {
        if (!state.payTo) logError("SELLER_PAY_TO is required for payment modes.");
        else logError("Invalid SELLER_PAY_TO. Expected a valid Ethereum address.");
        state.payTo = await askWithDefault("SELLER_PAY_TO", state.payTo);
      }
    } else {
      state.payTo = "";
    }

    let networkInput = await askWithDefault("CHAIN_ID", state.networkInput || "eip155:84532");
    while (true) {
      try {
        state.networkInput = resolveSupportedChain(networkInput).caip2;
        break;
      } catch (err) {
        logError(err.message || String(err));
        networkInput = await askWithDefault("CHAIN_ID", networkInput || "eip155:84532");
      }
    }

    state.publicEnabled = await promptYesNo(
      "Expose this publish run via temporary Cloudflare tunnel (--public)?",
      state.publicEnabled,
    );

    const useAdvanced = await promptYesNo(
      "Configure advanced options (facilitator, ports, OG metadata, ended-window)?",
      false,
    );

    if (useAdvanced) {
      if (state.requiresPayment) {
        state.confirmationPolicy = await promptSelect(
          "CONFIRMATION_POLICY",
          ["confirmed", "optimistic"],
          state.confirmationPolicy,
        );
      } else {
        state.confirmationPolicy = "confirmed";
      }

      let portInput = await askWithDefault("PORT", String(state.port || 4021));
      let parsedPort = parsePositiveInt(portInput);
      while (!parsedPort) {
        logError("PORT must be a positive integer.");
        portInput = await askWithDefault("PORT", String(state.port || 4021));
        parsedPort = parsePositiveInt(portInput);
      }
      state.port = parsedPort;

      let endedWindowInput = await askWithDefault(
        "ENDED_WINDOW_SECONDS",
        String(state.endedWindowSeconds),
      );
      let parsedEnded = parseNonNegativeInt(endedWindowInput);
      while (parsedEnded === null) {
        logError("ENDED_WINDOW_SECONDS must be a non-negative integer.");
        endedWindowInput = await askWithDefault(
          "ENDED_WINDOW_SECONDS",
          String(state.endedWindowSeconds),
        );
        parsedEnded = parseNonNegativeInt(endedWindowInput);
      }
      state.endedWindowSeconds = parsedEnded;
      state.endedWindowExplicit = true;

      state.ogTitle = await askWithDefault("OG_TITLE", state.ogTitle);
      state.ogDescription = await askWithDefault("OG_DESCRIPTION", state.ogDescription);
      state.ogImageInput = await askWithDefault(
        "OG_IMAGE_URL (http(s) URL or local file path)",
        state.ogImageInput,
      );

      state.facilitatorMode = await promptSelect(
        "FACILITATOR_MODE",
        ["testnet", "cdp_mainnet"],
        state.facilitatorMode,
      );
      state.facilitatorUrl = await askWithDefault(
        "FACILITATOR_URL",
        state.facilitatorUrl || defaultFacilitatorUrlForMode(state.facilitatorMode),
      );

      if (state.facilitatorMode === "cdp_mainnet") {
        state.cdpApiKeyId = await askWithDefault("CDP_API_KEY_ID", state.cdpApiKeyId);
        while (!state.cdpApiKeyId) {
          logError("CDP_API_KEY_ID is required when FACILITATOR_MODE=cdp_mainnet.");
          state.cdpApiKeyId = await askWithDefault("CDP_API_KEY_ID", state.cdpApiKeyId);
        }
        state.cdpApiKeySecret = await askWithDefault(
          "CDP_API_KEY_SECRET",
          state.cdpApiKeySecret,
        );
        while (!state.cdpApiKeySecret) {
          logError("CDP_API_KEY_SECRET is required when FACILITATOR_MODE=cdp_mainnet.");
          state.cdpApiKeySecret = await askWithDefault(
            "CDP_API_KEY_SECRET",
            state.cdpApiKeySecret,
          );
        }
      }
    } else {
      if (!state.endedWindowExplicit) {
        state.endedWindowSeconds = state.publicEnabled ? 86400 : 0;
      }
    }

    console.log("");
    console.log(outUi.section("Publish Summary"));
    const summaryRows = [
      { key: "file", value: state.file },
      { key: "access_mode", value: state.accessMode },
      { key: "download_code", value: state.requiresDownloadCode ? "required" : "not required" },
      { key: "price", value: `${state.price} USDC` },
      { key: "window", value: state.window },
      { key: "network", value: state.networkInput },
      { key: "public_tunnel", value: state.publicEnabled ? "yes" : "no" },
      state.requiresPayment ? { key: "pay_to", value: state.payTo } : null,
      { key: "facilitator_mode", value: state.facilitatorMode },
      { key: "facilitator_url", value: state.facilitatorUrl },
      {
        key: "confirmation_policy",
        value: state.requiresPayment ? state.confirmationPolicy : "n/a (payment disabled)",
      },
      { key: "port", value: state.port },
      { key: "ended_window_seconds", value: state.endedWindowSeconds },
      state.ogTitle ? { key: "og_title", value: state.ogTitle } : null,
      state.ogDescription ? { key: "og_description", value: state.ogDescription } : null,
      state.ogImageInput ? { key: "og_image_url", value: state.ogImageInput } : null,
    ];
    for (const line of outUi.formatRows(summaryRows)) {
      console.log(line);
    }

    const confirmedLaunch = await promptYesNo("Launch publish with these settings?", true);
    if (!confirmedLaunch) {
      throw new Error("Publish wizard cancelled before launch.");
    }

    const saveDefaults = await promptYesNo(
      "Save these values to ~/.nustuf/config.json as defaults?",
      false,
    );

    let downloadCodeHashForSave = "";
    if (state.requiresDownloadCode) {
      if (state.rawDownloadCode) {
        downloadCodeHashForSave = await hashDownloadCode(state.rawDownloadCode);
      } else {
        downloadCodeHashForSave = state.downloadCodeHash;
      }
    }

    if (saveDefaults) {
      const defaults = {
        ...(configDefaults || {}),
        sellerPayTo: state.requiresPayment
          ? state.payTo
          : trim(configDefaults?.sellerPayTo || ""),
        chainId: state.networkInput,
        facilitatorMode: state.facilitatorMode,
        facilitatorUrl: state.facilitatorUrl,
        cdpApiKeyId: state.cdpApiKeyId,
        cdpApiKeySecret: state.cdpApiKeySecret,
        confirmationPolicy: state.confirmationPolicy,
        priceUsd: state.price,
        window: state.window,
        port: state.port,
        endedWindowSeconds: state.endedWindowSeconds,
        ogTitle: state.ogTitle,
        ogDescription: state.ogDescription,
        accessMode: state.accessMode,
        downloadCodeHash: downloadCodeHashForSave,
      };
      const written = writeConfig({ version: 1, defaults });
      logOk(`Saved defaults: ${written.path}`);
    }

    args.file = state.file;
    args["access-mode"] = state.accessMode;
    args["download-code-hash"] = state.requiresDownloadCode
      ? (state.rawDownloadCode ? "" : state.downloadCodeHash)
      : "";
    if (state.requiresDownloadCode && state.rawDownloadCode) args["download-code"] = state.rawDownloadCode;
    else delete args["download-code"];
    delete args["download-code-stdin"];

    args.price = state.price;
    args.window = state.window;
    args.network = state.networkInput;
    args.port = String(state.port);
    args["ended-window-seconds"] = String(state.endedWindowSeconds);
    args["pay-to"] = state.payTo;
    args.public = state.publicEnabled;
    args["confirmation-policy"] = state.confirmationPolicy;
    if (state.confirmationPolicy === "confirmed") args.confirmed = true;
    else delete args.confirmed;

    args["facilitator-mode"] = state.facilitatorMode;
    args["facilitator-url"] = state.facilitatorUrl;
    args["cdp-api-key-id"] = state.cdpApiKeyId;
    args["cdp-api-key-secret"] = state.cdpApiKeySecret;
    args["og-title"] = state.ogTitle;
    args["og-description"] = state.ogDescription;
    args["og-image-url"] = state.ogImageInput;
  } finally {
    filePathRl.close();
  }
}

function isAbsoluteHttpUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const SUPPORTED_OG_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif"]);

function resolveOgImageInput(value) {
  if (!value) return { ogImageUrl: "", ogImagePath: "" };
  const raw = String(value).trim();
  if (!raw) return { ogImageUrl: "", ogImagePath: "" };

  if (isAbsoluteHttpUrl(raw)) {
    return { ogImageUrl: raw, ogImagePath: "" };
  }

  const localPath = resolveFile(raw);
  if (!fs.existsSync(localPath)) {
    throw new Error("Invalid --og-image-url (must be an absolute http(s) URL or a valid local image file path)");
  }

  let stat;
  try {
    stat = fs.statSync(localPath);
  } catch {
    throw new Error("Invalid --og-image-url (must be an absolute http(s) URL or a valid local image file path)");
  }

  if (!stat.isFile()) {
    throw new Error("Invalid --og-image-url (must be an absolute http(s) URL or a valid local image file path)");
  }

  const ext = path.extname(localPath).toLowerCase();
  if (!SUPPORTED_OG_IMAGE_EXTENSIONS.has(ext)) {
    throw new Error("Invalid --og-image-url (must be an absolute http(s) URL or a valid local image file path)");
  }

  return { ogImageUrl: "", ogImagePath: localPath };
}

function cloudflaredPreflight() {
  const probe = spawnSync("cloudflared", ["--version"], { stdio: "ignore" });
  if (!probe.error && probe.status === 0) return { ok: true };

  const missing = probe.error?.code === "ENOENT";
  return {
    ok: false,
    missing,
    reason: missing
      ? "cloudflared is not installed or not on PATH."
      : `cloudflared check failed (status=${probe.status ?? "n/a"}).`,
  };
}

function printCloudflaredInstallHelp(localOnlyCmd) {
  logError("--public requested, but cloudflared is unavailable.");
  logWarn("cloudflared is required to create a public tunnel URL.");
  console.error("");
  console.error(errUi.section("Install cloudflared"));
  console.error("  macOS (Homebrew): brew install cloudflared");
  console.error("  Windows (winget): winget install --id Cloudflare.cloudflared");
  console.error("  Linux packages/docs: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/");
  console.error("");
  console.error(errUi.section("Retry"));
  console.error("  nustuf --file <path> --pay-to <address> --public");
  console.error("");
  console.error(errUi.section("Local-only Alternative (No Tunnel)"));
  console.error(`  ${localOnlyCmd}`);
}

function parseDurationToSeconds(s) {
  if (!s) return null;
  const str = String(s).trim().toLowerCase();

  // Allow: "1 hour", "60 minutes", etc.
  const spaced = str.replace(/\s+/g, "");

  // Raw seconds: "3600"
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

function expandHomePath(inputPath) {
  const raw = String(inputPath || "");
  const home = process.env.HOME || "";
  if (!home) return raw;
  if (raw === "~") return home;
  if (raw.startsWith("~/")) return path.join(home, raw.slice(2));
  return raw;
}

function resolveFile(p) {
  const expanded = expandHomePath(p);
  const abs = path.isAbsolute(expanded) ? expanded : path.resolve(process.cwd(), expanded);
  return abs;
}

function normalizePathForCompare(p) {
  return path.resolve(p);
}

function isPathInside(candidate, root) {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function sensitiveRoots() {
  const roots = [...ABSOLUTE_SENSITIVE_PATHS];
  const home = process.env.HOME ? path.resolve(process.env.HOME) : "";
  if (home) {
    roots.push(path.join(home, ".ssh"));
    roots.push(path.join(home, ".aws"));
    roots.push(path.join(home, ".gnupg"));
    roots.push(path.join(home, ".config", "gcloud"));
  }
  const out = new Set();
  for (const root of roots.map(normalizePathForCompare)) {
    out.add(root);
    try {
      out.add(normalizePathForCompare(fs.realpathSync(root)));
    } catch {}
  }
  return [...out];
}

function firstMatchingSensitiveRoot(artifactPath) {
  const normalizedArtifactPath = normalizePathForCompare(artifactPath);
  for (const root of sensitiveRoots()) {
    if (isPathInside(normalizedArtifactPath, root)) return root;
  }
  return null;
}

function resolveAndValidateArtifactPath(fileArg, args) {
  const artifactPath = resolveFile(fileArg);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`File not found: ${artifactPath}`);
  }

  const st = fs.lstatSync(artifactPath);
  if (st.isSymbolicLink()) {
    throw new Error(`Refusing symlink artifact path: ${artifactPath}`);
  }
  if (!st.isFile()) {
    throw new Error(`Artifact must be a regular file (directories are not allowed): ${artifactPath}`);
  }

  const resolvedArtifactPath = fs.realpathSync(artifactPath);
  const allowSensitivePath = Boolean(args["allow-sensitive-path"]);
  const acknowledgeSensitivePathRisk = Boolean(args["acknowledge-sensitive-path-risk"]);
  if (allowSensitivePath !== acknowledgeSensitivePathRisk) {
    throw new Error("Sensitive-path override requires both --allow-sensitive-path and --acknowledge-sensitive-path-risk");
  }

  const sensitiveRoot = firstMatchingSensitiveRoot(resolvedArtifactPath);
  if (sensitiveRoot && !allowSensitivePath) {
    throw new Error(
      `Refusing sensitive artifact path (${resolvedArtifactPath}). To override intentionally, pass --allow-sensitive-path --acknowledge-sensitive-path-risk.`,
    );
  }

  return resolvedArtifactPath;
}

async function ensurePublicExposureConfirmed(args) {
  if (!args.public) return;

  const provided = typeof args["public-confirm"] === "string" ? args["public-confirm"].trim() : "";
  if (provided) {
    if (provided !== PUBLIC_CONFIRM_PHRASE) {
      throw new Error(`Invalid --public-confirm value. Expected exactly: ${PUBLIC_CONFIRM_PHRASE}`);
    }
    return;
  }

  if (!input.isTTY || !output.isTTY) {
    throw new Error(`--public requires --public-confirm ${PUBLIC_CONFIRM_PHRASE} in non-interactive mode`);
  }

  const rl = readline.createInterface({ input, output });
  try {
    logWarn("You are about to expose a local file to the public internet.");
    const answer = (await rl.question(`[nustuf] Type ${PUBLIC_CONFIRM_PHRASE} to continue: `)).trim();
    if (answer !== PUBLIC_CONFIRM_PHRASE) {
      throw new Error("Public exposure confirmation failed. Aborting.");
    }
  } finally {
    rl.close();
  }
}

async function promptMissing({ price, windowSeconds, requiresPayment }) {
  const rl = readline.createInterface({ input, output });
  try {
    let p = requiresPayment ? price : (price || "0");
    if (requiresPayment) {
      if (!p) {
        p = (await rl.question("How much (USDC)? e.g. 0.01 or $0.01: ")).trim();
      }
      p = String(p).trim();
      if (p.startsWith("$")) p = p.slice(1).trim();
      if (!p || Number.isNaN(Number(p))) throw new Error("Invalid price");
    } else {
      p = "0";
    }

    let w = windowSeconds;
    if (!w) {
      w = (await rl.question("How long? (e.g. 15m / 1h / 3600): ")).trim();
    }
    const secs = parseDurationToSeconds(w);
    if (!secs || secs <= 0) throw new Error("Invalid duration");

    return { price: String(p), windowSeconds: secs };
  } finally {
    rl.close();
  }
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function toIsoSeconds(ts) {
  return new Date(Number(ts) * 1000).toISOString();
}

function bestEffortChmod(targetPath, mode) {
  try {
    fs.chmodSync(targetPath, mode);
  } catch {
    // best effort only
  }
}

function getRunsDirPath() {
  const home = process.env.HOME || os.homedir();
  return path.join(home, RUNS_DIR);
}

function ensureRunsDir() {
  const runsDir = getRunsDirPath();
  fs.mkdirSync(runsDir, { recursive: true });
  bestEffortChmod(runsDir, 0o700);
  return runsDir;
}

function createRunStatePaths(runId) {
  const runsDir = ensureRunsDir();
  return {
    runsDir,
    statePath: path.join(runsDir, `${runId}.json`),
    latestPath: path.join(runsDir, "latest.json"),
  };
}

function persistRunState(paths, runState) {
  const nextState = {
    ...runState,
    updatedAtTs: nowSeconds(),
  };
  const serialized = `${JSON.stringify(nextState, null, 2)}\n`;
  fs.writeFileSync(paths.statePath, serialized, { mode: 0o600 });
  bestEffortChmod(paths.statePath, 0o600);

  const latest = {
    runId: nextState.runId,
    statePath: paths.statePath,
    status: nextState.status,
    updatedAtTs: nextState.updatedAtTs,
  };
  fs.writeFileSync(paths.latestPath, `${JSON.stringify(latest, null, 2)}\n`, { mode: 0o600 });
  bestEffortChmod(paths.latestPath, 0o600);
  return nextState;
}

function computeRestartDelayMs(restartCount) {
  const baseMs = 1000;
  const capped = Math.min(30000, baseMs * 2 ** Math.max(0, restartCount - 1));
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.max(250, Math.floor(capped * jitter));
}

function sleepWithCancel(ms, registerCancel) {
  const durationMs = Math.max(0, Number(ms) || 0);
  return new Promise((resolve) => {
    if (!durationMs) {
      registerCancel?.(null);
      resolve();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      registerCancel?.(null);
      resolve();
    };
    const timer = setTimeout(finish, durationMs);
    registerCancel?.(() => {
      clearTimeout(timer);
      finish();
    });
  });
}

function runWorkerOnce({
  args,
  port,
  env,
  remainingUntilHardStopSeconds,
  registerManualStop,
  onTunnelUrls,
}) {
  return new Promise((resolve) => {
    let settled = false;
    let stopReason = "";
    let tunnelFatalDetail = "";
    let tunnelProc = null;
    let stopTimer = null;

    const child = spawn(process.execPath, [SERVER_ENTRY], {
      env,
      cwd: path.resolve(__dirname, ".."),
      stdio: ["ignore", "inherit", "inherit"],
      detached: false,
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (stopTimer) clearTimeout(stopTimer);
      registerManualStop(null);
      try {
        tunnelProc?.kill("SIGTERM");
      } catch {}
      resolve(result);
    };

    const stopAll = (reason) => {
      if (stopReason) return;
      stopReason = reason;
      try {
        child.kill("SIGTERM");
      } catch {}
      try {
        tunnelProc?.kill("SIGTERM");
      } catch {}
    };

    registerManualStop(() => stopAll("manual_stop"));

    child.on("error", (err) => {
      finish({ reason: "child_crash", detail: `failed to start server process: ${err.message}` });
    });

    if (args.public) {
      logInfo("Starting Cloudflare quick tunnel...");
      tunnelProc = spawn(
        "cloudflared",
        ["tunnel", "--url", `http://localhost:${port}`, "--no-autoupdate"],
        { stdio: ["ignore", "pipe", "pipe"] },
      );

      tunnelProc.on("error", (err) => {
        if (err.code === "ENOENT") {
          tunnelFatalDetail = "cloudflared not found. Install it or re-run without --public.";
        } else {
          tunnelFatalDetail = `failed to start tunnel: ${err.message}`;
        }
        stopAll("tunnel_fatal");
      });

      const urlRegex = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi;
      const onData = (chunk) => {
        const s = chunk.toString("utf8");
        const m = s.match(urlRegex);
        if (m && m[0]) {
          const publicUrl = m[0];
          const promoUrl = `${publicUrl}/`;
          const buyUrl = `${publicUrl}/download`;
          console.log("");
          console.log(outUi.section("Public Tunnel"));
          for (const line of outUi.formatRows([
            { key: "public_url", value: outUi.link(publicUrl) },
            { key: "promo_link", value: outUi.link(promoUrl) },
            { key: "buy_link", value: outUi.link(buyUrl) },
          ])) {
            console.log(line);
          }
          onTunnelUrls?.({ publicUrl, promoUrl, buyUrl });
          tunnelProc?.stdout?.off("data", onData);
          tunnelProc?.stderr?.off("data", onData);
        }
      };

      tunnelProc.stdout.on("data", onData);
      tunnelProc.stderr.on("data", onData);

      tunnelProc.on("exit", (code, signal) => {
        if (stopReason) {
          if (signal) logWarn(`Tunnel exited (signal ${signal})`);
          else logInfo(`Tunnel exited (code ${code})`);
          return;
        }
        tunnelFatalDetail = signal
          ? `tunnel exited unexpectedly (signal ${signal})`
          : `tunnel exited unexpectedly (code ${code})`;
        stopAll("tunnel_fatal");
      });
    }

    stopTimer = setTimeout(
      () => stopAll("deadline_stop"),
      Math.max(0, remainingUntilHardStopSeconds) * 1000,
    );

    child.on("exit", (code, signal) => {
      if (stopReason === "manual_stop") {
        finish({ reason: "manual_stop" });
        return;
      }
      if (stopReason === "deadline_stop") {
        finish({ reason: "normal_window_stop" });
        return;
      }
      if (stopReason === "tunnel_fatal") {
        finish({
          reason: "tunnel_fatal",
          detail: tunnelFatalDetail || "public tunnel failed unexpectedly",
        });
        return;
      }
      if (signal) {
        finish({ reason: "child_crash", detail: `server exited unexpectedly (signal ${signal})` });
        return;
      }
      finish({ reason: "child_crash", detail: `server exited unexpectedly (code ${code ?? "n/a"})` });
    });
  });
}

async function supervisorMain({
  args,
  port,
  envBase,
  saleStartTsFixed,
  saleEndTsFixed,
  hardStopTsFixed,
  effectiveEndedWindowSeconds,
  runStatePaths,
  runState,
}) {
  console.log("");
  console.log(outUi.section("Supervisor"));
  for (const line of outUi.formatRows([
    { key: "run_id", value: runState.runId },
    { key: "state_file", value: runStatePaths.statePath },
    { key: "sale_end", value: toIsoSeconds(saleEndTsFixed) },
    { key: "hard_stop", value: toIsoSeconds(hardStopTsFixed) },
  ])) {
    console.log(line);
  }

  let manualStopRequested = false;
  let activeManualStop = null;
  let pendingDelayCancel = null;

  const handleSignal = (signalName) => {
    if (manualStopRequested) return;
    manualStopRequested = true;
    logWarn(`Received ${signalName}; stopping supervisor...`);
    if (typeof activeManualStop === "function") activeManualStop();
    if (typeof pendingDelayCancel === "function") pendingDelayCancel();
  };
  const onSigInt = () => handleSignal("SIGINT");
  const onSigTerm = () => handleSignal("SIGTERM");
  process.on("SIGINT", onSigInt);
  process.on("SIGTERM", onSigTerm);

  try {
    while (true) {
      const nowTs = nowSeconds();
      const remainingSaleSeconds = Math.max(0, saleEndTsFixed - nowTs);
      const remainingUntilHardStopSeconds = Math.max(0, hardStopTsFixed - nowTs);

      if (remainingUntilHardStopSeconds <= 0) {
        runState.status = "stopped";
        runState.lastExitReason = "normal_window_stop";
        runState = persistRunState(runStatePaths, runState);
        if (effectiveEndedWindowSeconds > 0) {
          logInfo(`Ended-window elapsed (${effectiveEndedWindowSeconds}s after sale end). stopping...`);
        } else {
          logInfo(`Window expired. stopping...`);
        }
        return 0;
      }

      const env = {
        ...envBase,
        WINDOW_SECONDS: String(remainingSaleSeconds),
        SALE_START_TS: String(saleStartTsFixed),
        SALE_END_TS: String(saleEndTsFixed),
        ENDED_WINDOW_SECONDS: String(effectiveEndedWindowSeconds),
      };

      const result = await runWorkerOnce({
        args,
        port,
        env,
        remainingUntilHardStopSeconds,
        registerManualStop: (nextStop) => {
          activeManualStop = typeof nextStop === "function" ? nextStop : null;
        },
        onTunnelUrls: (urls) => {
          runState.latestPublicUrl = urls.publicUrl;
          runState.latestPromoUrl = urls.promoUrl;
          runState.latestBuyUrl = urls.buyUrl;
          runState = persistRunState(runStatePaths, runState);
        },
      });
      activeManualStop = null;
      runState.lastExitReason = result.reason;
      runState = persistRunState(runStatePaths, runState);

      if (manualStopRequested || result.reason === "manual_stop") {
        runState.status = "stopped";
        runState.lastExitReason = "manual_stop";
        runState = persistRunState(runStatePaths, runState);
        logInfo("Stopped by user request.");
        return 0;
      }

      if (result.reason === "normal_window_stop") {
        runState.status = "stopped";
        runState = persistRunState(runStatePaths, runState);
        if (effectiveEndedWindowSeconds > 0) {
          logInfo(`Ended-window elapsed (${effectiveEndedWindowSeconds}s after sale end). stopping...`);
        } else {
          logInfo("Window expired. stopping...");
        }
        return 0;
      }

      if (result.reason === "child_crash" || result.reason === "tunnel_fatal") {
        runState.restartCount += 1;
        runState.status = "running";
        runState = persistRunState(runStatePaths, runState);

        const remainingSeconds = Math.max(0, hardStopTsFixed - nowSeconds());
        if (remainingSeconds <= 0) {
          runState.status = "stopped";
          runState.lastExitReason = "normal_window_stop";
          runState = persistRunState(runStatePaths, runState);
          logInfo("Hard-stop deadline reached. stopping...");
          return 0;
        }

        const requestedDelayMs = computeRestartDelayMs(runState.restartCount);
        const delayMs = Math.min(requestedDelayMs, remainingSeconds * 1000);
        const detailSuffix = result.detail ? `: ${result.detail}` : "";
        logWarn(
          `Worker exited (${result.reason}${detailSuffix}). Restarting in ${(delayMs / 1000).toFixed(1)}s...`,
        );
        await sleepWithCancel(delayMs, (cancel) => {
          pendingDelayCancel = cancel;
        });
        pendingDelayCancel = null;
        if (manualStopRequested) {
          runState.status = "stopped";
          runState.lastExitReason = "manual_stop";
          runState = persistRunState(runStatePaths, runState);
          logInfo("Stopped by user request.");
          return 0;
        }
        continue;
      }

      runState.status = "failed";
      runState.lastExitReason = result.reason || "config_fatal";
      runState = persistRunState(runStatePaths, runState);
      logError(`Supervisor failed with non-retriable reason: ${runState.lastExitReason}`);
      return 1;
    }
  } finally {
    process.off("SIGINT", onSigInt);
    process.off("SIGTERM", onSigTerm);
    if (typeof activeManualStop === "function") activeManualStop();
    if (typeof pendingDelayCancel === "function") pendingDelayCancel();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const storedConfig = readConfig();
  if (storedConfig.error) {
    logWarn(storedConfig.error);
  }
  const configDefaults = storedConfig.config.defaults || {};

  if (args.wizard) {
    try {
      await runPublishWizard({ args, configDefaults });
    } catch (err) {
      logError(err.message || String(err));
      process.exit(1);
    }
  }

  const fileArg = args.file;
  if (!fileArg) {
    const positionalPath = args._?.[0];
    if (positionalPath) {
      usageAndExit(
        1,
        `Expected '--file <path>', but got positional '${positionalPath}'. If using npm scripts, run: npm run nustuf -- --file ${positionalPath}`,
      );
    }
    usageAndExit(1);
  }

  let artifactPath;
  try {
    artifactPath = resolveAndValidateArtifactPath(fileArg, args);
  } catch (err) {
    logError(err.message || String(err));
    process.exit(1);
  }

  const accessModeInput = String(
    args["access-mode"] || process.env.ACCESS_MODE || configDefaults.accessMode || DEFAULT_ACCESS_MODE,
  ).trim().toLowerCase();
  if (!isValidAccessMode(accessModeInput)) {
    logError(`Invalid --access-mode value: ${accessModeInput}`);
    logError(`Supported access modes: ${ACCESS_MODE_VALUES.join(", ")}`);
    process.exit(1);
  }
  const accessMode = accessModeInput;
  const requiresPayment = accessModeRequiresPayment(accessMode);
  const requiresDownloadCode = accessModeRequiresDownloadCode(accessMode);

  let downloadCodeHash;
  try {
    downloadCodeHash = await resolveDownloadCodeHash({
      args,
      configDefaults,
      accessMode,
      persistedHashOverride: args["download-code-hash"],
    });
  } catch (err) {
    logError(err.message || String(err));
    process.exit(1);
  }

  const payTo = String(args["pay-to"] || process.env.SELLER_PAY_TO || configDefaults.sellerPayTo || "").trim();
  if (requiresPayment && !payTo) {
    logError("Missing --pay-to, SELLER_PAY_TO in env, or sellerPayTo in ~/.nustuf/config.json");
    process.exit(1);
  }
  if (requiresPayment && payTo && !isAddress(payTo)) {
    logError(`Invalid seller payout address: ${payTo}`);
    logError("Expected a valid Ethereum address (0x + 40 hex chars).");
    process.exit(1);
  }

  const networkInput = args.network || process.env.CHAIN_ID || configDefaults.chainId || "eip155:84532";
  let network;
  let networkName;
  try {
    const networkMeta = resolveSupportedChain(networkInput);
    network = networkMeta.caip2;
    networkName = networkMeta.name;
  } catch (err) {
    logError(err.message || String(err));
    process.exit(1);
  }
  const port = Number(args.port || process.env.PORT || configDefaults.port || 4021);
  if (!Number.isFinite(port) || !Number.isInteger(port) || port <= 0) {
    logError("Invalid --port (must be a positive integer)");
    process.exit(1);
  }
  const facilitatorMode = trim(
    args["facilitator-mode"] ||
      process.env.FACILITATOR_MODE ||
      configDefaults.facilitatorMode ||
      "testnet",
  ).toLowerCase();
  if (requiresPayment && !ALLOWED_FACILITATOR_MODES.has(facilitatorMode)) {
    logError("Invalid FACILITATOR_MODE. Use: testnet or cdp_mainnet");
    process.exit(1);
  }
  const effectiveFacilitatorMode = ALLOWED_FACILITATOR_MODES.has(facilitatorMode)
    ? facilitatorMode
    : "testnet";
  const facilitatorUrl = (
    args["facilitator-url"] ||
    process.env.FACILITATOR_URL ||
    configDefaults.facilitatorUrl ||
    defaultFacilitatorUrlForMode(effectiveFacilitatorMode)
  ).trim();
  const cdpApiKeyId = trim(
    args["cdp-api-key-id"] || process.env.CDP_API_KEY_ID || configDefaults.cdpApiKeyId || "",
  );
  const cdpApiKeySecret = trim(
    args["cdp-api-key-secret"] ||
      process.env.CDP_API_KEY_SECRET ||
      configDefaults.cdpApiKeySecret ||
      "",
  );

  const confirmationPolicyInput = trim(
    args["confirmation-policy"] ||
      (args.confirmed
        ? "confirmed"
        : process.env.CONFIRMATION_POLICY || configDefaults.confirmationPolicy || "confirmed"),
  ).toLowerCase();
  if (requiresPayment && !ALLOWED_CONFIRMATION_POLICIES.has(confirmationPolicyInput)) {
    logError("Invalid confirmation policy. Use: confirmed or optimistic");
    process.exit(1);
  }
  const confirmationPolicy = ALLOWED_CONFIRMATION_POLICIES.has(confirmationPolicyInput)
    ? confirmationPolicyInput
    : "confirmed";
  const ogTitle = typeof args["og-title"] === "string"
    ? args["og-title"]
    : (process.env.OG_TITLE || configDefaults.ogTitle);
  const ogDescription = typeof args["og-description"] === "string"
    ? args["og-description"]
    : (process.env.OG_DESCRIPTION || configDefaults.ogDescription);
  const ogImageInput = typeof args["og-image-url"] === "string"
    ? args["og-image-url"]
    : process.env.OG_IMAGE_URL;
  const endedWindowArg = args["ended-window-seconds"] ?? process.env.ENDED_WINDOW_SECONDS ?? configDefaults.endedWindowSeconds;
  const defaultEndedWindowSeconds = args.public ? 86400 : 0;
  const endedWindowSeconds = parseNonNegativeInt(endedWindowArg);

  const price = requiresPayment
    ? (args.price || process.env.PRICE_USD || configDefaults.priceUsd)
    : "0";
  const windowRaw = args.window || process.env.WINDOW_SECONDS || configDefaults.window;
  const windowSeconds = typeof windowRaw === "string" ? parseDurationToSeconds(windowRaw) : Number(windowRaw);

  const prompted = await promptMissing({
    price,
    windowSeconds: windowSeconds || null,
    requiresPayment,
  });

  if (endedWindowArg !== undefined && endedWindowSeconds === null) {
    logError("Invalid --ended-window-seconds (must be a non-negative integer)");
    process.exit(1);
  }

  let ogImageResolved;
  try {
    ogImageResolved = resolveOgImageInput(ogImageInput);
  } catch (err) {
    logError(err.message || String(err));
    process.exit(1);
  }

  const saleStartTsFixed = nowSeconds();
  const saleEndTsFixed = saleStartTsFixed + prompted.windowSeconds;
  const effectiveEndedWindowSeconds = endedWindowSeconds ?? defaultEndedWindowSeconds;
  const hardStopTsFixed = saleEndTsFixed + effectiveEndedWindowSeconds;

  try {
    await ensurePublicExposureConfirmed(args);
  } catch (err) {
    logError(err.message || String(err));
    process.exit(1);
  }

  // Spawn the server with explicit env so there's no confusion.
  const envBase = {
    ...process.env,
    PORT: String(port),
    SELLER_PAY_TO: payTo,
    PRICE_USD: String(prompted.price),
    ACCESS_MODE: accessMode,
    DOWNLOAD_CODE_HASH: downloadCodeHash,
    CHAIN_ID: String(network),
    FACILITATOR_MODE: effectiveFacilitatorMode,
    FACILITATOR_URL: facilitatorUrl,
    CDP_API_KEY_ID: cdpApiKeyId,
    CDP_API_KEY_SECRET: cdpApiKeySecret,
    WINDOW_SECONDS: String(prompted.windowSeconds),
    CONFIRMATION_POLICY: confirmationPolicy,
    ARTIFACT_PATH: artifactPath,
    OG_TITLE: ogTitle || "",
    OG_DESCRIPTION: ogDescription || "",
    OG_IMAGE_URL: ogImageResolved.ogImageUrl || "",
    OG_IMAGE_PATH: ogImageResolved.ogImagePath || "",
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || "",
  };

  console.log("");
  console.log(outUi.section("Leak Config"));
  const runtimeRows = [
    { key: "file", value: artifactPath },
    { key: "price", value: `${prompted.price} USDC` },
    { key: "window", value: `${prompted.windowSeconds}s` },
    { key: "access_mode", value: accessMode },
    { key: "download_code", value: requiresDownloadCode ? "required" : "not required" },
    requiresPayment
      ? { key: "to", value: payTo }
      : (payTo ? { key: "to", value: `${payTo} (ignored: payment disabled by access mode)` } : null),
    { key: "net", value: `${network} (${networkName})` },
    {
      key: "settlement",
      value: requiresPayment ? confirmationPolicy : "n/a (payment disabled)",
    },
    { key: "facilitator_mode", value: effectiveFacilitatorMode },
    { key: "facilitator_url", value: facilitatorUrl },
    ogTitle ? { key: "og_title", value: ogTitle } : null,
    ogDescription ? { key: "og_description", value: ogDescription } : null,
    ogImageResolved.ogImageUrl ? { key: "og_image_url", value: ogImageResolved.ogImageUrl } : null,
    ogImageResolved.ogImagePath ? { key: "og_image_path", value: ogImageResolved.ogImagePath } : null,
    { key: "ended_window", value: `${effectiveEndedWindowSeconds}s` },
  ];
  for (const line of outUi.formatRows(runtimeRows)) {
    console.log(line);
  }

  if (args.public) {
    const preflight = cloudflaredPreflight();
    if (!preflight.ok) {
      const localOnlyCmd = `nustuf --file ${JSON.stringify(artifactPath)} --access-mode ${accessMode} --price ${prompted.price} --window ${prompted.windowSeconds}s${requiresPayment ? ` --pay-to ${payTo}` : ""} --network ${network}${requiresPayment && confirmationPolicy === "confirmed" ? " --confirmed" : ""}${Number.isFinite(port) && port !== 4021 ? ` --port ${port}` : ""}${effectiveEndedWindowSeconds > 0 ? ` --ended-window-seconds ${effectiveEndedWindowSeconds}` : ""}`;
      printCloudflaredInstallHelp(localOnlyCmd);
      if (requiresDownloadCode) {
        logWarn("Local mode still requires download-code input or DOWNLOAD_CODE_HASH.");
      }
      if (!preflight.missing) {
        logWarn(`detail: ${preflight.reason}`);
      }
      const runId = randomUUID();
      const runStatePaths = createRunStatePaths(runId);
      let runState = {
        runId,
        createdAtTs: nowSeconds(),
        updatedAtTs: nowSeconds(),
        saleStartTs: saleStartTsFixed,
        saleEndTs: saleEndTsFixed,
        hardStopTs: hardStopTsFixed,
        endedWindowSeconds: effectiveEndedWindowSeconds,
        restartCount: 0,
        latestPublicUrl: null,
        latestPromoUrl: null,
        latestBuyUrl: null,
        status: "failed",
        lastExitReason: "config_fatal",
      };
      runState = persistRunState(runStatePaths, runState);
      process.exit(1);
    }
  }

  const runId = randomUUID();
  const runStatePaths = createRunStatePaths(runId);
  let runState = {
    runId,
    createdAtTs: nowSeconds(),
    updatedAtTs: nowSeconds(),
    saleStartTs: saleStartTsFixed,
    saleEndTs: saleEndTsFixed,
    hardStopTs: hardStopTsFixed,
    endedWindowSeconds: effectiveEndedWindowSeconds,
    restartCount: 0,
    latestPublicUrl: null,
    latestPromoUrl: null,
    latestBuyUrl: null,
    status: "running",
    lastExitReason: "",
  };
  runState = persistRunState(runStatePaths, runState);

  const exitCode = await supervisorMain({
    args,
    port,
    envBase,
    saleStartTsFixed,
    saleEndTsFixed,
    hardStopTsFixed,
    effectiveEndedWindowSeconds,
    runStatePaths,
    runState,
  });
  process.exit(exitCode);
}

main().catch((e) => {
  const detail = e?.stack || e?.message || String(e);
  logError(detail);
  process.exit(1);
});
