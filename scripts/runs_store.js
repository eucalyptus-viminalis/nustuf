import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const RUNS_DIR = ".nustuf/runs";

export function getRunsDirPath() {
  const home = process.env.HOME || os.homedir();
  return path.join(home, RUNS_DIR);
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function processCommand(pid) {
  const res = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  return res.status === 0 ? String(res.stdout || "").trim() : "";
}

// True only when the pid is alive AND still looks like a nustuf publish process, so a recycled
// pid never gets reported as serving (or signalled by `nustuf stop`).
export function isPublishProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (err) {
    if (err?.code !== "EPERM") return false;
  }
  return /publish\.js/.test(processCommand(pid));
}

function describeRun(raw) {
  const now = nowSeconds();
  const recordedRunning = raw.status === "running";
  // Records written before pid tracking (<= 0.7.0) can't be verified; never call them stale.
  const legacy = recordedRunning && !raw.pid;
  const alive = recordedRunning && !legacy && isPublishProcess(raw.pid);
  // "running" on disk with no live process means the supervisor was killed without cleaning up.
  const state = legacy
    ? "unknown"
    : recordedRunning
      ? (alive ? "serving" : "stale")
      : String(raw.status || "unknown");
  const saleEndTs = Number(raw.saleEndTs) || null;
  const hardStopTs = Number(raw.hardStopTs) || null;
  const phase = !alive
    ? null
    : saleEndTs && now >= saleEndTs
      ? "ended-window"
      : "selling";
  return {
    id: raw.runId,
    state,
    phase,
    pid: raw.pid ?? null,
    title: raw.title || null,
    file: raw.file || null,
    priceUsdc: raw.price ?? null,
    network: raw.network || null,
    accessMode: raw.accessMode || null,
    port: raw.port ?? null,
    publicUrl: raw.latestPromoUrl || raw.latestPublicUrl || null,
    buyUrl: raw.latestBuyUrl || null,
    startedAtTs: Number(raw.saleStartTs) || Number(raw.createdAtTs) || null,
    saleEndTs,
    hardStopTs,
    secondsUntilSaleEnd: alive && saleEndTs ? Math.max(0, saleEndTs - now) : null,
    secondsUntilStop: alive && hardStopTs ? Math.max(0, hardStopTs - now) : null,
    restartCount: raw.restartCount ?? 0,
    lastExitReason: raw.lastExitReason || null,
    // On-chain listing: { status, signer, signerSource, chain, txHash, explorerUrl, error }, or null.
    announce: raw.announce || null,
    updatedAtTs: raw.updatedAtTs ?? null,
  };
}

export function listRuns() {
  const dir = getRunsDirPath();
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const runs = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name === "latest.json") continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      if (raw && typeof raw === "object" && raw.runId) runs.push(describeRun(raw));
    } catch {
      // skip unreadable or half-written files
    }
  }
  return runs.sort((a, b) => (b.startedAtTs || 0) - (a.startedAtTs || 0));
}

export function listServing() {
  return listRuns().filter((run) => run.state === "serving");
}

// Mark stale records as stopped so they stop showing up as live.
export function markStaleRunsStopped() {
  const dir = getRunsDirPath();
  for (const run of listRuns()) {
    if (run.state !== "stale") continue;
    const statePath = path.join(dir, `${run.id}.json`);
    try {
      const raw = JSON.parse(fs.readFileSync(statePath, "utf8"));
      raw.status = "stopped";
      raw.lastExitReason = "process_missing";
      raw.updatedAtTs = nowSeconds();
      fs.writeFileSync(statePath, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
    } catch {
      // best effort
    }
  }
}
