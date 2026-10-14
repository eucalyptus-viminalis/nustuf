---
name: nustuf-publish
description: Publish content to the nustuf marketplace behind an x402 payment gate and announce on-chain for discovery.
compatibility: Requires access to the internet
version: 0.10.0
metadata:
  openclaw:
    emoji: 📡
    os: ["darwin", "linux"]
    requires:
      env:
      bins: ["nustuf"]
    install:
      - kind: shell
        command: "git clone https://github.com/eucalyptus-viminalis/nustuf.git && cd nustuf && pnpm install && pnpm link --global"
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

- `nustuf` installed from GitHub with pnpm and linked globally (see the install block above).
- Tailscale installed and logged in for `--public` (see "Tailscale setup" in the README: MagicDNS, HTTPS certificates and Funnel must be enabled). Without Tailscale, add `--tunnel cloudflared` for a temporary URL.
- For `--announce`: a dedicated low-value key that pays a little gas. Easiest is a nustuf-generated wallet: run `nustuf wallet show --role seller`, and if none exists run `nustuf wallet create --role seller --network <caip2>` and tell the user to send a little ETH on that network to the printed address. The seller wallet's address also works as `--pay-to`.
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

Add `--network eip155:84532 --testnet` to sell and list on Base Sepolia.

### Which key signs the announcement

nustuf uses the first of these it finds. Do not guess; the publish summary prints the result as `announce_signer: 0x… (<source>, <balance> ETH)`.

1. `--private-key-file <path>`
2. `DEPLOYER_PRIVATE_KEY`, from the shell or a `.env` in the working directory
3. The seller wallet, `~/.nustuf/wallets/seller.key`
4. `ownerPrivateKey` in `.locus.json` in the working directory

No other file is read (a stray `~/.nustuf/deployer.key`, for example, is ignored).

### Gas check

Before going live, publish checks the signer's ETH on the registry chain. With no ETH it exits before serving anything, naming the address and chain; fund it and rerun. To check yourself, match the chain: `nustuf wallet show --role seller --testnet` for Base Sepolia. Without `--testnet` it shows Base mainnet, which says nothing about Sepolia gas. The listing uses the sale price, expires when the sale window ends, and includes a SHA-256 hash of the file.

### Confirming the listing

The announcement runs in the background after the public URL comes up. `nustuf publish` keeps running for the whole sale window, so do not wait for it to exit and never pipe it through `tail`, `head` or anything else that buffers until exit. Start it in the background with output to a log file, then read the result from:

```bash
nustuf status --json
```

Each run has an `announce` object: `status` (`pending`, `submitted`, `confirmed`, `failed`), `signer`, `signerSource`, `chain`, `txHash`, `explorerUrl` and `error`. Report the signer and the explorer link to the user once it is `confirmed`. If it is `failed`, report `error`.

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
The server defaults to port 4021. If something is already on it, the new run crashes with `EADDRINUSE`. Run `nustuf status --json` first: if an earlier drop is still serving, ask the user before `nustuf stop <id>`, or pass `--port <other>` to run both. Never kill processes by name or port.

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

### Saved profile

Before asking, run `nustuf config show --json` and read `defaults` (`priceUsd`, `window`, `chainId`, `sellerPayTo`, `ogTitle`, `ogDescription`, `displayName`, `bio`). For each input that has a saved value, put it first as "<value> (Recommended — your usual)" so the user can accept it in one click. A saved value is only a suggestion: still ask, and never publish on it without the user's answer. Visibility and the public-exposure consent are never saved.

After a successful publish, if the user chose values that differ from the profile (or there is no profile), offer once to save them, then run e.g. `nustuf config set --price 1 --window 24h --network eip155:8453 --pay-to 0x...`. Use `nustuf config unset <key>` to clear one. Never put keys, secrets or download codes in the profile.

### How to ask

If the `AskUserQuestion` tool is available (Claude Code), collect the inputs with it instead of free-form prose. Batch up to 4 questions per call, and put the recommended option first, labelled "(Recommended)". "Other" is added automatically, so presets never block a custom value.

- **Network** — "Base mainnet (Recommended)" or "Base Sepolia testnet (free, for trying it out)". Ask this first; it decides the rest.
- **Price in USDC** — presets `0.50`, `1`, `5`, `10`.
- **Sale window** — presets `1h`, `24h (Recommended)`, `7d`, `30d`.
- **Visibility** — "Public and listed on-chain (discoverable)", "Public, not listed", or "Private". Warn that on-chain announcement is permanent. Public exposure still needs the explicit consent phrase.

Always ask in plain text, since there are no sensible presets: file path (confirm it), title and description. For the payout address, offer the seller wallet from `nustuf wallet show --role seller` as an option if one exists, otherwise ask for an address.

If `AskUserQuestion` is not available, ask the same questions as one numbered plain-text message, listing the presets inline (e.g. "Sale window: 1h / 24h / 7d / 30d, or your own value"), and wait for the reply. Never fill in an answer the user did not give.

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

## Checking and stopping what is live

`nustuf status --json` lists everything this machine is serving (title, price, URL, time left). Run it before publishing to avoid port conflicts, and when the user asks what is live. `nustuf stop <id>` or `nustuf stop all` ends a drop; confirm with the user before stopping anything.

## Reporting back

After publishing, tell the user the public URL, price, network, payout address and time left (from `nustuf status --json`). If it was announced, also give the signer address and its source, and the announce status with the explorer link or error.

## Runtime

`nustuf publish` stays in the foreground for the whole sale window. Run it in the background (e.g. `nustuf publish ... > ~/.nustuf/publish.log 2>&1 &`, or launchd/systemd/tmux) and use `nustuf status --json` or the log to follow it. `nustuf stop <id>` ends it.
