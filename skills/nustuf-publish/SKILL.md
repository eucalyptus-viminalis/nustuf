---
name: nustuf-publish
description: Publish content to the nustuf marketplace behind an x402 payment gate and announce on-chain for discovery.
compatibility: Requires access to the internet
version: 0.1.0
metadata:
  openclaw:
    emoji: 📡
    os: ["darwin", "linux"]
    requires:
      env:
      bins: ["nustuf"]
    install:
      - kind: node
        package: nustuf
        bins: ["nustuf"]
        label: "Install nustuf via npm"
  author: eucalyptus-viminalis
---

# nustuf-publish

## Overview

Publish content behind an x402 payment gate and announce the release on-chain so agents can discover it.

## The publish flow

1. User provides file, price, and sale window
2. nustuf creates x402 payment gate
3. Release metadata is announced on Base L2 registry
4. Other agents can now discover and buy the release

## Commands

### Publish with on-chain announcement (discoverable)

If the user wants the release to be discoverable by other agents on-chain, use `nustuf announce` **after** publishing. This writes the release metadata to the NustufRegistry contract on Base (or Base Sepolia for testnet).

```bash
# Step 1: Publish (starts x402 gate + tunnel)
nustuf publish \
  --file ./track.mp3 \
  --price 0.50 \
  --window 24h \
  --pay-to 0xYOUR_ADDRESS \
  --title "My New Track" \
  --description "Exclusive release"

# Step 2: Announce on-chain (after publish gives you the tunnel URL)
nustuf announce \
  --url <tunnel-url-from-publish> \
  --price 0.50 \
  --expires <unix-timestamp> \
  --title "My New Track" \
  --description "Exclusive release" \
  --file ./track.mp3
```

The `--file` flag on announce computes a content hash for on-chain verification. The `--expires` timestamp should match the sale window end time.

### Publish without announcement (private)

```bash
nustuf publish \
  --file ./track.mp3 \
  --price 0.50 \
  --window 24h \
  --pay-to 0xYOUR_ADDRESS \
  --private
```

### Expose publicly (with consent)

```bash
nustuf publish \
  --file ./track.mp3 \
  --price 0.50 \
  --window 24h \
  --pay-to 0xYOUR_ADDRESS \
  --public
```

## ⚠️ Known issues

### Port conflicts
The server defaults to port 4021. If a previous instance didn't shut down cleanly, the new one will crash with `EADDRINUSE`. Before starting a new publish:

```bash
# Kill any existing nustuf/leak processes
pkill -f "publish.js\|index.js" 2>/dev/null
# Verify port is free
kill -9 $(lsof -ti:4021) 2>/dev/null || true
# Wait a moment for cleanup
sleep 2
```

### Cloudflare tunnel rate limiting
Quick tunnels via `trycloudflare.com` can be rate-limited if you start/stop too frequently. If the tunnel URL doesn't load, wait 30-60 seconds before retrying.

## Safety policy (required)

1. Require explicit user confirmation of the file path
2. Require explicit consent before `--public` exposure
3. Reject symlink paths
4. Block sensitive paths (~/.ssh, ~/.aws, etc.)
5. Warn user that on-chain announcement is permanent

## Required inputs

1. File path
2. Price in USDC
3. Sale window (e.g., 1h, 24h, 7d)
4. Payout address (`--pay-to`)
5. Title and description (for on-chain metadata)

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
    "url": "https://xxx.trycloudflare.com/",
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
