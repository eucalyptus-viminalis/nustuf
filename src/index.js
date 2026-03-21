import express from "express";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Resvg } from "@resvg/resvg-js";

import { x402ResourceServer } from "@x402/core/server";
import { x402HTTPResourceServer, HTTPFacilitatorClient } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { isAddress, createPublicClient, http, parseAbi } from "viem";
import { base, baseSepolia } from "viem/chains";
import { resolveSupportedChain } from "./chain_meta.js";
import {
  ACCESS_MODE_VALUES,
  DEFAULT_ACCESS_MODE,
  accessModeRequiresDownloadCode,
  accessModeRequiresPayment,
  accessModeSummary,
  isValidAccessMode,
} from "./access_mode.js";
import {
  DOWNLOAD_CODE_HEADER,
  isValidDownloadCodeHash,
  verifyDownloadCode,
} from "./download_code.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function parseNonNegativeInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function now() {
  return Math.floor(Date.now() / 1000);
}

function isAbsoluteHttpUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function toSafeJsonForScript(value) {
  return JSON.stringify(value)
    .replace(/<\/script/gi, "<\\/script")
    .replace(/<!--/g, "<\\!--")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const PORT = Number(process.env.PORT || 4021);

// Mirror the Python env names (with a couple backwards-compatible aliases)
const FACILITATOR_MODE = (process.env.FACILITATOR_MODE || "testnet").trim();
const CDP_API_KEY_ID = (process.env.CDP_API_KEY_ID || "").trim();
const CDP_API_KEY_SECRET = (process.env.CDP_API_KEY_SECRET || "").trim();
const DEFAULT_TESTNET_FACILITATOR_URL = "https://x402.org/facilitator";
const DEFAULT_CDP_MAINNET_FACILITATOR_URL =
  "https://api.cdp.coinbase.com/platform/v2/x402";
const FACILITATOR_URL = (
  process.env.FACILITATOR_URL ||
  (FACILITATOR_MODE === "cdp_mainnet"
    ? DEFAULT_CDP_MAINNET_FACILITATOR_URL
    : DEFAULT_TESTNET_FACILITATOR_URL)
).trim();
const SELLER_PAY_TO = String(
  process.env.SELLER_PAY_TO || process.env.PAY_TO || "",
).trim();
const PRICE_USD = process.env.PRICE_USD || "1.00";
const ACCESS_MODE = String(
  process.env.ACCESS_MODE || DEFAULT_ACCESS_MODE,
).trim().toLowerCase();
const DOWNLOAD_CODE_HASH = String(process.env.DOWNLOAD_CODE_HASH || "").trim();
const RAW_CHAIN_ID =
  process.env.CHAIN_ID || process.env.NETWORK || "eip155:84532";
const ARTIFACT_PATH = process.env.ARTIFACT_PATH || process.env.PROTECTED_FILE;
const WINDOW_SECONDS = Number(process.env.WINDOW_SECONDS || 3600);
const MAX_GRANTS = parsePositiveInt(process.env.MAX_GRANTS, 10000);
const GRANT_SWEEP_SECONDS = parsePositiveInt(
  process.env.GRANT_SWEEP_SECONDS,
  60,
);

const CONFIRMATION_POLICY = process.env.CONFIRMATION_POLICY || "confirmed"; // optimistic|confirmed
const CONFIRMATIONS_REQUIRED = Number(process.env.CONFIRMATIONS_REQUIRED || 1);

const MIME_TYPE = process.env.PROTECTED_MIME || "application/octet-stream";

const OG_TITLE = (process.env.OG_TITLE || "").trim();
const OG_DESCRIPTION = (process.env.OG_DESCRIPTION || "").trim();
const OG_IMAGE_URL = (process.env.OG_IMAGE_URL || "").trim();
const OG_IMAGE_PATH_RAW = (process.env.OG_IMAGE_PATH || "").trim();
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").trim();
const OG_IMAGE_PATH = OG_IMAGE_PATH_RAW
  ? path.isAbsolute(OG_IMAGE_PATH_RAW)
    ? OG_IMAGE_PATH_RAW
    : path.join(__dirname, "..", OG_IMAGE_PATH_RAW)
  : "";
const OG_IMAGE_CACHE_CONTROL = "public, max-age=60";
const OG_IMAGE_WIDTH = 1200;
const OG_IMAGE_HEIGHT = 630;
const SKILL_NAME = "nustuf-buy";
const SKILL_DESCRIPTION =
  "Buy and download nustuf content from promo or download links using the nustuf CLI tool";
const SKILL_SOURCE = "clawhub";
const SKILL_INSTALL_COMMAND = "clawhub install nustuf-buy";
const WELL_KNOWN_CACHE_CONTROL = "public, max-age=60";
const LEGACY_DISCOVERY_DEPRECATION =
  "Deprecated endpoint; use /.well-known/skills/index.json for RFC-compatible discovery.";

// ─────────────────────────────────────────────────────────────────────────────
// Nustuf Design System - Greyscale + Custom Fonts
// ─────────────────────────────────────────────────────────────────────────────
const NUSTUF_FONTS_CSS = `
@font-face {
  font-family: 'Outward';
  src: url('/fonts/outward-round-webfont.woff2') format('woff2');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Karrik';
  src: url('/fonts/Karrik-Regular.woff2') format('woff2');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Karrik';
  src: url('/fonts/Karrik-Italic.woff2') format('woff2');
  font-weight: normal;
  font-style: italic;
  font-display: swap;
}
`;

const NUSTUF_BASE_CSS = `
${NUSTUF_FONTS_CSS}
body { 
  font-family: 'Karrik', ui-monospace, SFMono-Regular, Menlo, monospace; 
  margin: 0; 
  padding: 24px; 
  background: #121212; 
  color: #e0e0e0;
  position: relative;
  min-height: 100vh;
}
body::before {
  content: 'nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf nustuf';
  font-family: 'Outward', sans-serif;
  font-size: 312px;
  color: #fff;
  opacity: 0.05;
  position: fixed;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  transform: rotate(-30deg);
  word-spacing: 100px;
  line-height: 1.4;
  letter-spacing: 2px;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
  word-break: break-all;
}
.card { 
  max-width: 760px; 
  margin: 0 auto; 
  border: 1px solid #333; 
  background: #1a1a1a; 
  border-radius: 0; 
  padding: 20px;
  position: relative;
  z-index: 1;
}
h1, h2 { 
  font-family: 'Karrik', sans-serif; 
  font-weight: normal;
}
h1 { margin: 0 0 12px; font-size: 28px; color: #fff; }
h2 { margin: 0 0 10px; font-size: 20px; color: #f0f0f0; }
p { line-height: 1.6; color: #ccc; }
.kv { margin: 14px 0; font-size: 14px; color: #aaa; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.kv strong { color: #e0e0e0; }
code, pre { 
  background: #2a2a2a; 
  border-radius: 0; 
  padding: 2px 6px; 
  color: #e0e0e0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
pre { padding: 10px; overflow-x: auto; border: 1px solid #333; }
a { color: #888; }
a:hover { color: #fff; }
.prompt-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.prompt-head p { margin: 0; }
button.copy-btn { 
  border: 1px solid #444; 
  background: #2a2a2a; 
  color: #e0e0e0; 
  border-radius: 0; 
  padding: 6px 10px; 
  cursor: pointer; 
  font: inherit; 
  font-size: 13px; 
}
button.copy-btn:hover { background: #333; }
.copy-status { font-size: 12px; color: #888; min-height: 1em; }
.install-note { margin-top: 16px; font-size: 13px; color: #999; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.install-note a { color: #aaa; }
.agent-quick-path { 
  margin: 16px 0; 
  padding: 14px; 
  border: 1px solid #333; 
  border-radius: 0; 
  background: #222; 
}
.agent-quick-path h2 { margin: 0 0 8px; font-size: 18px; }
.agent-quick-path ol { margin: 8px 0 8px 20px; color: #ccc; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.agent-quick-path p { margin: 8px 0 0; }
ol { margin: 10px 0 12px 20px; }
li { margin: 4px 0; }
`;

const SALE_START_TS = parsePositiveInt(process.env.SALE_START_TS, now());
const SALE_END_TS = parsePositiveInt(
  process.env.SALE_END_TS,
  SALE_START_TS + WINDOW_SECONDS,
);
const ENDED_WINDOW_SECONDS = parseNonNegativeInt(
  process.env.ENDED_WINDOW_SECONDS,
  0,
);

if (!isValidAccessMode(ACCESS_MODE)) {
  console.error(`Invalid ACCESS_MODE: ${ACCESS_MODE}`);
  console.error(`Supported ACCESS_MODE values: ${ACCESS_MODE_VALUES.join(", ")}`);
  process.exit(1);
}

const REQUIRES_DOWNLOAD_CODE = accessModeRequiresDownloadCode(ACCESS_MODE);
const REQUIRES_PAYMENT = accessModeRequiresPayment(ACCESS_MODE);

if (REQUIRES_DOWNLOAD_CODE && !DOWNLOAD_CODE_HASH) {
  console.error(`ACCESS_MODE=${ACCESS_MODE} requires DOWNLOAD_CODE_HASH.`);
  process.exit(1);
}
if (DOWNLOAD_CODE_HASH && !isValidDownloadCodeHash(DOWNLOAD_CODE_HASH)) {
  console.error("Invalid DOWNLOAD_CODE_HASH format.");
  process.exit(1);
}
if (!REQUIRES_DOWNLOAD_CODE && DOWNLOAD_CODE_HASH) {
  console.error(
    `ACCESS_MODE=${ACCESS_MODE} does not use DOWNLOAD_CODE_HASH. Remove DOWNLOAD_CODE_HASH or choose a download-code access mode.`,
  );
  process.exit(1);
}

let CHAIN_META;
try {
  CHAIN_META = resolveSupportedChain(RAW_CHAIN_ID);
} catch (err) {
  console.error(err?.message || String(err));
  process.exit(1);
}

const CHAIN_ID = CHAIN_META.caip2;
const CHAIN_NAME = CHAIN_META.name;
const CHAIN_NUMERIC_ID = CHAIN_META.id;
const IS_BASE_MAINNET = CHAIN_NUMERIC_ID === 8453;

if (REQUIRES_PAYMENT) {
  if (!new Set(["testnet", "cdp_mainnet"]).has(FACILITATOR_MODE)) {
    console.error(
      "Invalid FACILITATOR_MODE. Supported values: testnet, cdp_mainnet",
    );
    process.exit(1);
  }

  if (IS_BASE_MAINNET && FACILITATOR_MODE !== "cdp_mainnet") {
    console.error(
      "Invalid config: CHAIN_ID=eip155:8453 requires FACILITATOR_MODE=cdp_mainnet.",
    );
    console.error(
      "Set FACILITATOR_MODE=cdp_mainnet and configure CDP_API_KEY_ID/CDP_API_KEY_SECRET.",
    );
    process.exit(1);
  }

  if (
    FACILITATOR_MODE === "cdp_mainnet" &&
    (!CDP_API_KEY_ID || !CDP_API_KEY_SECRET)
  ) {
    console.error("Missing CDP credentials for FACILITATOR_MODE=cdp_mainnet.");
    console.error(
      "Set CDP_API_KEY_ID and CDP_API_KEY_SECRET in your environment.",
    );
    process.exit(1);
  }
}

if (REQUIRES_PAYMENT && !SELLER_PAY_TO) {
  console.error("Missing required env var: SELLER_PAY_TO (or PAY_TO)");
  process.exit(1);
}
if (SELLER_PAY_TO && !isAddress(SELLER_PAY_TO)) {
  console.error(`Invalid SELLER_PAY_TO (or PAY_TO): ${SELLER_PAY_TO}`);
  console.error("Expected a valid Ethereum address (0x + 40 hex chars).");
  process.exit(1);
}
if (!ARTIFACT_PATH) {
  console.error("Missing required env var: ARTIFACT_PATH (or PROTECTED_FILE)");
  process.exit(1);
}

function absArtifactPath() {
  return path.isAbsolute(ARTIFACT_PATH)
    ? ARTIFACT_PATH
    : path.join(__dirname, "..", ARTIFACT_PATH);
}

const ARTIFACT_NAME = path.basename(absArtifactPath());

function saleEnded(ts = now()) {
  return ts >= SALE_END_TS;
}

function endedWindowActive(ts = now()) {
  if (ENDED_WINDOW_SECONDS <= 0) return false;
  return ts >= SALE_END_TS && ts < SALE_END_TS + ENDED_WINDOW_SECONDS;
}

function endedWindowCutoffTs() {
  return SALE_END_TS + ENDED_WINDOW_SECONDS;
}

function saleStatus(ts = now()) {
  return saleEnded(ts) ? "ended" : "live";
}

function baseUrlFromReq(req) {
  if (isAbsoluteHttpUrl(PUBLIC_BASE_URL)) {
    return PUBLIC_BASE_URL.replace(/\/+$/, "");
  }
  const host = req.get("host");
  return `${req.protocol}://${host}`;
}

function imageMimeTypeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".avif") return "image/avif";
  return null;
}

function imageMimeTypeFromUrl(urlString) {
  try {
    const parsed = new URL(String(urlString));
    return imageMimeTypeFromPath(parsed.pathname);
  } catch {
    return null;
  }
}

function classifyFacilitatorError(err) {
  const msg = (err?.message || String(err)).toLowerCase();
  if (
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("unauthorized") ||
    msg.includes("forbidden") ||
    msg.includes("authorization") ||
    msg.includes("bearer") ||
    msg.includes("jwt") ||
    msg.includes("api key") ||
    msg.includes("invalid key format")
  ) {
    return "auth";
  }
  if (
    msg.includes("does not support scheme") ||
    msg.includes("unsupported") ||
    (msg.includes("network") &&
      (msg.includes("mismatch") || msg.includes("invalid")))
  ) {
    return "network";
  }
  return "generic";
}

function printFacilitatorHint(err) {
  const kind = classifyFacilitatorError(err);
  if (kind === "auth") {
    console.error("[hint] Facilitator authentication failed.");
    console.error(
      "[hint] For mainnet, set FACILITATOR_MODE=cdp_mainnet and valid CDP_API_KEY_ID/CDP_API_KEY_SECRET.",
    );
    return;
  }
  if (kind === "network") {
    console.error("[hint] Facilitator/network mismatch.");
    console.error(
      "[hint] Verify CHAIN_ID and FACILITATOR_URL/FACILITATOR_MODE are aligned.",
    );
    return;
  }
  if (IS_BASE_MAINNET) {
    console.error(
      "[hint] Base mainnet requires a mainnet-capable facilitator and valid auth.",
    );
  }
}

function joinUrlPath(basePath, suffix) {
  const normalizedBase = basePath.replace(/\/+$/, "");
  return `${normalizedBase}${suffix}`;
}

function createCdpAuthHeadersFactory() {
  const url = new URL(FACILITATOR_URL);
  const requestHost = url.host;
  const verifyPath = joinUrlPath(url.pathname, "/verify");
  const settlePath = joinUrlPath(url.pathname, "/settle");
  const supportedPath = joinUrlPath(url.pathname, "/supported");

  return async () => {
    let generateJwt;
    try {
      ({ generateJwt } = await import("@coinbase/cdp-sdk/auth"));
    } catch {
      throw new Error(
        "CDP auth helper unavailable. Install @coinbase/cdp-sdk and retry.",
      );
    }

    const createAuthorization = async (requestMethod, requestPath) => {
      const jwt = await generateJwt({
        apiKeyId: CDP_API_KEY_ID,
        apiKeySecret: CDP_API_KEY_SECRET,
        requestMethod,
        requestHost,
        requestPath,
        expiresIn: 120,
      });
      return { Authorization: `Bearer ${jwt}` };
    };

    return {
      verify: await createAuthorization("POST", verifyPath),
      settle: await createAuthorization("POST", settlePath),
      supported: await createAuthorization("GET", supportedPath),
    };
  };
}

async function preflightCdpAuth() {
  if (FACILITATOR_MODE !== "cdp_mainnet") return;

  let generateJwt;
  try {
    ({ generateJwt } = await import("@coinbase/cdp-sdk/auth"));
  } catch {
    console.error(
      "[startup] Missing CDP auth dependency. Install @coinbase/cdp-sdk.",
    );
    process.exit(1);
  }

  const url = new URL(FACILITATOR_URL);
  const requestHost = url.host;
  const supportedPath = joinUrlPath(url.pathname, "/supported");
  try {
    await generateJwt({
      apiKeyId: CDP_API_KEY_ID,
      apiKeySecret: CDP_API_KEY_SECRET,
      requestMethod: "GET",
      requestHost,
      requestPath: supportedPath,
      expiresIn: 120,
    });
  } catch (err) {
    console.error("[startup] CDP auth preflight failed.");
    console.error(`[startup] ${err?.message || String(err)}`);
    process.exit(1);
  }
}

function promoModel(req) {
  const baseUrl = baseUrlFromReq(req);
  const promoUrl = `${baseUrl}/`;
  const downloadUrl = `${baseUrl}/download`;
  const ogTitle = OG_TITLE || ARTIFACT_NAME;
  const ogDescription =
    OG_DESCRIPTION || `$${PRICE_USD} to unlock ${ARTIFACT_NAME}`;
  const imageAlt = `${ogTitle} preview image`;

  let imageUrl = `${baseUrl}/og.png`;
  let imageType = "image/png";
  let imageWidth = OG_IMAGE_WIDTH;
  let imageHeight = OG_IMAGE_HEIGHT;
  if (isAbsoluteHttpUrl(OG_IMAGE_URL)) {
    imageUrl = OG_IMAGE_URL;
    imageType = imageMimeTypeFromUrl(OG_IMAGE_URL) || "";
    imageWidth = null;
    imageHeight = null;
  } else if (OG_IMAGE_PATH) {
    imageUrl = `${baseUrl}/og-image`;
    imageType = imageMimeTypeFromPath(OG_IMAGE_PATH) || "";
    imageWidth = null;
    imageHeight = null;
  }

  return {
    baseUrl,
    promoUrl,
    downloadUrl,
    imageUrl,
    imageType,
    imageWidth,
    imageHeight,
    imageAlt,
    ogTitle,
    ogDescription,
    saleStartTs: SALE_START_TS,
    saleEndTs: SALE_END_TS,
    endedWindowSeconds: ENDED_WINDOW_SECONDS,
    endedWindowCutoffTs: endedWindowCutoffTs(),
    accessMode: ACCESS_MODE,
    accessSummary: accessModeSummary(ACCESS_MODE),
    requiresPayment: REQUIRES_PAYMENT,
    requiresDownloadCode: REQUIRES_DOWNLOAD_CODE,
  };
}

function discoveryIndexUrl(model) {
  return `${model.baseUrl}/.well-known/skills/index.json`;
}

function rfcResourceUrl(model) {
  return `${model.baseUrl}/.well-known/skills/${SKILL_NAME}/resource.json`;
}

function buildDiscoveryResource(req) {
  const model = promoModel(req);
  return {
    name: SKILL_NAME,
    status: saleStatus(),
    promo_url: model.promoUrl,
    download_url: model.downloadUrl,
    artifact_name: ARTIFACT_NAME,
    price_usd: PRICE_USD,
    price_currency: "USDC",
    network: CHAIN_ID,
    sale_end: new Date(SALE_END_TS * 1000).toISOString(),
    access_mode: ACCESS_MODE,
    access_summary: accessModeSummary(ACCESS_MODE),
    payment_required: REQUIRES_PAYMENT,
    download_code_required: REQUIRES_DOWNLOAD_CODE,
    download_code_header: DOWNLOAD_CODE_HEADER,
  };
}

function renderWellKnownSkillMd(req) {
  const resource = buildDiscoveryResource(req);
  const codeNote = resource.download_code_required
    ? `- Download code header: ${resource.download_code_header}`
    : "- Download code: not required";
  const paymentFlow = resource.payment_required
    ? `2. Use \`download_url\` for x402 purchase and token mint.
3. Download from \`/download?token=...\` and save locally.`
    : `2. Use \`download_url\` for direct download.
3. Save the response body locally.`;
  return `# ${SKILL_NAME}

${SKILL_DESCRIPTION}

## Discovery
- Promo URL: ${resource.promo_url}
- Download URL: ${resource.download_url}
- Status: ${resource.status}
- Sale ends: ${resource.sale_end}
- Access mode: ${resource.access_mode}
${codeNote}

## Buyer Fast Path (for unknown agents)
1. Ask the user for approval to install the skill once.
2. Install: \`${SKILL_INSTALL_COMMAND}\`
3. Load the skill and continue with Buyer Fast Path.

Do not explain x402 internals unless the user explicitly asks.

## Discovery Fallback
1. Read resource metadata from \`/.well-known/skills/${SKILL_NAME}/resource.json\`.
${paymentFlow}

## CLI
- Install: \`${SKILL_INSTALL_COMMAND}\`
- Buy: \`nustuf buy <promo_or_download_url> [--download-code <code>] [--buyer-private-key-file ./buyer.key]\`
`;
}

function buildAgentQuickPath(promoUrl, downloadUrl) {
  const safePromoUrl = String(promoUrl || "").trim();
  const safeDownloadUrl = String(downloadUrl || "").trim();
  const buyTarget =
    safePromoUrl || safeDownloadUrl || "<promo_or_download_url>";

  return {
    promoUrl: safePromoUrl,
    downloadUrl: safeDownloadUrl,
    installCommand: SKILL_INSTALL_COMMAND,
    buyTarget,
  };
}

function urlsForQuickPathFromRequestUrl(requestUrl) {
  try {
    const parsed = new URL(String(requestUrl || ""));
    const origin = parsed.origin;
    return {
      promoUrl: `${origin}/`,
      downloadUrl: `${origin}/download`,
    };
  } catch {
    const fallbackBase = isAbsoluteHttpUrl(PUBLIC_BASE_URL)
      ? PUBLIC_BASE_URL.replace(/\/+$/, "")
      : `http://127.0.0.1:${PORT}`;
    return {
      promoUrl: `${fallbackBase}/`,
      downloadUrl: `${fallbackBase}/download`,
    };
  }
}

function renderAgentQuickPathHtmlBlock(fastPath) {
  const ruleText = REQUIRES_PAYMENT
    ? "do not explain x402 internals unless the user explicitly asks."
    : "focus on direct download steps and avoid adding payment instructions.";
  return `<section class="agent-quick-path">
      <h2>Agent Quick Path</h2>
      <ol>
        <li>Ask for approval to install the skill once.</li>
        <li>Install: <code>${escapeHtml(fastPath.installCommand)}</code></li>
        <li>Load the skill and continue with Buyer Fast Path.</li>
      </ol>
      <p><strong>Rule:</strong> ${escapeHtml(ruleText)}</p>
    </section>`;
}

function renderPromoSharedContent({ promoUrl, downloadUrl, saleEndTs }) {
  const fastPath = buildAgentQuickPath(promoUrl, downloadUrl);
  const expiresIso = new Date(saleEndTs * 1000).toISOString();
  const humanActionText = "Just send the link to this page to your agent";

  return `
    <div class="kv"><strong>Price:</strong> ${escapeHtml(PRICE_USD)} USD equivalent</div>
    <div class="kv"><strong>Network:</strong> ${escapeHtml(CHAIN_NAME)} (${escapeHtml(CHAIN_ID)})</div>
    <div class="kv"><strong>Access mode:</strong> ${escapeHtml(ACCESS_MODE)} (${escapeHtml(accessModeSummary(ACCESS_MODE))})</div>
    <div class="kv"><strong>Download-code header:</strong> <code>${escapeHtml(DOWNLOAD_CODE_HEADER)}</code>${REQUIRES_DOWNLOAD_CODE ? "" : " (not required)"}</div>
    <div class="kv"><strong>Sale end:</strong> <span id="sale-end-local" data-sale-end-iso="${escapeHtml(expiresIso)}">${escapeHtml(expiresIso)}</span></div>
    ${renderAgentQuickPathHtmlBlock(fastPath)}

    <div class="prompt-head">
      <p><strong>Human action</strong></p>
      <button class="copy-btn" id="copy-link-btn" type="button" aria-label="Copy page link">Copy link</button>
      <span class="copy-status" id="copy-link-status" aria-live="polite"></span>
    </div>
    <pre id="human-action-text">${escapeHtml(humanActionText)}</pre>
    <p class="install-note">
      Want to know more about <code>nustuf</code>? Visit
      <a href="https://github.com/eucalyptus-viminalis/nustuf">github.com/eucalyptus-viminalis/nustuf</a>
      or search for nustuf on clawhub.
      Want to publish your own content? Install the <code>nustuf-publish</code> skill.
    </p>
  `;
}

function renderPromoSharedClientScript(promoUrl) {
  return `<script>
    (() => {
      const button = document.getElementById("copy-link-btn");
      const status = document.getElementById("copy-link-status");
      const safePromoUrl = ${toSafeJsonForScript(promoUrl)};
      const saleEndLocal = document.getElementById("sale-end-local");

      if (saleEndLocal) {
        const saleEndIso = saleEndLocal.getAttribute("data-sale-end-iso") || "";
        const saleEndDate = new Date(saleEndIso);
        if (!Number.isNaN(saleEndDate.getTime())) {
          try {
            const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });
            saleEndLocal.textContent = formatter.format(saleEndDate) + " (local time)";
          } catch {
            saleEndLocal.textContent = saleEndDate.toLocaleString() + " (local time)";
          }
        }
      }

      if (!button || !safePromoUrl) return;

      const setStatus = (text) => {
        if (status) status.textContent = text;
      };

      button.addEventListener("click", async () => {
        const original = "Copy link";
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(safePromoUrl);
          } else {
            const ta = document.createElement("textarea");
            ta.value = safePromoUrl;
            ta.setAttribute("readonly", "");
            ta.style.position = "absolute";
            ta.style.left = "-9999px";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
          }
          button.textContent = "Copied";
          setStatus("Copied to clipboard.");
          setTimeout(() => {
            button.textContent = original;
            setStatus("");
          }, 1500);
        } catch {
          setStatus("Copy failed. Select and copy manually.");
        }
      });
    })();
  </script>`;
}

function renderUnpaidDownloadGuidancePage(requestUrl) {
  const urls = urlsForQuickPathFromRequestUrl(requestUrl);
  const sharedContent = renderPromoSharedContent({
    promoUrl: urls.promoUrl,
    downloadUrl: urls.downloadUrl,
    saleEndTs: SALE_END_TS,
  });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Payment Required - nustuf</title>
  <style>${NUSTUF_BASE_CSS}</style>
</head>
<body>
  <main class="card">
    <h1>402 Payment Required</h1>
    <p>This content is paywalled. Use the nustuf skill fast path below.</p>
    <div class="kv"><strong>Resource:</strong> ${escapeHtml(ARTIFACT_NAME)}</div>
    ${sharedContent}
  </main>
  ${renderPromoSharedClientScript(urls.promoUrl)}
</body>
</html>`;
}

function renderDownloadCodeRequiredPage(requestUrl) {
  const urls = urlsForQuickPathFromRequestUrl(requestUrl);
  const sharedContent = renderPromoSharedContent({
    promoUrl: urls.promoUrl,
    downloadUrl: urls.downloadUrl,
    saleEndTs: SALE_END_TS,
  });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Download Code Required - nustuf</title>
  <style>${NUSTUF_BASE_CSS}</style>
</head>
<body>
  <main class="card">
    <h1>401 Download Code Required</h1>
    <p>This URL requires a download code before access is granted.</p>
    <div class="kv"><strong>Header:</strong> <code>${escapeHtml(DOWNLOAD_CODE_HEADER)}</code></div>
    <div class="kv"><strong>Resource:</strong> ${escapeHtml(ARTIFACT_NAME)}</div>
    ${sharedContent}
  </main>
  ${renderPromoSharedClientScript(urls.promoUrl)}
</body>
</html>`;
}

function sendDownloadCodeRequired(req, res, requestUrl) {
  res.setHeader("X-LEAK-DOWNLOAD-CODE-REQUIRED", "1");
  const wantsHtml = (req.get("accept") || "").includes("text/html");
  const isBrowser = (req.get("user-agent") || "").includes("Mozilla");
  if (wantsHtml && isBrowser) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(401).send(renderDownloadCodeRequiredPage(requestUrl));
  }
  return res.status(401).json({
    error: "download code required",
    header: DOWNLOAD_CODE_HEADER,
  });
}

function sendSkillIndex(req, res) {
  const payload = {
    skills: [
      {
        name: SKILL_NAME,
        description: SKILL_DESCRIPTION,
        files: ["SKILL.md", "resource.json"],
      },
    ],
  };
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", WELL_KNOWN_CACHE_CONTROL);
  if (req.method === "HEAD") return res.status(200).end();
  return res.status(200).json(payload);
}

function sendSkillMarkdown(req, res) {
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Cache-Control", WELL_KNOWN_CACHE_CONTROL);
  if (req.method === "HEAD") return res.status(200).end();
  return res.status(200).send(renderWellKnownSkillMd(req));
}

function sendSkillResource(req, res) {
  const payload = buildDiscoveryResource(req);
  const statusCode = payload.status === "ended" ? 410 : 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", WELL_KNOWN_CACHE_CONTROL);
  if (req.method === "HEAD") return res.status(statusCode).end();
  return res.status(statusCode).json(payload);
}

function renderPromoPage(model, { ended }) {
  const stateLabel = ended ? "ENDED" : "LIVE";
  const pageTitle = model.ogTitle;
  const description = ended
    ? `This release has ended. ${model.ogDescription}`
    : model.ogDescription;
  const expiresIso = new Date(model.saleEndTs * 1000).toISOString();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: model.ogTitle,
    description,
    image: model.imageUrl,
    url: model.promoUrl,
    category: "DigitalDocument",
    offers: {
      "@type": "Offer",
      url: model.downloadUrl,
      price: PRICE_USD,
      priceCurrency: "USD",
      availability: ended
        ? "https://schema.org/OutOfStock"
        : "https://schema.org/InStock",
      validThrough: expiresIso,
    },
    additionalProperty: [
      { "@type": "PropertyValue", name: "paymentProtocol", value: "x402" },
      {
        "@type": "PropertyValue",
        name: "paymentSettlementCurrency",
        value: "USDC",
      },
      { "@type": "PropertyValue", name: "network", value: CHAIN_ID },
      {
        "@type": "PropertyValue",
        name: "downloadUrl",
        value: model.downloadUrl,
      },
    ],
  };
  const safeJsonLd = toSafeJsonForScript(jsonLd);
  const secureImageUrl = model.imageUrl.startsWith("https://")
    ? model.imageUrl
    : "";
  const ogImageSecureUrlMeta = secureImageUrl
    ? `<meta property="og:image:secure_url" content="${escapeHtml(secureImageUrl)}" />`
    : "";
  const ogImageTypeMeta = model.imageType
    ? `<meta property="og:image:type" content="${escapeHtml(model.imageType)}" />`
    : "";
  const ogImageWidthMeta = Number.isFinite(model.imageWidth)
    ? `<meta property="og:image:width" content="${model.imageWidth}" />`
    : "";
  const ogImageHeightMeta = Number.isFinite(model.imageHeight)
    ? `<meta property="og:image:height" content="${model.imageHeight}" />`
    : "";
  const sharedContent = renderPromoSharedContent({
    promoUrl: model.promoUrl,
    downloadUrl: model.downloadUrl,
    saleEndTs: model.saleEndTs,
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(description)}" />

  <meta property="og:type" content="website" />
  <meta property="og:url" content="${escapeHtml(model.promoUrl)}" />
  <meta property="og:title" content="${escapeHtml(pageTitle)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="${escapeHtml(model.imageUrl)}" />
  ${ogImageSecureUrlMeta}
  ${ogImageTypeMeta}
  ${ogImageWidthMeta}
  ${ogImageHeightMeta}
  <meta property="og:image:alt" content="${escapeHtml(model.imageAlt)}" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(pageTitle)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(model.imageUrl)}" />
  <meta name="twitter:image:alt" content="${escapeHtml(model.imageAlt)}" />

  <script type="application/ld+json">${safeJsonLd}</script>
  <style>
    ${NUSTUF_BASE_CSS}
    :root { color-scheme: dark; }
    .state { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; border: 1px solid #555; border-radius: 0; padding: 2px 10px; margin-bottom: 12px; color: #aaa; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .state .dot { width: 6px; height: 6px; background: #e53e3e; border-radius: 50%; animation: pulse 1.5s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(229, 62, 62, 0.4); } 50% { opacity: 0.6; box-shadow: 0 0 6px 2px rgba(229, 62, 62, 0.3); } }
  </style>
</head>
<body>
  <main class="card">
    <div class="state">${ended ? '' : '<span class="dot"></span>'}${escapeHtml(stateLabel)}</div>
    <h1>${escapeHtml(pageTitle)}</h1>

    ${sharedContent}
  </main>
  ${renderPromoSharedClientScript(model.promoUrl)}
</body>
</html>`;
}

function renderOgSvg(req) {
  const model = promoModel(req);
  const title = model.ogTitle;
  const subtitle = `$${PRICE_USD} on ${CHAIN_NAME}`;
  const status = saleEnded() ? "ENDED" : "LIVE";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a1a1a"/>
      <stop offset="100%" stop-color="#0f0f0f"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="64" y="64" width="1072" height="502" rx="0" fill="#222" stroke="#444"/>
  ${status === 'LIVE' ? '<circle cx="112" cy="159" r="6" fill="#e53e3e"/>' : ''}
  <text x="${status === 'LIVE' ? '126' : '96'}" y="170" font-size="32" font-family="monospace" fill="#888">${escapeXml(status)}</text>
  <text x="96" y="250" font-size="52" font-family="monospace" fill="#fff">${escapeXml(title)}</text>
  <text x="96" y="330" font-size="30" font-family="monospace" fill="#ccc">${escapeXml(subtitle)}</text>
  <text x="96" y="404" font-size="22" font-family="monospace" fill="#888">Share this link with your OpenClaw agent to download</text>
</svg>`;
}

function renderOgPng(req) {
  const svg = renderOgSvg(req);
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: OG_IMAGE_WIDTH,
    },
  });
  const pngData = resvg.render();
  return pngData.asPng();
}

// In-memory grants (v1). Later: SQLite.
/** @type {Map<string, { token: string, expiresAt: number, downloadsLeft: number|null }>} */
const GRANTS = new Map();

function pruneExpiredGrants() {
  const ts = now();
  for (const [token, grant] of GRANTS.entries()) {
    if (grant.expiresAt < ts) GRANTS.delete(token);
  }
}

function enforceGrantLimit() {
  while (GRANTS.size >= MAX_GRANTS) {
    const oldest = GRANTS.keys().next().value;
    if (!oldest) return;
    GRANTS.delete(oldest);
  }
}

function mintGrant() {
  pruneExpiredGrants();
  enforceGrantLimit();

  const token = randomUUID().replaceAll("-", "");
  GRANTS.set(token, {
    token,
    expiresAt: now() + WINDOW_SECONDS,
    downloadsLeft: null, // null = unlimited
  });
  return token;
}

function validateAndConsumeToken(token) {
  const g = GRANTS.get(token);
  if (!g) return { ok: false, reason: "invalid token" };
  if (g.expiresAt < now()) {
    GRANTS.delete(token);
    return { ok: false, reason: "token expired" };
  }
  if (g.downloadsLeft !== null) {
    if (g.downloadsLeft <= 0)
      return { ok: false, reason: "download limit reached" };
    g.downloadsLeft -= 1;
  }
  return { ok: true };
}

function sendArtifactStream(res) {
  const p = absArtifactPath();
  if (!fs.existsSync(p)) {
    return res.status(404).json({ error: "artifact not found" });
  }

  res.setHeader("Content-Type", MIME_TYPE);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=\"${path.basename(p)}\"`,
  );
  return fs.createReadStream(p).pipe(res);
}

const app = express();
app.set("trust proxy", true);

// Serve static fonts
app.use("/fonts", express.static(path.join(__dirname, "..", "public", "fonts")));

// Serve feed page
app.get("/feed", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "feed.html"));
});

// x402 core server + HTTP wrapper
let httpServer = null;
if (REQUIRES_PAYMENT) {
  await preflightCdpAuth();
  const facilitatorConfig = { url: FACILITATOR_URL };
  if (FACILITATOR_MODE === "cdp_mainnet") {
    facilitatorConfig.createAuthHeaders = createCdpAuthHeadersFactory();
  }
  const facilitatorClient = new HTTPFacilitatorClient(facilitatorConfig);
  const coreServer = new x402ResourceServer(facilitatorClient).register(
    CHAIN_ID,
    new ExactEvmScheme(),
  );

  // Route config for x402HTTPResourceServer
  const routes = {
    "GET /download": {
      accepts: [
        {
          scheme: "exact",
          price: `$${PRICE_USD}`,
          network: CHAIN_ID,
          payTo: SELLER_PAY_TO,
          maxTimeoutSeconds: WINDOW_SECONDS,
        },
      ],
      description: ARTIFACT_NAME,
      mimeType: MIME_TYPE,
      unpaidResponseBody: async (context) => ({
        contentType: "text/html; charset=utf-8",
        body: renderUnpaidDownloadGuidancePage(context?.adapter?.getUrl?.()),
      }),
    },
  };

  httpServer = new x402HTTPResourceServer(coreServer, routes);
  try {
    await httpServer.initialize();
  } catch (err) {
    console.error("[startup] Failed to initialize x402 route configuration.");
    console.error(
      `[startup] facilitator=${FACILITATOR_URL} mode=${FACILITATOR_MODE} network=${CHAIN_ID}`,
    );
    if (Array.isArray(err?.errors) && err.errors.length > 0) {
      for (const e of err.errors) {
        console.error(`[startup] ${e.message || JSON.stringify(e)}`);
      }
    } else {
      console.error(`[startup] ${err?.message || String(err)}`);
    }
    printFacilitatorHint(err);
    process.exit(1);
  }
}

setInterval(() => {
  pruneExpiredGrants();
}, GRANT_SWEEP_SECONDS * 1000).unref();

app.get("/", (req, res) => {
  const model = promoModel(req);
  const ended = saleEnded();
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(renderPromoPage(model, { ended }));
});

app.get("/info", (req, res) => {
  const model = promoModel(req);
  res.json({
    name: "nustuf",
    artifact: path.basename(absArtifactPath()),
    price_usd: PRICE_USD,
    network: CHAIN_ID,
    pay_to: SELLER_PAY_TO || null,
    window_seconds: WINDOW_SECONDS,
    confirmation_policy: CONFIRMATION_POLICY,
    confirmations_required: CONFIRMATIONS_REQUIRED,
    facilitator_url: FACILITATOR_URL,
    facilitator_mode: FACILITATOR_MODE,
    access_mode: ACCESS_MODE,
    access_summary: accessModeSummary(ACCESS_MODE),
    payment_required: REQUIRES_PAYMENT,
    download_code_required: REQUIRES_DOWNLOAD_CODE,
    download_code_header: DOWNLOAD_CODE_HEADER,
    download_url: model.downloadUrl,
    promo_url: model.promoUrl,
  });
});

app.get("/og.svg", (req, res) => {
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", OG_IMAGE_CACHE_CONTROL);
  if (req.method === "HEAD") return res.status(200).end();
  return res.status(200).send(renderOgSvg(req));
});
app.head("/og.svg", (req, res) => {
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", OG_IMAGE_CACHE_CONTROL);
  return res.status(200).end();
});

app.get("/og.png", (req, res) => {
  let png;
  try {
    png = renderOgPng(req);
  } catch (err) {
    console.error(`[og] failed to render png: ${err?.message || String(err)}`);
    return res.status(500).json({ error: "og image unavailable" });
  }
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", OG_IMAGE_CACHE_CONTROL);
  if (req.method === "HEAD") return res.status(200).end();
  return res.status(200).send(png);
});
app.head("/og.png", (req, res) => {
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", OG_IMAGE_CACHE_CONTROL);
  return res.status(200).end();
});

app.get("/og-image", (req, res) => {
  if (!OG_IMAGE_PATH) {
    return res.status(404).json({ error: "og image not configured" });
  }
  if (!fs.existsSync(OG_IMAGE_PATH)) {
    return res.status(404).json({ error: "og image not found" });
  }

  let stat;
  try {
    stat = fs.statSync(OG_IMAGE_PATH);
  } catch {
    return res.status(404).json({ error: "og image unavailable" });
  }
  if (!stat.isFile()) {
    return res.status(404).json({ error: "og image unavailable" });
  }

  const contentType = imageMimeTypeFromPath(OG_IMAGE_PATH);
  if (!contentType) {
    return res.status(404).json({ error: "og image unavailable" });
  }

  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", OG_IMAGE_CACHE_CONTROL);
  if (req.method === "HEAD") return res.status(200).end();
  const stream = fs.createReadStream(OG_IMAGE_PATH);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.status(404).json({ error: "og image unavailable" });
    } else {
      res.end();
    }
  });
  return stream.pipe(res);
});
app.head("/og-image", (req, res) => {
  if (!OG_IMAGE_PATH) {
    return res.status(404).end();
  }
  if (!fs.existsSync(OG_IMAGE_PATH)) {
    return res.status(404).end();
  }
  let stat;
  try {
    stat = fs.statSync(OG_IMAGE_PATH);
  } catch {
    return res.status(404).end();
  }
  if (!stat.isFile()) {
    return res.status(404).end();
  }
  const contentType = imageMimeTypeFromPath(OG_IMAGE_PATH);
  if (!contentType) {
    return res.status(404).end();
  }
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", OG_IMAGE_CACHE_CONTROL);
  return res.status(200).end();
});

app.get("/health", (req, res) => {
  res.json({ ok: true, ts: now() });
});

app.get("/.well-known/skills/index.json", sendSkillIndex);
app.head("/.well-known/skills/index.json", sendSkillIndex);

app.get(`/.well-known/skills/${SKILL_NAME}/SKILL.md`, sendSkillMarkdown);
app.head(`/.well-known/skills/${SKILL_NAME}/SKILL.md`, sendSkillMarkdown);

app.get(`/.well-known/skills/${SKILL_NAME}/resource.json`, sendSkillResource);
app.head(`/.well-known/skills/${SKILL_NAME}/resource.json`, sendSkillResource);

// Well-known endpoint for agent skill discovery (RFC-inspired)
app.get("/.well-known/leak", (req, res) => {
  const model = promoModel(req);
  const rfcResourcePath = rfcResourceUrl(model);
  const discoveryPath = discoveryIndexUrl(model);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", WELL_KNOWN_CACHE_CONTROL);
  if (saleEnded()) {
    return res.status(410).json({
      error: "sale ended",
      skill: {
        name: SKILL_NAME,
        description: SKILL_DESCRIPTION,
        source: SKILL_SOURCE,
        install_command: SKILL_INSTALL_COMMAND,
      },
      message:
        "This release has expired, but you can install the nustuf-buy skill for future purchases",
      deprecation: LEGACY_DISCOVERY_DEPRECATION,
      discovery_index_url: discoveryPath,
      rfc_resource_url: rfcResourcePath,
    });
  }

  res.json({
    skill: {
      name: SKILL_NAME,
      description: SKILL_DESCRIPTION,
      source: SKILL_SOURCE,
      install_command: SKILL_INSTALL_COMMAND,
    },
    resource: {
      type: REQUIRES_PAYMENT ? "x402-gated-download" : "direct-download",
      download_url: model.downloadUrl,
      promo_url: model.promoUrl,
      artifact_name: ARTIFACT_NAME,
      price_usd: PRICE_USD,
      price_currency: "USDC",
      network: CHAIN_ID,
      access_mode: ACCESS_MODE,
      access_summary: accessModeSummary(ACCESS_MODE),
      payment_required: REQUIRES_PAYMENT,
      download_code_required: REQUIRES_DOWNLOAD_CODE,
      download_code_header: DOWNLOAD_CODE_HEADER,
      sale_end: new Date(SALE_END_TS * 1000).toISOString(),
    },
    deprecation: LEGACY_DISCOVERY_DEPRECATION,
    discovery_index_url: discoveryPath,
    rfc_resource_url: rfcResourcePath,
  });
});

// Alias /.well-known/nustuf -> same as /.well-known/leak for new branding
app.get("/.well-known/nustuf", (req, res) => {
  // Redirect to the canonical endpoint
  res.redirect(301, "/.well-known/leak");
});

// Access gate for GET /download (download-code check, then optional x402 payment).
app.use("/download", async (req, res, next) => {
  if (saleEnded()) {
    return res.status(410).json({ error: "release ended" });
  }

  // If a valid token is supplied, skip x402 and let the handler serve the file.
  // (Matches the Python implementation: token check happens before payment requirement.)
  if (typeof req.query.token === "string" && req.query.token.length > 0) {
    return next();
  }

  const requestUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;

  if (REQUIRES_DOWNLOAD_CODE) {
    const submittedCode = String(req.get(DOWNLOAD_CODE_HEADER) || "").trim();
    if (!submittedCode) return sendDownloadCodeRequired(req, res, requestUrl);

    let valid = false;
    try {
      valid = await verifyDownloadCode(submittedCode, DOWNLOAD_CODE_HASH);
    } catch (err) {
      console.error(
        `[download-code] verification failed: ${err?.message || String(err)}`,
      );
      return res.status(500).json({ error: "download code validation failed" });
    }

    if (!valid) return sendDownloadCodeRequired(req, res, requestUrl);
  }

  if (!REQUIRES_PAYMENT) return next();

  // NOTE: because this middleware is mounted at "/download", Express strips the mount
  // path and `req.path` becomes "/". x402 route matching needs the *full* path.
  const fullPath = `${req.baseUrl || ""}${req.path || ""}`;

  const adapter = {
    getHeader(name) {
      const v = req.get(name);
      if (v) return v;
      // legacy support: treat X-PAYMENT as PAYMENT-SIGNATURE (same base64 JSON format)
      const lower = String(name).toLowerCase();
      if (lower === "payment-signature")
        return req.get("x-payment") || undefined;
      if (lower === "payment-required")
        return req.get("payment-required") || undefined;
      return undefined;
    },
    getMethod() {
      return req.method;
    },
    getPath() {
      return fullPath;
    },
    getUrl() {
      return requestUrl;
    },
    getAcceptHeader() {
      return req.get("accept") || "";
    },
    getUserAgent() {
      return req.get("user-agent") || "";
    },
    getQueryParam(name) {
      return req.query?.[name];
    },
  };

  let result;
  try {
    result = await httpServer.processHTTPRequest({
      adapter,
      path: fullPath,
      method: req.method,
    });
  } catch (err) {
    console.error(
      `[x402] payment handshake failed: ${err?.message || String(err)}`,
    );
    printFacilitatorHint(err);
    return res.status(502).json({ error: "payment gateway unavailable" });
  }

  if (result.type === "no-payment-required") return next();

  if (result.type === "payment-error") {
    for (const [k, v] of Object.entries(result.response.headers || {}))
      res.setHeader(k, v);

    const isUnpaidBrowser402 =
      result.response.status === 402 &&
      (req.get("accept") || "").includes("text/html") &&
      (req.get("user-agent") || "").includes("Mozilla") &&
      !req.get("payment-signature") &&
      !req.get("x-payment");

    if (isUnpaidBrowser402) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(402).send(renderUnpaidDownloadGuidancePage(requestUrl));
    }

    return res.status(result.response.status).send(result.response.body ?? "");
  }

  // payment verified
  req.x402 = {
    paymentPayload: result.paymentPayload,
    paymentRequirements: result.paymentRequirements,
    declaredExtensions: result.declaredExtensions,
  };

  return next();
});

app.get("/download", async (req, res) => {
  if (saleEnded()) {
    return res.status(410).json({ error: "release ended" });
  }

  // 1) If caller already has a valid access token, serve the artifact.
  const token =
    typeof req.query.token === "string" ? req.query.token : undefined;
  if (token) {
    const check = validateAndConsumeToken(token);
    if (!check.ok) return res.status(403).json({ error: check.reason });
    return sendArtifactStream(res);
  }

  // 2) No token.
  if (!REQUIRES_PAYMENT) {
    return sendArtifactStream(res);
  }

  // If we got here with payment enabled, payment has been verified by middleware.
  // If you want immediate UX, just mint token. If you want stronger guarantees, settle.
  if (CONFIRMATION_POLICY === "confirmed") {
    let settle;
    try {
      settle = await httpServer.processSettlement(
        req.x402.paymentPayload,
        req.x402.paymentRequirements,
        req.x402.declaredExtensions,
      );
    } catch (err) {
      console.error(
        `[x402] settlement request failed: ${err?.message || String(err)}`,
      );
      printFacilitatorHint(err);
      return res.status(502).json({ error: "payment settlement unavailable" });
    }

    if (!settle.success) {
      return res.status(402).json({
        error: "payment settlement failed",
        reason: settle.errorReason,
        message: settle.errorMessage,
      });
    }

    for (const [k, v] of Object.entries(settle.headers || {}))
      res.setHeader(k, v);
    res.setHeader(
      "Access-Control-Expose-Headers",
      "PAYMENT-REQUIRED, PAYMENT-RESPONSE",
    );
  }

  const t = mintGrant();
  const p = absArtifactPath();

  return res.json({
    ok: true,
    token: t,
    expires_in: WINDOW_SECONDS,
    download_url: `/download?token=${t}`,
    filename: path.basename(p),
    mime_type: MIME_TYPE,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Locus Direct Payment Verification (workaround for Locus x402/call bug)
// Accepts a USDC transfer tx hash and verifies on-chain that the correct
// amount was sent to the seller address.
// ─────────────────────────────────────────────────────────────────────────────
const USDC_TRANSFER_EVENT = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

// Known USDC contract addresses
const USDC_ADDRESSES = {
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

app.post("/download/verify-tx", express.json(), async (req, res) => {
  if (saleEnded()) {
    return res.status(410).json({ error: "release ended" });
  }
  if (!REQUIRES_PAYMENT) {
    return res.status(400).json({ error: "payment not required" });
  }

  const { txHash } = req.body;
  if (!txHash || typeof txHash !== "string") {
    return res.status(400).json({ error: "txHash required" });
  }

  const chain = CHAIN_ID === "eip155:8453" ? base : baseSepolia;
  const usdcAddress = USDC_ADDRESSES[CHAIN_ID];
  if (!usdcAddress) {
    return res.status(500).json({ error: `unsupported chain for tx verification: ${CHAIN_ID}` });
  }

  const requiredAmount = BigInt(Math.round(PRICE_USD * 1e6));

  try {
    const client = createPublicClient({ chain, transport: http() });
    const receipt = await client.getTransactionReceipt({ hash: txHash });

    if (receipt.status !== "success") {
      return res.status(402).json({ error: "transaction failed on-chain" });
    }

    // Find USDC Transfer event to seller
    const transferLog = receipt.logs.find((log) => {
      if (log.address.toLowerCase() !== usdcAddress.toLowerCase()) return false;
      if (!log.topics || log.topics.length < 3) return false;
      // topics[0] = Transfer event sig, topics[2] = to address (padded)
      const to = "0x" + log.topics[2].slice(26);
      return to.toLowerCase() === SELLER_PAY_TO.toLowerCase();
    });

    if (!transferLog) {
      return res.status(402).json({ error: "no USDC transfer to seller found in tx" });
    }

    // Check amount (data field contains the uint256 value)
    const transferredAmount = BigInt(transferLog.data);
    if (transferredAmount < requiredAmount) {
      return res.status(402).json({
        error: "insufficient payment",
        required: requiredAmount.toString(),
        received: transferredAmount.toString(),
      });
    }

    // Check tx is recent (within window)
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    const txAge = Math.floor(Date.now() / 1000) - Number(block.timestamp);
    if (txAge > WINDOW_SECONDS) {
      return res.status(402).json({ error: "transaction too old", age_seconds: txAge });
    }

    // Payment verified — mint access token
    const t = mintGrant();
    const p = absArtifactPath();

    return res.json({
      ok: true,
      token: t,
      expires_in: WINDOW_SECONDS,
      download_url: `/download?token=${t}`,
      filename: path.basename(p),
      mime_type: MIME_TYPE,
    });
  } catch (err) {
    console.error(`[verify-tx] ${err?.message || String(err)}`);
    return res.status(500).json({ error: "tx verification failed", detail: err?.message });
  }
});

const server = app.listen(PORT, () => {
  console.log(`x402-node listening on http://localhost:${PORT}`);
  console.log(`access mode:      ${ACCESS_MODE} (${accessModeSummary(ACCESS_MODE)})`);
  if (REQUIRES_PAYMENT) {
    console.log(`facilitator mode: ${FACILITATOR_MODE}`);
    console.log(`facilitator url:  ${FACILITATOR_URL}`);
  }
  console.log(`network:          ${CHAIN_ID}`);
  if (REQUIRES_DOWNLOAD_CODE) {
    console.log(`download-code:    required via header ${DOWNLOAD_CODE_HEADER}`);
  }
  console.log(`promo:   http://localhost:${PORT}/ (share this)`);
  console.log(`info:    http://localhost:${PORT}/info`);
  console.log(`health:  http://localhost:${PORT}/health`);
  const protection = [
    REQUIRES_DOWNLOAD_CODE ? "download-code" : null,
    REQUIRES_PAYMENT ? "x402 payment" : null,
  ].filter(Boolean);
  console.log(
    `download http://localhost:${PORT}/download (${protection.length > 0 ? protection.join(" + ") : "direct"})`,
  );
  if (endedWindowActive()) {
    console.log(
      `ended-window active until ${new Date(endedWindowCutoffTs() * 1000).toISOString()} (download endpoints HTTP 410 mode)`,
    );
  }
});

// Keep server running and handle errors
server.on("error", (err) => {
  console.error(`Server error: ${err.message}`);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  console.error(`Uncaught exception: ${err.message}`);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error(`Unhandled rejection: ${reason}`);
});

// Prevent the process from exiting
server.ref();
