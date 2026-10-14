#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createUi } from "./ui.js";
import { isPublishProcess, listRuns, markStaleRunsStopped } from "./runs_store.js";

const outUi = createUi(process.stdout);
const errUi = createUi(process.stderr);

const [mode, ...rest] = process.argv.slice(2);

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return "n/a";
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function formatAnnounce(a) {
  const detail = a.status === "failed" ? a.error : a.explorerUrl || a.txHash;
  return `${a.status} on ${a.chain} from ${a.signer} (${a.signerSource})${detail ? ` · ${detail}` : ""}`;
}

function swiftbarText(value) {
  // SwiftBar treats "|" as the parameter separator and newlines as line breaks.
  return String(value ?? "").replace(/\|/g, "¦").replace(/[\r\n]+/g, " ").trim();
}

function printSwiftbar(runs) {
  const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "cli.js");
  // Absolute node + cli paths: SwiftBar actions don't inherit the user's shell PATH.
  const action = (...args) =>
    `bash="${process.execPath}" param1="${cli}" ${args.map((a, i) => `param${i + 2}="${a}"`).join(" ")} terminal=false refresh=true`;
  const serving = runs.filter((run) => run.state === "serving");

  if (serving.length === 0) {
    console.log("○ | color=#8e8e93 tooltip=\"nustuf: nothing is being served\"");
    console.log("---");
    console.log("Nothing is being served | color=#8e8e93");
    console.log("Refresh | refresh=true");
    return;
  }

  console.log(`● ${serving.length} | color=#34c759 tooltip="nustuf is serving ${serving.length} item(s)"`);
  console.log("---");
  console.log(`Serving from this Mac | size=11 color=#8e8e93`);
  for (const run of serving) {
    const name = swiftbarText(run.title || run.file || run.id.slice(0, 8));
    const price = run.priceUsdc !== null ? ` · ${run.priceUsdc} USDC` : "";
    console.log(`${name}${price} | color=#34c759`);
    const url = run.publicUrl;
    console.log(`--${run.phase === "ended-window" ? "Sale ended, page still up" : "Selling"}${run.secondsUntilSaleEnd !== null && run.phase === "selling" ? ` · ${formatDuration(run.secondsUntilSaleEnd)} left` : ""}`);
    if (run.secondsUntilStop !== null) console.log(`--Stops in ${formatDuration(run.secondsUntilStop)}`);
    if (url) {
      console.log(`--${swiftbarText(url)} | href=${url}`);
      console.log(`--Open in browser | href=${url}`);
      console.log(`--Copy link | bash=/bin/sh param1=-c param2='printf %s "${url}" | pbcopy' terminal=false`);
    } else {
      console.log(`--Local only (http://localhost:${run.port})${run.port ? ` | href=http://localhost:${run.port}` : ""}`);
    }
    if (run.restartCount) console.log(`--Restarted ${run.restartCount}x | color=#ff9500`);
    console.log(`--Stop | ${action("stop", run.id)}`);
  }
  console.log("---");
  if (serving.length > 1) console.log(`Stop all | ${action("stop", "all")}`);
  console.log("Refresh | refresh=true");
}

function printStatusHelp() {
  console.log(outUi.heading("nustuf status"));
  console.log("  nustuf status [--json] [--all]");
  console.log("");
  console.log("  Lists what this machine is serving right now (one entry per `nustuf publish`).");
  console.log("  --json   Machine-readable output (used by the SwiftBar plugin and agents)");
  console.log("  --all    Include stopped and failed runs");
  console.log("  --swiftbar   Output in SwiftBar plugin format (see integrations/swiftbar)");
}

function printStopHelp() {
  console.log(outUi.heading("nustuf stop"));
  console.log("  nustuf stop <run-id-or-prefix> | all");
}

function runStatus(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return printStatusHelp();
  const json = argv.includes("--json");
  const all = argv.includes("--all");
  markStaleRunsStopped();
  const runs = listRuns();
  const shown = all ? runs : runs.filter((run) => run.state === "serving");

  if (argv.includes("--swiftbar")) return printSwiftbar(runs);

  if (json) {
    console.log(JSON.stringify({ serving: runs.filter((r) => r.state === "serving").length, runs: shown }, null, 2));
    return;
  }

  if (shown.length === 0) {
    console.log(outUi.statusLine("info", "Nothing is being served from this machine."));
    return;
  }

  console.log(outUi.section(`Serving ${runs.filter((r) => r.state === "serving").length} item(s)`));
  for (const run of shown) {
    console.log("");
    const headline = run.title || run.file || run.id;
    console.log(`${run.state === "serving" ? outUi.ok("●") : outUi.muted("○")} ${headline}`);
    const rows = [
      { key: "id", value: run.id.slice(0, 8) },
      { key: "state", value: run.phase ? `${run.state} (${run.phase})` : run.state },
      { key: "price", value: run.priceUsdc !== null ? `${run.priceUsdc} USDC` : null },
      { key: "url", value: run.publicUrl ? outUi.link(run.publicUrl) : run.port ? `http://localhost:${run.port} (local only)` : null },
      { key: "sale ends in", value: run.secondsUntilSaleEnd !== null ? formatDuration(run.secondsUntilSaleEnd) : null },
      { key: "stops in", value: run.secondsUntilStop !== null ? formatDuration(run.secondsUntilStop) : null },
      { key: "pid", value: run.pid },
      { key: "restarts", value: run.restartCount || null },
      { key: "announce", value: run.announce ? formatAnnounce(run.announce) : null },
    ];
    for (const line of outUi.formatRows(rows)) console.log(line);
  }
  console.log("");
  console.log(outUi.muted("Stop one with: nustuf stop <id>   Stop everything: nustuf stop all"));
}

async function runStop(argv) {
  if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) return printStopHelp();
  markStaleRunsStopped();
  const target = argv[0];
  const serving = listRuns().filter((run) => run.state === "serving");
  const matches = target === "all" ? serving : serving.filter((run) => run.id.startsWith(target));

  if (matches.length === 0) {
    console.error(errUi.statusLine("error", target === "all" ? "Nothing is being served." : `No running item matches "${target}".`));
    process.exit(1);
  }
  if (target !== "all" && matches.length > 1) {
    console.error(errUi.statusLine("error", `"${target}" matches ${matches.length} runs; use a longer id.`));
    process.exit(1);
  }

  let failed = false;
  for (const run of matches) {
    // Re-verify right before signalling so a recycled pid is never killed.
    if (!isPublishProcess(run.pid)) {
      console.error(errUi.statusLine("warn", `${run.id.slice(0, 8)} is no longer running.`));
      continue;
    }
    try {
      process.kill(run.pid, "SIGTERM"); // publish.js shuts down its server and tunnel on SIGTERM
    } catch (err) {
      failed = true;
      console.error(errUi.statusLine("error", `Could not stop ${run.id.slice(0, 8)}: ${err.message}`));
      continue;
    }
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && isPublishProcess(run.pid)) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (isPublishProcess(run.pid)) {
      failed = true;
      console.error(errUi.statusLine("error", `${run.id.slice(0, 8)} did not exit within 10s (pid ${run.pid}).`));
    } else {
      console.log(outUi.statusLine("ok", `Stopped ${run.title || run.file || run.id.slice(0, 8)}`));
    }
  }
  if (failed) process.exit(1);
}

if (mode === "stop") {
  await runStop(rest);
} else {
  runStatus(rest);
}
