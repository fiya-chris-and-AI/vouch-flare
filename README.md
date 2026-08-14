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

## Was echt ist und was simuliert/kuratiert ist

- **Echt:** the smart contracts, the signature verification and hash-gate, the FXRP pool (real unsecured borrow/repay transactions on Coston2), the live FTSOv2 price read, and the deterministic rule engine (byte-for-byte identical Go and TypeScript implementations).
- **Simuliert:** the hardware attestation step. Flare's own scaffold supports `SIMULATED_TEE=true` for exactly this purpose. The real end-to-end FCC/FTDC dispatch path is currently blocked by an upstream availability-check timeout (`/action/result` returns 404 after a successful dispatch) — this affects the provider side, not our code, and multiple teams building on FCC hit the same issue during this event. Instead of blocking on it, underwriting results are produced by a same-mechanism fallback (`extension/tools/cmd/mock-tee`, ported to `frontend/lib/rules.ts` + `frontend/lib/sign.ts` for the deployed app) — identical rule engine, identical signature scheme, judged identically by the on-chain hash-gate. The UI labels this explicitly wherever it's relevant.
- **Kuratiert:** the demo data source (`extension/demo-data/personas.json`) is three curated financial histories, not a real bank connection. Labeled as such in the UI.

## KI-Nutzung

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
