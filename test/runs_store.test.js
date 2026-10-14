// `nustuf status --json` is how agents learn whether a drop's on-chain announce went through.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { listRuns } from "../scripts/runs_store.js";

test("listRuns passes the announce record through", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nustuf-runs-"));
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  t.after(() => { process.env.HOME = prevHome; });
  const runs = path.join(home, ".nustuf", "runs");
  fs.mkdirSync(runs, { recursive: true });
  const announce = {
    status: "confirmed",
    signer: "0x000000000000000000000000000000000000dEaD",
    signerSource: "seller wallet",
    chain: "Base Sepolia",
    txHash: "0x" + "11".repeat(32),
    explorerUrl: "https://sepolia.basescan.org/tx/0x" + "11".repeat(32),
    error: null,
  };
  fs.writeFileSync(path.join(runs, "a.json"), JSON.stringify({ runId: "a", status: "stopped", announce }));
  fs.writeFileSync(path.join(runs, "b.json"), JSON.stringify({ runId: "b", status: "stopped" }));
  const byId = Object.fromEntries(listRuns().map((r) => [r.id, r]));
  assert.deepEqual(byId.a.announce, announce);
  assert.equal(byId.b.announce, null);
});
