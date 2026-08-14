#!/usr/bin/env bash
# make verify — three lines of end-to-end truth, each MATCH / NO MATCH.
#
# Verifies what is actually true about the deployed demo, not a proxy for it:
#   1. RULE EQUIVALENCE  the Go rule engine and the deployed TypeScript port
#                        produce identical limits + ruleVersion for all three
#                        curated personas (local Go run vs live API).
#   2. SIGNER BINDING    the address the deployed app signs with is exactly
#                        the address VouchCreditLine trusts on-chain as the
#                        attested underwriter (live read from Coston2).
#   3. REJECT PROOF      a result signed by a tampered rule build is refused
#                        by the contract with "unattested underwriter"
#                        (read-only eth_call — no gas, no private key).
#
# Runs from a fresh clone with NO .env — only public endpoints and committed
# fixtures. Requires: go, cast (Foundry), curl, python3.
#
# Deliberately NOT verified here: the Go container image hash. Only the Go
# build is bit-for-bit reproducible (see extension/REPRODUCIBILITY.md), but
# the deployed demo signs via the mock-TEE serverless path — reproducing the
# image would verify something that never signed in the demo. We verify the
# signer that did.

set -u

APP_URL="${APP_URL:-https://vouch-flare.vercel.app}"
RPC_URL="${RPC_URL:-https://coston2-api.flare.network/ext/C/rpc}"
VCL="0xe14163ef340D9D94A04f7F6e5503149564Baf118"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PERSONAS=(thin-file-freelancer salaried-employee overindebted)

FAIL=0
report() { # $1 MATCH|NO MATCH, $2 label, $3 detail
  printf "%-9s %-17s %s\n" "$1" "$2" "$3"
  [ "$1" = "MATCH" ] || FAIL=1
}
json_get() { # $1 json, $2 key
  printf '%s' "$1" | python3 -c "import json,sys; print(json.load(sys.stdin)[sys.argv[1]])" "$2" 2>/dev/null
}
cast_retry() { # public testnet RPCs hiccup — retry reads up to 3x
  local out i
  for i in 1 2 3; do
    out="$(cast call "$@" --rpc-url "$RPC_URL" 2>/dev/null)" && [ -n "$out" ] && { printf '%s' "$out"; return 0; }
    sleep 2
  done
  return 1
}

echo "vouch verify — app: $APP_URL · chain: Coston2 ($RPC_URL)"
echo

# ── 1. RULE EQUIVALENCE ─────────────────────────────────────────────────────
GO_OUT="$(cd "$ROOT/extension/go" && go run ./cmd/verify-rules "$ROOT/extension/demo-data/personas.json" 2>&1)"
if [ $? -ne 0 ]; then
  report "NO MATCH" "rule equivalence" "Go engine failed to run: $GO_OUT"
else
  DETAIL=""
  OK=1
  for P in "${PERSONAS[@]}"; do
    GO_LINE="$(printf '%s\n' "$GO_OUT" | awk -v p="$P" '$1==p {print $2, $3}')"
    API="$(curl -sf -X POST "$APP_URL/api/underwrite/$P")"
    TS_LIMIT="$(json_get "$API" credit_limit_usd)"
    TS_RV="$(json_get "$API" rule_version)"
    if [ -z "$GO_LINE" ] || [ -z "$TS_LIMIT" ] || [ "$GO_LINE" != "$TS_LIMIT $TS_RV" ]; then
      OK=0
      DETAIL="$DETAIL$P: go=(${GO_LINE:-?}) app=(${TS_LIMIT:-?} ${TS_RV:-?})  "
    else
      DETAIL="$DETAIL$P=\$$TS_LIMIT  "
    fi
  done
  if [ $OK -eq 1 ]; then
    report "MATCH" "rule equivalence" "Go engine == deployed app for all 3 personas (rule v1): $DETAIL"
  else
    report "NO MATCH" "rule equivalence" "$DETAIL"
  fi
fi

# ── 2. SIGNER BINDING ───────────────────────────────────────────────────────
APP_SIGNER="$(json_get "$(curl -sf "$APP_URL/api/underwrite/address")" address | tr '[:upper:]' '[:lower:]')"
CHAIN_SIGNER="$(cast_retry "$VCL" "attestedSigner()(address)" | tr '[:upper:]' '[:lower:]')"
if [ -n "$APP_SIGNER" ] && [ "$APP_SIGNER" = "$CHAIN_SIGNER" ]; then
  report "MATCH" "signer binding" "app signs as $APP_SIGNER == VouchCreditLine.attestedSigner() on Coston2"
else
  report "NO MATCH" "signer binding" "app=${APP_SIGNER:-?} chain=${CHAIN_SIGNER:-?}"
fi

# ── 3. REJECT PROOF ─────────────────────────────────────────────────────────
T="$(curl -sf -X POST "$APP_URL/api/underwrite/tampered/thin-file-freelancer")"
T_WALLET="$(json_get "$T" wallet)"
T_LIMIT="$(json_get "$T" credit_limit_usd)"
T_RV="$(json_get "$T" rule_version)"
T_EXPIRY="$(json_get "$T" expiry)"
T_SIG="$(json_get "$T" signature)"
if [ -z "$T_SIG" ]; then
  report "NO MATCH" "reject proof" "could not fetch tampered result from $APP_URL"
else
  for I in 1 2 3; do
    OUT="$(cast call "$VCL" "submitResult(address,uint128,uint32,uint64,bytes)" \
          "$T_WALLET" "$T_LIMIT" "$T_RV" "$T_EXPIRY" "$T_SIG" --rpc-url "$RPC_URL" 2>&1)"
    printf '%s' "$OUT" | grep -qi "revert" && break   # got a real chain answer
    sleep 2                                           # network hiccup — retry
  done
  if printf '%s' "$OUT" | grep -q "unattested underwriter"; then
    report "MATCH" "reject proof" "tampered-build signature reverts: \"unattested underwriter\""
  else
    report "NO MATCH" "reject proof" "expected revert 'unattested underwriter', got: $(printf '%s' "$OUT" | head -1)"
  fi
fi

echo
if [ $FAIL -eq 0 ]; then
  echo "All 3 checks MATCH — what the demo shows is what the chain enforces."
else
  echo "VERIFICATION FAILED — at least one check did not match."
fi
exit $FAIL
