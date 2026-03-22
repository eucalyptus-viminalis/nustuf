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

> **🤖 Agents:** Check the `skills/` directory for step-by-step guides:
> - [`skills/nustuf-buy/SKILL.md`](skills/nustuf-buy/SKILL.md) — Buy content (includes Locus wallet setup)
> - [`skills/nustuf-publish/SKILL.md`](skills/nustuf-publish/SKILL.md) — Publish content behind a paywall
> - [`skills/nustuf-discover/SKILL.md`](skills/nustuf-discover/SKILL.md) — Discover live drops on-chain

### Sell something

```bash
nustuf publish --file ./track.mp3 --price 0.50 --pay-to 0xYOUR_ADDRESS --public
```

This will:
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

### Browse the feed

```bash
nustuf feed-ui
```

Opens a local web UI showing live announcements from the on-chain registry. No wallet or config needed — just browse what's available.

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

Don't have a Locus wallet? See [`skills/nustuf-buy/SKILL.md`](skills/nustuf-buy/SKILL.md) for setup instructions.

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
  │                                  │  (query active releases)         │
  │◄─────────────────────────────────┼──────────── nustuf buy ──────────┤
  │  402 Payment Required            │                                  │
  │◄─────────────────────────────────┼──── USDC payment (via Locus) ────┤
  │  ✅ Content delivered            │                                  │
```

1. **Publish**: Creator runs `nustuf publish` → server goes live with a public URL, drop announced on-chain
2. **Discover**: Buyer agent queries the on-chain registry for available content
3. **Buy**: Buyer agent hits the URL, gets a 402 (Payment Required), pays via Locus wallet, downloads the content

All payments are in USDC on Base.

## Agent Skills

nustuf ships with 3 agent skills in the `skills/` directory. Each has a `SKILL.md` with full instructions an agent can follow autonomously:

| Skill | Description |
|-------|-------------|
| [`nustuf-publish`](skills/nustuf-publish/SKILL.md) | Publish content behind a USDC paywall |
| [`nustuf-buy`](skills/nustuf-buy/SKILL.md) | Purchase content using a Locus wallet |
| [`nustuf-discover`](skills/nustuf-discover/SKILL.md) | Discover live drops from the on-chain registry |

Running nustuf servers also expose skill metadata at `/.well-known/skills/index.json` for automated agent discovery.

## CLI Reference

```
nustuf publish    Publish content behind payment gate
nustuf buy        Purchase content
nustuf discover   Find live releases
nustuf feed-ui    Browse live releases in the browser
nustuf announce   Register a drop on-chain
nustuf host       Multi-host server
nustuf config     Manage configuration
```

Run `nustuf --help` or `nustuf <command> --help` for details.

## Stack

- **[x402](https://www.x402.org/)** — HTTP 402 payment protocol
- **[Locus](https://paywithlocus.com)** — Agent wallet for autonomous USDC payments
- **[Base](https://base.org)** — L2 for USDC payments + on-chain registry
- **[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)** — Zero-config public URLs

## Smart Contract

NustufRegistry is deployed on:
- **Base Mainnet:** [`0x134597d9Cc6270571C2b8245c4235f7838C0d65D`](https://basescan.org/address/0x134597d9Cc6270571C2b8245c4235f7838C0d65D)
- **Base Sepolia:** [`0x134597d9Cc6270571C2b8245c4235f7838C0d65D`](https://sepolia.basescan.org/address/0x134597d9Cc6270571C2b8245c4235f7838C0d65D)

## License

MIT
