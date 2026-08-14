import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { personas } from "@/lib/personas";
import { evaluate } from "@/lib/rules";
import { signResult } from "@/lib/sign";

export const runtime = "nodejs";

// Signs with a throwaway key instead of the registered mock-tee signer —
// this is what the 'Oh!' moment demo beat sends; VouchCreditLine must
// reject it with "unattested underwriter".
export async function POST(req: NextRequest, { params }: { params: { personaId: string } }) {
  const persona = personas.find((p) => p.persona_id === params.personaId);
  if (!persona) {
    return NextResponse.json({ error: `unknown persona_id: ${params.personaId}` }, { status: 404 });
  }

  const walletOverride = req.nextUrl.searchParams.get("wallet");
  if (walletOverride && !isAddress(walletOverride)) {
    return NextResponse.json({ error: `invalid wallet override: ${walletOverride}` }, { status: 400 });
  }
  const wallet = (walletOverride ?? persona.wallet) as `0x${string}`;

  const result = evaluate(persona, wallet);
  const expiry = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  const { signature, signer } = await signResult(
    wallet,
    result.creditLimitUsd,
    result.ruleVersion,
    expiry,
    true
  );

  return NextResponse.json({
    wallet: result.wallet,
    credit_limit_usd: result.creditLimitUsd,
    rule_version: result.ruleVersion,
    reason: result.reason,
    expiry,
    signature,
    signer,
    mock_tee: true,
  });
}
