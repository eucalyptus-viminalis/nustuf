// Unit tests for `nustuf announce`: the plan it builds is what gets written to the
// on-chain registry, so bad input must be rejected before any key is loaded or gas spent.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildAnnouncePlan, computeFileHash } from "../scripts/announce.js";

const NOW = 1_800_000_000;
const good = { url: "https://drop.example.com/", price: "0.50", expires: String(NOW + 3600) };
const plan = (over = {}) => buildAnnouncePlan({ ...good, ...over }, { now: NOW });

test("builds a plan with USDC base units (6 decimals)", () => {
  const p = plan({ price: "0.5", title: "My Drop", description: "d" });
  assert.equal(p.priceUnits, 500_000n);
  assert.equal(p.expiresAt, NOW + 3600);
  assert.equal(p.title, "My Drop");
  assert.equal(p.description, "d");
  assert.equal(p.url, good.url);
});

test("sub-cent and integer prices convert exactly", () => {
  assert.equal(plan({ price: "0.000001" }).priceUnits, 1n);
  assert.equal(plan({ price: "12" }).priceUnits, 12_000_000n);
});

test("defaults: zero content hash, mainnet", () => {
  const p = plan();
  assert.equal(p.contentHash, "0x" + "0".repeat(64));
  assert.equal(p.useTestnet, false);
  assert.equal(plan({ testnet: true }).useTestnet, true);
});

test("rejects missing required flags", () => {
  assert.throws(() => buildAnnouncePlan({ ...good, url: undefined }, { now: NOW }), /--url is required/);
  assert.throws(() => plan({ price: undefined }), /--price is required/);
  assert.throws(() => plan({ price: true }), /--price is required/);
  assert.throws(() => plan({ expires: undefined }), /--expires is required/);
});

test("rejects bad urls", () => {
  assert.throws(() => plan({ url: "not a url" }), /Invalid --url/);
  assert.throws(() => plan({ url: "ftp://x.example.com/" }), /http\(s\)/);
});

test("rejects bad prices", () => {
  for (const price of ["abc", "-1", "0", "0.0", "1e3", "0.0000001", "1,5", "NaN"]) {
    assert.throws(() => plan({ price }), /--price/, `price ${price}`);
  }
});

test("rejects bad or past expiry", () => {
  for (const expires of ["soon", "-5", "1.5", "1e9"]) {
    assert.throws(() => plan({ expires }), /--expires must be/, `expires ${expires}`);
  }
  assert.throws(() => plan({ expires: String(NOW) }), /in the past/);
  assert.throws(() => plan({ expires: "1000" }), /in the past/);
});

test("rejects a malformed --content-hash", () => {
  assert.throws(() => plan({ "content-hash": "0x1234" }), /--content-hash/);
  assert.throws(() => plan({ "content-hash": "z".repeat(66) }), /--content-hash/);
  const ok = "0x" + "ab".repeat(32);
  assert.equal(plan({ "content-hash": ok }).contentHash, ok);
});

test("--file is hashed with SHA-256; explicit --content-hash wins", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nustuf-announce-"));
  const file = path.join(dir, "a.txt");
  fs.writeFileSync(file, "hello");
  const expected = "0x2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
  assert.equal(computeFileHash(file), expected);
  assert.equal(plan({ file }).contentHash, expected);
  const explicit = "0x" + "cd".repeat(32);
  assert.equal(plan({ file, "content-hash": explicit }).contentHash, explicit);
});
