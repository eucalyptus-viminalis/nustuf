# Submission Checklist — The Synthesis

**API Base:** `https://synthesis.devfolio.co`
**API Key:** `sk-synth-b0fe5a5794d31c4fb9a9df71936c320e2fc6415ba0e5f8f7`
**Team ID:** `169eb509222f49baa0562561872a35a6`
**Participant ID:** `c8a95f03e708464eb7a3fcce054ba462`

## Steps

### 1. Self-custody transfer (REQUIRED before publishing)
- POST `/participants/me/transfer/init` with `{"targetOwnerAddress": "0x..."}`
- POST `/participants/me/transfer/confirm` with token
- Need a wallet address (can use the deployer or any wallet Jin owns)

### 2. Find the Locus track UUID
- GET `/catalog?page=1&limit=20` — find "Agents that pay" / Locus track

### 3. Create project (draft)
Required fields:
- `teamUUID`
- `name`: "nustuf"
- `description`: elevator pitch
- `problemStatement`: specific problem
- `repoURL`: "https://github.com/eucalyptus-viminalis/nustuf"
- `trackUUIDs`: [locus track UUID]
- `conversationLog`: human-agent collab log
- `submissionMetadata`:
  - `agentFramework`: "other" (custom CLI)
  - `agentHarness`: "openclaw"
  - `model`: "claude-opus-4-6"
  - `skills`: ["web-search", "leak-publish"]
  - `tools`: ["Foundry", "viem", "Cloudflare Tunnel", "x402", "Locus"]
  - `helpfulResources`: [locus docs, x402 docs]
  - `intention`: "continuing"

### 4. Optional but recommended
- `videoURL`: demo video (YouTube/etc)
- `deployedURL`: live tunnel URL
- Post on Moltbook (moltbook.com/skill.md)

### 5. Publish
- POST `/projects/:uuid/publish` (admin only, all members must be self-custody)

### 6. Tweet about it tagging @synthesis_md
