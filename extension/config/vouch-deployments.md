# Vouch — Deployed Contracts (Coston2)

Auto-tracked as each contract is deployed/verified. Canonical copy of this
table belongs in the top-level README under F10 (Repo-Hygiene) — this file
is the working source until that rewrite happens.

| Contract | Address | Verified | Notes |
|---|---|---|---|
| `VouchCreditLine` | `0xe14163ef340D9D94A04f7F6e5503149564Baf118` | ✅ | `attestedSigner` = mock-tee key `0xc78E8d01E38149F0c7aC6018f0300aa636F32b83` (F12 Plan B path; rotate via `setAttestedSigner` once the real FCC/FTDC dispatch path is unblocked) |
| `VouchPool` | `0xB2B8de163C83D31CfE0d95C7de4cB715625e0DC2` | ✅ | Seeded with 9.000000 test-FXRP. Live borrow (2 FXRP) + repay verified on-chain: borrow tx `0x79c60aeb4cc8c76a2006e52cd1404c9537134697a6df5c691a668f71c5e40342`, repay tx `0x2d12843fec7f812fdd760da581735ac64d40e69544bdbd669fd2333714f47497` |
| `InstructionSender` (ex-HelloWorld) | `0xE75Fb1bd27b46E4E0500440B52D8498eC7000066` | — | Registered extension ID `66179` on `TeeExtensionRegistry`; real FCC dispatch path blocked by upstream FTDC 404s as of 2026-08-13 19:06 CEST (see `.academy/m0_diagnostics.log`), demo path uses mock-tee instead |
| FXRP (`FTestXRP`) | `0x0b6a3645c240605887a5532109323a3e12273dc7` | (pre-existing testnet token) | 6 decimals |
| FtsoV2 | `0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d` | (pre-existing Flare periphery) | XRP/USD feed id `0x015852502f55534400000000000000000000000000`, live-checked at $1.005/XRP on 2026-08-13 |

## Public frontend (Vercel)

**https://vouch-flare.vercel.app** — project `fiya-chris-ai/vouch-flare`, deployed via `vercel --prod`.
The F12 mock-tee fallback was ported from `tools/cmd/mock-tee` (Go) to
`frontend/lib/rules.ts` + `frontend/lib/sign.ts` (TypeScript/viem) and runs
as Vercel serverless functions at `/api/underwrite/[personaId]` and
`/api/underwrite/tampered/[personaId]` — same signer key
(`MOCK_TEE_PRIVATE_KEY`, set as a Vercel production secret, value matches
`config/mock-tee-key.env`), byte-for-byte identical rule engine (verified:
same $6872 limit for `salaried-employee` from both implementations), and a
live-verified signature (`cast call` succeeds; tampered variant produces a
different signer and gets rejected by `VouchCreditLine` with "unattested
underwriter"). This removes the ngrok/local-process dependency entirely —
the deployed app needs nothing running on our machine.

## Pool liquidity fix (found by @examiner-adversarial, P1)

Pool had only 9 FXRP (~$9) after initial seeding + test borrow/repay — far
short of the demo script's persona credit limits ($2,000–$6,872). Topped up
via the official Coston2 faucet (https://faucet.flare.network/coston2, 10
FXRP/address/24h): generated 3 throwaway wallets, requested FXRP+C2FLR to
each, swept all FXRP directly to the pool via plain ERC20 `transfer()`.
**Pool now holds 49 FXRP (~$49).** Verified with a real 20 FXRP borrow +
repay cycle after the topup (tx `0x04dae53a9a2d1cc3e8113f27ff0a152fb4bc6d51615e3f7caca6fe20f26fd123` / `0x9d27c46d924dd1fef63d2018d560888cb9510ccf352cf976bb73ec0e62edfdaa`).

**Still short of the full $2,000–$6,872 persona credit limits** — the faucet
rate-limits FXRP per address, so fully funding those amounts isn't
practical pre-demo. For the recorded take: draw a modest amount (≤40 FXRP)
live on camera — the $ credit *limit* shown in the "What the chain knows"
panel is separately true and verifiable on-chain regardless of how much of
it is actually drawn in the clip. If more headroom is needed later, repeat
the faucet-sweep pattern above (a few more throwaway wallets).

## UI error-handling fix (found by @examiner-adversarial, P1)

`borrow()`/`repay()` in `frontend/app/page.tsx` had no try/catch and no
pending-tx button guard — a failed borrow (e.g. insufficient pool
liquidity, which was guaranteed before the fix above) failed completely
silently on stage: no error text, no tx hash, nothing. Fixed: both now set
a `borrowBusy` flag (disables the buttons and shows "Sending …"
while a tx is in flight) and catch errors into a visible `borrowError`
message. Same guard added to the 'Oh!'-moment button, which previously
could be double-clicked or fired concurrently with a credit-line request.

## mock-tee wallet override (added alongside VouchPool)

`tools/cmd/mock-tee` originally signed credit lines only to the three fixed
fixture wallets in `demo-data/personas.json` (`0x1111...1a` etc.) — nobody
holds a private key for those, so a live demo could never actually borrow
against a credit line issued that way. Added an optional `?wallet=0x...`
query param to both `/underwrite/{personaID}` and
`/underwrite/tampered/{personaID}`: the persona still supplies the
financial history/reasoning, but the credit line (and thus the on-chain
`user`) is issued to whatever wallet is passed in — the actually-connected
demo wallet. F6 must call it this way, not with the bare persona endpoint.

Verified end-to-end with this override: `salaried-employee` persona →
`0x00814B15DaabD2ffAc76b849031F63d416721108` → $6872 limit → `submitResult`
tx `0xb57ab7f722a3ae81c5e7d1c05e010c832e093be7a4fcc90888d5a86f5b0b49a5` →
borrow/repay above.
