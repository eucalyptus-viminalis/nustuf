import { spawn, spawnSync } from "node:child_process";

export const TUNNEL_PROVIDERS = ["tailscale", "cloudflared"];
export const DEFAULT_TUNNEL_PROVIDER = "tailscale";

// Funnel only accepts public ports 443, 8443 and 10000. The local port nustuf listens on is
// unrelated: `tailscale funnel --https=<public> <local>` maps one to the other.
export const FUNNEL_PUBLIC_PORTS = [443, 8443, 10000];

export function normalizeTunnelProvider(value) {
  if (value === undefined || value === null || value === true || value === "") {
    return DEFAULT_TUNNEL_PROVIDER;
  }
  const v = String(value).trim().toLowerCase();
  return TUNNEL_PROVIDERS.includes(v) ? v : null;
}

// `tailscale status --json` reports Self.DNSName with a trailing dot, e.g. "mybox.tail1234.ts.net."
export function parseTailscaleStatus(json) {
  let status;
  try {
    status = typeof json === "string" ? JSON.parse(json) : json;
  } catch {
    return { ok: false, reason: "could not parse `tailscale status --json` output." };
  }
  if (!status || typeof status !== "object") {
    return { ok: false, reason: "unexpected `tailscale status --json` output." };
  }
  if (status.BackendState && status.BackendState !== "Running") {
    return {
      ok: false,
      reason: `Tailscale is not running (state: ${status.BackendState}). Run \`tailscale up\` and log in.`,
    };
  }
  const dnsName = String(status.Self?.DNSName || "").replace(/\.$/, "");
  if (!dnsName) {
    return {
      ok: false,
      reason: "this device has no MagicDNS name. Enable MagicDNS and HTTPS certificates for your tailnet.",
    };
  }
  return { ok: true, hostname: dnsName };
}

export function tailscalePreflight() {
  const probe = spawnSync("tailscale", ["status", "--json"], { encoding: "utf8" });
  if (probe.error?.code === "ENOENT") {
    return { ok: false, missing: true, reason: "tailscale is not installed or not on PATH." };
  }
  // The macOS wrapper at /usr/local/bin/tailscale exits non-zero when the app is gone.
  if (probe.error || (probe.status !== 0 && !probe.stdout)) {
    return {
      ok: false,
      missing: probe.status === 127,
      reason: `tailscale check failed: ${(probe.stderr || probe.error?.message || `status ${probe.status}`).toString().trim()}`,
    };
  }
  return parseTailscaleStatus(probe.stdout);
}

export function cloudflaredPreflight() {
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

export function tunnelPreflight(provider) {
  return provider === "cloudflared" ? cloudflaredPreflight() : tailscalePreflight();
}

export function printTunnelInstallHelp(provider, { logError, logWarn, errUi, localOnlyCmd }) {
  logError(`--public requested, but ${provider} is unavailable.`);
  console.error("");
  if (provider === "cloudflared") {
    logWarn("cloudflared is required to create a public tunnel URL with --tunnel cloudflared.");
    console.error(errUi.section("Install cloudflared"));
    console.error("  macOS (Homebrew): brew install cloudflared");
    console.error("  Windows (winget): winget install --id Cloudflare.cloudflared");
    console.error("  Linux packages/docs: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/");
  } else {
    logWarn("Tailscale (v1.38.3+) must be installed and logged in to create a stable public URL.");
    console.error(errUi.section("Set up Tailscale"));
    console.error("  1. Install: https://tailscale.com/download (free Personal plan is enough)");
    console.error("  2. Log in:  tailscale up");
    console.error("  3. In the admin console, enable MagicDNS and HTTPS certificates");
    console.error("  4. Funnel is allowed by default; the first run prints a link if it still needs enabling");
    console.error("");
    console.error("  No Tailscale account? Use a temporary URL instead: --tunnel cloudflared");
  }
  console.error("");
  console.error(errUi.section("Retry"));
  console.error("  nustuf --file <path> --pay-to <address> --public");
  console.error("");
  console.error(errUi.section("Local-only Alternative (No Tunnel)"));
  console.error(`  ${localOnlyCmd}`);
}

// Starts the tunnel as a child process and reports the public origin once it is live.
// Both providers run in the foreground, so killing the child tears the tunnel down.
//
// onUrl(origin)   called once with e.g. "https://mybox.tail1234.ts.net" (no trailing slash)
// onFatal(detail, { retriable }) called if the tunnel cannot start or dies before stop was requested;
//                 retriable=false means retrying cannot help (needs the user to change something)
// returns { proc }
export function startTunnel({ provider, port, hostname, publicPort, onUrl, onFatal }) {
  if (provider === "cloudflared") {
    return startCloudflared({ port, onUrl, onFatal });
  }
  return startTailscaleFunnel({ port, hostname, publicPort, onUrl, onFatal });
}

function startCloudflared({ port, onUrl, onFatal }) {
  const proc = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${port}`, "--no-autoupdate"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const urlRegex = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
  let announced = false;
  const onData = (chunk) => {
    if (announced) return;
    const m = chunk.toString("utf8").match(urlRegex);
    if (m) {
      announced = true;
      proc.stdout.off("data", onData);
      proc.stderr.off("data", onData);
      onUrl(m[0]);
    }
  };
  proc.stdout.on("data", onData);
  proc.stderr.on("data", onData);
  proc.on("error", (err) => {
    onFatal(
      err.code === "ENOENT"
        ? "cloudflared not found. Install it or re-run without --public."
        : `failed to start tunnel: ${err.message}`,
    );
  });
  return { proc };
}

const FUNNEL_ENABLE_HINT = /https:\/\/login\.tailscale\.com\/f\/funnel\S*/i;

function startTailscaleFunnel({ port, hostname, publicPort = 443, onUrl, onFatal }) {
  // Foreground mode (no --bg): Tailscale removes the Funnel config when this process exits,
  // so an interrupted publish never leaves a port open to the internet.
  const proc = spawn("tailscale", ["funnel", `--https=${publicPort}`, String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let announced = false;
  let tail = "";
  const onData = (chunk) => {
    const s = chunk.toString("utf8");
    tail = (tail + s).slice(-2000);
    if (announced) return;
    const hint = tail.match(FUNNEL_ENABLE_HINT);
    if (hint) {
      // Funnel is not enabled for this tailnet yet; the CLI prints a link and waits.
      onFatal(`Funnel is not enabled on your tailnet. Enable it here, then re-run: ${hint[0]}`, { retriable: false });
      return;
    }
    if (/available on the internet/i.test(tail) && hostname) {
      announced = true;
      proc.stdout.off("data", onData);
      proc.stderr.off("data", onData);
      onUrl(`https://${hostname}${publicPort === 443 ? "" : `:${publicPort}`}`);
    }
  };
  proc.stdout.on("data", onData);
  proc.stderr.on("data", onData);
  proc.on("error", (err) => {
    onFatal(
      err.code === "ENOENT"
        ? "tailscale not found. Install it or re-run with --tunnel cloudflared."
        : `failed to start tunnel: ${err.message}`,
    );
  });
  return { proc, getOutputTail: () => tail };
}

// Picks the first public port in FUNNEL_PUBLIC_PORTS that no other Funnel config is using, so
// publishing never overwrites a Funnel the user already runs for something else.
export function pickFunnelPublicPort() {
  const probe = spawnSync("tailscale", ["funnel", "status", "--json"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0 || !probe.stdout.trim()) return FUNNEL_PUBLIC_PORTS[0];
  let cfg;
  try {
    cfg = JSON.parse(probe.stdout);
  } catch {
    return FUNNEL_PUBLIC_PORTS[0];
  }
  const taken = new Set();
  for (const hostPort of Object.keys(cfg?.AllowFunnel || {})) {
    if (cfg.AllowFunnel[hostPort]) taken.add(Number(hostPort.split(":").pop()));
  }
  return FUNNEL_PUBLIC_PORTS.find((p) => !taken.has(p)) ?? null;
}
