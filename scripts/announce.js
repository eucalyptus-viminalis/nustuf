#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createWalletClient, createPublicClient, formatEther, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { createUi } from "./ui.js";
import { readWalletKey } from "./wallet_store.js";

const outUi = createUi(process.stdout);
const errUi = createUi(process.stderr);

const DEFAULT_REGISTRY_ADDRESS = "0x134597d9Cc6270571C2b8245c4235f7838C0d65D";
const REGISTRY_ADDRESS = process.env.NUSTUF_REGISTRY_ADDRESS || DEFAULT_REGISTRY_ADDRESS;
const REGISTRY_CHAIN = process.env.NUSTUF_REGISTRY_CHAIN || "base";

const REGISTRY_ABI = [
  {
    name: "announce",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "url", type: "string" },
      { name: "priceUsdc", type: "uint256" },
      { name: "contentHash", type: "bytes32" },
      { name: "expiresAt", type: "uint256" },
      { name: "title", type: "string" },
      { name: "description", type: "string" },
    ],
    outputs: [{ name: "releaseId", type: "bytes32" }],
  },
];

function usageAndExit(code = 1) {
  console.log(outUi.heading("nustuf announce"));
  console.log("");
  console.log(outUi.section("Usage"));
  console.log("  nustuf announce --url <url> --price <usdc> --expires <timestamp> [options]");
  console.log("");
  console.log(outUi.section("Options"));
  console.log("  --url <url>               Release URL (required)");
  console.log("  --price <usdc>            Price in USDC (required)");
  console.log("  --expires <timestamp>     Unix timestamp when release expires (required)");
  console.log("  --title <text>            Release title");
  console.log("  --description <text>      Release description");
  console.log("  --content-hash <hex>      Content hash (optional, computed if --file given)");
  console.log("  --file <path>             File to hash for content verification");
  console.log("  --private-key-file <path> Deployer key file (or set DEPLOYER_PRIVATE_KEY)");
  console.log("  --testnet                 Use Base Sepolia (default: Base mainnet, costs real gas)");
  console.log("");
  console.log(outUi.section("Examples"));
  console.log("  nustuf announce --url https://xxx.trycloudflare.com/ --price 0.50 --expires 1710720000 --title 'My Drop'");
  process.exit(code);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") usageAndExit(0);
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val && !val.startsWith("--")) {
        args[key] = val;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

export function computeFileHash(filePath) {
  const content = fs.readFileSync(filePath);
  const hash = createHash("sha256").update(content).digest("hex");
  return `0x${hash}`;
}

function getChain(useTestnet) {
  return useTestnet ? baseSepolia : base;
}

export function registryUsesTestnet(args = {}) {
  return Boolean(args.testnet) || REGISTRY_CHAIN === "base-sepolia";
}

function normalizeHexKey(raw) {
  const key = String(raw).trim().split(/\r?\n/, 1)[0].trim();
  return key.startsWith("0x") ? key : `0x${key}`;
}

export function resolveSigner(args = {}, { env = process.env, cwd = process.cwd() } = {}) {
  const found = (privateKey, source) => ({ privateKey, source, address: privateKeyToAccount(privateKey).address });

  if (args["private-key-file"]) {
    const keyPath = path.resolve(cwd, args["private-key-file"]);
    return found(normalizeHexKey(fs.readFileSync(keyPath, "utf8")), "--private-key-file");
  }

  if (env.DEPLOYER_PRIVATE_KEY) return found(normalizeHexKey(env.DEPLOYER_PRIVATE_KEY), "DEPLOYER_PRIVATE_KEY");

  const walletKey = readWalletKey("seller");
  if (walletKey) return found(walletKey, "seller wallet");

  const locusPath = path.resolve(cwd, ".locus.json");
  if (fs.existsSync(locusPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(locusPath, "utf8"));
      if (data.ownerPrivateKey) return found(normalizeHexKey(data.ownerPrivateKey), ".locus.json");
    } catch {}
  }

  throw new Error("No private key found. Use --private-key-file, set DEPLOYER_PRIVATE_KEY, or run `nustuf wallet create --role seller` and fund it");
}

export function loadPrivateKey(args) {
  return resolveSigner(args).privateKey;
}

async function rpcBalance(address, chain) {
  return createPublicClient({ chain, transport: http() }).getBalance({ address });
}

export async function checkAnnounceGas({ address, useTestnet = false, getBalance = rpcBalance }) {
  const chain = getChain(useTestnet);
  try {
    const balanceWei = await getBalance(address, chain);
    return {
      status: balanceWei > 0n ? "ok" : "empty",
      chainName: chain.name,
      balanceEth: formatEther(balanceWei),
    };
  } catch (err) {
    return { status: "unknown", chainName: chain.name, error: err?.shortMessage || err?.message || String(err) };
  }
}

export async function announceRelease(options) {
  const {
    url,
    priceUsdc,
    expiresAt,
    title = "",
    description = "",
    contentHash = "0x" + "0".repeat(64),
    useTestnet = false,
    privateKey,
    registryAddress = REGISTRY_ADDRESS,
    walletClient: walletClientOverride,
    publicClient: publicClientOverride,
    onSubmitted,
  } = options;

  if (!registryAddress) {
    throw new Error("Registry address not set. Set NUSTUF_REGISTRY_ADDRESS env var.");
  }

  const chain = getChain(useTestnet);
  const account = privateKeyToAccount(privateKey);

  const walletClient = walletClientOverride || createWalletClient({ account, chain, transport: http() });
  const publicClient = publicClientOverride || createPublicClient({ chain, transport: http() });

  const priceUnits = parseUnits(String(priceUsdc), 6);

  console.log(outUi.statusLine("info", `Announcing release to ${chain.name}...`));
  console.log(outUi.statusLine("info", `Registry: ${registryAddress}`));
  console.log(outUi.statusLine("info", `From: ${account.address}`));
  console.log(outUi.statusLine("info", `URL: ${url}`));
  console.log(outUi.statusLine("info", `Price: ${priceUsdc} USDC`));

  const hash = await walletClient.writeContract({
    address: registryAddress,
    abi: REGISTRY_ABI,
    functionName: "announce",
    args: [
      url,
      priceUnits,
      contentHash,
      BigInt(expiresAt),
      title,
      description,
    ],
  });

  console.log(outUi.statusLine("info", `Transaction submitted: ${hash}`));
  if (onSubmitted) onSubmitted(hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  const explorerUrl = useTestnet
    ? `https://sepolia.basescan.org/tx/${hash}`
    : `https://basescan.org/tx/${hash}`;

  console.log(outUi.statusLine("ok", `Release announced!`));
  console.log(outUi.statusLine("info", `Explorer: ${explorerUrl}`));

  return {
    from: account.address,
    transactionHash: hash,
    blockNumber: receipt.blockNumber,
    explorerUrl,
  };
}

const ZERO_HASH = "0x" + "0".repeat(64);

export function buildAnnouncePlan(args, { now = Math.floor(Date.now() / 1000) } = {}) {
  if (!args.url || args.url === true) throw new Error("--url is required");
  let parsedUrl;
  try {
    parsedUrl = new URL(String(args.url));
  } catch {
    throw new Error(`Invalid --url: ${args.url}`);
  }
  if (!/^https?:$/.test(parsedUrl.protocol)) {
    throw new Error(`--url must be http(s), got ${parsedUrl.protocol}`);
  }

  if (!args.price || args.price === true) throw new Error("--price is required");
  if (!/^\d+(\.\d{1,6})?$/.test(String(args.price))) {
    throw new Error(`--price must be a USDC amount with at most 6 decimals, got "${args.price}"`);
  }
  const priceUnits = parseUnits(String(args.price), 6);
  if (priceUnits <= 0n) throw new Error("--price must be greater than 0");

  if (!args.expires || args.expires === true) throw new Error("--expires is required");
  if (!/^\d+$/.test(String(args.expires))) {
    throw new Error(`--expires must be a unix timestamp in seconds, got "${args.expires}"`);
  }
  const expiresAt = Number(args.expires);
  if (expiresAt <= now) throw new Error(`--expires ${expiresAt} is already in the past`);

  let contentHash = args["content-hash"];
  if (contentHash !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(String(contentHash))) {
    throw new Error("--content-hash must be 0x followed by 64 hex characters");
  }
  if (!contentHash && args.file) contentHash = computeFileHash(args.file);

  return {
    url: String(args.url),
    priceUsdc: String(args.price),
    priceUnits,
    expiresAt,
    title: typeof args.title === "string" ? args.title : "",
    description: typeof args.description === "string" ? args.description : "",
    contentHash: contentHash || ZERO_HASH,
    useTestnet: registryUsesTestnet(args),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.url) {
    usageAndExit(1);
  }

  const plan = buildAnnouncePlan(args);
  if (!args["content-hash"] && args.file) {
    console.log(outUi.statusLine("info", `Computed content hash: ${plan.contentHash}`));
  }

  const signer = resolveSigner(args);
  console.log(outUi.statusLine("info", `Signer: ${signer.address} (${signer.source})`));
  const gas = await checkAnnounceGas({ address: signer.address, useTestnet: plan.useTestnet });
  if (gas.status === "empty") {
    throw new Error(`Signer ${signer.address} has no ETH on ${gas.chainName} to pay gas. Fund it and retry.`);
  }
  if (gas.status === "unknown") {
    console.log(outUi.statusLine("warn", `Could not check the signer's ${gas.chainName} balance (${gas.error}); trying anyway.`));
  }
  const privateKey = signer.privateKey;

  await announceRelease({
    url: plan.url,
    priceUsdc: plan.priceUsdc,
    expiresAt: plan.expiresAt,
    title: plan.title,
    description: plan.description,
    contentHash: plan.contentHash,
    useTestnet: plan.useTestnet,
    privateKey,
  });
}

const isMain = process.argv[1]?.endsWith("announce.js");
if (isMain) {
  main().catch((e) => {
    console.error(errUi.statusLine("error", e.message || String(e)));
    process.exit(1);
  });
}
