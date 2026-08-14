# Vouch

An unsecured FXRP credit line, underwritten by a hardware-sealed enclave —
the chain never sees your financial history, only three public numbers:
address, limit, expiry. Built on Flare Confidential Compute + FAssets FXRP +
FTSOv2. Frontend: `../frontend`. Full product context: [`../README.md`](../README.md).

## Live app

**https://vouch-flare.vercel.app** — publicly reachable, no login, no local
process required. The F12 mock-tee fallback (see below) runs as this app's
own `/api/underwrite/*` serverless routes, not a locally-hosted binary
behind a tunnel, so a juror can use the full core loop from a cold browser
on a different network.

## Deployed contracts (Coston2, chain id 114)

| Contract | Address | Verified |
|---|---|---|
| `VouchCreditLine` | [`0xe14163ef340D9D94A04f7F6e5503149564Baf118`](https://coston2-explorer.flare.network/address/0xe14163ef340D9D94A04f7F6e5503149564Baf118) | ✅ |
| `VouchPool` | [`0xB2B8de163C83D31CfE0d95C7de4cB715625e0DC2`](https://coston2-explorer.flare.network/address/0xB2B8de163C83D31CfE0d95C7de4cB715625e0DC2) | ✅ |
| `InstructionSender` (ex-HelloWorld) | [`0xE75Fb1bd27b46E4E0500440B52D8498eC7000066`](https://coston2-explorer.flare.network/address/0xE75Fb1bd27b46E4E0500440B52D8498eC7000066) | ✅ · Extension ID `66179` on `TeeExtensionRegistry` |

Full deployment log, tx hashes for a live borrow/repay cycle, and the
mock-tee wallet-override fix: [`config/vouch-deployments.md`](config/vouch-deployments.md).

## What is real, what is simulated, what is curated

**Real first — all of this is live on Coston2, every claim one explorer click away:**

- **`[REAL]` Unsecured borrow.** A real borrow with `value: 0` collateral and its matching repay ran against the live pool: [`0x04dae5…fd123`](https://coston2-explorer.flare.network/tx/0x04dae53a9a2d1cc3e8113f27ff0a152fb4bc6d51615e3f7caca6fe20f26fd123) / [`0x9d27c4…2dda`](https://coston2-explorer.flare.network/tx/0x9d27c46d924dd1fef63d2018d560888cb9510ccf352cf976bb73ec0e62edfdaa). The pool holds real FXRP (~49), the price comes from the real FTSOv2 feed.
- **`[REAL]` The hash gate and the rejection.** `VouchCreditLine` verifies every signature on-chain and refuses a tampered rule build with a named revert: `unattested underwriter`. This is not a UI effect — it is a contract revert you can reproduce read-only (`make verify`, line 3).
- **`[REAL]` Rule engine, credit line, contract verification.** Deterministic rule v1 runs identically in Go and in the deployed app (`make verify`, line 1); all three demo-path contracts are source-verified on the explorer.

**Simulated — exactly one thing, by engineering decision:**

- **`[SIMULATED]` The hardware attestation root.** Flare's FCC dispatch route currently 404s upstream on `/action/result` for multiple teams building on this infrastructure. We built the only path demonstrable under these conditions: the identical rule engine and the identical signature scheme, signed by the mock-TEE key instead of a hardware-attested enclave key. `VouchCreditLine` cannot tell the difference by design — it judges WHO signed, never HOW the result arrived — so the entire proof mechanism (signer binding, tamper rejection) runs unchanged. When FCC dispatch is reachable, the switch is a config diff (`SIMULATED_TEE=false`), not a refactor. We documented this boundary instead of hiding it.
- **`[MOCKED/CURATED]` Demo data source.** The three personas (`demo-data/personas.json`) are curated, plausible financial histories — not a real bank connection.

The demo never claims something is real that it isn't — every simulated/curated component is labeled both in the UI and in this README.

## Verify it yourself

One command, three lines, each MATCH / NO MATCH — runs from a fresh clone
with no `.env`, using only public endpoints (requires `go`, `cast` from
Foundry, `curl`, `python3`):

```
$ make verify
vouch verify — app: https://vouch-flare.vercel.app · chain: Coston2

MATCH     rule equivalence  Go engine == deployed app for all 3 personas (rule v1): thin-file-freelancer=$2088  salaried-employee=$6872  overindebted=$0
MATCH     signer binding    app signs as 0xc78e8d01e38149f0c7ac6018f0300aa636f32b83 == VouchCreditLine.attestedSigner() on Coston2
MATCH     reject proof      tampered-build signature reverts: "unattested underwriter"

All 3 checks MATCH — what the demo shows is what the chain enforces.
```

Line 2 and 3 are live reads against Coston2 — nothing is hardcoded on both
sides. We deliberately do **not** present the reproducible Go image hash as
the demo's proof: only the Go build is bit-for-bit reproducible
([REPRODUCIBILITY.md](REPRODUCIBILITY.md)), but the deployed demo signs via
the serverless mock-TEE path — verifying the image would verify something
that never signed in the demo. We verify the signer that did.

## AI usage disclosure

This project was built with AI-assisted development (Claude Code). Spec
and process artifacts (product brief, adversarial review, revision log)
live in a separate private workspace; this repository is the extracted
product. All architecture decisions, the honesty boundary (what is real
vs. simulated), and every on-chain deployment were reviewed and decided
by the human team; the commit history reflects the real build sequence.

---

# Hello World Extension (scaffold base)

This repo is derived from `flare-foundation/fce-extension-scaffold`. The
rest of this file is the unmodified scaffold documentation — useful for
understanding the deployment/registration tooling and language selection.

A working Hello World example for building Flare Confidential Compute (FCC) extensions. This repository demonstrates a complete, runnable extension with on-chain contracts, deployment tooling, and registration scripts — everything you need to understand how extensions work on the Flare TEE infrastructure.

**The same extension is implemented in Go, Python and TypeScript.** Pick one with `LANGUAGE` in `.env`; everything else — contracts, deployment, registration, tests — is identical regardless of choice.

## Choosing a Language

```bash
LANGUAGE=go          # default. Smallest image (~22MB distroless), bit-for-bit reproducible
LANGUAGE=python      # ~268MB. Same-machine reproducible
LANGUAGE=typescript  # ~472MB. Same-machine reproducible
```

All three implement identical behaviour and are verified against the same golden wire fixtures by `./scripts/test-conformance.sh`. The Go path is the most thoroughly reproducible because it produces a static binary on a distroless base; Python wheels and `node_modules` trees embed build-host variance (see [REPRODUCIBILITY.md](REPRODUCIBILITY.md)).

Language selection is **convention-based**: `LANGUAGE=<dir>` is valid iff `<dir>/language.env` exists, so adding a fourth language requires no changes to any script, tool or compose file — you create one directory.

> **→ [Working in Multiple Languages](docs/languages.md)** covers choosing between them, the same handler written three ways, and a step-by-step for adding your own. The normative spec an implementation must satisfy is [docs/extension-contract.md](docs/extension-contract.md).

## Repository Structure

The repo splits into a **language-neutral spine** (contracts, deployment tooling, scripts) and **pluggable language implementations**. You customize one language directory plus the Solidity contract.

```
├── go/                                 # ── Go implementation
│   ├── cmd/main.go                     # ★ Extension server entry point (standalone, for dev)
│   ├── cmd/docker/main.go              # Combined TEE node + extension (single-process image)
│   ├── cmd/start-tee/main.go           # Host-process runner for --local mode
│   ├── internal/config/config.go       # ★ OPType constants, version, port defaults
│   ├── internal/extension/extension.go # ★ MAIN CUSTOMIZATION POINT: processAction routing
│   ├── internal/extension/utils.go     # Boilerplate: actionHandler, buildResult
│   ├── pkg/types/types.go              # ★ Request/response types
│   ├── Dockerfile                      # Single-process image (distroless)
│   └── language.env                    # Language manifest (marks this dir as an implementation)
├── python/                             # ── Python implementation
│   ├── base/                           # Framework: server, wire types, encoding, node client
│   ├── app/config.py                   # ★ OPType constants and version
│   ├── app/handlers.py                 # ★ MAIN CUSTOMIZATION POINT: your handlers
│   ├── app/abi.py                      # ★ ABI decoding for non-JSON payloads
│   ├── tests/                          # pytest suite
│   ├── Dockerfile                      # Two-process image (tee-node binary + python)
│   └── language.env
├── typescript/                         # ── TypeScript implementation
│   ├── src/base/                       # Framework: server, wire types, encoding, node client
│   ├── src/app/config.ts               # ★ OPType constants and version
│   ├── src/app/handlers.ts             # ★ MAIN CUSTOMIZATION POINT: your handlers
│   ├── src/app/abi.ts                  # ★ ABI decoding for non-JSON payloads
│   ├── src/__tests__/                  # vitest suite
│   ├── Dockerfile                      # Two-process image (tee-node binary + node)
│   └── language.env
│
├── contracts/InstructionSender.sol     # ★ Your extension's on-chain entry point (shared)
├── docker/node-base.Dockerfile         # Shared tee-node builder for non-Go images
├── testdata/conformance/               # Golden wire fixtures, asserted against every language
├── config/
│   ├── extension.env                   # Generated by pre-build (gitignored)
│   └── proxy/extension_proxy.toml      # Proxy config (Redis, DB, ports, addresses)
├── scripts/                            # ── Language-neutral
│   ├── full-setup.sh                   # Chains all phases: pre-build → compose → post-build → test
│   ├── pre-build.sh                    # Compile + deploy + register → writes config
│   ├── post-build.sh                   # Allow TEE version + register TEE on-chain
│   ├── test.sh                         # On-chain end-to-end test (identical for all languages)
│   ├── test-unit.sh                    # Unit tests, dispatched via language.env
│   ├── test-conformance.sh             # Wire-contract conformance, no chain required
│   ├── check-versions.sh               # Fails when dependency pins drift apart
│   ├── build-node-base.sh              # Builds the shared tee-node base image
│   ├── generate-bindings.sh            # Compile contract → generate Go bindings
│   └── lib/{language,versions}.sh      # Language resolution + version derivation
├── tools/                              # ── Language-neutral deployment tooling (Go)
│   ├── cmd/deploy-contract/            # Deploys InstructionSender to chain
│   ├── cmd/register-extension/         # Registers extension on TeeExtensionRegistry
│   ├── cmd/allow-tee-version/          # Registers TEE code hash as allowed version
│   ├── cmd/register-tee/               # Registers extension TEE machine on-chain
│   ├── cmd/run-test/                   # Sends instructions and verifies results
│   └── pkg/utils/instructions.go       # Deploy, SetExtensionId, SendSayHello helpers
├── docker-compose.yaml                 # Redis + proxy + extension-tee
├── foundry.toml                        # Foundry config for compiling contracts
└── .env.example                        # Sample env vars, including LANGUAGE

★ = Files developers MUST modify for their extension
```

`tools/` is deliberately independent of every language implementation, which is what lets one deployment and test path serve all of them.

## Creating Your Extension

The scaffold ships with a working Hello World. To build your extension you modify four things: the operation constants, the handlers, the Solidity contract, and the test assertions.

| # | File | What you do |
|---|------|-------------|
| 1 | `<lang>` config — `go/internal/config/config.go`, `python/app/config.py`, or `typescript/src/app/config.ts` | Define your OPType and OPCommand constants |
| 2 | `<lang>` handlers — `go/internal/extension/extension.go`, `python/app/handlers.py`, or `typescript/src/app/handlers.ts` | Implement your action handlers and state |
| 3 | `contracts/InstructionSender.sol` | Add matching `bytes32` constants and send functions |
| 4 | `tools/cmd/run-test/main.go` | Write test payloads and response assertions |

Go additionally has `go/pkg/types/types.go` for request/response structs; Python and TypeScript declare those shapes inline in the handlers.

The key link between your Solidity contract and your handlers is the **OPType** and **OPCommand** pair, which must match exactly across every layer:

```
Solidity:    bytes32 constant OP_TYPE_GREETING      = bytes32("GREETING");
             bytes32 constant OP_COMMAND_SAY_HELLO  = bytes32("SAY_HELLO");

Go:          OPTypeGreeting    = "GREETING"        // internal/config/config.go
             OPCommandSayHello = "SAY_HELLO"

Python:      OP_TYPE_GREETING     = "GREETING"     # app/config.py
             OP_COMMAND_SAY_HELLO = "SAY_HELLO"

TypeScript:  OP_TYPE_GREETING     = "GREETING"     // src/app/config.ts
             OP_COMMAND_SAY_HELLO = "SAY_HELLO"
```

A mismatch means the action falls through to "unsupported op type" (HTTP 501).

Every handler follows the same 4-step pattern in all three languages: decode the request, validate it, execute your logic, return a result.

> ### **→ [Read the Extension Development Guide](docs/extension-guide.md)** for a detailed walkthrough, and **[docs/extension-contract.md](docs/extension-contract.md)** for the normative wire and container contract.

## Making It Your Own

This repository works out of the box as a Hello World extension. When you're ready to build your own extension, you'll rename the HelloWorld placeholders to your own names and replace the SAY_HELLO logic with your own operations.

> ### **→ [Follow the Making It Your Own guide](docs/manual-setup.md)** for step-by-step renaming instructions.
>
> Using [Claude Code](https://claude.ai/code)? Run `/rename-scaffold` to do it automatically.


## Run It

With local infrastructure up (`docker compose up` from `e2e/`):

```bash
cp .env.example .env                            # set DEPLOYMENT_PRIVATE_KEY and CHAIN_ID
LANGUAGE=go ./scripts/full-setup.sh --test      # or python, typescript
```

Prerequisites, configuration, ports and the failure table are in
[docs/getting-started.md](docs/getting-started.md). Coston2 deployment and the platform
traps that cost redeploys are in [docs/deployment-steps.md](docs/deployment-steps.md).

## Testing

Three layers, cheapest first — unit (`test-unit.sh`), wire conformance against golden
fixtures with no chain required (`test-conformance.sh`), and on-chain end-to-end
(`test.sh`). Conformance is what guarantees the three implementations stay
byte-identical on the wire, and it is the acceptance test for any new language. See
[docs/testing.md](docs/testing.md).

## Further Reading

**Building your extension**

- [Extension Development Guide](docs/extension-guide.md) — how the code works and how to add your own logic
- [Working in Multiple Languages](docs/languages.md) — choosing a language, working in each, and **adding your own**
- [Making It Your Own](docs/manual-setup.md) — renaming from HelloWorld to your own extension
- [InstructionSender Contract](docs/instruction-sender.md) — how the on-chain contract works and how to customize it

**Reference**

- [Extension Container Contract](docs/extension-contract.md) — the normative wire format and container spec every implementation must satisfy
- [Testing Guide](docs/testing.md) — the test layers, conformance fixtures, and what to run when
- [Reproducibility](REPRODUCIBILITY.md) — what each language's build actually guarantees

**Per-language**

- [go/README.md](go/README.md) · [python/README.md](python/README.md) · [typescript/README.md](typescript/README.md)

---

## Built On

Flare Confidential Compute — see the [FCC overview](https://dev.flare.network/fcc/overview) for the underlying primitives (extensions, signing policies, data providers, attestation, Protocol Managed Wallets).
