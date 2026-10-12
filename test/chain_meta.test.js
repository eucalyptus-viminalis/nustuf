import { test } from "node:test";
import assert from "node:assert/strict";

import {
  USDC_ADDRESSES,
  formatChainDisplayName,
  parseCaip2Eip155,
  resolveSupportedChain,
} from "../src/chain_meta.js";

test("parseCaip2Eip155 parses eip155 identifiers", () => {
  assert.deepEqual(parseCaip2Eip155("eip155:8453"), { id: 8453, caip2: "eip155:8453" });
  assert.deepEqual(parseCaip2Eip155("  eip155:84532 "), { id: 84532, caip2: "eip155:84532" });
});

test("parseCaip2Eip155 rejects other formats", () => {
  for (const input of ["8453", "eip155:", "eip155:0", "solana:mainnet", "eip155:-1", "", undefined]) {
    assert.throws(() => parseCaip2Eip155(input), /Invalid chain identifier/, String(input));
  }
});

test("resolveSupportedChain covers Base mainnet and Base Sepolia", () => {
  const mainnet = resolveSupportedChain("eip155:8453");
  assert.equal(mainnet.id, 8453);
  assert.equal(mainnet.testnet, false);

  const sepolia = resolveSupportedChain("eip155:84532");
  assert.equal(sepolia.id, 84532);
  assert.equal(sepolia.testnet, true);

  assert.equal(formatChainDisplayName("eip155:8453"), mainnet.name);
});

test("resolveSupportedChain rejects chains nustuf does not support", () => {
  assert.throws(() => resolveSupportedChain("eip155:1"), /Unsupported chain 'eip155:1'/);
});

test("every supported chain has a USDC address", () => {
  for (const caip2 of ["eip155:8453", "eip155:84532"]) {
    assert.match(USDC_ADDRESSES[caip2], /^0x[0-9a-fA-F]{40}$/, caip2);
  }
});
