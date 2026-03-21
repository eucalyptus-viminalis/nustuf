import { base, baseSepolia } from "viem/chains";
import { extractChain } from "viem/chains/utils";

const SUPPORTED_CHAINS = [base, baseSepolia];

const SUPPORTED_CHAIN_SUMMARY = [
  `${base.id} (${base.name})`,
  `${baseSepolia.id} (${baseSepolia.name})`,
].join(", ");

function invalidFormatMessage(raw) {
  const value = String(raw ?? "").trim() || "<empty>";
  return `Invalid chain identifier '${value}'. Expected eip155:<number>. Supported values: ${SUPPORTED_CHAIN_SUMMARY}.`;
}

function unsupportedChainMessage(caip2) {
  return `Unsupported chain '${caip2}'. Supported values: ${SUPPORTED_CHAIN_SUMMARY}.`;
}

export function parseCaip2Eip155(chainIdString) {
  const value = String(chainIdString ?? "").trim();
  const match = value.match(/^eip155:(\d+)$/);
  if (!match) {
    throw new Error(invalidFormatMessage(chainIdString));
  }

  const id = Number(match[1]);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(invalidFormatMessage(chainIdString));
  }

  return {
    id,
    caip2: `eip155:${id}`,
  };
}

export function resolveSupportedChain(chainIdString) {
  const parsed = parseCaip2Eip155(chainIdString);
  const chain = extractChain({ chains: SUPPORTED_CHAINS, id: parsed.id });
  if (!chain) {
    throw new Error(unsupportedChainMessage(parsed.caip2));
  }

  return {
    caip2: parsed.caip2,
    id: parsed.id,
    name: chain.name,
    testnet: Boolean(chain.testnet),
  };
}

export function formatChainDisplayName(chainIdString) {
  return resolveSupportedChain(chainIdString).name;
}
