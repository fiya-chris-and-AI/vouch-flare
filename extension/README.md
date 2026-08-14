# Vouch

An unsecured FXRP credit line, underwritten by a hardware-sealed enclave —
the chain never sees your financial history, only three public numbers:
address, limit, expiry. Built on Flare Confidential Compute + FAssets FXRP +
FTSOv2. Frontend: `../frontend`. Full product context: `../project_brief.md`.

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
| `InstructionSender` (ex-HelloWorld) | [`0xE75Fb1bd27b46E4E0500440B52D8498eC7000066`](https://coston2-explorer.flare.network/address/0xE75Fb1bd27b46E4E0500440B52D8498eC7000066) | Extension ID `66179` on `TeeExtensionRegistry` |

Full deployment log, tx hashes for a live borrow/repay cycle, and the
mock-tee wallet-override fix: [`config/vouch-deployments.md`](config/vouch-deployments.md).

## Was echt ist und was simuliert/kuratiert ist

- **Regel-Engine, Hash-Gate, Kreditlinie, unterbesicherter Kredit, FTSOv2-Preis: `[ECHT]`.** Alle live auf Coston2, jede Transaktion im Explorer nachvollziehbar.
- **TEE-Attestierung: `[SIMULIERT]`.** Die echte FCC/FTDC-Dispatch-Route ist an einem Infra-Problem blockiert, das außerhalb unserer Kontrolle liegt (der TEE-Proxy antwortet nach dem Dispatch konsistent mit 404 auf `/action/result`, siehe `.academy/m0_diagnostics.log`). Statt die Demo daran scheitern zu lassen, signiert `tools/cmd/mock-tee` (F12 Plan B) exakt dieselbe Nachrichtenstruktur mit dem exakt gleichen Prüfmechanismus — `VouchCreditLine` kann die beiden Pfade nicht unterscheiden, nur ob die Signatur zum aktuell attestierten Signer passt.
- **Demo-Datenquelle: `[GEMOCKT/KURATIERT]`.** Die drei Personas (`demo-data/personas.json`) sind kuratierte, plausible Finanzhistorien — keine echte Bankverbindung.
- Die Demo behauptet an keiner Stelle, dass etwas echt ist, das es nicht ist — jede simulierte/kuratierte Komponente ist im UI und in diesem README benannt.

---

# Hello World Extension (Scaffold-Basis)

Dieses Repo ist von `flare-foundation/fce-extension-scaffold` abgeleitet. Der
Rest dieser Datei ist die unveränderte Scaffold-Dokumentation — nützlich, um
die Deployment-/Registrierungs-Tools und die Sprachauswahl zu verstehen.

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
