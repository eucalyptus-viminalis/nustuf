import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

import { x402Client } from "@x402/core/client";
import {
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const DEV_DEFAULT_BASE_URL = process.env.DEV_DEFAULT_BASE_URL || "http://127.0.0.1:4021";
const BASE_URL = process.env.BASE_URL || (process.env.LEAK_DEV === "1" ? DEV_DEFAULT_BASE_URL : null);
const BUYER_PRIVATE_KEY = process.env.BUYER_PRIVATE_KEY;
const OUTPUT_PATH = process.env.OUTPUT_PATH || "downloaded.bin";
const OUTPUT_BASENAME = process.env.OUTPUT_BASENAME; // optional, without extension

if (!BASE_URL) {
  console.error("Missing BASE_URL env var (set LEAK_DEV=1 to allow local default for development)");
  process.exit(1);
}

if (!BUYER_PRIVATE_KEY) {
  console.error("Missing BUYER_PRIVATE_KEY env var");
  process.exit(1);
}

const account = privateKeyToAccount(
  BUYER_PRIVATE_KEY.startsWith("0x")
    ? BUYER_PRIVATE_KEY
    : `0x${BUYER_PRIVATE_KEY}`,
);

const client = new x402Client();
registerExactEvmScheme(client, { signer: account });

function getHeaderCaseInsensitive(headers, name) {
  const target = name.toLowerCase();
  for (const [k, v] of headers.entries()) {
    if (k.toLowerCase() === target) return v;
  }
  return null;
}

function sanitizeFilename(name) {
  const base = path.basename(String(name || "").trim());
  if (!base || base === "." || base === "..") return "downloaded.bin";
  return base.replace(/[\u0000-\u001f\u007f]/g, "_");
}

async function main() {
  // 1) First request: expect 402 with PAYMENT-REQUIRED header.
  const r1 = await fetch(`${BASE_URL}/download`, { method: "GET" });
  if (r1.status !== 402) {
    const text = await r1.text().catch(() => "");
    throw new Error(`Expected 402, got ${r1.status}: ${text}`);
  }

  const paymentRequiredHeader = getHeaderCaseInsensitive(
    r1.headers,
    "PAYMENT-REQUIRED",
  );
  if (!paymentRequiredHeader)
    throw new Error("Missing PAYMENT-REQUIRED header");

  const paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader);
  const payload = await client.createPaymentPayload(paymentRequired);
  const paymentHeader = encodePaymentSignatureHeader(payload);

  // 2) Second request: send payment signature, expect token JSON.
  const r2 = await fetch(`${BASE_URL}/download`, {
    method: "GET",
    headers: {
      "PAYMENT-SIGNATURE": paymentHeader,
    },
  });

  if (!r2.ok) {
    const text = await r2.text().catch(() => "");
    throw new Error(`Payment failed ${r2.status}: ${text}`);
  }

  const data = await r2.json();
  const token = data?.token;
  if (!token)
    throw new Error(`Missing token in response: ${JSON.stringify(data)}`);

  // Choose output path.
  // Priority:
  // 1) OUTPUT_PATH (full path)
  // 2) OUTPUT_BASENAME (basename without extension) + server extension
  // 3) server-provided filename
  // 4) fallback OUTPUT_PATH default
  let outPath;

  if (process.env.OUTPUT_PATH) {
    outPath = process.env.OUTPUT_PATH;
  } else if (OUTPUT_BASENAME) {
    const safeBase = sanitizeFilename(OUTPUT_BASENAME);
    const serverName = sanitizeFilename(data?.filename || "downloaded.bin");
    const ext = path.extname(serverName) || "";
    outPath = `./${safeBase}${ext}`;
  } else if (data?.filename) {
    outPath = `./${sanitizeFilename(data.filename)}`;
  } else {
    outPath = OUTPUT_PATH;
  }

  // 3) Final request: download artifact with token.
  const r3 = await fetch(
    `${BASE_URL}/download?token=${encodeURIComponent(token)}`,
    {
      method: "GET",
    },
  );

  if (!r3.ok) {
    const text = await r3.text().catch(() => "");
    throw new Error(`Download failed ${r3.status}: ${text}`);
  }

  const buf = Buffer.from(await r3.arrayBuffer());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  console.log(`Downloaded ${buf.length} bytes to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
