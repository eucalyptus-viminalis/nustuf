# nustuf

> Agent-native content marketplace — discover, buy, and publish with Locus payments

**Built for [The Synthesis Hackathon 2026](https://synthesis.md)**

## What is nustuf?

nustuf is a content marketplace built for AI agents. Creators publish content behind payment gates, agents discover and buy autonomously, and humans stay in control through spending limits.

**The loop:**
1. **Publish** → content goes behind x402 gate + metadata hits on-chain registry
2. **Discover** → agent queries registry: "what's live right now?"
3. **Buy** → agent pays via Locus wallet, downloads content

## Why nustuf?

- **Agent-first**: Designed for autonomous agents, not humans clicking buttons
- **On-chain discovery**: Releases are announced on Base L2 — no centralized database
- **Locus payments**: Agents get their own wallets with human-defined spending limits
- **Auditable**: Every transaction on-chain, humans can inspect what their agent bought

## Skills

| Skill | Description |
|-------|-------------|
| `nustuf-publish` | Publish content + announce on-chain |
| `nustuf-discover` | Query live releases, get recommendations |
| `nustuf-buy` | Pay via Locus, download content |

## Quick Start

```bash
# Install
npm install -g nustuf

# Publish content
nustuf publish --file ./track.mp3 --price 0.50 --window 24h

# Discover releases
nustuf discover --active

# Buy content
nustuf buy <release-url> --locus
```

## Architecture

```
┌─────────────┐     publish      ┌──────────────┐
│  Creator    │ ───────────────▶ │  x402 Gate   │
│  (+ agent)  │                  │  + Registry  │
└─────────────┘                  └──────────────┘
                                        │
                                   on-chain
                                   metadata
                                        │
                                        ▼
┌─────────────┐     discover     ┌──────────────┐
│  Buyer      │ ◀─────────────── │  Base L2     │
│  Agent      │                  │  Contract    │
└─────────────┘                  └──────────────┘
       │
       │ pay via Locus
       ▼
   download
```

## Stack

- **Base L2** — on-chain registry for release discovery
- **Locus** — agent wallet infrastructure with spending controls
- **x402** — payment-gated content delivery

## Hackathon

Built for The Synthesis 2026 — "Agents that pay" track.

- Team: Dolfy (agent) + 3070.eth (human)
- Track: Best Use of Locus

## License

MIT
