import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "scripts", "cli.js");
const SUBCOMMANDS = new Set([
  "publish", "buy", "discover", "feed-ui", "announce", "host", "status", "stop",
  "config", "wallet", "identity", "version",
]);
const home = fs.mkdtempSync(path.join(os.tmpdir(), "nustuf-help-"));

function help(...args) {
  const r = spawnSync(process.execPath, [CLI, ...args, "--help"], {
    cwd: home,
    encoding: "utf8",
    timeout: 5_000,
    env: { PATH: process.env.PATH, HOME: home },
  });
  return { code: r.status, signal: r.signal, out: `${r.stdout}${r.stderr}` };
}

const COMMANDS = [[], ["publish"], ["buy"], ["discover"], ["feed-ui"], ["announce"], ["host"], ["status"], ["config"], ["wallet"], ["identity"]];

for (const cmd of COMMANDS) {
  const name = ["nustuf", ...cmd].join(" ");

  test(`${name} --help prints help and exits 0`, () => {
    const r = help(...cmd);
    assert.equal(r.signal, null, `${name} --help did not exit (killed by ${r.signal})`);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /nustuf/);
  });

  test(`${name} --help only shows runnable commands`, () => {
    const { out } = help(...cmd);
    for (const m of out.matchAll(/(?:^|\s|`)(npm|pnpm) run\b/gm)) {
      assert.fail(`${name} --help suggests "${m[0].trim()}", which this package does not define`);
    }
    for (const m of out.matchAll(/(?:^\s*|`)nustuf ([^\s`]+)/gm)) {
      const word = m[1].replace(/[.,;:)]+$/, "");
      assert.ok(SUBCOMMANDS.has(word), `${name} --help shows "nustuf ${word}", which is not a subcommand`);
    }
  });
}

test("cli help lists every subcommand", () => {
  const { out } = help();
  for (const sub of SUBCOMMANDS) {
    assert.match(out, new RegExp(`nustuf ${sub}\\b`), `missing nustuf ${sub}`);
  }
});
