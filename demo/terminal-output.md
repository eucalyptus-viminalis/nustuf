# nustuf Demo — Full Cycle

## 1. Creator publishes content

```
$ nustuf publish --file ./demo-report.txt --price 0.01 --window 1h \
    --pay-to 0xea99...1451 --public --announce --title "Agent Commerce Report 2026"

Leak Config
  file            : ./demo-report.txt
  price           : 0.01 USDC
  window          : 3600s
  access_mode     : payment-only-no-download-code
  to              : 0xea990ae72939B8751cB680919C6B64A05B8e1451
  net             : eip155:8453 (Base)

[info] Starting Cloudflare quick tunnel...
x402-node listening on http://localhost:4021

Public Tunnel
  public_url: https://activated-native-automatic-relevance.trycloudflare.com
  promo_link: https://activated-native-automatic-relevance.trycloudflare.com/

[info] Announcing release to Base Sepolia...
[ok] Release announced!
[info] Explorer: https://sepolia.basescan.org/tx/0xd797...
```

## 2. Agent discovers available content

```
$ nustuf discover --active

[info] Querying Base Sepolia registry...
Found 3 releases

Agent Commerce Report 2026
  price  : 0.01 USDC
  expires: 59m left
  creator: 0xAb46...328e
  url    : https://activated-native-automatic-relevance.trycloudflare.com/
  desc   : Premium research on autonomous agent-to-agent commerce

Use `nustuf buy <url> --locus` to purchase
```

## 3. Agent buys content via Locus wallet

```
$ nustuf buy https://activated-native-automatic-relevance.trycloudflare.com/ --locus

[info] Resolved purchase endpoint: .../download
[info] Locus wallet balance: 5.96 USDC
[info] Payment: 0.01 USDC to 0xea990ae72939B8751cB680919C6B64A05B8e1451
[info] Sending payment via Locus wallet...
[ok] Payment queued! id: 17ac026a-a53d-4d08-89c5-db78de21f2c8
[info] Waiting for on-chain confirmation...
[ok] Confirmed! tx: 0x70b7f032525ea4bf847a35d7c059ef845d0566f1137917f4e0ff107a947e6255
[ok] Payment verified by server!

Locus Payment Receipt
  amount  : 0.01 USDC
  to      : 0xea990ae72939B8751cB680919C6B64A05B8e1451
  tx_hash : 0x70b7f032525ea4bf847a35d7c059ef845d0566f1137917f4e0ff107a947e6255
  explorer: https://basescan.org/tx/0x70b7f032525ea4bf847a35d7c059ef845d0566f1137917f4e0ff107a947e6255
[ok] Saved 156 bytes -> ./demo-bought.txt
```

## 4. Content delivered

```
$ cat demo-bought.txt
This is a premium agent-generated report on the state of autonomous commerce
in 2026. Agents are now buying and selling content without human intervention.
```

## On-chain verification

- Payment tx: https://basescan.org/tx/0x70b7f032525ea4bf847a35d7c059ef845d0566f1137917f4e0ff107a947e6255
- Registry announce tx: https://sepolia.basescan.org/tx/0xd7975616ab48fd130fb444ed73cda56b82fbbabf66ebbe2d1a6e8a1d566beaed
- Registry contract: https://sepolia.basescan.org/address/0x134597d9Cc6270571C2b8245c4235f7838C0d65D
