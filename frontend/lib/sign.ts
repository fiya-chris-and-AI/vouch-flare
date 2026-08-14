// Server-side port of tools/cmd/mock-tee's signResult — runs as a Vercel
// serverless function instead of a locally-hosted Go binary behind ngrok,
// so a juror's browser can reach the F12 fallback without our terminal.
// Must produce byte-for-byte the same signature a given (key, args) pair
// would produce in Go — same message construction, same signer.
import "server-only";
import { encodeAbiParameters, keccak256, pad, toBytes, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const CHAIN_ID = 114n; // Coston2
const VOUCH_CREDIT_LINE_ADDRESS = "0xe14163ef340D9D94A04f7F6e5503149564Baf118" as const;

function mockTeeAccount() {
  const key = process.env.MOCK_TEE_PRIVATE_KEY;
  if (!key) throw new Error("MOCK_TEE_PRIVATE_KEY not configured");
  return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
}

export function mockTeeSignerAddress(): `0x${string}` {
  return mockTeeAccount().address;
}

export async function signResult(
  user: `0x${string}`,
  limitUsd: number,
  ruleVersion: number,
  expiry: number,
  rogue = false
): Promise<{ signature: `0x${string}`; signer: `0x${string}` }> {
  const tag = toHex(pad(toBytes("VOUCH_CREDIT_LINE"), { size: 32, dir: "right" }));

  const encoded = encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "uint256" },
      { type: "address" },
      { type: "address" },
      { type: "uint128" },
      { type: "uint32" },
      { type: "uint64" },
    ],
    [tag, CHAIN_ID, VOUCH_CREDIT_LINE_ADDRESS, user, BigInt(limitUsd), ruleVersion, BigInt(expiry)]
  );
  const resultHash = keccak256(encoded);

  const account = rogue ? privateKeyToAccount(randomKey()) : mockTeeAccount();
  const signature = await account.signMessage({ message: { raw: resultHash } });
  return { signature, signer: account.address };
}

function randomKey(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}
