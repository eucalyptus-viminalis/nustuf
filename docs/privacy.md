# Privacy

What a seller, buyer or observer can learn when you sell with `nustuf publish --public`.

By default nustuf exposes your drop through [Tailscale Funnel](https://tailscale.com/kb/1223/funnel). Buyer requests reach your machine through Tailscale's relay servers. Payments settle on-chain through the x402 facilitator and are not routed through Tailscale at all.

## What stays private

File contents, payment payloads and download codes are encrypted end to end. TLS ends on your own machine, using a certificate Tailscale provisions for your `ts.net` name, and Tailscale documents that its Funnel relays do not decrypt the traffic.

## What Tailscale can see

| Data | Visible to Tailscale? | Basis |
|---|---|---|
| File contents, payments, download codes | No | Documented by Tailscale |
| Buyer IP address, connection timing, bytes transferred | Yes | Inferred: any relay sees these. Not documented by Tailscale |
| Hostname requested (which seller was contacted) | Yes | Inferred, same reason |
| Your device name, tailnet, login identity and public IP | Yes | Needed to run Tailscale at all. Funnel hides your IP from buyers, not from Tailscale |

## What is public

- **Your machine and tailnet names.** Your drop's URL is `https://<machine>.<tailnet>.ts.net`, and the HTTPS certificate for that name is issued by a public certificate authority, so the name will almost certainly appear in public Certificate Transparency logs. Choose a machine name you are happy to publish. The default tailnet name is random (for example `tail1234`).
- **On-chain data.** With `--announce`, the listing (URL, price, expiry, file hash) is public on Base. Payments are public on-chain.

## Compared with a Cloudflare quick tunnel

`--tunnel cloudflared` terminates TLS at Cloudflare's edge, so Cloudflare can read traffic in plaintext. Funnel is better on content confidentiality and comparable on metadata.

## What you depend on

Your file and keys stay on your machine, but every buyer request passes through Tailscale's relays, so Tailscale's relay capacity, control plane, `ts.net` DNS and terms of service all affect whether your URL works. Funnel traffic also has a non-configurable bandwidth limit that Tailscale does not publish. Measured once on a home connection, a single download ran at about 0.9 MB/s, so large files take a while.

Source for the Tailscale behaviour above: [Tailscale Funnel documentation](https://tailscale.com/kb/1223/funnel).
