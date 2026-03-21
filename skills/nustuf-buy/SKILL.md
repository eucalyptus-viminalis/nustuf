---
name: nustuf-buy
description: Buy content from the nustuf marketplace using Locus payments. Agents pay autonomously within human-defined spending limits.
compatibility: Requires access to the internet
version: 0.2.0
metadata:
  openclaw:
    emoji: 🛒
    os: ["darwin", "linux"]
    requires:
      bins: ["nustuf"]
    install:
      - kind: shell
        command: "git clone https://github.com/eucalyptus-viminalis/nustuf.git && cd nustuf && npm install -g ."
        label: "Install nustuf CLI from GitHub"
  author: eucalyptus-viminalis
---

# nustuf-buy

## Overview

Purchase content from the nustuf marketplace. Sellers publish files behind USDC paywalls — you pay, you download.

## Step 1: Set up a Locus wallet

Before you can buy anything, you need a Locus agent wallet with USDC on Base.

### Create a Locus account and wallet

1. Go to https://paywithlocus.com and sign up (or ask your human to)
2. From the Locus dashboard, create an **agent wallet**
3. Get your **API key** (starts with `claw_`)
4. Fund the wallet with USDC on Base (your human can transfer from any wallet)

### Configure nustuf with your Locus credentials

```bash
nustuf config --write-env
```

This will prompt for your Locus API key and save it to `.env`. Alternatively, set the environment variable directly:

```bash
export LOCUS_API_KEY=claw_your_key_here
```

### Verify your wallet

```bash
# Check balance
curl -s -H "x-api-key: $LOCUS_API_KEY" https://beta-api.paywithlocus.com/api/pay/balance
```

## Step 2: Find content to buy

If you have a nustuf release URL (promo page), you're ready to buy. Otherwise, discover releases:

```bash
nustuf discover --active
```

Or check the on-chain feed at any nustuf server's `/feed` endpoint.

## Step 3: Buy

### Buy with Locus payment

```bash
nustuf buy <release-url> --locus
```

### Buy with download code (free/gifted — no payment needed)

```bash
nustuf buy <release-url> --download-code "friends-only"
```

### Specify output location

```bash
nustuf buy <release-url> --locus --out ./downloads/
```

## How it works

1. Fetches release metadata from the URL (price, network, payment address)
2. Sends USDC via Locus `pay/send` to the seller's address on Base
3. Polls for transaction confirmation
4. Submits the tx hash to the server for verification
5. Server verifies the on-chain USDC transfer and returns the file

## Safety policy (required)

1. Always check Locus balance before purchase
2. If purchase exceeds your human's spending limits, inform them and request approval
3. Log all purchases for audit trail
4. Never store or log payment credentials in chat

## Spending controls

Humans configure via Locus dashboard:
- **Allowance** — total USDC budget
- **Max transaction size** — per-purchase cap
- **Approval threshold** — purchases above this require human approval

## Error handling

- `INSUFFICIENT_BALANCE` — wallet needs funding, ask your human
- `SPENDING_LIMIT_EXCEEDED` — needs human approval via Locus dashboard
- `RELEASE_EXPIRED` — content no longer available
- `NETWORK_ERROR` — retry with backoff
- `402 Payment Required` — normal, this means payment is needed (not an error)
