// Port of extension/go/internal/rules/rules.go — MUST stay byte-for-byte
// equivalent (same rounding, same thresholds). This is the deterministic
// underwriting rule v1: identical input always produces identical output.
import type { Persona } from "./personas";

export const RULE_VERSION = 1;

export interface UnderwritingResult {
  wallet: string;
  creditLimitUsd: number;
  ruleVersion: number;
  reason: string;
}

export function evaluate(persona: Persona, wallet: string): UnderwritingResult {
  const months = persona.months;
  const n = months.length;
  if (n === 0) {
    return { wallet, creditLimitUsd: 0, ruleVersion: RULE_VERSION, reason: "no history provided" };
  }

  const nets = months.map((m) => m.inflow_usd - m.outflow_usd);
  const avgNet = nets.reduce((a, b) => a + b, 0) / n;

  if (avgNet <= 0) {
    return {
      wallet,
      creditLimitUsd: 0,
      ruleVersion: RULE_VERSION,
      reason: "average monthly net income is not positive",
    };
  }

  const variance = nets.reduce((acc, v) => acc + (v - avgNet) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);
  const coefficientOfVariation = stddev / avgNet;

  const historyFactor = Math.min(n / 24.0, 1.0);

  let stabilityFactor = 1.0 / (1.0 + coefficientOfVariation);
  if (stabilityFactor < 0.2) stabilityFactor = 0.2;
  if (stabilityFactor > 1.0) stabilityFactor = 1.0;

  const baseMultiplier = 3.0;
  let limit = avgNet * baseMultiplier * historyFactor * stabilityFactor;
  if (limit < 0) limit = 0;

  return {
    wallet,
    creditLimitUsd: Math.round(limit),
    ruleVersion: RULE_VERSION,
    reason: "eligible",
  };
}
