#!/usr/bin/env node
/**
 * Register a seller as an ERC-8004 agent (Identity Registry) so drops can be tied to a
 * portable on-chain identity. ERC-8004 is a draft standard; testnet only for now.
 */
import "dotenv/config";
import { createPublicClient, createWalletClient, formatEther, http, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { createUi } from "./ui.js";
import { loadPrivateKey } from "./announce.js";
import { readConfig, writeConfig } from "./config_store.js";
import { getWalletAddress } from "./wallet_store.js";

const outUi = createUi(process.stdout);
const errUi = createUi(process.stderr);

// Identity Registry per chain. Base Sepolia was checked on-chain (ERC-721 "AgentIdentity").
const IDENTITY_REGISTRIES = {
  "eip155:84532": { chain: baseSepolia, address: "0x8004A818BFB912233c491871b3d84c89A494BD9e", explorer: "https://sepolia.basescan.org" },
};
const REGISTRATION_TYPE = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";

const IDENTITY_ABI = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    name: "Registered",
    type: "event",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "agentURI", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: true },
    ],
  },
];

function usageAndExit(code = 1) {
  console.log(outUi.heading("nustuf identity"));
  console.log("");
  console.log(outUi.section("Usage"));
  console.log("  nustuf identity register --testnet [options]   Preview, or register with --yes");
  console.log("  nustuf identity show                           Show saved identities");
  console.log("");
  console.log(outUi.section("Register options"));
  console.log("  --testnet                 Base Sepolia (mainnet is not enabled yet)");
  console.log("  --name <text>             Agent name (default: saved displayName)");
  console.log("  --description <text>      Agent description (default: saved bio)");
  console.log("  --image <url>             Optional avatar URL");
  console.log("  --agent-uri <url>         Host the registration file yourself (default: on-chain data URI)");
  console.log("  --private-key-file <path> Key file (or DEPLOYER_PRIVATE_KEY, or the seller wallet)");
  console.log("  --yes                     Actually send the transaction (otherwise preview only)");
  process.exit(code);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") usageAndExit(0);
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[a.slice(2)] = next;
        i++;
      } else {
        args[a.slice(2)] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

export function buildRegistrationFile({ name, description, image }) {
  const file = {
    type: REGISTRATION_TYPE,
    name,
    description: description || "",
    services: [],
    x402Support: true,
    active: true,
    registrations: [],
  };
  if (image) file.image = image;
  return file;
}

export function toDataUri(obj) {
  return `data:application/json;base64,${Buffer.from(JSON.stringify(obj)).toString("base64")}`;
}

function registryKey(caip2, address) {
  return `${caip2}:${address}`;
}

async function register(args) {
  if (!args.testnet) {
    throw new Error("Only Base Sepolia is enabled for now: add --testnet. ERC-8004 is still a draft standard.");
  }
  const caip2 = "eip155:84532";
  const reg = IDENTITY_REGISTRIES[caip2];
  const key = registryKey(caip2, reg.address);

  const loaded = readConfig();
  const defaults = loaded.config.defaults;
  const existing = loaded.config.identities?.[key];
  if (existing) {
    throw new Error(`Already registered on ${caip2} as agentId ${existing.agentId}. See \`nustuf identity show\`.`);
  }

  const name = String(args.name === true ? "" : args.name || defaults.displayName || "").trim();
  if (!name) {
    throw new Error("A name is required: pass --name or run `nustuf config set --display-name <text>`.");
  }
  const description = String(args.description === true ? "" : args.description || defaults.bio || "").trim();
  const image = typeof args.image === "string" ? args.image : "";
  const file = buildRegistrationFile({ name, description, image });
  const agentURI = typeof args["agent-uri"] === "string" ? args["agent-uri"] : toDataUri(file);

  const account = privateKeyToAccount(loadPrivateKey(args));
  const publicClient = createPublicClient({ chain: reg.chain, transport: http() });
  const balance = await publicClient.getBalance({ address: account.address });

  console.log(outUi.section("ERC-8004 registration (draft standard)"));
  for (const line of outUi.formatRows([
    { key: "network", value: `${reg.chain.name} (${caip2})` },
    { key: "registry", value: reg.address },
    { key: "owner", value: account.address },
    { key: "balance", value: `${formatEther(balance)} ETH` },
    { key: "agentURI", value: typeof args["agent-uri"] === "string" ? agentURI : `on-chain data URI (${agentURI.length} chars)` },
  ])) {
    console.log(line);
  }
  console.log("");
  console.log(JSON.stringify(file, null, 2));
  console.log("");
  console.log(outUi.statusLine("warn", "Registration is public and permanent: it links this wallet to the name and description above."));

  let gasCost;
  try {
    const gas = await publicClient.estimateContractGas({
      address: reg.address, abi: IDENTITY_ABI, functionName: "register", args: [agentURI], account,
    });
    const gasPrice = await publicClient.getGasPrice();
    gasCost = gas * gasPrice;
    console.log(outUi.statusLine("info", `Estimated gas cost: ~${formatEther(gasCost)} ETH`));
  } catch (err) {
    if (balance === 0n) {
      throw new Error(`The owner wallet has no ETH on ${reg.chain.name}. Send a little to ${account.address} and retry.`);
    }
    throw err;
  }

  if (!args.yes) {
    console.log(outUi.statusLine("info", "Preview only. Re-run with --yes to register."));
    return;
  }
  if (balance < gasCost) {
    throw new Error(`Not enough ETH: need about ${formatEther(gasCost)}, have ${formatEther(balance)}. Fund ${account.address}.`);
  }

  const walletClient = createWalletClient({ account, chain: reg.chain, transport: http() });
  const hash = await walletClient.writeContract({
    address: reg.address, abi: IDENTITY_ABI, functionName: "register", args: [agentURI],
  });
  console.log(outUi.statusLine("info", `Transaction submitted: ${hash}`));
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Registration reverted: ${reg.explorer}/tx/${hash}`);

  const [event] = parseEventLogs({ abi: IDENTITY_ABI, eventName: "Registered", logs: receipt.logs });
  if (!event) throw new Error(`Registered but could not read the agentId from the receipt: ${reg.explorer}/tx/${hash}`);
  const agentId = event.args.agentId.toString();

  const fresh = readConfig().config;
  writeConfig({
    ...fresh,
    identities: {
      ...fresh.identities,
      [key]: { agentId, owner: account.address, agentURI: typeof args["agent-uri"] === "string" ? agentURI : "data-uri", txHash: hash },
    },
  });

  console.log(outUi.statusLine("ok", `Registered agentId ${agentId}`));
  console.log(outUi.statusLine("info", `Explorer: ${reg.explorer}/tx/${hash}`));
}

function show() {
  const { config } = readConfig();
  const entries = Object.entries(config.identities || {});
  if (entries.length === 0) {
    console.log(outUi.statusLine("info", "No identities saved. Run `nustuf identity register --testnet`."));
    return;
  }
  console.log(JSON.stringify(config.identities, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sub = args._[0];
  if (sub === "register") return register(args);
  if (sub === "show") return show();
  usageAndExit(1);
}

if (process.argv[1]?.endsWith("identity.js")) {
  main().catch((e) => {
    console.error(errUi.statusLine("error", e.message || String(e)));
    process.exit(1);
  });
}
