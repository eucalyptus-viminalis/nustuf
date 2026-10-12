import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ACCESS_MODE_VALUES,
  DEFAULT_ACCESS_MODE,
  accessModeRequiresDownloadCode,
  accessModeRequiresPayment,
  accessModeSummary,
  isValidAccessMode,
  normalizeAccessMode,
  resolveAccessMode,
} from "../src/access_mode.js";

test("default access mode is payment only", () => {
  assert.equal(DEFAULT_ACCESS_MODE, "payment-only-no-download-code");
  assert.ok(ACCESS_MODE_VALUES.includes(DEFAULT_ACCESS_MODE));
});

test("normalizeAccessMode trims and lowercases", () => {
  assert.equal(normalizeAccessMode("  Download-Code-And-Payment "), "download-code-and-payment");
  assert.equal(normalizeAccessMode(undefined), "");
  assert.equal(normalizeAccessMode(null), "");
});

test("isValidAccessMode accepts every known mode in any case", () => {
  for (const mode of ACCESS_MODE_VALUES) {
    assert.ok(isValidAccessMode(mode), mode);
    assert.ok(isValidAccessMode(mode.toUpperCase()), mode);
  }
  assert.equal(isValidAccessMode("free"), false);
  assert.equal(isValidAccessMode(""), false);
});

test("resolveAccessMode falls back for unknown values", () => {
  assert.equal(resolveAccessMode("DOWNLOAD-CODE-ONLY-NO-PAYMENT"), "download-code-only-no-payment");
  assert.equal(resolveAccessMode("nonsense"), DEFAULT_ACCESS_MODE);
  assert.equal(resolveAccessMode("", "no-download-code-no-payment"), "no-download-code-no-payment");
});

test("each mode requires the right combination of download code and payment", () => {
  const expected = {
    "no-download-code-no-payment": { code: false, payment: false },
    "download-code-only-no-payment": { code: true, payment: false },
    "payment-only-no-download-code": { code: false, payment: true },
    "download-code-and-payment": { code: true, payment: true },
  };
  assert.deepEqual(Object.keys(expected).sort(), [...ACCESS_MODE_VALUES].sort());
  for (const [mode, { code, payment }] of Object.entries(expected)) {
    assert.equal(accessModeRequiresDownloadCode(mode), code, `${mode} download code`);
    assert.equal(accessModeRequiresPayment(mode), payment, `${mode} payment`);
  }
});

test("accessModeSummary describes each mode", () => {
  assert.equal(accessModeSummary("download-code-and-payment"), "Download code and payment required");
  assert.equal(accessModeSummary("download-code-only-no-payment"), "Download code required; no payment");
  assert.equal(accessModeSummary("payment-only-no-download-code"), "Payment required; no download code");
  assert.equal(accessModeSummary("no-download-code-no-payment"), "No download code; no payment");
});
