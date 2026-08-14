// Turns raw viem/wallet error dumps into one short, on-camera-safe line.
// Raw messages include full calldata blobs and RPC internals — never render
// those directly (dry-run finding, CD Round 1).
export function friendlyError(e: unknown): string {
  const raw =
    (typeof e === "object" && e !== null && "shortMessage" in e
      ? String((e as { shortMessage: unknown }).shortMessage)
      : "") || (e instanceof Error ? e.message : String(e));

  const lower = raw.toLowerCase();
  if (lower.includes("user rejected") || lower.includes("user denied")) {
    return "Request cancelled in MetaMask.";
  }
  if (lower.includes("rate limit")) {
    return "The wallet's Coston2 RPC is rate-limiting. In MetaMask → Networks → Coston2, set the RPC URL to https://coston2-api.flare.network/ext/C/rpc and retry.";
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
