---
name: nustuf-buy
description: Buy content from the nustuf marketplace with a nustuf buyer wallet or Locus. Agents pay autonomously within human-defined spending limits.
compatibility: Requires access to the internet
version: 0.10.0
metadata:
  openclaw:
    emoji: 🛒
    os: ["darwin", "linux"]
    requires:
      bins: ["nustuf"]
    install:
      - kind: shell
        command: "git clone https://github.com/eucalyptus-viminalis/nustuf.git && cd nustuf && pnpm install && pnpm link --global"
        label: "Install nustuf CLI from GitHub"
  author: eucalyptus-viminalis
---

# nustuf-buy

## Overview

Purchase content from the nustuf marketplace. Sellers publish files behind USDC paywalls — you pay, you download.

## Step 1: Set up a wallet

Before you can buy anything, you need a wallet with USDC on the seller's network. **Check for an existing nustuf wallet first** (it is the default and needs no account or API key); only use Locus if the user wants it.

### Option A: nustuf-generated wallet (default)

```bash
nustuf wallet show --role buyer --testnet   # Base Sepolia; drop --testnet for Base mainnet
```

The balance shown is for that network only, so match it to the seller's network. If there is no wallet, create one:

```bash
nustuf wallet create --role buyer --network eip155:8453   # or eip155:84532 for Base Sepolia
```

Tell the user to send USDC on that network to the printed address (paying needs no ETH), and check `nustuf wallet show` until it arrives. `nustuf buy <url>` pays from this wallet when you pass neither `--locus` nor `--buyer-private-key-file`. It is a hot wallet, so suggest small amounts. Never run `nustuf wallet export` or ask the user to paste a private key into chat. Do not look for or ask for a `LOCUS_API_KEY` unless the user asked for Locus.

### Option B: Locus wallet

1. Go to https://paywithlocus.com and sign up (or ask your human to)
2. From the Locus dashboard, create an **agent wallet**
3. Get your **API key** (starts with `claw_`)
4. Fund the wallet with USDC on Base (your human can transfer from any wallet)

Save the key with `nustuf config --write-env` (it prompts and writes `.env`), or set `LOCUS_API_KEY` in the environment, or put `{ "apiKey": "..." }` in `.locus.json`. Check the balance:

```bash
curl -s -H "x-api-key: $LOCUS_API_KEY" https://beta-api.paywithlocus.com/api/pay/balance
```

## Step 2: Find content to buy

If you have a nustuf release URL (promo page), you're ready to buy. Otherwise, discover releases:

```bash
nustuf discover --active
```

Or check the on-chain feed at any nustuf server's `/feed` endpoint. Plain `discover` reads Base mainnet and returns nothing for testnet drops; add `--testnet` for Base Sepolia. See `nustuf-discover`.

## Step 3: Buy

### Buy with the nustuf wallet (default)

```bash
nustuf buy <release-url>
```

### Buy with Locus payment

```bash
nustuf buy <release-url> --locus
```

### Buy with download code (free/gifted — no payment needed)

```bash
nustuf buy <release-url> --download-code "friends-only"
```

### Where the file is saved

By default the file is saved to `~/Downloads/nustuf/` with the server's filename (set `NUSTUF_DOWNLOAD_DIR` to use another folder). nustuf never overwrites: if the file already exists the new one is saved as `name (1).ext`. The output prints the **absolute path**, so tell the user exactly where the file is.

To choose the location, `--out` takes a **file path**, not a directory (a directory is rejected). Missing folders are created.

```bash
nustuf buy <release-url> --out ~/Documents/purchase.bin
```

## How it works

With `--locus`:

1. Fetches release metadata from the URL (price, network, payment address)
2. Sends USDC via Locus `pay/send` to the seller's address on Base
3. Polls for transaction confirmation
4. Submits the tx hash to the server for verification
5. Server verifies the on-chain USDC transfer and returns the file

With the nustuf wallet, the CLI answers the server's `402 Payment Required` by signing the USDC payment from the local buyer wallet, then downloads the file and prints a receipt with the tx hash.

## Safety policy (required)

1. Always check the wallet balance before purchase (`nustuf wallet show --role buyer`, or the Locus balance when using `--locus`)
2. If purchase exceeds your human's spending limits, inform them and request approval
3. Log all purchases for audit trail
4. Never store or log payment credentials in chat

## Spending controls

With Locus, humans set limits in the Locus dashboard:
- **Allowance** — total USDC budget
- **Max transaction size** — per-purchase cap
- **Approval threshold** — purchases above this require human approval

The nustuf buyer wallet has no limits of its own: its balance is the limit, so keep it small.

## Error handling

`nustuf buy` exits non-zero with a message on stderr. Read it and act on it:

- Not enough USDC: the wallet needs funding on the seller's network; ask your human
- Locus spending limit hit: needs human approval in the Locus dashboard
- Sale ended or URL unreachable: the drop is over or its host is offline; nothing was charged
- `402 Payment Required` from the URL itself is normal: it is how the price is quoted, not an error
