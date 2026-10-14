import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { hashDownloadCode, DOWNLOAD_CODE_HEADER } from "../src/download_code.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = path.join(ROOT, "src", "index.js");
const PAY_TO = "0x1111111111111111111111111111111111111111";
const ARTIFACT_BODY = "nustuf test artifact\n";

let workDir;
let artifactPath;

before(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "nustuf-test-"));
  artifactPath = path.join(workDir, "artifact.txt");
  fs.writeFileSync(artifactPath, ARTIFACT_BODY);
});

after(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

async function freePort() {
  const srv = createServer();
  srv.listen(0, "127.0.0.1");
  await once(srv, "listening");
  const { port } = srv.address();
  srv.close();
  await once(srv, "close");
  return port;
}

async function startFakeFacilitator(network) {
  const srv = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/supported") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          kinds: [{ x402Version: 2, scheme: "exact", network }],
          extensions: [],
          signers: {},
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  srv.listen(0, "127.0.0.1");
  await once(srv, "listening");
  return { url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() };
}

async function startServer(env) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    cwd: workDir,
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      ARTIFACT_PATH: artifactPath,
      PROTECTED_MIME: "text/plain",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early (code ${child.exitCode}):\n${output}`);
    }
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) break;
    } catch {
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (Date.now() >= deadline) {
    child.kill();
    throw new Error(`server did not start in time:\n${output}`);
  }

  return {
    base,
    output: () => output,
    async stop() {
      child.kill();
      if (child.exitCode === null) await once(child, "exit");
    },
  };
}

test("payment mode: unpaid download gets 402 with x402 payment requirements", async (t) => {
  const facilitator = await startFakeFacilitator("eip155:84532");
  t.after(() => facilitator.close());
  const server = await startServer({
    ACCESS_MODE: "payment-only-no-download-code",
    CHAIN_ID: "eip155:84532",
    FACILITATOR_MODE: "testnet",
    FACILITATOR_URL: facilitator.url,
    SELLER_PAY_TO: PAY_TO,
    PRICE_USD: "0.25",
  });
  t.after(() => server.stop());

  const health = await fetch(`${server.base}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);

  const res = await fetch(`${server.base}/download`, {
    headers: { Accept: "application/json" },
  });
  assert.equal(res.status, 402, server.output());

  const header = res.headers.get("payment-required");
  assert.ok(header, "402 response should carry a PAYMENT-REQUIRED header");
  const required = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  const accept = required.accepts[0];
  assert.equal(accept.scheme, "exact");
  assert.equal(accept.network, "eip155:84532");
  assert.equal(accept.payTo.toLowerCase(), PAY_TO);
  assert.equal(accept.amount, "250000", "0.25 USDC in 6-decimal units");

  const body = await res.text();
  assert.ok(!body.includes(ARTIFACT_BODY.trim()), "artifact must not leak before payment");
});

test("payment mode: browsers get the HTML payment guidance page", async (t) => {
  const facilitator = await startFakeFacilitator("eip155:84532");
  t.after(() => facilitator.close());
  const server = await startServer({
    ACCESS_MODE: "payment-only-no-download-code",
    CHAIN_ID: "eip155:84532",
    FACILITATOR_MODE: "testnet",
    FACILITATOR_URL: facilitator.url,
    SELLER_PAY_TO: PAY_TO,
  });
  t.after(() => server.stop());

  const res = await fetch(`${server.base}/download`, {
    headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0" },
  });
  assert.equal(res.status, 402);
  assert.match(res.headers.get("content-type"), /text\/html/);
  assert.match(await res.text(), /402 Payment Required/);
});

test("download-code mode: requires the right code, then serves the file", async (t) => {
  const server = await startServer({
    ACCESS_MODE: "download-code-only-no-payment",
    CHAIN_ID: "eip155:84532",
    DOWNLOAD_CODE_HASH: await hashDownloadCode("open-sesame"),
  });
  t.after(() => server.stop());

  const missing = await fetch(`${server.base}/download`);
  assert.equal(missing.status, 401);
  assert.equal(missing.headers.get("x-nustuf-download-code-required"), "1");

  const wrong = await fetch(`${server.base}/download`, {
    headers: { [DOWNLOAD_CODE_HEADER]: "wrong" },
  });
  assert.equal(wrong.status, 401);

  const ok = await fetch(`${server.base}/download`, {
    headers: { [DOWNLOAD_CODE_HEADER]: "open-sesame" },
  });
  assert.equal(ok.status, 200, server.output());
  assert.equal(await ok.text(), ARTIFACT_BODY);
});

test("startup fails fast on an invalid access mode", async () => {
  await assert.rejects(
    startServer({ ACCESS_MODE: "free-for-all", CHAIN_ID: "eip155:84532" }),
    /Invalid ACCESS_MODE/,
  );
});
