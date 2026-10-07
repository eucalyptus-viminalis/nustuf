---
name: nustuf-publish
description: Publish content to the nustuf marketplace behind an x402 payment gate and announce on-chain for discovery.
compatibility: Requires access to the internet
version: 0.5.0
metadata:
  openclaw:
    emoji: 📡
    os: ["darwin", "linux"]
    requires:
      env:
      bins: ["nustuf"]
    install:
      - kind: shell
        command: "git clone https://github.com/eucalyptus-viminalis/nustuf.git && cd nustuf && npm install -g ."
        label: "Install nustuf CLI from GitHub"
  author: eucalyptus-viminalis
---

# nustuf-publish

## Overview

Publish content behind an x402 payment gate and announce the release on-chain so agents can discover it.

## The publish flow

1. User provides file, price, and sale window
2. nustuf creates the x402 payment gate and a stable public URL (Tailscale Funnel)
3. With `--announce`, the release is written to the Base L2 registry once the public URL is live
4. Other agents can now discover and buy the release

## Prerequisites

- `nustuf` installed from GitHub (see the install block above) and `npm link`ed or installed globally.
- Tailscale installed and logged in for `--public` (see "Tailscale setup" in the README: MagicDNS, HTTPS certificates and Funnel must be enabled). Without Tailscale, add `--tunnel cloudflared` for a temporary URL.
- For `--announce`: a dedicated low-value key that pays a little gas. Easiest is a nustuf-generated wallet: run `nustuf wallet show --role seller`, and if none exists run `nustuf wallet create --role seller --network <caip2>` and tell the user to send a little ETH on that network to the printed address. `--announce` uses it automatically. Alternatives: `DEPLOYER_PRIVATE_KEY` or `--private-key-file`. The seller wallet's address also works as `--pay-to`.
- For mainnet payments: CDP keys (see the README). To try without them, sell on Base Sepolia with `--network eip155:84532` and announce with `--testnet`.

## Commands

### Publish and announce on-chain (discoverable)

One command publishes the file behind the paywall, exposes it, and lists it in the registry. Non-interactive runs need the explicit consent phrase for public exposure.

```bash
nustuf publish \
  --file ./track.mp3 \
  --price 0.50 \
  --window 24h \
  --pay-to 0xYOUR_ADDRESS \
  --public --public-confirm I_UNDERSTAND_PUBLIC_EXPOSURE \
  --announce \
  --title "My New Track" \
  --description "Exclusive release"
```

Add `--network eip155:84532 --testnet` to sell and list on Base Sepolia. The listing uses the sale price, expires when the sale window ends, and includes a SHA-256 hash of the file.

If the announcement fails, the drop stays live and nustuf prints a `nustuf announce --url ... --price ... --expires ... --title ...` command. Run that by hand to retry. nustuf announces a drop once, on its first public URL; if the URL changes (a cloudflared restart, a renamed machine or tailnet) it warns and prints the command instead of writing a second listing.

### Publish without announcement (private)

```bash
nustuf publish \
  --file ./track.mp3 \
  --price 0.50 \
  --window 24h \
  --pay-to 0xYOUR_ADDRESS \
  --private
```

### Expose publicly without listing it on-chain

```bash
nustuf publish \
  --file ./track.mp3 \
  --price 0.50 \
  --window 24h \
  --pay-to 0xYOUR_ADDRESS \
  --public --public-confirm I_UNDERSTAND_PUBLIC_EXPOSURE
```

## ⚠️ Known issues

### Port conflicts
The server defaults to port 4021. If a previous instance didn't shut down cleanly, the new one will crash with `EADDRINUSE`. Before starting a new publish:

```bash
# Kill any existing nustuf processes
pkill -f "publish.js\|index.js" 2>/dev/null
# Verify port is free
kill -9 $(lsof -ti:4021) 2>/dev/null || true
# Wait a moment for cleanup
sleep 2
```

### Tunnels
`--public` uses Tailscale Funnel by default (needs Tailscale installed and logged in; URL is `https://<machine>.<tailnet>.ts.net` and stable across restarts). Use `--tunnel cloudflared` for a temporary account-free URL.

Quick tunnels via `trycloudflare.com` can be rate-limited if you start/stop too frequently. If the tunnel URL doesn't load, wait 30-60 seconds before retrying.

## Safety policy (required)

1. Require explicit user confirmation of the file path
2. Require explicit consent before `--public` exposure
3. Reject symlink paths
4. Block sensitive paths (~/.ssh, ~/.aws, etc.)
5. Warn user that on-chain announcement is permanent
6. Do not print `DEPLOYER_PRIVATE_KEY`, API keys or `.env` contents
7. Never run `nustuf wallet export` and never ask the user to paste a private key into chat; funding a generated wallet only needs its public address

## Required inputs (ALWAYS ask for these — never assume defaults)

1. **File path** — what content to publish
2. **Price in USDC** — how much to charge
3. **Sale window** — how long to keep it live (e.g., 1h, 24h, 7d). DO NOT default silently.
4. **Payout address** — where USDC goes (`--pay-to`)
5. **Title and description** — for on-chain metadata and promo page
6. **Network** — Base mainnet (`eip155:8453`) or Base Sepolia testnet (`eip155:84532`)

## On-chain announcement

When publishing, nustuf writes to the Base L2 registry contract:

```solidity
function announce(
    string url,
    uint256 priceUsdc,
    bytes32 contentHash,
    uint256 expiresAt,
    string title,
    string description
)
```

This makes the release discoverable by any agent running `nustuf-discover`.

## Response format

```json
{
  "success": true,
  "release": {
    "id": "0x...",
    "url": "https://<machine>.<tailnet>.ts.net/",
    "price": "0.50",
    "expiresAt": "2026-03-18T07:00:00Z",
    "registryTx": "https://basescan.org/tx/0x..."
  },
  "gate": {
    "status": "live",
    "accessModes": ["payment"]
  }
}
```

## Runtime

Uses persistent background process (launchd/systemd/tmux) to keep the gate alive for the sale window duration.
