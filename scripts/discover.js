#!/usr/bin/env node
import "dotenv/config";
import { createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";
import { createUi } from "./ui.js";

const outUi = createUi(process.stdout);
const errUi = createUi(process.stderr);

// Registry contract address (TODO: deploy and update)
const DEFAULT_REGISTRY_ADDRESS = "0x134597d9Cc6270571C2b8245c4235f7838C0d65D";
const REGISTRY_ADDRESS = process.env.NUSTUF_REGISTRY_ADDRESS || DEFAULT_REGISTRY_ADDRESS;
const REGISTRY_CHAIN = process.env.NUSTUF_REGISTRY_CHAIN || "base";

// Minimal ABI for reading releases
const REGISTRY_ABI = [
  {
    name: "getActiveReleases",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "limit", type: "uint256" }],
    outputs: [{ name: "", type: "bytes32[]" }],
  },
  {
    name: "getRelease",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "releaseId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "creator", type: "address" },
          { name: "url", type: "string" },
          { name: "priceUsdc", type: "uint256" },
          { name: "contentHash", type: "bytes32" },
          { name: "expiresAt", type: "uint256" },
          { name: "title", type: "string" },
          { name: "description", type: "string" },
          { name: "active", type: "bool" },
        ],
      },
    ],
  },
  {
    name: "getReleasesByCreator",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "creator", type: "address" }],
    outputs: [{ name: "", type: "bytes32[]" }],
  },
];

function usageAndExit(code = 1) {
  console.log(outUi.heading("nustuf discover"));
  console.log("");
  console.log(outUi.section("Usage"));
  console.log("  nustuf discover [options]");
  console.log("");
  console.log(outUi.section("Options"));
  console.log("  --active               Show only active releases (default)");
  console.log("  --creator <address>    Filter by creator address");
  console.log("  --max-price <usdc>     Filter by maximum price");
  console.log("  --limit <n>            Maximum results (default: 20)");
  console.log("  --json                 Output as JSON");
  console.log("  --testnet              Use Base Sepolia testnet");
  console.log("");
  console.log(outUi.section("Examples"));
  console.log("  nustuf discover --active");
  console.log("  nustuf discover --creator 0x1234... --limit 10");
  console.log("  nustuf discover --max-price 1.00 --json");
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

function getClient(useTestnet) {
  const chain = useTestnet ? baseSepolia : base;
  return createPublicClient({
    chain,
    transport: http(),
  });
}

function formatPrice(priceUsdc) {
  // priceUsdc is in 6 decimals (USDC standard)
  const formatted = (Number(priceUsdc) / 1e6).toFixed(2);
  return `${formatted} USDC`;
}

function formatExpiry(expiresAt) {
  const date = new Date(Number(expiresAt) * 1000);
  const now = Date.now();
  const diff = date.getTime() - now;
  
  if (diff < 0) return "expired";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m left`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h left`;
  return `${Math.floor(diff / 86400000)}d left`;
}

async function fetchReleases(client, registryAddress, options) {
  const limit = options.limit || 20;
  
  // Get active release IDs
  let releaseIds;
  
  if (options.creator) {
    releaseIds = await client.readContract({
      address: registryAddress,
      abi: REGISTRY_ABI,
      functionName: "getReleasesByCreator",
      args: [options.creator],
    });
  } else {
    releaseIds = await client.readContract({
      address: registryAddress,
      abi: REGISTRY_ABI,
      functionName: "getActiveReleases",
      args: [BigInt(limit)],
    });
  }
  
  // Fetch details for each release
  const releases = [];
  for (const id of releaseIds.slice(0, limit)) {
    try {
      const release = await client.readContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: "getRelease",
        args: [id],
      });
      
      // Filter by max price if specified
      if (options.maxPrice) {
        const maxPriceUsdc = BigInt(Math.floor(parseFloat(options.maxPrice) * 1e6));
        if (release.priceUsdc > maxPriceUsdc) continue;
      }
      
      // Filter out inactive/expired if --active
      if (options.active) {
        if (!release.active) continue;
        if (Number(release.expiresAt) * 1000 < Date.now()) continue;
      }
      
      releases.push({
        id: id,
        creator: release.creator,
        url: release.url,
        price: formatPrice(release.priceUsdc),
        priceRaw: release.priceUsdc.toString(),
        title: release.title,
        description: release.description,
        expiresAt: new Date(Number(release.expiresAt) * 1000).toISOString(),
        timeLeft: formatExpiry(release.expiresAt),
        active: release.active,
      });
    } catch (err) {
      // Skip invalid releases
      console.error(errUi.statusLine("warn", `Failed to fetch release ${id}: ${err.message}`));
    }
  }
  
  return releases;
}

function printReleases(releases, asJson) {
  if (asJson) {
    console.log(JSON.stringify({ releases }, null, 2));
    return;
  }
  
  if (releases.length === 0) {
    console.log(outUi.statusLine("info", "No releases found"));
    return;
  }
  
  console.log(outUi.heading(`Found ${releases.length} release${releases.length === 1 ? "" : "s"}`));
  console.log("");
  
  for (const release of releases) {
    console.log(outUi.section(release.title || "Untitled"));
    const rows = [
      { key: "price", value: release.price },
      { key: "expires", value: release.timeLeft },
      { key: "creator", value: release.creator },
      { key: "url", value: release.url },
      release.description ? { key: "desc", value: release.description } : null,
    ].filter(Boolean);
    
    for (const line of outUi.formatRows(rows)) {
      console.log(line);
    }
    console.log("");
  }
  
  console.log(outUi.muted("Use `nustuf buy <url> --locus` to purchase"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  
  if (!REGISTRY_ADDRESS) {
    console.log(outUi.heading("nustuf discover"));
    console.log("");
    console.log(outUi.statusLine("warn", "Registry contract not yet deployed"));
    console.log("");
    console.log("The on-chain discovery feature requires the NustufRegistry contract.");
    console.log("Set NUSTUF_REGISTRY_ADDRESS env var once deployed.");
    console.log("");
    console.log(outUi.section("Coming Soon"));
    console.log("  • Browse live releases from any creator");
    console.log("  • Filter by price, category, creator");
    console.log("  • Get recommendations based on history");
    console.log("");
    
    // For now, show mock data for demo purposes
    if (args.demo) {
      const mockReleases = [
        {
          id: "0x1234...demo",
          creator: "0xAb46Ab69fE5820468942880A5fF4bB3284BB328e",
          url: "https://demo.trycloudflare.com/",
          price: "0.50 USDC",
          title: "Demo Track",
          description: "A demo release for testing",
          timeLeft: "23h left",
        },
      ];
      printReleases(mockReleases, args.json);
    }
    
    process.exit(0);
  }
  
  const useTestnet = Boolean(args.testnet) || REGISTRY_CHAIN === "base-sepolia";
  const client = getClient(useTestnet);
  
  console.log(outUi.statusLine("info", `Querying ${useTestnet ? "Base Sepolia" : "Base"} registry...`));
  
  const releases = await fetchReleases(client, REGISTRY_ADDRESS, {
    active: args.active !== false, // default true
    creator: args.creator,
    maxPrice: args["max-price"],
    limit: parseInt(args.limit) || 20,
  });
  
  printReleases(releases, args.json);
}

main().catch((e) => {
  const detail = e?.message || String(e);
  console.error(errUi.statusLine("error", detail));
  process.exit(1);
});
