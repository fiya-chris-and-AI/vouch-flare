# Vouch

Vouch turns private financial history into a public, unsecured credit line — without ever putting that history on-chain. A wallet's transaction history is read inside a hardware-sealed enclave (Flare Confidential Compute), scored by a deterministic rule, and the enclave writes exactly three public numbers to Coston2: address, credit limit, expiry. A second contract then lets that wallet borrow FXRP against the limit with **zero collateral posted** — the "collateral" is the enclave's attestation itself.

**Live app:** https://vouch-flare.vercel.app — no login, no local process required.

## Why this exists

XRPFi lending today requires overcollateralization (e.g. deposit $12,000 to borrow $8,000) because the chain can't know anything about the borrower. Vouch keeps the underwriting private and the result public and verifiable — a credit line becomes an ingredient any Flare protocol can use, without any protocol ever holding user financial data.

## Architecture

```
Browser (persona data + ECIES) → underwriting request
        ↓
Rule engine (deterministic, versioned) — identical Go and TypeScript implementations
        ↓
Signed result: { address, creditLimitUsd, ruleVersion, expiry, signature }
        ↓
VouchCreditLine.submitResult() — verifies the signature against the currently
attested signer, rejects anything else with "unattested underwriter"
        ↓
VouchPool.borrow() / repay() — unsecured FXRP borrow up to the limit,
USD conversion via a live FTSOv2 XRP/USD price read
```

The core loop (persona → request → enclave → signed → on-chain → borrow) runs entirely from the browser, backed by Next.js API routes running as Vercel serverless functions — no ngrok tunnel, no locally-hosted process required for anyone using the deployed app.

## Deployed contracts (Coston2, chain id 114)

| Contract | Address | Verified |
|---|---|---|
| `VouchCreditLine` | [`0xe14163ef340D9D94A04f7F6e5503149564Baf118`](https://coston2-explorer.flare.network/address/0xe14163ef340D9D94A04f7F6e5503149564Baf118) | ✅ |
| `VouchPool` | [`0xB2B8de163C83D31CfE0d95C7de4cB715625e0DC2`](https://coston2-explorer.flare.network/address/0xB2B8de163C83D31CfE0d95C7de4cB715625e0DC2) | ✅ |
| `VouchInstructionSender` (FCC extension registration) | [`0xE75Fb1bd27b46E4E0500440B52D8498eC7000066`](https://coston2-explorer.flare.network/address/0xE75Fb1bd27b46E4E0500440B52D8498eC7000066) | ✅ (Extension ID `66179` on `TeeExtensionRegistry`) |

FXRP token (`FTestXRP`, 6 decimals): [`0x0b6a3645c240605887a5532109323a3e12273dc7`](https://coston2-explorer.flare.network/address/0x0b6a3645c240605887a5532109323a3e12273dc7)

## What is real, what is simulated, what is curated

**Real first — all of this is live on Coston2, every claim one explorer click away:**

- **Real.** A real unsecured borrow (`value: 0` collateral posted) and its matching repay ran against the live pool: [`0x04dae5…fd123`](https://coston2-explorer.flare.network/tx/0x04dae53a9a2d1cc3e8113f27ff0a152fb4bc6d51615e3f7caca6fe20f26fd123) / [`0x9d27c4…2dda`](https://coston2-explorer.flare.network/tx/0x9d27c46d924dd1fef63d2018d560888cb9510ccf352cf976bb73ec0e62edfdaa). The pool holds real FXRP (~49), priced by the live FTSOv2 feed. `VouchCreditLine` verifies every signature on-chain and refuses a tampered rule build with a named revert — `unattested underwriter` — reproducible read-only (`make verify`, line 3). The rule engine is deterministic and byte-for-byte identical between the Go and TypeScript implementations (`make verify`, line 1). All three contracts are source-verified on the explorer.
- **Simulated — exactly one thing, by engineering decision.** The hardware attestation step. Flare's own scaffold supports `SIMULATED_TEE=true` for exactly this purpose. The real end-to-end FCC/FTDC dispatch path is currently blocked by an upstream availability-check timeout (`/action/result` returns 404 after a successful dispatch) — this affects the provider side, not our code, and multiple teams building on FCC hit the same issue during this event. Rather than block on it, we built the only path demonstrable under these conditions: underwriting results come from a same-mechanism fallback (`extension/tools/cmd/mock-tee`, ported to `frontend/lib/rules.ts` + `frontend/lib/sign.ts` for the deployed app) — identical rule engine, identical signature scheme, judged identically by the on-chain hash-gate. `VouchCreditLine` cannot tell the difference by design — it judges WHO signed, never HOW the result arrived. When FCC dispatch is reachable, the switch is a config diff, not a refactor. We documented this boundary instead of hiding it, and the UI labels it explicitly wherever it's relevant.
- **Curated.** The demo data source (`extension/demo-data/personas.json`) is three curated financial histories, not a real bank connection. Labeled as such in the UI.

## Verify it yourself

One command, three lines, each MATCH / NO MATCH — runs from a fresh clone with no `.env`, using only public endpoints (requires `go`, `cast` from Foundry, `curl`, `python3`):

```
$ make verify
vouch verify — app: https://vouch-flare.vercel.app · chain: Coston2

MATCH     rule equivalence  Go engine == deployed app for all 3 personas (rule v1): thin-file-freelancer=$2088  salaried-employee=$6872  overindebted=$0
MATCH     signer binding    app signs as 0xc78e8d01e38149f0c7ac6018f0300aa636f32b83 == VouchCreditLine.attestedSigner() on Coston2
MATCH     reject proof      tampered-build signature reverts: "unattested underwriter"

All 3 checks MATCH — what the demo shows is what the chain enforces.
```

Details and the reasoning for what this command deliberately does *not* verify (the Go image hash): [`extension/README.md`](extension/README.md#verify-it-yourself).

## AI usage disclosure

This project was built with AI-assisted development (Claude Code). Spec and process artifacts live in a separate private workspace; this repository is the extracted product.

## Repo history note

Development happened in a private monorepo alongside the AI build tooling used to create it. This repository is a fresh extraction of just the product code (`extension/`, `frontend/`) — it does not carry the original private commit history, but is organized as a small number of logically separated commits rather than one large drop.

## Setup

### Contracts + extension (`extension/`)

See `extension/README.md` and `extension/docs/deployment-steps.md` for the full scaffold walkthrough. Quick path:

```bash
cd extension
cp .env.example .env.coston2   # fill in your own deployer key + RPC
bash scripts/use-chain.sh coston2
forge build
```

### Frontend (`frontend/`)

```bash
cd frontend
npm install
cp .env.local.example .env.local   # set MOCK_TEE_PRIVATE_KEY to your own throwaway signer
npm run dev
```

The signer key only needs to match whatever address you register as `VouchCreditLine`'s `attestedSigner` on your own deployment — it does not need to be the same key used in the live deployment above.
