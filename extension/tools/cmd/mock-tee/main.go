// mock-tee is Vouch's F12 Plan B: a local stand-in for the FCC dispatch
// path. It runs the exact same deterministic rule engine
// (internal/rules) as the real enclave extension and signs results the
// exact same way VouchCreditLine.submitResult() expects — so the contract
// cannot tell the two paths apart, only whether the signature matches the
// currently attested signer. Used when FCC infra (indexer, FTDC dispatch)
// is unreachable; always labeled [GEMOCKT/KURATIERT] in the UI and video.
package main

import (
	"crypto/ecdsa"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"strings"
	"time"

	"extension-scaffold/internal/rules"

	"math/big"

	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

// abiEncodeResult mirrors Solidity's
// abi.encode(bytes32("VOUCH_CREDIT_LINE"), chainId, contractAddr, user, limitUsd, ruleVersion, expiry)
// exactly — arg order and types must match VouchCreditLine._recoverSigner's
// resultHash construction bit for bit, or signatures never verify.
func abiEncodeResult(chainID int64, contract, user common.Address, limitUsd uint64, ruleVersion uint32, expiry uint64) ([]byte, error) {
	bytes32Ty, _ := abi.NewType("bytes32", "", nil)
	uint256Ty, _ := abi.NewType("uint256", "", nil)
	addressTy, _ := abi.NewType("address", "", nil)
	uint128Ty, _ := abi.NewType("uint128", "", nil)
	uint32Ty, _ := abi.NewType("uint32", "", nil)
	uint64Ty, _ := abi.NewType("uint64", "", nil)

	args := abi.Arguments{
		{Type: bytes32Ty}, {Type: uint256Ty}, {Type: addressTy},
		{Type: addressTy}, {Type: uint128Ty}, {Type: uint32Ty}, {Type: uint64Ty},
	}

	var tag [32]byte
	copy(tag[:], []byte("VOUCH_CREDIT_LINE"))

	return args.Pack(
		tag,
		big.NewInt(chainID),
		contract,
		user,
		new(big.Int).SetUint64(limitUsd),
		ruleVersion,
		expiry,
	)
}

type personaFile struct {
	Personas []persona `json:"personas"`
}

type persona struct {
	PersonaID     string               `json:"persona_id"`
	DisplayName   string               `json:"display_name"`
	Wallet        string               `json:"wallet"`
	HistoryMonths int                  `json:"history_months"`
	Months        []rules.MonthlyRecord `json:"months"`
}

type underwriteResponse struct {
	Wallet        string `json:"wallet"`
	CreditLimitUSD uint64 `json:"credit_limit_usd"`
	RuleVersion   uint32  `json:"rule_version"`
	Reason        string  `json:"reason"`
	Expiry        uint64  `json:"expiry"`
	Signature     string  `json:"signature"`
	Signer        string  `json:"signer"`
	MockTEE       bool    `json:"mock_tee"`
}

func main() {
	port := flag.Int("port", 7799, "HTTP port")
	keyFile := flag.String("key-file", "config/mock-tee-key.env", "path to persist the mock signer key")
	dataFile := flag.String("data-file", "demo-data/personas.json", "path to persona fixture data")
	contractAddr := flag.String("contract", "", "VouchCreditLine address (for logging only)")
	flag.Parse()

	key, addr := loadOrCreateKey(*keyFile)
	log.Printf("mock-tee signer address: %s", addr.Hex())
	if *contractAddr != "" {
		log.Printf("expects to be registered via VouchCreditLine(%s).setAttestedSigner(%s)", *contractAddr, addr.Hex())
	}

	personas := loadPersonas(*dataFile)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /address", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"address": addr.Hex()})
	})
	mux.HandleFunc("GET /personas", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, personas)
	})
	mux.HandleFunc("POST /underwrite/{personaID}", func(w http.ResponseWriter, r *http.Request) {
		personaID := r.PathValue("personaID")
		p, ok := personas[personaID]
		if !ok {
			http.Error(w, fmt.Sprintf("unknown persona_id: %s", personaID), http.StatusNotFound)
			return
		}
		if err := applyWalletOverride(&p, r); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		resp := underwrite(p, key)
		writeJSON(w, resp)
	})
	// /underwrite/tampered/{personaID} signs with a throwaway key instead of
	// the registered signer — this is what the 'Oh!' moment demo beat sends.
	mux.HandleFunc("POST /underwrite/tampered/{personaID}", func(w http.ResponseWriter, r *http.Request) {
		personaID := r.PathValue("personaID")
		p, ok := personas[personaID]
		if !ok {
			http.Error(w, fmt.Sprintf("unknown persona_id: %s", personaID), http.StatusNotFound)
			return
		}
		if err := applyWalletOverride(&p, r); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		rogueKey, _ := crypto.GenerateKey()
		resp := underwrite(p, rogueKey)
		writeJSON(w, resp)
	})

	addrStr := fmt.Sprintf(":%d", *port)
	log.Printf("mock-tee listening on %s", addrStr)
	log.Fatal(http.ListenAndServe(addrStr, withCORS(mux)))
}

// withCORS lets the F6 frontend (Next.js dev server on a different origin)
// call this local F12 fallback directly from the browser.
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// applyWalletOverride lets the caller (the F6 frontend, or a manual demo
// operator) issue the credit line to whichever wallet is actually
// connected in the browser rather than the fixture's fixed placeholder
// address — the persona still supplies the financial history/reasoning,
// only the on-chain recipient changes. Nobody holds a private key for the
// fixture wallets (0x1111...1a etc.), so without this override mock-tee
// could never issue a credit line borrowable from a real connected wallet.
func applyWalletOverride(p *persona, r *http.Request) error {
	wallet := r.URL.Query().Get("wallet")
	if wallet == "" {
		return nil
	}
	if !common.IsHexAddress(wallet) {
		return fmt.Errorf("invalid wallet override: %q is not a hex address", wallet)
	}
	p.Wallet = common.HexToAddress(wallet).Hex()
	return nil
}

func underwrite(p persona, key *ecdsa.PrivateKey) underwriteResponse {
	result := rules.Evaluate(rules.UnderwritingInput{
		PersonaID:     p.PersonaID,
		Wallet:        p.Wallet,
		HistoryMonths: p.HistoryMonths,
		Months:        p.Months,
	})

	expiry := uint64(time.Now().Add(30 * 24 * time.Hour).Unix())
	sig := signResult(key, common.HexToAddress(result.Wallet), result.CreditLimitUSD, result.RuleVersion, expiry)
	signerAddr := crypto.PubkeyToAddress(key.PublicKey)

	return underwriteResponse{
		Wallet:         result.Wallet,
		CreditLimitUSD: result.CreditLimitUSD,
		RuleVersion:    result.RuleVersion,
		Reason:         result.Reason,
		Expiry:         expiry,
		Signature:      "0x" + hex.EncodeToString(sig),
		Signer:         signerAddr.Hex(),
		MockTEE:        true,
	}
}

// signResult reproduces VouchCreditLine._recoverSigner's exact hash:
// keccak256(abi.encode("VOUCH_CREDIT_LINE", chainId, contractAddr, user, limitUsd, ruleVersion, expiry))
// then EIP-191 personal-sign over that hash. The contract address is
// baked in at deploy time via CONTRACT_ADDRESS env — signing without it
// would let a signature replay against a different contract.
func signResult(key *ecdsa.PrivateKey, user common.Address, limitUsd uint64, ruleVersion uint32, expiry uint64) []byte {
	chainID := mustChainID()
	contract := mustContractAddress()

	packed, err := abiEncodeResult(chainID, contract, user, limitUsd, ruleVersion, expiry)
	if err != nil {
		log.Fatalf("encoding result: %v", err)
	}
	resultHash := crypto.Keccak256(packed)
	ethSignedHash := accounts.TextHash(resultHash)

	sig, err := crypto.Sign(ethSignedHash, key)
	if err != nil {
		log.Fatalf("signing: %v", err)
	}
	// go-ethereum returns v in {0,1}; Solidity ecrecover expects {27,28}.
	sig[64] += 27
	return sig
}

func mustChainID() int64 {
	v := os.Getenv("CHAIN_ID")
	if v == "" {
		return 114 // Coston2
	}
	var id int64
	fmt.Sscanf(v, "%d", &id)
	return id
}

func mustContractAddress() common.Address {
	v := os.Getenv("CONTRACT_ADDRESS")
	if v == "" {
		log.Fatal("CONTRACT_ADDRESS env var required (VouchCreditLine deployment address)")
	}
	return common.HexToAddress(v)
}

func loadOrCreateKey(path string) (*ecdsa.PrivateKey, common.Address) {
	if data, err := os.ReadFile(path); err == nil {
		hexKey := strings.TrimSpace(strings.TrimPrefix(string(data), "MOCK_TEE_PRIVATE_KEY="))
		key, err := crypto.HexToECDSA(strings.TrimPrefix(hexKey, "0x"))
		if err != nil {
			log.Fatalf("parsing persisted mock-tee key: %v", err)
		}
		return key, crypto.PubkeyToAddress(key.PublicKey)
	}

	key, err := crypto.GenerateKey()
	if err != nil {
		log.Fatalf("generating mock-tee key: %v", err)
	}
	hexKey := hex.EncodeToString(crypto.FromECDSA(key))
	if err := os.WriteFile(path, []byte(fmt.Sprintf("MOCK_TEE_PRIVATE_KEY=%s\n", hexKey)), 0600); err != nil {
		log.Fatalf("persisting mock-tee key: %v", err)
	}
	return key, crypto.PubkeyToAddress(key.PublicKey)
}

func loadPersonas(path string) map[string]persona {
	data, err := os.ReadFile(path)
	if err != nil {
		log.Fatalf("reading persona fixture %s: %v", path, err)
	}
	var pf personaFile
	if err := json.Unmarshal(data, &pf); err != nil {
		log.Fatalf("parsing persona fixture: %v", err)
	}
	out := make(map[string]persona, len(pf.Personas))
	for _, p := range pf.Personas {
		out[p.PersonaID] = p
	}
	return out
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

var _ = math.Round // keep math import if unused elsewhere later
