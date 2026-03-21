---
name: nustuf-buy
description: Buy content from the nustuf marketplace using Locus payments. Agents pay autonomously within human-defined spending limits.
compatibility: Requires access to the internet
version: 0.1.0
metadata:
  openclaw:
    emoji: 🛒
    os: ["darwin", "linux"]
    requires:
      env:
        - LOCUS_API_KEY
      bins: ["nustuf"]
    install:
      - kind: node
        package: nustuf
        bins: ["nustuf"]
        label: "Install nustuf via npm"
  author: eucalyptus-viminalis
---

# nustuf-buy

## Overview

Purchase content from the nustuf marketplace using Locus wallet. The agent pays autonomously within spending limits set by the human via the Locus dashboard.

## Prerequisites

1. Agent must be registered with Locus (API key in `LOCUS_API_KEY`)
2. Locus wallet must have USDC balance
3. Human must configure spending limits via Locus dashboard

## Commands

### Buy with Locus (default)

```bash
nustuf buy <release-url> --locus
```

### Buy with download code (no payment)

```bash
nustuf buy <release-url> --download-code "friends-only"
```

### Specify output location

```bash
nustuf buy <release-url> --locus --out ./downloads/
```

## Safety policy (required)

1. Always check Locus balance before purchase
2. Respect spending limits — if purchase exceeds limits, inform user and request approval
3. Log all purchases for audit trail
4. Never store or log payment credentials

## Locus integration

The buy flow:
1. Fetch release metadata from URL
2. Check Locus wallet balance
3. If price > spending limit threshold, request human approval via Locus
4. Execute x402 payment through Locus
5. Download content
6. Report success with transaction details

## Spending controls

Humans configure via Locus dashboard:
- **Allowance** — total USDC budget
- **Max transaction size** — per-purchase cap
- **Approval threshold** — purchases above this require human approval

## Response format

```json
{
  "success": true,
  "release": {
    "id": "0x...",
    "title": "...",
    "price": "0.50"
  },
  "payment": {
    "txHash": "0x...",
    "amount": "0.50",
    "timestamp": "2026-03-17T07:00:00Z"
  },
  "download": {
    "path": "./downloads/track.mp3",
    "size": 4521984
  }
}
```

## Error handling

- `INSUFFICIENT_BALANCE` — wallet needs funding
- `SPENDING_LIMIT_EXCEEDED` — needs human approval
- `RELEASE_EXPIRED` — content no longer available
- `NETWORK_ERROR` — retry with backoff
