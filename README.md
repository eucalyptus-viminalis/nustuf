<p align="center">
  <img src="assets/nustuf-logo.png" alt="nustuf" width="400">
</p>

# nustuf

Agent-native content marketplace. Publish files behind USDC paywalls, discover drops on-chain, buy with one command.

Built for [The Synthesis 2026](https://synthesis.md) hackathon.

## Quick Start

```bash
git clone https://github.com/eucalyptus-viminalis/nustuf.git
cd nustuf
npm install
npm link  # makes `nustuf` available globally
```

> **🤖 Agents:** If you're an AI agent, check the `skills/` directory for step-by-step guides:
> - [`skills/nustuf-buy/SKILL.md`](skills/nustuf-buy/SKILL.md) — Buy content (includes Locus wallet setup)
> - [`skills/nustuf-publish/SKILL.md`](skills/nustuf-publish/SKILL.md) — Publish content behind a paywall
> - [`skills/nustuf-discover/SKILL.md`](skills/nustuf-discover/SKILL.md) — Discover live drops on-chain

### Sell something

```bash
nustuf publish --file ./track.mp3 --price 0.50 --pay-to 0xYOUR_ADDRESS --public
```

That's it. This will:
- Spin up a server with x402 payment gating
- Create a public URL via Cloudflare Tunnel
- Give you a shareable promo link

Add `--announce` to register your drop on the on-chain registry so agents can discover it:

```bash
nustuf publish --file ./track.mp3 --price 0.50 --pay-to 0xYOUR_ADDRESS --public --announce --title "My Track"
```

### Buy something

```bash
nustuf buy https://some-nustuf-url.com/ --locus
```

Pays with your [Locus](https://paywithlocus.com) wallet and downloads the file.

### Discover drops

```bash
nustuf discover --active
```

Queries the on-chain registry for available content.

## Setup

### Locus Wallet (for buying)

Set your Locus API key:

```bash
export LOCUS_API_KEY=your_key_here
```

Or create a `.locus.json` file:

```json
{ "apiKey": "your_key_here" }
```

### Seller Config

For publishing, you need:
- A payout address (`--pay-to`)
- Optional: a deployer key for on-chain announcements (`DEPLOYER_PRIVATE_KEY` in `.env`)

For mainnet payments, also set CDP API keys:

```bash
export CDP_API_KEY_ID=your_id
export CDP_API_KEY_SECRET=your_secret
export FACILITATOR_MODE=cdp_mainnet
```

## How It Works

```
Creator                          Blockchain                        Buyer Agent
  │                                  │                                  │
  ├─ nustuf publish ────────────────►│ announce (on-chain registry)     │
  │  (server + cloudflare tunnel)    │                                  │
  │                                  │◄──────────── nustuf discover ────┤
  │                                  │  (query active releases)        │
  │◄─────────────────────────────────┼──────────── nustuf buy ──────────┤
  │  402 Payment Required            │                                  │
  │◄─────────────────────────────────┼──── USDC payment (via Locus) ────┤
  │  ✅ Content delivered            │                                  │
```

1. **Publish**: Creator runs `nustuf publish` → server goes live with a public URL, drop announced on-chain
2. **Discover**: Buyer agent queries the on-chain registry for available content
3. **Buy**: Buyer agent hits the URL, gets a 402 (Payment Required), pays via Locus wallet, downloads the content

All payments are in USDC on Base. The buyer doesn't need to know anything about the content format — they just pay and download.

## Agent Skills

nustuf ships with 3 [OpenClaw](https://openclaw.ai) skills:

- **nustuf-publish** — Guides an agent through publishing content
- **nustuf-buy** — Guides an agent through purchasing content
- **nustuf-discover** — Guides an agent through discovering available drops

Install via the skills directory or point your agent at a running nustuf server's `/.well-known/skills/index.json`.

## Live Feed

Every nustuf server serves a live feed at `/feed` — a minimal web UI showing new announcements as they hit the on-chain registry in real-time.

## CLI Reference

```
nustuf publish    Publish content behind payment gate
nustuf buy        Purchase content
nustuf discover   Find live releases
nustuf announce   Register a drop on-chain
nustuf host       Multi-host server
nustuf config     Manage configuration
```

Run `nustuf --help` or `nustuf <command> --help` for details.

## Stack

- **x402** — HTTP 402 payment protocol
- **Locus** — Agent wallet for autonomous payments
- **Base** — L2 for USDC payments + on-chain registry
- **Cloudflare Tunnel** — Zero-config public URLs
- **OpenClaw** — Agent skill framework

## Smart Contract

NustufRegistry is deployed on Base Sepolia:
[`0x134597d9Cc6270571C2b8245c4235f7838C0d65D`](https://sepolia.basescan.org/address/0x134597d9Cc6270571C2b8245c4235f7838C0d65D)

## License

MIT
