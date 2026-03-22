#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_ACCESS_MODE,
  accessModeRequiresDownloadCode,
  accessModeRequiresPayment,
  isValidAccessMode,
} from "../src/access_mode.js";
import { createUi } from "./ui.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLISH_SCRIPT_PATH = path.resolve(__dirname, "publish.js");
const PUBLIC_CONFIRM_PHRASE = "I_UNDERSTAND_PUBLIC_EXPOSURE";

const outUi = createUi(process.stdout);
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
  console.log(outUi.heading("nustuf host"));
  console.log("");
  console.log(outUi.section("Usage"));
  console.log(
    `  nustuf host --config <path> [--proxy-host <host>] [--proxy-port <port>] [--public] [--public-confirm ${PUBLIC_CONFIRM_PHRASE}] [--dry-run]`,
  );
  console.log("");
  console.log(outUi.section("Config Shape (JSON)"));
  console.log("  {");
  console.log('    "proxy": { "host": "127.0.0.1", "port": 4080 },');
  console.log("    \"defaults\": {");
  console.log('      "window": "1h",');
  console.log('      "network": "eip155:8453",');
  console.log('      "payTo": "0x...",');
  console.log('      "price": "0.01"');
  console.log("    },");
  console.log('    "routes": [');
  console.log("      {");
  console.log('        "slug": "lolboy",');
  console.log('        "prefix": "/nustuf/lolboy",');
  console.log('        "port": 4101,');
  console.log('        "artifactPath": "./content/lol.mp3",');
  console.log('        "accessMode": "payment-only-no-download-code"');
  console.log("      }");
  console.log("    ]");
  console.log("  }");
  console.log("");
  console.log(outUi.section("Notes"));
  console.log("  - One route maps to one nustuf worker process.");
  console.log("  - The reverse proxy rewrites /nustuf/<slug>/... to worker-local /...");
  console.log("  - publicOrigin in config is optional; --public can auto-create quick tunnel.");
  process.exit(code);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") usageAndExit(0);
    if (a === "--dry-run") {
      args["dry-run"] = true;
      continue;
    }
    if (a === "--public") {
      args.public = true;
      continue;
    }
    if (a.startsWith("--")) {
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
    args._.push(a);
  }
  return args;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parsePositiveInt(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid ${label}: expected a positive integer`);
  }
  return n;
}

function parseNonNegativeInt(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid ${label}: expected a non-negative integer`);
  }
  return n;
}

function trim(value) {
  return String(value ?? "").trim();
}

function toStringMap(value, label) {
  if (!isPlainObject(value)) return {};
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (!k || typeof k !== "string") {
      throw new Error(`Invalid ${label}: all keys must be non-empty strings`);
    }
    if (v === null || v === undefined) continue;
    out[k] = String(v);
  }
  return out;
}

function toBoolean(value) {
  return value === true;
}

function normalizePrefix(input, label) {
  let prefix = trim(input);
  if (!prefix) throw new Error(`Missing ${label}`);
  if (!prefix.startsWith("/")) prefix = `/${prefix}`;
  prefix = prefix.replace(/\/+$/, "");
  if (!prefix || prefix === "/") {
    throw new Error(`Invalid ${label}: use a non-root path prefix, for example /nustuf/lolboy`);
  }
  return prefix;
}

function ensureHttpOrigin(value, label) {
  const raw = trim(value);
  if (!raw) return "";
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid ${label}: must be an absolute http(s) URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid ${label}: protocol must be http or https`);
  }
  return raw.replace(/\/+$/, "");
}

function stringOrDefault(route, defaults, key, fallback = "") {
  const routeValue = route?.[key];
  if (routeValue !== undefined && routeValue !== null && trim(routeValue) !== "") {
    return String(routeValue);
  }
  const defaultValue = defaults?.[key];
  if (
    defaultValue !== undefined &&
    defaultValue !== null &&
    trim(defaultValue) !== ""
  ) {
    return String(defaultValue);
  }
  return fallback;
}

function boolOrDefault(route, defaults, key, fallback = false) {
  if (route?.[key] !== undefined) return toBoolean(route[key]);
  if (defaults?.[key] !== undefined) return toBoolean(defaults[key]);
  return fallback;
}

function arrayToStrings(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}: expected an array of strings`);
  return value.map((item, idx) => {
    const str = String(item ?? "").trim();
    if (!str) throw new Error(`Invalid ${label}[${idx}]: value must be a non-empty string`);
    return str;
  });
}

function shellQuote(value) {
  const raw = String(value ?? "");
  if (/^[A-Za-z0-9_./:=+-]+$/.test(raw)) return raw;
  return JSON.stringify(raw);
}

function looksSensitiveEnvKey(key) {
  const normalized = String(key || "").toLowerCase();
  return (
    normalized.includes("secret") ||
    normalized.includes("token") ||
    normalized.includes("private") ||
    normalized.includes("password") ||
    normalized.includes("key")
  );
}

function redactEnvForDisplay(envObj) {
  const redacted = {};
  for (const [k, v] of Object.entries(envObj)) {
    redacted[k] = looksSensitiveEnvKey(k) ? "<redacted>" : String(v);
  }
  return redacted;
}

function appendForwardedFor(existing, remoteAddress) {
  const current = trim(existing || "");
  const remote = trim(remoteAddress || "");
  if (!current) return remote;
  if (!remote) return current;
  return `${current}, ${remote}`;
}

function matchRouteByPrefix(routes, pathname) {
  for (const route of routes) {
    if (pathname === route.prefix) return route;
    if (pathname.startsWith(`${route.prefix}/`)) return route;
  }
  return null;
}

function rewritePathForRoute(pathname, prefix) {
  const suffix = pathname.slice(prefix.length);
  if (!suffix) return "/";
  if (suffix.startsWith("/")) return suffix;
  return `/${suffix}`;
}

function attachPrefixedOutput(stream, outputStream, prefix, onLine = null) {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      outputStream.write(`${prefix}${line}\n`);
      if (typeof onLine === "function") onLine(line);
    }
  });
  stream.on("end", () => {
    if (buffer) {
      outputStream.write(`${prefix}${buffer}\n`);
      if (typeof onLine === "function") onLine(buffer);
    }
  });
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

function printCloudflaredInstallHelp() {
  logError("--public requested, but cloudflared is unavailable.");
  logWarn("cloudflared is required to create a public tunnel URL.");
  console.error("");
  console.error(errUi.section("Install cloudflared"));
  console.error("  macOS (Homebrew): brew install cloudflared");
  console.error("  Windows (winget): winget install --id Cloudflare.cloudflared");
  console.error("  Linux packages/docs: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/");
  console.error("");
  console.error(errUi.section("Retry"));
  console.error(
    `  nustuf host --config ./examples/multi-host.example.json --public --public-confirm ${PUBLIC_CONFIRM_PHRASE}`,
  );
}

async function ensurePublicExposureConfirmedForHost(args) {
  if (!args.public) return;

  const provided =
    typeof args["public-confirm"] === "string" ? args["public-confirm"].trim() : "";
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
    logWarn("You are about to expose local content to the public internet.");
    const answer = (
      await rl.question(`[nustuf-host] Type ${PUBLIC_CONFIRM_PHRASE} to continue: `)
    ).trim();
    if (answer !== PUBLIC_CONFIRM_PHRASE) {
      throw new Error("Public exposure confirmation failed. Aborting.");
    }
  } finally {
    rl.close();
  }
}

function buildRoutePlan(config, cliArgs) {
  const proxyCfg = isPlainObject(config.proxy) ? config.proxy : {};
  const defaults = isPlainObject(config.defaults) ? config.defaults : {};
  const routes = Array.isArray(config.routes) ? config.routes : null;
  if (!routes || routes.length === 0) {
    throw new Error("Missing routes: provide at least one route in config.routes");
  }

  const proxyHost = trim(cliArgs["proxy-host"] || proxyCfg.host || "127.0.0.1");
  if (!proxyHost) throw new Error("Invalid proxy host");
  const proxyPort = parsePositiveInt(
    cliArgs["proxy-port"] ?? proxyCfg.port ?? 4080,
    "proxy port",
  );

  const configuredOrigin = ensureHttpOrigin(config.publicOrigin || "", "publicOrigin");
  const localFallbackOrigin = `http://127.0.0.1:${proxyPort}`;
  const publicOriginMode = configuredOrigin
    ? "configured_origin"
    : (cliArgs.public ? "quick_tunnel" : "local_only");

  const usedPrefixes = new Set();
  const usedPorts = new Set();
  const plannedRoutes = [];

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    const label = `routes[${i}]`;
    if (!isPlainObject(route)) {
      throw new Error(`Invalid ${label}: expected an object`);
    }

    const prefix = normalizePrefix(route.prefix, `${label}.prefix`);
    if (usedPrefixes.has(prefix)) {
      throw new Error(`Duplicate route prefix: ${prefix}`);
    }
    usedPrefixes.add(prefix);

    const port = parsePositiveInt(route.port, `${label}.port`);
    if (usedPorts.has(port)) {
      throw new Error(`Duplicate route port: ${port}`);
    }
    usedPorts.add(port);

    const artifactPath = stringOrDefault(route, defaults, "artifactPath");
    if (!trim(artifactPath)) {
      throw new Error(`Missing ${label}.artifactPath`);
    }

    const accessMode = stringOrDefault(route, defaults, "accessMode", DEFAULT_ACCESS_MODE)
      .trim()
      .toLowerCase();
    if (!isValidAccessMode(accessMode)) {
      throw new Error(`Invalid ${label}.accessMode: ${accessMode}`);
    }
    const requiresPayment = accessModeRequiresPayment(accessMode);
    const requiresDownloadCode = accessModeRequiresDownloadCode(accessMode);

    const windowValue = stringOrDefault(route, defaults, "window");
    if (!trim(windowValue)) {
      throw new Error(`Missing ${label}.window (required for non-interactive launch)`);
    }

    const payTo = stringOrDefault(route, defaults, "payTo");
    const price = stringOrDefault(route, defaults, "price");
    if (requiresPayment && !trim(payTo)) {
      throw new Error(`Missing ${label}.payTo (required for payment access modes)`);
    }
    if (requiresPayment && !trim(price)) {
      throw new Error(`Missing ${label}.price (required for payment access modes)`);
    }

    const network = stringOrDefault(route, defaults, "network");
    const facilitatorMode = stringOrDefault(route, defaults, "facilitatorMode");
    const facilitatorUrl = stringOrDefault(route, defaults, "facilitatorUrl");
    const confirmationPolicy = stringOrDefault(route, defaults, "confirmationPolicy");
    const cdpApiKeyId = stringOrDefault(route, defaults, "cdpApiKeyId");
    const cdpApiKeySecret = stringOrDefault(route, defaults, "cdpApiKeySecret");

    const ogTitle = stringOrDefault(route, defaults, "ogTitle");
    const ogDescription = stringOrDefault(route, defaults, "ogDescription");
    const ogImageUrl = stringOrDefault(route, defaults, "ogImageUrl");

    const routeEnv = {
      ...toStringMap(defaults.env, "defaults.env"),
      ...toStringMap(route.env, `${label}.env`),
    };

    const downloadCodeHash = stringOrDefault(route, defaults, "downloadCodeHash");
    if (downloadCodeHash && !routeEnv.DOWNLOAD_CODE_HASH) {
      routeEnv.DOWNLOAD_CODE_HASH = downloadCodeHash;
    }

    const downloadCode = stringOrDefault(route, defaults, "downloadCode");
    if (
      requiresDownloadCode &&
      !downloadCode &&
      !trim(routeEnv.DOWNLOAD_CODE_HASH || "")
    ) {
      throw new Error(
        `Missing ${label}.downloadCode or ${label}.downloadCodeHash for download-code access mode`,
      );
    }

    const endedWindowSecondsRaw = route.endedWindowSeconds ?? defaults.endedWindowSeconds;
    let endedWindowSeconds = null;
    if (
      endedWindowSecondsRaw !== undefined &&
      endedWindowSecondsRaw !== null &&
      `${endedWindowSecondsRaw}` !== ""
    ) {
      endedWindowSeconds = parseNonNegativeInt(
        endedWindowSecondsRaw,
        `${label}.endedWindowSeconds`,
      );
    }

    const confirmed = boolOrDefault(route, defaults, "confirmed", false);
    const allowSensitivePath = boolOrDefault(route, defaults, "allowSensitivePath", false);
    const acknowledgeSensitivePathRisk = boolOrDefault(
      route,
      defaults,
      "acknowledgeSensitivePathRisk",
      false,
    );
    if (allowSensitivePath !== acknowledgeSensitivePathRisk) {
      throw new Error(
        `${label}: allowSensitivePath and acknowledgeSensitivePathRisk must both be true together`,
      );
    }

    const extraArgs = arrayToStrings(route.extraArgs, `${label}.extraArgs`);
    const slug = trim(route.slug) || prefix.split("/").filter(Boolean).pop() || `route-${i + 1}`;
    const restartOnExit = boolOrDefault(route, defaults, "restartOnExit", false);

    const publishArgs = [
      "--file",
      artifactPath,
      "--access-mode",
      accessMode,
      "--window",
      windowValue,
      "--port",
      String(port),
    ];
    if (requiresPayment) {
      publishArgs.push("--price", price, "--pay-to", payTo);
    }
    if (network) publishArgs.push("--network", network);
    if (confirmed) publishArgs.push("--confirmed");
    if (!confirmed && confirmationPolicy) {
      publishArgs.push("--confirmation-policy", confirmationPolicy);
    }
    if (requiresDownloadCode && downloadCode) {
      publishArgs.push("--download-code", downloadCode);
    }
    if (facilitatorMode) publishArgs.push("--facilitator-mode", facilitatorMode);
    if (facilitatorUrl) publishArgs.push("--facilitator-url", facilitatorUrl);
    if (cdpApiKeyId) publishArgs.push("--cdp-api-key-id", cdpApiKeyId);
    if (cdpApiKeySecret) publishArgs.push("--cdp-api-key-secret", cdpApiKeySecret);
    if (ogTitle) publishArgs.push("--og-title", ogTitle);
    if (ogDescription) publishArgs.push("--og-description", ogDescription);
    if (ogImageUrl) publishArgs.push("--og-image-url", ogImageUrl);
    if (endedWindowSeconds !== null) {
      publishArgs.push("--ended-window-seconds", String(endedWindowSeconds));
    }
    if (allowSensitivePath && acknowledgeSensitivePathRisk) {
      publishArgs.push("--allow-sensitive-path", "--acknowledge-sensitive-path-risk");
    }
    publishArgs.push(...extraArgs);

    plannedRoutes.push({
      slug,
      prefix,
      port,
      requiresPayment,
      requiresDownloadCode,
      restartOnExit,
      publishArgs,
      routeEnv,
      publicBaseUrl: "",
      env: null,
      status: "pending",
      restarts: 0,
      child: null,
      pid: null,
      lastExitCode: null,
      lastSignal: null,
      starting: false,
    });
  }

  plannedRoutes.sort((a, b) => b.prefix.length - a.prefix.length);
  return {
    proxyHost,
    proxyPort,
    configuredOrigin,
    localFallbackOrigin,
    publicOriginMode,
    routes: plannedRoutes,
  };
}

function applyPublicOriginToRoutes(routes, publicOrigin) {
  const normalized = String(publicOrigin).replace(/\/+$/, "");
  for (const route of routes) {
    route.publicBaseUrl = `${normalized}${route.prefix}`;
    route.env = {
      ...process.env,
      ...route.routeEnv,
      PUBLIC_BASE_URL: route.publicBaseUrl,
    };
  }
}

function computeDryRunOriginPreview(plan) {
  if (plan.publicOriginMode === "configured_origin") return plan.configuredOrigin;
  if (plan.publicOriginMode === "local_only") return plan.localFallbackOrigin;
  return "<quick-tunnel-origin-at-runtime>";
}

function printDryRun(plan, configPath) {
  const dryRunOrigin = computeDryRunOriginPreview(plan);
  const modeLabel =
    plan.publicOriginMode === "configured_origin"
      ? "configured origin"
      : (plan.publicOriginMode === "quick_tunnel" ? "quick tunnel" : "local-only fallback");

  console.log(outUi.section("Multi-host Dry Run"));
  console.log("");
  for (const line of outUi.formatRows([
    { key: "config", value: configPath },
    { key: "proxy_host", value: plan.proxyHost },
    { key: "proxy_port", value: plan.proxyPort },
    { key: "origin_mode", value: modeLabel },
    { key: "public_origin", value: dryRunOrigin },
  ])) {
    console.log(line);
  }
  console.log("");
  for (const route of plan.routes) {
    const previewPublicBaseUrl = `${dryRunOrigin}${route.prefix}`;
    console.log(outUi.section(`Route ${route.slug}`));
    for (const line of outUi.formatRows([
      { key: "prefix", value: route.prefix },
      { key: "public_base_url", value: previewPublicBaseUrl },
      { key: "local_target", value: `http://127.0.0.1:${route.port}` },
      { key: "requires_payment", value: route.requiresPayment ? "yes" : "no" },
      {
        key: "requires_download_code",
        value: route.requiresDownloadCode ? "yes" : "no",
      },
    ])) {
      console.log(line);
    }

    const command = [process.execPath, PUBLISH_SCRIPT_PATH, ...route.publishArgs]
      .map(shellQuote)
      .join(" ");
    console.log(`  command: ${command}`);
    const envForDisplay = redactEnvForDisplay({
      PUBLIC_BASE_URL: previewPublicBaseUrl,
      DOWNLOAD_CODE_HASH: route.routeEnv.DOWNLOAD_CODE_HASH,
      FACILITATOR_MODE: route.routeEnv.FACILITATOR_MODE,
      FACILITATOR_URL: route.routeEnv.FACILITATOR_URL,
    });
    for (const [k, v] of Object.entries(envForDisplay)) {
      if (v === undefined || v === "undefined") continue;
      console.log(`  env.${k}: ${v}`);
    }
    console.log("");
  }
}

async function startQuickTunnelForProxy({ proxyPort, timeoutMs = 30000 }) {
  const urlRegex = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi;
  return new Promise((resolve, reject) => {
    let settled = false;
    const proc = spawn(
      "cloudflared",
      ["tunnel", "--url", `http://localhost:${proxyPort}`, "--no-autoupdate"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout?.off("data", onData);
      proc.stderr?.off("data", onData);
      proc.off("error", onError);
      proc.off("exit", onEarlyExit);
    };

    const fail = (message) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        proc.kill("SIGTERM");
      } catch {
        // best effort only
      }
      reject(new Error(message));
    };

    const succeed = (origin) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ origin: String(origin).replace(/\/+$/, ""), proc });
    };

    const onData = (chunk) => {
      const s = chunk.toString("utf8");
      const m = s.match(urlRegex);
      if (m && m[0]) succeed(m[0]);
    };

    const onError = (err) => {
      if (err?.code === "ENOENT") {
        fail("cloudflared not found. Install it or run without --public.");
        return;
      }
      fail(`failed to start tunnel: ${err?.message || String(err)}`);
    };

    const onEarlyExit = (code, signal) => {
      fail(
        signal
          ? `tunnel exited before URL was assigned (signal ${signal})`
          : `tunnel exited before URL was assigned (code ${code})`,
      );
    };

    const timer = setTimeout(() => {
      fail("Timed out waiting for quick tunnel URL");
    }, timeoutMs);

    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("error", onError);
    proc.on("exit", onEarlyExit);
  });
}

function printPublicTunnelSummary(publicOrigin, routes) {
  console.log("");
  console.log(outUi.section("Public Tunnel"));
  for (const line of outUi.formatRows([
    { key: "public_origin", value: outUi.link(publicOrigin) },
  ])) {
    console.log(line);
  }

  for (const route of routes) {
    const promoUrl = `${route.publicBaseUrl}/`;
    const buyUrl = `${route.publicBaseUrl}/download`;
    for (const line of outUi.formatRows([
      { key: `${route.slug}_promo`, value: outUi.link(promoUrl) },
      { key: `${route.slug}_buy`, value: outUi.link(buyUrl) },
    ])) {
      console.log(line);
    }
  }
  console.log("");
}

function lineSignalsRouteReady(route, line) {
  const text = String(line || "").trim();
  if (!text) return false;
  const readyRe = new RegExp(
    `^download\\s+http:\\/\\/(?:localhost|127\\.0\\.0\\.1):${route.port}\\/download\\b`,
  );
  return readyRe.test(text);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args._.length > 0) {
    usageAndExit(1, `Unexpected positional arguments: ${args._.join(" ")}`);
  }

  const configArg = trim(args.config);
  if (!configArg) usageAndExit(1, "Missing required --config <path>");
  const configPath = path.resolve(process.cwd(), configArg);

  if (!fs.existsSync(configPath)) {
    logError(`Config file not found: ${configPath}`);
    process.exit(1);
  }

  let parsedConfig;
  try {
    parsedConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (err) {
    logError(`Failed to parse JSON config: ${err?.message || String(err)}`);
    process.exit(1);
  }

  let plan;
  try {
    plan = buildRoutePlan(parsedConfig, args);
  } catch (err) {
    logError(err?.message || String(err));
    process.exit(1);
  }

  try {
    await ensurePublicExposureConfirmedForHost(args);
  } catch (err) {
    logError(err?.message || String(err));
    process.exit(1);
  }

  if (args["dry-run"]) {
    printDryRun(plan, configPath);
    process.exit(0);
  }

  const runtime = {
    shuttingDown: false,
    serverClosed: false,
    forceExitTimer: null,
    tunnelProc: null,
    publicSummaryEnabled: false,
    publicSummaryPrinted: false,
    publicSummaryOrigin: "",
    publicSummaryTimer: null,
  };

  function maybeExit() {
    if (!runtime.shuttingDown) return;
    const hasAliveChild = plan.routes.some((route) => route.child !== null);
    const hasTunnel = runtime.tunnelProc !== null;
    if (!hasAliveChild && !hasTunnel && runtime.serverClosed) {
      if (runtime.publicSummaryTimer) clearTimeout(runtime.publicSummaryTimer);
      if (runtime.forceExitTimer) clearTimeout(runtime.forceExitTimer);
      process.exit(0);
    }
  }

  function maybePrintPublicSummary() {
    if (!runtime.publicSummaryEnabled || runtime.publicSummaryPrinted) return;
    const allReady = plan.routes.every((route) => route.startupReady);
    if (!allReady) return;
    runtime.publicSummaryPrinted = true;
    if (runtime.publicSummaryTimer) {
      clearTimeout(runtime.publicSummaryTimer);
      runtime.publicSummaryTimer = null;
    }
    printPublicTunnelSummary(runtime.publicSummaryOrigin, plan.routes);
  }

  function schedulePublicSummary(origin) {
    runtime.publicSummaryEnabled = true;
    runtime.publicSummaryPrinted = false;
    runtime.publicSummaryOrigin = origin;

    if (runtime.publicSummaryTimer) clearTimeout(runtime.publicSummaryTimer);
    runtime.publicSummaryTimer = setTimeout(() => {
      if (runtime.shuttingDown || runtime.publicSummaryPrinted) return;
      runtime.publicSummaryPrinted = true;
      runtime.publicSummaryTimer = null;
      logWarn("Timed out waiting for all route startup banners; printing public URLs anyway.");
      printPublicTunnelSummary(runtime.publicSummaryOrigin, plan.routes);
    }, 12000);
  }

  function shutdown(signal) {
    if (runtime.shuttingDown) return;
    runtime.shuttingDown = true;
    logInfo(`Received ${signal}. Shutting down proxy, tunnel, and route workers...`);

    runtime.forceExitTimer = setTimeout(() => {
      logWarn("Force exiting after timeout.");
      process.exit(1);
    }, 8000);

    proxyServer.close(() => {
      runtime.serverClosed = true;
      maybeExit();
    });

    if (runtime.tunnelProc && !runtime.tunnelProc.killed) {
      try {
        runtime.tunnelProc.kill("SIGTERM");
      } catch {
        // best effort only
      }
    }

    for (const route of plan.routes) {
      if (route.child && !route.child.killed) {
        route.child.kill("SIGTERM");
      }
    }

    setTimeout(() => {
      if (runtime.tunnelProc && !runtime.tunnelProc.killed) {
        try {
          runtime.tunnelProc.kill("SIGKILL");
        } catch {
          // best effort only
        }
      }

      for (const route of plan.routes) {
        if (route.child && !route.child.killed) {
          route.child.kill("SIGKILL");
        }
      }
    }, 3000);

    if (runtime.publicSummaryTimer) {
      clearTimeout(runtime.publicSummaryTimer);
      runtime.publicSummaryTimer = null;
    }
  }

  function startRoute(route) {
    if (runtime.shuttingDown || route.starting) return;
    if (!route.env) {
      throw new Error(`Missing route environment for ${route.slug}; PUBLIC_BASE_URL not initialized`);
    }

    route.starting = true;
    route.status = "starting";

    const child = spawn(process.execPath, [PUBLISH_SCRIPT_PATH, ...route.publishArgs], {
      stdio: ["ignore", "pipe", "pipe"],
      env: route.env,
    });

    route.child = child;
    route.pid = child.pid ?? null;
    route.lastExitCode = null;
    route.lastSignal = null;
    route.status = "running";
    route.starting = false;
    route.startupReady = false;

    const onRouteLine = (line) => {
      if (route.startupReady) return;
      if (!lineSignalsRouteReady(route, line)) return;
      route.startupReady = true;
      maybePrintPublicSummary();
    };
    attachPrefixedOutput(child.stdout, process.stdout, `[${route.slug}] `, onRouteLine);
    attachPrefixedOutput(child.stderr, process.stderr, `[${route.slug}] `, onRouteLine);

    child.on("error", (err) => {
      route.status = "error";
      route.lastSignal = "spawn-error";
      logError(`route=${route.slug} spawn failed: ${err?.message || String(err)}`);
    });

    child.on("exit", (code, signal) => {
      route.child = null;
      route.pid = null;
      route.lastExitCode = code;
      route.lastSignal = signal || null;
      route.status = runtime.shuttingDown ? "stopped" : "exited";

      if (runtime.shuttingDown) {
        maybeExit();
        return;
      }

      logWarn(
        `route=${route.slug} exited (code=${code ?? "null"}, signal=${signal || "none"})`,
      );

      if (route.restartOnExit) {
        route.restarts += 1;
        logInfo(`route=${route.slug} restarting in 1s (restart count=${route.restarts})`);
        setTimeout(() => {
          if (!runtime.shuttingDown) startRoute(route);
        }, 1000);
      }
    });
  }

  const proxyServer = http.createServer((req, res) => {
    const method = String(req.method || "GET").toUpperCase();
    const parsedUrl = new URL(
      String(req.url || "/"),
      `http://${req.headers.host || "localhost"}`,
    );
    const pathname = parsedUrl.pathname || "/";

    if (method === "GET" && pathname === "/health") {
      const routes = plan.routes.map((route) => ({
        slug: route.slug,
        prefix: route.prefix,
        port: route.port,
        status: route.status,
        pid: route.pid,
        restarts: route.restarts,
        public_base_url: route.publicBaseUrl || null,
        last_exit_code: route.lastExitCode,
        last_signal: route.lastSignal,
      }));
      const allRunning = routes.every((route) => route.status === "running");
      const body = {
        ok: allRunning,
        proxy: {
          host: plan.proxyHost,
          port: plan.proxyPort,
        },
        routes,
      };
      res.statusCode = allRunning ? 200 : 503;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(`${JSON.stringify(body, null, 2)}\n`);
      return;
    }

    if (method === "GET" && pathname === "/") {
      const lines = [
        "nustuf multi-host reverse proxy",
        "",
        "available route prefixes:",
        ...plan.routes.map((route) => `- ${route.prefix}/ -> http://127.0.0.1:${route.port}/`),
        "",
        "health: /health",
      ];
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end(`${lines.join("\n")}\n`);
      return;
    }

    const route = matchRouteByPrefix(plan.routes, pathname);
    if (!route) {
      res.statusCode = 404;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(
        `${JSON.stringify(
          {
            error: "no matching route prefix",
            path: pathname,
            routes: plan.routes.map((entry) => entry.prefix),
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    if (route.status !== "running") {
      res.statusCode = 503;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(
        `${JSON.stringify(
          {
            error: "route backend unavailable",
            slug: route.slug,
            status: route.status,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    const upstreamPath = `${rewritePathForRoute(pathname, route.prefix)}${parsedUrl.search || ""}`;
    const forwardedHeaders = {
      ...req.headers,
      host: `127.0.0.1:${route.port}`,
      "x-forwarded-for": appendForwardedFor(
        req.headers["x-forwarded-for"],
        req.socket?.remoteAddress || "",
      ),
      "x-forwarded-host": String(req.headers.host || ""),
      "x-forwarded-prefix": route.prefix,
      "x-forwarded-proto": String(req.headers["x-forwarded-proto"] || "http"),
    };

    const upstreamReq = http.request(
      {
        host: "127.0.0.1",
        port: route.port,
        method,
        path: upstreamPath,
        headers: forwardedHeaders,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );

    upstreamReq.on("error", (err) => {
      res.statusCode = 502;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(
        `${JSON.stringify(
          {
            error: "upstream request failed",
            slug: route.slug,
            message: err?.message || String(err),
          },
          null,
          2,
        )}\n`,
      );
    });

    req.on("aborted", () => {
      upstreamReq.destroy();
    });
    req.pipe(upstreamReq);
  });

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  proxyServer.on("error", (err) => {
    logError(`Proxy server error: ${err?.message || String(err)}`);
    shutdown("proxy-error");
  });

  async function initializeRuntime() {
    logInfo(`Health endpoint: http://${plan.proxyHost}:${plan.proxyPort}/health`);

    let resolvedPublicOrigin = plan.localFallbackOrigin;

    if (plan.publicOriginMode === "configured_origin") {
      resolvedPublicOrigin = plan.configuredOrigin;
      if (args.public) {
        logInfo("Using configured publicOrigin; skipping quick tunnel startup.");
      } else {
        logInfo("Using configured publicOrigin from config.");
      }
    } else if (plan.publicOriginMode === "quick_tunnel") {
      const preflight = cloudflaredPreflight();
      if (!preflight.ok) {
        printCloudflaredInstallHelp();
        shutdown("cloudflared_missing");
        return;
      }

      logInfo("Starting Cloudflare quick tunnel for shared proxy...");

      let tunnel;
      try {
        tunnel = await startQuickTunnelForProxy({ proxyPort: plan.proxyPort });
      } catch (err) {
        logError(`Failed to start quick tunnel: ${err?.message || String(err)}`);
        shutdown("tunnel_setup_failed");
        return;
      }

      runtime.tunnelProc = tunnel.proc;
      resolvedPublicOrigin = tunnel.origin;

      runtime.tunnelProc.on("exit", (code, signal) => {
        const wasShuttingDown = runtime.shuttingDown;
        runtime.tunnelProc = null;

        if (wasShuttingDown) {
          maybeExit();
          return;
        }

        logError(
          signal
            ? `Public tunnel exited unexpectedly (signal ${signal})`
            : `Public tunnel exited unexpectedly (code ${code})`,
        );
        shutdown("tunnel_fatal");
      });
    } else {
      logInfo("Running in local-only mode (no public tunnel). Use --public to auto-create quick tunnel.");
    }

    applyPublicOriginToRoutes(plan.routes, resolvedPublicOrigin);

    const shouldPrintPublicSummary =
      args.public || plan.publicOriginMode === "configured_origin";
    if (shouldPrintPublicSummary) {
      schedulePublicSummary(resolvedPublicOrigin);
    }

    for (const route of plan.routes) startRoute(route);
  }

  proxyServer.listen(plan.proxyPort, plan.proxyHost, () => {
    logOk(`Proxy listening on http://${plan.proxyHost}:${plan.proxyPort}`);
    void initializeRuntime().catch((err) => {
      logError(err?.message || String(err));
      shutdown("runtime_init_error");
    });
  });
}

main().catch((err) => {
  logError(err?.message || String(err));
  process.exit(1);
});
