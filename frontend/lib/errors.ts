import { BaseError, ContractFunctionRevertedError } from "viem";

// Decodes an actual on-chain/contract revert reason from a viem error's
// cause chain (or from a `.revertReason` we attached ourselves after
// re-simulating a mined-but-reverted tx — see sendAndConfirm in page.tsx).
// Never string-match on `.message` for this: viem's top-level message for a
// revert caught during gas estimation (ContractFunctionExecutionError) does
// not reliably contain the readable reason text, and generic RPC/network
// failures can otherwise look identical to a contract rejection (dry-run
// regression, CD Round 3 — "Oh! moment" mislabeled an RPC error as
// "Rejected"). A null return means "not a contract rejection" — callers
// must not use rejection language for it.
export function extractRevertReason(e: unknown): string | null {
  if (e && typeof e === "object" && "revertReason" in e) {
    const attached = (e as { revertReason?: unknown }).revertReason;
    if (typeof attached === "string" && attached) return attached;
  }
  if (e instanceof BaseError) {
    const revertError = e.walk((err) => err instanceof ContractFunctionRevertedError);
    if (revertError instanceof ContractFunctionRevertedError) {
      return revertError.reason ?? revertError.data?.errorName ?? null;
    }
  }
  return null;
}

// Turns raw viem/wallet error dumps into one short, on-camera-safe line.
// Raw messages include full calldata blobs and RPC internals — never render
// those directly (dry-run finding, CD Round 1).
export function friendlyError(e: unknown): string {
  const revertReason = extractRevertReason(e);
  if (revertReason) return `Transaction reverted: ${revertReason}`;

  const raw =
    (typeof e === "object" && e !== null && "shortMessage" in e
      ? String((e as { shortMessage: unknown }).shortMessage)
      : "") || (e instanceof Error ? e.message : String(e));

  const lower = raw.toLowerCase();
  if (lower.includes("user rejected") || lower.includes("user denied")) {
    return "Request cancelled in MetaMask.";
  }
  // Coston2's public RPC rate-limits under load and phrases it differently
  // depending on which layer trips first (JSON-RPC body vs. transport-level
  // HTTP error) — match all the shapes we've actually seen, not just one.
  if (
    lower.includes("rate limit") ||
    lower.includes("rate-limit") ||
    lower.includes("exceeds defined limit") ||
    lower.includes("too many requests") ||
    lower.includes("http request failed") ||
    lower.includes("429")
  ) {
    return "Coston2 RPC is rate-limiting. Retry in a moment.";
  }
  if (lower.includes("insufficient funds")) {
    return "Not enough C2FLR for gas on this wallet.";
  }
  if (lower.includes("unrecognized chain") || lower.includes("4902")) {
    return "Coston2 is not added to the wallet yet — click “Switch to Coston2” again to add it.";
  }
  // Contract revert reasons are short and meaningful — keep them.
  const revert = raw.match(/reverted with(?: the following)? reason:?\s*([^\n.]{1,80})/i);
  if (revert) return `Transaction reverted: ${revert[1].trim()}`;

  const firstLine = raw.split("\n")[0].trim();
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}…` : firstLine;
}
