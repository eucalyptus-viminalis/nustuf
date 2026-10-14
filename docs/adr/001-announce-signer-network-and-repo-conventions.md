# ADR 001: Announce signer and network, pnpm, and no code comments

## Status

Implemented (2026-10-14)

## Context

A demo run of the `nustuf-publish` skill went wrong in ways that made the agent unsure what it had done:

- The agent could not say which wallet signed the on-chain announcement. The CLI never printed the signer, and the agent guessed that a stray `~/.nustuf/deployer.key` might be used (it never is).
- An unfunded signer was only discovered after the drop was live, when the background announce failed. The agent had also checked the seller wallet's balance on Base mainnet while the drop was on Base Sepolia.
- `nustuf publish` runs for the whole sale window, and the agent piped it through `tail`, so it never saw the announce result. Nothing else reported it.
- Payments (`--network`) and the listing (`--testnet`) were chosen by separate flags. Forgetting `--testnet` on a Base Sepolia drop would list it on Base mainnet, paying real gas for a listing no mainnet buyer can pay.

An audit of the repo during the fix found more drift:

- `packageManager` was `npm@10.9.0`, a leftover from the first hackathon commit, while the README and the maintainer use pnpm.
- The repo check scripts came from an earlier project (CalVer versions, a missing `CHANGELOG.md`, a deleted skill) and nothing ran them.
- Help text suggested commands that do not work (`nustuf --file …`, `npm run nustuf`), `nustuf feed-ui --help` started the server, and the docs and skills disagreed with the code in several places.
- The maintainer decided that comments in code files are a code smell and should not be used.

## Decision

### Announce signer is explicit

- `resolveSigner` returns the key, its address and its source. The order is `--private-key-file`, `DEPLOYER_PRIVATE_KEY` (shell or `.env`), the seller wallet, then `.locus.json`. No other file is read.
- `nustuf publish` prints `announce_signer: <address> (<source>, <balance> ETH)`, and `nustuf announce` prints the signer and a `From:` line.

### Gas is checked before going live

- Before serving anything, publish checks the signer's ETH on the listing chain. With no ETH it exits, naming the address and chain. If the RPC cannot be reached, it warns and continues.

### The announce result is recorded

- The run state gets an `announce` record (`pending`, `submitted`, `confirmed` or `failed`, plus signer, chain, tx hash, explorer link and error). `nustuf status --json` returns it, and `nustuf status` prints it.
- The skill tells agents to run publish in the background with output going to a log file, never piped through `tail`, and to confirm the listing from `nustuf status --json`.

### One network for payments and listing

- `publish --announce` lists on the same chain as `--network`. A `--testnet` or `NUSTUF_REGISTRY_CHAIN` that disagrees is an error, not a silent choice. Standalone `nustuf announce` keeps `--testnet`.

### pnpm

- `packageManager` is `pnpm@10.33.0`, `pnpm-lock.yaml` replaces `package-lock.json`, and CI uses pnpm. Install instructions everywhere use `pnpm install && pnpm link --global`.

### Repo checks run on every change

- `pnpm check` runs version sync (semver, `package.json` against every `SKILL.md`), no machine-specific paths, skill command scope, download-code terminology, and no comments. CI runs it alongside `pnpm test`.
- `test/help.test.js` checks that every `--help` exits cleanly and only suggests commands that exist.

### No comments in code files

- JS, HTML, Solidity, shell and YAML/TOML files carry no comments. Explanations go in names, tests and docs.
- Lines that tools read are allowed: shebangs, `// SPDX-License-Identifier`, and the SwiftBar `<xbar.*>`/`<swiftbar.*>` header. Vendored code (`contracts/lib/`, `assets/`) is exempt.
- `scripts/check_no_comments.js` enforces this. It uses the TypeScript parser, so comment markers inside strings, template literals and regexes are not flagged.

## Consequences

- An agent can answer "which wallet, which chain, did it list?" from CLI output and `nustuf status --json` alone, with no guessing.
- A drop can no longer go live with an announce that is certain to fail for lack of gas.
- A mainnet publish with `NUSTUF_REGISTRY_CHAIN=base-sepolia` in `.env` (set so `discover` shows testnet drops) now fails. Remove the variable for that run, or use `discover --testnet`.
- `typescript` is now a direct dev dependency, used only by the comment check.
- Removing NatSpec from `NustufRegistry.sol` changes its compiler metadata hash, so the repo source no longer rebuilds byte-for-byte to the deployed, verified bytecode. The deployed contract and its Basescan verification are unaffected.
- Knowledge that lived in comments is gone from the code. The maintainer keeps a local, untracked copy of the removed comments to move into docs where still useful.

## Provenance

| Commit | Change |
|---|---|
| `229fe22` | Signer shown, gas checked before going live, announce result recorded in status; skill updated |
| `33a67e7` | Version 0.10.0 |
| `a810f92` | Switch to pnpm; check scripts updated and run in CI |
| `fcefd46` | Docs, help and skills brought in line with the code; code comments removed; no-comments check added |
| `bc43b4b` | Version 0.11.0 |
| `5326ba2` | Listing follows the payment network; mismatches rejected |
| `7464d9f` | Version 0.12.0 |
