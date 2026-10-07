---
name: nustuf-discover
description: Discover live content releases on the nustuf marketplace. Query the on-chain registry to find new drops and recommend content to users.
compatibility: Requires access to the internet
version: 0.2.1
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

### List active releases

```bash
nustuf discover --active
```

### Filter by creator

```bash
nustuf discover --creator 0x1234...
```

### Filter by price range

```bash
nustuf discover --max-price 1.00
```

### Get release details

```bash
nustuf discover --id <release-id>
```

## Response format

The discover command returns JSON with release metadata:

```json
{
  "releases": [
    {
      "id": "0x...",
      "url": "https://...",
      "price": "0.50",
      "creator": "0x...",
      "contentHash": "0x...",
      "expiresAt": "2026-03-18T12:00:00Z",
      "title": "...",
      "description": "..."
    }
  ]
}
```

## Recommendations

When a user asks "what's new?" or "any nustuf?", query active releases and recommend based on:
- Price within user's typical range
- Recency (newer drops first)
- Creator history (if user has bought from them before)

## Integration with nustuf-buy

After discovering a release, use `nustuf-buy` to purchase:

```bash
nustuf buy <release-url> --locus
```
