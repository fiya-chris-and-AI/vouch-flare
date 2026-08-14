// verify-rules runs the deterministic underwriting rule v1 over the curated
// demo personas and prints one line per persona: "<persona_id> <limit> <ruleVersion>".
// Used by `make verify` (line 1: rule equivalence) to prove the Go engine and
// the deployed TypeScript port produce identical results — no network, no keys.
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"extension-scaffold/internal/rules"
)

type personasFile struct {
	Personas []struct {
		PersonaID     string                `json:"persona_id"`
		Wallet        string                `json:"wallet"`
		HistoryMonths int                   `json:"history_months"`
		Months        []rules.MonthlyRecord `json:"months"`
	} `json:"personas"`
}

func main() {
	path := "../demo-data/personas.json"
	if len(os.Args) > 1 {
		path = os.Args[1]
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "verify-rules:", err)
		os.Exit(1)
	}
	var pf personasFile
	if err := json.Unmarshal(raw, &pf); err != nil {
		fmt.Fprintln(os.Stderr, "verify-rules:", err)
		os.Exit(1)
	}
	for _, p := range pf.Personas {
		res := rules.Evaluate(rules.UnderwritingInput{
			PersonaID:     p.PersonaID,
			Wallet:        p.Wallet,
			HistoryMonths: p.HistoryMonths,
			Months:        p.Months,
		})
		fmt.Printf("%s %d %d\n", p.PersonaID, res.CreditLimitUSD, res.RuleVersion)
	}
}
