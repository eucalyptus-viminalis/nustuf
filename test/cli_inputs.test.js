import { test, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUY = path.join(ROOT, "scripts", "buy.js");
const URL_OK = "https://drop.example.com/";

let workDir;
let home;

before(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "nustuf-buy-"));
  home = path.join(workDir, "home");
  fs.mkdirSync(home);
});

function buy(args, input = "") {
  const r = spawnSync(process.execPath, [BUY, ...args], {
    cwd: workDir,
    input,
    encoding: "utf8",
    timeout: 15_000,
    env: { PATH: process.env.PATH, HOME: home },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function rejects(args, pattern, input) {
  const r = buy(args, input);
  assert.equal(r.code, 1, `expected exit 1 for ${args.join(" ")}, got ${r.code}: ${r.out}`);
  assert.match(r.out, pattern);
  assert.doesNotMatch(r.out, /Resolved purchase endpoint|Paying/);
}

test("no url prints usage and exits 1", () => {
  rejects([], /nustuf buy <url>/);
});

test("--help exits 0", () => {
  assert.equal(buy(["--help"]).code, 0);
});

test("rejects non-http(s) and malformed urls", () => {
  rejects(["file:///etc/passwd", "--locus"], /Unsupported URL protocol/);
  rejects(["not-a-url", "--locus"], /Invalid URL/);
});

test("rejects paths other than / and /download", () => {
  rejects(["https://drop.example.com/some/page", "--locus"], /Unsupported path/);
});

test("--out must be a file path, not a directory", () => {
  rejects([URL_OK, "--out", os.tmpdir()], /must be a file path/);
  rejects([URL_OK, "--out", "somedir/"], /must be a file path/);
  rejects([URL_OK, "--out"], /--out needs a file path/);
});

test("--download-code needs exactly one non-empty source", () => {
  rejects([URL_OK, "--download-code"], /requires a value/);
  rejects([URL_OK, "--download-code", "   "], /cannot be empty/);
  rejects([URL_OK, "--download-code", "a", "--download-code-stdin"], /exactly one download code/);
  rejects([URL_OK, "--download-code-stdin", "--buyer-private-key-stdin"], /cannot be combined/);
});

test("--download-code-stdin with empty stdin is an error", () => {
  rejects([URL_OK, "--download-code-stdin"], /No download code received/, "\n");
});
