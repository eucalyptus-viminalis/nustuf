#!/usr/bin/env node
/**
 * Announce a release to the NustufRegistry on-chain
 * Called after publish to make the release discoverable
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createWalletClient, createPublicClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { createUi } from "./ui.js";

const outUi = createUi(process.stdout);
const errUi = createUi(process.stderr);

// Registry contract address (set via env)
const REGISTRY_ADDRESS = process.env.NUSTUF_REGISTRY_ADDRESS;
const REGISTRY_CHAIN = process.env.NUSTUF_REGISTRY_CHAIN || "base-sepolia";

// Minimal ABI for announcing
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
  console.log("  --testnet                 Use Base Sepolia");
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

function computeFileHash(filePath) {
  const content = fs.readFileSync(filePath);
  const hash = createHash("sha256").update(content).digest("hex");
  return `0x${hash}`;
}

function getChain(useTestnet) {
  return useTestnet ? baseSepolia : base;
}

function loadPrivateKey(args) {
  // Check args first
  if (args["private-key-file"]) {
    const keyPath = path.resolve(process.cwd(), args["private-key-file"]);
    const content = fs.readFileSync(keyPath, "utf8").trim().split("\n")[0];
    return content.startsWith("0x") ? content : `0x${content}`;
  }
  
  // Check env
  if (process.env.DEPLOYER_PRIVATE_KEY) {
    const key = process.env.DEPLOYER_PRIVATE_KEY.trim();
    return key.startsWith("0x") ? key : `0x${key}`;
  }
  
  // Check .locus.json
  const locusPath = path.resolve(process.cwd(), ".locus.json");
  if (fs.existsSync(locusPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(locusPath, "utf8"));
      if (data.ownerPrivateKey) {
        return data.ownerPrivateKey;
      }
    } catch {}
  }
  
  throw new Error("No private key found. Use --private-key-file or set DEPLOYER_PRIVATE_KEY");
}

export async function announceRelease(options) {
  const {
    url,
    priceUsdc,
    expiresAt,
    title = "",
    description = "",
    contentHash = "0x" + "0".repeat(64),
    useTestnet = true,
    privateKey,
    registryAddress = REGISTRY_ADDRESS,
  } = options;

  if (!registryAddress) {
    throw new Error("Registry address not set. Set NUSTUF_REGISTRY_ADDRESS env var.");
  }

  const chain = getChain(useTestnet);
  const account = privateKeyToAccount(privateKey);

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(),
  });

  const publicClient = createPublicClient({
    chain,
    transport: http(),
  });

  // Convert price to USDC units (6 decimals)
  const priceUnits = parseUnits(String(priceUsdc), 6);

  console.log(outUi.statusLine("info", `Announcing release to ${chain.name}...`));
  console.log(outUi.statusLine("info", `Registry: ${registryAddress}`));
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

  // Wait for confirmation
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  const explorerUrl = useTestnet
    ? `https://sepolia.basescan.org/tx/${hash}`
    : `https://basescan.org/tx/${hash}`;

  console.log(outUi.statusLine("ok", `Release announced!`));
  console.log(outUi.statusLine("info", `Explorer: ${explorerUrl}`));

  return {
    transactionHash: hash,
    blockNumber: receipt.blockNumber,
    explorerUrl,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.url) {
    usageAndExit(1);
  }

  if (!args.price) {
    throw new Error("--price is required");
  }

  if (!args.expires) {
    throw new Error("--expires is required");
  }

  let contentHash = args["content-hash"];
  if (!contentHash && args.file) {
    contentHash = computeFileHash(args.file);
    console.log(outUi.statusLine("info", `Computed content hash: ${contentHash}`));
  }

  const privateKey = loadPrivateKey(args);
  const useTestnet = Boolean(args.testnet) || REGISTRY_CHAIN === "base-sepolia";

  await announceRelease({
    url: args.url,
    priceUsdc: parseFloat(args.price),
    expiresAt: parseInt(args.expires),
    title: args.title || "",
    description: args.description || "",
    contentHash: contentHash || "0x" + "0".repeat(64),
    useTestnet,
    privateKey,
  });
}

// Run if called directly
const isMain = process.argv[1]?.endsWith("announce.js");
if (isMain) {
  main().catch((e) => {
    console.error(errUi.statusLine("error", e.message || String(e)));
    process.exit(1);
  });
}
