---
name: nustuf-discover
description: Discover live content releases on the nustuf marketplace. Query the on-chain registry to find new drops and recommend content to users.
compatibility: Requires access to the internet
version: 0.5.1
metadata:
  openclaw:
    emoji: 🔍
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

# nustuf-discover

## Overview

Query the nustuf on-chain registry to discover live content releases. Help users find new drops without following creators on social media.

## Commands

### Pick the network first

`discover` reads **Base mainnet** by default. Testnet drops only appear with `--testnet` (Base Sepolia). An empty mainnet result ("No releases found") does not mean there are no drops: retry with `--testnet`. Use `--json` for machine-readable output.

### List active releases

```bash
nustuf discover --active
nustuf discover --testnet --json
```

### Filter by creator

```bash
nustuf discover --creator 0x1234...
```

### Filter by price range

```bash
nustuf discover --max-price 1.00
```

### Limit results

```bash
nustuf discover --limit 10
```

## Response format

`discover --json` returns release metadata:

```json
{
  "releases": [
    {
      "id": "0x...",
      "creator": "0x...",
      "url": "https://...",
      "price": "0.50 USDC",
      "priceRaw": "500000",
      "title": "...",
      "description": "...",
      "expiresAt": "2026-03-18T12:00:00.000Z",
      "timeLeft": "9h left",
      "active": true
    }
  ]
}
```

`price` is rounded to 2 decimals, so sub-cent prices show as `0.00 USDC`. Use `priceRaw` (USDC base units, 6 decimals; `500` = 0.0005 USDC) for the real price. To pick the drop that expires first, sort by `expiresAt`.

## Recommendations

When a user asks "what's new?" or "any nustuf?", query active releases and recommend based on:
- Price within user's typical range
- Recency (newer drops first)
- Creator history (if user has bought from them before)

## Integration with nustuf-buy

After discovering a release, use `nustuf-buy` to purchase:

```bash
nustuf buy <release-url>            # pays from the nustuf buyer wallet
nustuf buy <release-url> --locus    # or pay via Locus
```
