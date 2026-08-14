// Deployed Coston2 addresses — kept in sync with extension/config/vouch-deployments.md
export const VOUCH_CREDIT_LINE_ADDRESS = "0xe14163ef340D9D94A04f7F6e5503149564Baf118" as const;
export const VOUCH_POOL_ADDRESS = "0xB2B8de163C83D31CfE0d95C7de4cB715625e0DC2" as const;
export const FXRP_ADDRESS = "0x0b6a3645c240605887a5532109323a3e12273dc7" as const;
export const FXRP_DECIMALS = 6;

// Same-origin by default: the F12 fallback runs as a Vercel serverless
// function (app/api/underwrite/*) alongside this app, no ngrok/local
// process required for a juror to use the deployed link. Override only for
// local development against the standalone Go binary if needed.
export const MOCK_TEE_URL = process.env.NEXT_PUBLIC_MOCK_TEE_URL ?? "/api/underwrite";

export const VOUCH_CREDIT_LINE_ABI = [
  {
    type: "function",
    name: "creditLines",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "limitUsd", type: "uint128" },
      { name: "ruleVersion", type: "uint32" },
      { name: "expiry", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "submitResult",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "limitUsd", type: "uint128" },
      { name: "ruleVersion", type: "uint32" },
      { name: "expiry", type: "uint64" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "CreditLineIssued",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "limitUsd", type: "uint128", indexed: false },
      { name: "ruleVersion", type: "uint32", indexed: false },
      { name: "expiry", type: "uint64", indexed: false },
    ],
  },
] as const;

export const VOUCH_POOL_ABI = [
  {
    type: "function",
    name: "borrowedFxrp",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "borrow",
    stateMutability: "nonpayable",
    inputs: [{ name: "fxrpAmount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [{ name: "fxrpAmount", type: "uint256" }],
    outputs: [],
  },
] as const;

export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;
