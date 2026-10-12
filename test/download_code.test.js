import { test } from "node:test";
import assert from "node:assert/strict";

import {
  hashDownloadCode,
  isValidDownloadCodeHash,
  parseDownloadCodeHash,
  verifyDownloadCode,
} from "../src/download_code.js";

test("hashDownloadCode produces a parseable scrypt hash with a random salt", async () => {
  const a = await hashDownloadCode("open-sesame");
  const b = await hashDownloadCode("open-sesame");

  assert.match(a, /^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.notEqual(a, b, "same code should hash differently with a fresh salt");

  const parsed = parseDownloadCodeHash(a);
  assert.equal(parsed.n, 16384);
  assert.equal(parsed.r, 8);
  assert.equal(parsed.p, 1);
  assert.equal(parsed.salt.length, 16);
  assert.equal(parsed.digest.length, 32);
});

test("hashDownloadCode rejects an empty code", async () => {
  await assert.rejects(hashDownloadCode("   "), /cannot be empty/);
});

test("verifyDownloadCode accepts the right code and rejects others", async () => {
  const hash = await hashDownloadCode("open-sesame");

  assert.equal(await verifyDownloadCode("open-sesame", hash), true);
  assert.equal(await verifyDownloadCode("  open-sesame  ", hash), true, "surrounding whitespace is ignored");
  assert.equal(await verifyDownloadCode("open-sesam", hash), false);
  assert.equal(await verifyDownloadCode("OPEN-SESAME", hash), false, "codes are case sensitive");
  assert.equal(await verifyDownloadCode("", hash), false);
});

test("parseDownloadCodeHash rejects malformed hashes", () => {
  const cases = [
    ["", /format/],
    ["scrypt$16384$8$1$abcd", /format/],
    ["bcrypt$16384$8$1$abcd$abcd", /Unsupported/],
    ["scrypt$0$8$1$abcd$abcd", /N/],
    ["scrypt$16384$x$1$abcd$abcd", /r/],
    ["scrypt$16384$8$-1$abcd$abcd", /p/],
    ["scrypt$16384$8$1$xyz1$abcd", /salt/],
    ["scrypt$16384$8$1$abcd$abc", /digest/],
  ];
  for (const [input, error] of cases) {
    assert.throws(() => parseDownloadCodeHash(input), error, input);
    assert.equal(isValidDownloadCodeHash(input), false, input);
  }
});

test("isValidDownloadCodeHash accepts a real hash", async () => {
  assert.equal(isValidDownloadCodeHash(await hashDownloadCode("x")), true);
});
