import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isValidAccessMode,
  DEFAULT_ACCESS_MODE,
} from "../src/access_mode.js";
import { isValidDownloadCodeHash } from "../src/download_code.js";

export const CONFIG_VERSION = 1;
export const DEFAULT_TESTNET_FACILITATOR_URL = "https://x402.org/facilitator";
export const DEFAULT_CDP_MAINNET_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";

const CONFIG_DIRNAME = ".nustuf";
const CONFIG_FILENAME = "config.json";
const ALLOWED_FACILITATOR_MODES = new Set(["testnet", "cdp_mainnet"]);
const ALLOWED_CONFIRMATION_POLICIES = new Set(["confirmed", "optimistic"]);

function trimString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function parsePositiveInt(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

function parseNonNegativeInt(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

function bestEffortChmod(targetPath, mode) {
  try {
    fs.chmodSync(targetPath, mode);
  } catch {
    // best effort only
  }
}

function userHomeDir() {
  return process.env.HOME || os.homedir();
}

export function getConfigPath() {
  return path.join(userHomeDir(), CONFIG_DIRNAME, CONFIG_FILENAME);
}

export function defaultFacilitatorUrlForMode(mode) {
  return mode === "cdp_mainnet"
    ? DEFAULT_CDP_MAINNET_FACILITATOR_URL
    : DEFAULT_TESTNET_FACILITATOR_URL;
}

function normalizeDefaults(rawDefaults) {
  const defaults = {};
  if (!rawDefaults || typeof rawDefaults !== "object") return defaults;

  const sellerPayTo = trimString(rawDefaults.sellerPayTo);
  if (sellerPayTo) defaults.sellerPayTo = sellerPayTo;

  const chainId = trimString(rawDefaults.chainId);
  if (chainId) defaults.chainId = chainId;

  const facilitatorMode = trimString(rawDefaults.facilitatorMode);
  if (ALLOWED_FACILITATOR_MODES.has(facilitatorMode)) {
    defaults.facilitatorMode = facilitatorMode;
  }

  const facilitatorUrl = trimString(rawDefaults.facilitatorUrl);
  if (facilitatorUrl) defaults.facilitatorUrl = facilitatorUrl;

  const cdpApiKeyId = trimString(rawDefaults.cdpApiKeyId);
  if (cdpApiKeyId) defaults.cdpApiKeyId = cdpApiKeyId;

  const cdpApiKeySecret = trimString(rawDefaults.cdpApiKeySecret);
  if (cdpApiKeySecret) defaults.cdpApiKeySecret = cdpApiKeySecret;

  const confirmationPolicy = trimString(rawDefaults.confirmationPolicy);
  if (ALLOWED_CONFIRMATION_POLICIES.has(confirmationPolicy)) {
    defaults.confirmationPolicy = confirmationPolicy;
  }

  const priceUsd = trimString(rawDefaults.priceUsd);
  if (priceUsd) defaults.priceUsd = priceUsd;

  const window = trimString(rawDefaults.window);
  if (window) defaults.window = window;

  const port = parsePositiveInt(rawDefaults.port);
  if (port !== undefined) defaults.port = port;

  const endedWindowSeconds = parseNonNegativeInt(rawDefaults.endedWindowSeconds);
  if (endedWindowSeconds !== undefined) defaults.endedWindowSeconds = endedWindowSeconds;

  const ogTitle = trimString(rawDefaults.ogTitle);
  if (ogTitle) defaults.ogTitle = ogTitle;

  const ogDescription = trimString(rawDefaults.ogDescription);
  if (ogDescription) defaults.ogDescription = ogDescription;

  const accessMode = trimString(rawDefaults.accessMode).toLowerCase();
  if (isValidAccessMode(accessMode)) {
    defaults.accessMode = accessMode;
  }

  const downloadCodeHash = trimString(rawDefaults.downloadCodeHash);
  if (downloadCodeHash && isValidDownloadCodeHash(downloadCodeHash)) {
    defaults.downloadCodeHash = downloadCodeHash;
  }

  if (defaults.facilitatorMode && !defaults.facilitatorUrl) {
    defaults.facilitatorUrl = defaultFacilitatorUrlForMode(defaults.facilitatorMode);
  }

  if (!defaults.accessMode) {
    defaults.accessMode = DEFAULT_ACCESS_MODE;
  }

  return defaults;
}

export function normalizeConfig(rawConfig) {
  const normalized = {
    version: CONFIG_VERSION,
    defaults: {},
  };

  if (!rawConfig || typeof rawConfig !== "object") return normalized;
  normalized.defaults = normalizeDefaults(rawConfig.defaults);
  return normalized;
}

export function readConfig() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return {
      path: configPath,
      exists: false,
      config: normalizeConfig(null),
      error: null,
    };
  }

  let rawText;
  try {
    rawText = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    return {
      path: configPath,
      exists: true,
      config: normalizeConfig(null),
      error: `unable to read config: ${err.message || String(err)}`,
    };
  }

  try {
    const parsed = JSON.parse(rawText);
    return {
      path: configPath,
      exists: true,
      config: normalizeConfig(parsed),
      error: null,
    };
  } catch (err) {
    return {
      path: configPath,
      exists: true,
      config: normalizeConfig(null),
      error: `unable to parse config JSON: ${err.message || String(err)}`,
    };
  }
}

export function writeConfig(nextConfig) {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  const normalized = normalizeConfig(nextConfig);

  fs.mkdirSync(configDir, { recursive: true });
  bestEffortChmod(configDir, 0o700);

  fs.writeFileSync(configPath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  bestEffortChmod(configPath, 0o600);

  return {
    path: configPath,
    config: normalized,
  };
}

function redactSecret(value) {
  const raw = trimString(value);
  if (!raw) return "";
  if (raw.length <= 4) return "*".repeat(raw.length);
  return `${"*".repeat(raw.length - 4)}${raw.slice(-4)}`;
}

export function redactConfig(config) {
  const normalized = normalizeConfig(config);
  const copy = JSON.parse(JSON.stringify(normalized));

  if (copy.defaults.cdpApiKeySecret) {
    copy.defaults.cdpApiKeySecret = redactSecret(copy.defaults.cdpApiKeySecret);
  }

  if (copy.defaults.cdpApiKeyId) {
    copy.defaults.cdpApiKeyId = redactSecret(copy.defaults.cdpApiKeyId);
  }

  if (copy.defaults.downloadCodeHash) {
    copy.defaults.downloadCodeHash = redactSecret(copy.defaults.downloadCodeHash);
  }

  return copy;
}
