#!/usr/bin/env node
import "dotenv/config";
import { createPublicClient, erc20Abi, formatEther, formatUnits, http } from "viem";
import { base, baseSepolia } from "viem/chains";
import { stdin as input, stdout as output } from "node:process";
import { readConfig } from "./config_store.js";
import { resolveSupportedChain, USDC_ADDRESSES } from "../src/chain_meta.js";
import { WALLET_ROLES, createWallet, getWalletAddress, isWalletRole, readWalletKey, walletPath } from "./wallet_store.js";
import { createUi } from "./ui.js";

const outUi = createUi(output);
const errUi = createUi(process.stderr);

function usageAndExit(code = 0) {
  console.log(outUi.heading("nustuf wallet"));
  console.log("");
  console.log(outUi.section("Usage"));
  console.log("  nustuf wallet create --role <buyer|seller> [--network <caip2> | --testnet]");
  console.log("  nustuf wallet show [--role <buyer|seller>] [--network <caip2> | --testnet] [--json]");
  console.log("  nustuf wallet export --role <buyer|seller>");
  console.log("");
  console.log(outUi.section("Notes"));
  console.log("  - Generates a wallet for you, so you only need to send funds to its address.");
  console.log("  - Keys live in ~/.nustuf/wallets/<role>.key (mode 600). These are hot wallets: keep balances small.");
  console.log("  - buyer: `nustuf buy` uses it when no --buyer-private-key-file is given. Needs USDC on the seller's network.");
  console.log("  - seller: `--announce` uses it when no --private-key-file or DEPLOYER_PRIVATE_KEY is set. Needs a little ETH for gas.");
  console.log("  - `create` never overwrites an existing wallet. `export` prints the key and only runs in an interactive terminal.");
  process.exit(code);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      args._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function fail(message) {
  console.error(errUi.statusLine("error", message));
  process.exit(1);
}

function resolveNetwork(args) {
  const raw = args.testnet ? "eip155:84532" : args.network || readConfig().config?.defaults?.chainId || "eip155:8453";
  try {
    return resolveSupportedChain(raw);
  } catch (err) {
    return fail(err.message);
  }
}

function resolveRole(args, { required }) {
  if (args.role === undefined) {
    if (required) fail(`--role is required. Use ${WALLET_ROLES.join(" or ")}.`);
    return null;
  }
  if (!isWalletRole(args.role)) fail(`Unknown --role "${args.role}". Use ${WALLET_ROLES.join(" or ")}.`);
  return args.role;
}

function fundingHint(role, network) {
  return role === "buyer"
    ? `Send USDC on ${network.name} (${network.caip2}) to this address. Paying needs no ETH.`
    : `Send a little ETH on ${network.name} (${network.caip2}) for announce gas. It can also receive USDC: use this address as --pay-to.`;
}

function runCreate(args) {
  const role = resolveRole(args, { required: true });
  const network = resolveNetwork(args);
  let created;
  try {
    created = createWallet(role);
  } catch (err) {
    return fail(err.message);
  }
  console.log(outUi.statusLine("ok", `Created ${role} wallet`));
  console.log(`  address : ${created.address}`);
  console.log(`  network : ${network.name} (${network.caip2})`);
  console.log(`  fund    : ${fundingHint(role, network)}`);
  console.log(`  key     : ${created.file} (mode 600, hot wallet: keep balances small)`);
}

async function balancesFor(address, network) {
  const chain = network.id === base.id ? base : baseSepolia;
  const client = createPublicClient({ chain, transport: http() });
  const [eth, usdc] = await Promise.all([
    client.getBalance({ address }),
    client.readContract({ address: USDC_ADDRESSES[network.caip2], abi: erc20Abi, functionName: "balanceOf", args: [address] }),
  ]);
  return { eth: formatEther(eth), usdc: formatUnits(usdc, 6) };
}

async function runShow(args) {
  const requested = resolveRole(args, { required: false });
  const network = resolveNetwork(args);
  const roles = requested ? [requested] : WALLET_ROLES;

  const rows = [];
  for (const role of roles) {
    let address = null;
    try {
      address = getWalletAddress(role);
    } catch (err) {
      return fail(err.message);
    }
    const row = { role, address, network: network.caip2 };
    if (address) {
      try {
        row.balances = await balancesFor(address, network);
      } catch (err) {
        row.balanceError = err.shortMessage || err.message;
      }
    }
    rows.push(row);
  }

  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  for (const row of rows) {
    if (!row.address) {
      console.log(`${row.role}: no wallet yet. Create one with: nustuf wallet create --role ${row.role}`);
      continue;
    }
    console.log(`${row.role}: ${row.address}  (${network.name})`);
    if (row.balances) console.log(`  USDC ${row.balances.usdc}   ETH ${row.balances.eth}`);
    else console.log(`  balance unavailable: ${row.balanceError}`);
  }
}

function runExport(args) {
  const role = resolveRole(args, { required: true });
  // The key must never land in an agent's captured output or a log, so only print to a person.
  if (!input.isTTY || !output.isTTY) {
    return fail("`wallet export` only runs in an interactive terminal. Run it yourself, not through an agent.");
  }
  let key;
  try {
    key = readWalletKey(role);
  } catch (err) {
    return fail(err.message);
  }
  if (!key) return fail(`No ${role} wallet found at ${walletPath(role)}.`);
  console.error(errUi.statusLine("warn", "Anyone with this key controls the wallet. Do not paste it into chat."));
  console.log(key);
}

const [sub, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

if (!sub || sub === "--help" || sub === "-h" || sub === "help") usageAndExit(0);
if (sub === "create") runCreate(args);
else if (sub === "show") await runShow(args);
else if (sub === "export") runExport(args);
else {
  console.error(errUi.statusLine("error", `Unknown wallet command "${sub}".`));
  usageAndExit(1);
}
