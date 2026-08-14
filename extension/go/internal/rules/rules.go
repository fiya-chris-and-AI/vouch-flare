// Package rules implements Vouch's deterministic underwriting rule v1.
// Same package is imported by the real FCC extension handler (runs inside
// the enclave) and by the local mock-TEE signer (tools/cmd/mock-underwriter)
// — one rule engine, two delivery paths, so a manipulated build is the only
// way to change the output, never the transport.
package rules

import "math"

const RuleVersion = 1

// MonthlyRecord is one month of a persona's financial history.
type MonthlyRecord struct {
	Month          string  `json:"month"`
	InflowUSD      float64 `json:"inflow_usd"`
	OutflowUSD     float64 `json:"outflow_usd"`
	LargestCreditor string `json:"largest_creditor,omitempty"`
}

// UnderwritingInput is the confidential input — never leaves the enclave
// (or, in mock mode, never leaves the operator's machine) in raw form.
type UnderwritingInput struct {
	PersonaID     string          `json:"persona_id"`
	Wallet        string          `json:"wallet"`
	HistoryMonths int             `json:"history_months"`
	Months        []MonthlyRecord `json:"months"`
}

// UnderwritingResult is the only thing that ever becomes public — three
// numbers plus the rule version that produced them.
type UnderwritingResult struct {
	Wallet        string  `json:"wallet"`
	CreditLimitUSD uint64 `json:"credit_limit_usd"`
	RuleVersion   uint32  `json:"rule_version"`
	Reason        string  `json:"reason"`
}

// Evaluate runs the deterministic v1 underwriting rule. Identical input
// always produces identical output — no wall-clock, no randomness.
//
// v1 policy: base capacity is 3x average monthly net income (inflow -
// outflow), scaled down for thin history (full weight at 24 months) and
// for volatile income (penalized by coefficient of variation of the
// monthly net series). Zero or negative average net income disqualifies.
func Evaluate(input UnderwritingInput) UnderwritingResult {
	n := len(input.Months)
	if n == 0 {
		return UnderwritingResult{Wallet: input.Wallet, CreditLimitUSD: 0, RuleVersion: RuleVersion, Reason: "no history provided"}
	}

	nets := make([]float64, n)
	var sum float64
	for i, m := range input.Months {
		nets[i] = m.InflowUSD - m.OutflowUSD
		sum += nets[i]
	}
	avgNet := sum / float64(n)

	if avgNet <= 0 {
		return UnderwritingResult{Wallet: input.Wallet, CreditLimitUSD: 0, RuleVersion: RuleVersion, Reason: "average monthly net income is not positive"}
	}

	var variance float64
	for _, v := range nets {
		d := v - avgNet
		variance += d * d
	}
	variance /= float64(n)
	stddev := math.Sqrt(variance)
	coefficientOfVariation := stddev / avgNet

	historyFactor := math.Min(float64(n)/24.0, 1.0)

	stabilityFactor := 1.0 / (1.0 + coefficientOfVariation)
	if stabilityFactor < 0.2 {
		stabilityFactor = 0.2
	}
	if stabilityFactor > 1.0 {
		stabilityFactor = 1.0
	}

	const baseMultiplier = 3.0
	limit := avgNet * baseMultiplier * historyFactor * stabilityFactor
	if limit < 0 {
		limit = 0
	}

	return UnderwritingResult{
		Wallet:         input.Wallet,
		CreditLimitUSD: uint64(math.Round(limit)),
		RuleVersion:    RuleVersion,
		Reason:         "eligible",
	}
}
