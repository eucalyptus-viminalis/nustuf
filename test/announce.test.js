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

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { checkAnnounceGas, resolveSigner, announceRelease } from "../scripts/announce.js";

function signerSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nustuf-signer-"));
  const home = path.join(dir, "home");
  fs.mkdirSync(path.join(home, ".nustuf", "wallets"), { recursive: true });
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  const writeSeller = () => {
    const key = generatePrivateKey();
    fs.writeFileSync(path.join(home, ".nustuf", "wallets", "seller.key"), `${key}\n`);
    return privateKeyToAccount(key).address;
  };
  return { dir, writeSeller, restore: () => { process.env.HOME = prevHome; } };
}

test("resolveSigner: seller wallet is used when no key is passed", (t) => {
  const sb = signerSandbox();
  t.after(sb.restore);
  const address = sb.writeSeller();
  const s = resolveSigner({}, { env: {}, cwd: sb.dir });
  assert.equal(s.address, address);
  assert.equal(s.source, "seller wallet");
  assert.match(s.privateKey, /^0x[0-9a-f]{64}$/);
});

test("resolveSigner: DEPLOYER_PRIVATE_KEY beats the seller wallet", (t) => {
  const sb = signerSandbox();
  t.after(sb.restore);
  sb.writeSeller();
  const key = generatePrivateKey();
  const s = resolveSigner({}, { env: { DEPLOYER_PRIVATE_KEY: key.slice(2) }, cwd: sb.dir });
  assert.equal(s.address, privateKeyToAccount(key).address);
  assert.equal(s.source, "DEPLOYER_PRIVATE_KEY");
});

test("resolveSigner: --private-key-file beats everything", (t) => {
  const sb = signerSandbox();
  t.after(sb.restore);
  sb.writeSeller();
  const key = generatePrivateKey();
  const file = path.join(sb.dir, "k.key");
  fs.writeFileSync(file, `${key}\n`);
  const s = resolveSigner({ "private-key-file": file }, { env: { DEPLOYER_PRIVATE_KEY: generatePrivateKey() }, cwd: sb.dir });
  assert.equal(s.address, privateKeyToAccount(key).address);
  assert.equal(s.source, "--private-key-file");
});

test("resolveSigner: .locus.json is the last fallback; nothing found throws", (t) => {
  const sb = signerSandbox();
  t.after(sb.restore);
  assert.throws(() => resolveSigner({}, { env: {}, cwd: sb.dir }), /No private key found/);
  const key = generatePrivateKey();
  fs.writeFileSync(path.join(sb.dir, ".locus.json"), JSON.stringify({ ownerPrivateKey: key }));
  const s = resolveSigner({}, { env: {}, cwd: sb.dir });
  assert.equal(s.address, privateKeyToAccount(key).address);
  assert.equal(s.source, ".locus.json");
});

const ADDR = "0x000000000000000000000000000000000000dEaD";

test("checkAnnounceGas: zero balance is empty, on the chain asked for", async () => {
  let asked;
  const r = await checkAnnounceGas({
    address: ADDR,
    useTestnet: true,
    getBalance: async (a, chain) => { asked = { a, chain: chain.id }; return 0n; },
  });
  assert.equal(r.status, "empty");
  assert.equal(r.chainName, "Base Sepolia");
  assert.deepEqual(asked, { a: ADDR, chain: 84532 });
});

test("checkAnnounceGas: positive balance is ok; RPC failure is unknown, not fatal", async () => {
  const ok = await checkAnnounceGas({ address: ADDR, useTestnet: false, getBalance: async () => 10n ** 15n });
  assert.equal(ok.status, "ok");
  assert.equal(ok.balanceEth, "0.001");
  assert.equal(ok.chainName, "Base");
  const down = await checkAnnounceGas({ address: ADDR, getBalance: async () => { throw new Error("rpc down"); } });
  assert.equal(down.status, "unknown");
  assert.match(down.error, /rpc down/);
});

test("announceRelease: returns the sender and reports the hash before confirmation", async () => {
  const key = generatePrivateKey();
  const hash = "0x" + "11".repeat(32);
  const events = [];
  const res = await announceRelease({
    url: "https://drop.example.com/",
    priceUsdc: "0.5",
    expiresAt: NOW + 3600,
    useTestnet: true,
    privateKey: key,
    walletClient: { writeContract: async () => { events.push("write"); return hash; } },
    publicClient: { waitForTransactionReceipt: async () => { events.push("receipt"); return { blockNumber: 7n }; } },
    onSubmitted: (h) => events.push(`submitted:${h}`),
  });
  assert.deepEqual(events, ["write", `submitted:${hash}`, "receipt"]);
  assert.equal(res.from, privateKeyToAccount(key).address);
  assert.equal(res.transactionHash, hash);
  assert.equal(res.explorerUrl, `https://sepolia.basescan.org/tx/${hash}`);
});
