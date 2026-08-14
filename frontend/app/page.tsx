"use client";

import { useEffect, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { coston2 } from "@/lib/chains";
import { extractRevertReason, friendlyError } from "@/lib/errors";
import {
  ERC20_ABI,
  FXRP_ADDRESS,
  FXRP_DECIMALS,
  MOCK_TEE_URL,
  VOUCH_CREDIT_LINE_ABI,
  VOUCH_CREDIT_LINE_ADDRESS,
  VOUCH_POOL_ABI,
  VOUCH_POOL_ADDRESS,
} from "@/lib/contracts";
import { DEMO_DATA_LABEL, personas } from "@/lib/personas";

type Step =
  | "idle"
  | "requesting"
  | "signed"
  | "submitting"
  | "onchain"
  | "rejected"
  | "error";

interface UnderwriteResponse {
  wallet: string;
  credit_limit_usd: number;
  rule_version: number;
  reason: string;
  expiry: number;
  signature: `0x${string}`;
  signer: string;
  mock_tee: boolean;
}

function explorerTx(hash: string) {
  return `${coston2.blockExplorers.default.url}/tx/${hash}`;
}
function explorerAddress(addr: string) {
  return `${coston2.blockExplorers.default.url}/address/${addr}`;
}

export default function Page() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, error: connectError, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();
  const [switchError, setSwitchError] = useState<string | null>(null);

  // Dry-run finding (CD Round 1): on a cold profile MetaMask can answer
  // switchChain with "Unrecognized chain ID" instead of the standard 4902 —
  // fall back to adding Coston2 explicitly with the official RPC, then retry.
  async function ensureCoston2() {
    setSwitchError(null);
    try {
      await switchChainAsync({ chainId: coston2.id });
    } catch {
      try {
        await (window as any).ethereum?.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0x72",
              chainName: coston2.name,
              nativeCurrency: coston2.nativeCurrency,
              rpcUrls: [coston2.rpcUrls.default.http[0]],
              blockExplorerUrls: [coston2.blockExplorers.default.url],
            },
          ],
        });
        await switchChainAsync({ chainId: coston2.id });
      } catch (e) {
        setSwitchError(friendlyError(e));
      }
    }
  }

  const [hasInjectedWallet, setHasInjectedWallet] = useState(true);
  useEffect(() => {
    setHasInjectedWallet(typeof window !== "undefined" && Boolean((window as any).ethereum));
  }, []);

  const wrongChain = isConnected && chainId !== coston2.id;

  const [personaId, setPersonaId] = useState(personas[0].persona_id);
  const persona = personas.find((p) => p.persona_id === personaId)!;

  const [step, setStep] = useState<Step>("idle");
  const [underwrite, setUnderwrite] = useState<UnderwriteResponse | null>(null);
  const [submitTxHash, setSubmitTxHash] = useState<`0x${string}` | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [ohMoment, setOhMoment] = useState<{ reason: string } | null>(null);

  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  // Every write in this app goes through here. Dry-run findings (CD Round 2):
  // (C) a receipt with status "reverted" was being rendered as a plain
  // success link — the UI must always check status before declaring success.
  // (C.a) an out-of-gas revert happened under wagmi's own default gas
  // estimate — estimate explicitly and buffer it, no hardcoded limit.
  // (A) callers must await the mined receipt before refetching chain state,
  // or panels show pre-transaction values for the ~block-time gap.
  async function sendAndConfirm(
    params: Parameters<typeof writeContractAsync>[0]
  ): Promise<`0x${string}`> {
    if (!publicClient) throw new Error("No RPC client available.");
    const estimate = await publicClient.estimateContractGas({
      ...(params as any),
      account: address,
    });
    const gas = (estimate * 130n) / 100n;
    const hash = await writeContractAsync({ ...params, gas } as any);
    const txReceipt = await publicClient.waitForTransactionReceipt({ hash });
    if (txReceipt.status === "reverted") {
      // The receipt itself carries no reason — replay the same call to
      // decode one, so a genuine contract rejection (e.g. the hash gate)
      // still reads as "Rejected: <reason>", not a generic failure.
      let revertReason: string | null = null;
      try {
        await publicClient.simulateContract({ ...(params as any), account: address });
      } catch (simError) {
        revertReason = extractRevertReason(simError);
      }
      const err = new Error(
        revertReason
          ? `Transaction reverted on-chain: ${revertReason} — view on explorer: ${explorerTx(hash)}`
          : `Transaction reverted on-chain — view on explorer: ${explorerTx(hash)}`
      ) as Error & { revertReason?: string };
      if (revertReason) err.revertReason = revertReason;
      throw err;
    }
    return hash;
  }

  const { data: creditLine, refetch: refetchCreditLine } = useReadContract({
    address: VOUCH_CREDIT_LINE_ADDRESS,
    abi: VOUCH_CREDIT_LINE_ABI,
    functionName: "creditLines",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: borrowedFxrp, refetch: refetchBorrowed } = useReadContract({
    address: VOUCH_POOL_ADDRESS,
    abi: VOUCH_POOL_ABI,
    functionName: "borrowedFxrp",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: fxrpBalance, refetch: refetchBalance } = useReadContract({
    address: FXRP_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const receipt = useWaitForTransactionReceipt({ hash: submitTxHash ?? undefined });

  const limitUsd = creditLine ? Number(creditLine[0]) : 0;
  const hasLiveCreditLine = limitUsd > 0;

  async function requestCreditLine() {
    if (!address) return;
    setErrorMsg(null);
    setOhMoment(null);
    setStep("requesting");
    try {
      const res = await fetch(
        `${MOCK_TEE_URL}/${persona.persona_id}?wallet=${address}`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error(await res.text());
      const data: UnderwriteResponse = await res.json();
      setUnderwrite(data);
      setStep("signed");

      setStep("submitting");
      const hash = await sendAndConfirm({
        address: VOUCH_CREDIT_LINE_ADDRESS,
        abi: VOUCH_CREDIT_LINE_ABI,
        functionName: "submitResult",
        args: [
          data.wallet as `0x${string}`,
          BigInt(data.credit_limit_usd),
          data.rule_version,
          BigInt(data.expiry),
          data.signature,
        ],
      });
      setSubmitTxHash(hash);
      setStep("onchain");
      await refetchCreditLine();
    } catch (e) {
      setErrorMsg(friendlyError(e));
      setStep("error");
    }
  }

  const [ohMomentBusy, setOhMomentBusy] = useState(false);

  async function triggerOhMoment() {
    if (!address || ohMomentBusy || step === "requesting" || step === "submitting") return;
    setOhMomentBusy(true);
    setErrorMsg(null);
    setOhMoment(null);
    try {
      const res = await fetch(
        `${MOCK_TEE_URL}/tampered/${persona.persona_id}?wallet=${address}`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error(await res.text());
      const data: UnderwriteResponse = await res.json();
      await sendAndConfirm({
        address: VOUCH_CREDIT_LINE_ADDRESS,
        abi: VOUCH_CREDIT_LINE_ABI,
        functionName: "submitResult",
        args: [
          data.wallet as `0x${string}`,
          BigInt(data.credit_limit_usd),
          data.rule_version,
          BigInt(data.expiry),
          data.signature,
        ],
      });
      // If this doesn't throw, something is badly wrong — the hash gate failed.
      setOhMoment({ reason: "ERROR: tampered result was accepted!" });
    } catch (e) {
      // Only a decoded contract revert is a "Rejected" — the hash gate
      // firing. An RPC/network/server failure is not the contract speaking
      // and must never be worded as if it were (dry-run regression, CD
      // Round 3): a Coston2 hiccup that reads like cryptographic proof is
      // exactly the false claim the honesty boundary forbids.
      const reason = extractRevertReason(e);
      setOhMoment({
        reason: reason
          ? `Rejected: ${reason}.`
          : `Request failed — please retry. (${friendlyError(e)})`,
      });
    } finally {
      setOhMomentBusy(false);
    }
  }

  const [borrowInput, setBorrowInput] = useState("");
  const [borrowTx, setBorrowTx] = useState<`0x${string}` | null>(null);
  const [borrowBusy, setBorrowBusy] = useState(false);
  const [borrowError, setBorrowError] = useState<string | null>(null);

  async function borrow() {
    if (!borrowInput || borrowBusy) return;
    setBorrowBusy(true);
    setBorrowError(null);
    try {
      const amount = parseUnits(borrowInput, FXRP_DECIMALS);
      const hash = await sendAndConfirm({
        address: VOUCH_POOL_ADDRESS,
        abi: VOUCH_POOL_ABI,
        functionName: "borrow",
        args: [amount],
      });
      setBorrowTx(hash);
      await Promise.all([refetchBorrowed(), refetchBalance()]);
    } catch (e) {
      setBorrowError(friendlyError(e));
    } finally {
      setBorrowBusy(false);
    }
  }

  const [repayPhase, setRepayPhase] = useState<"idle" | "approving" | "repaying">("idle");

  async function repay() {
    if (!borrowInput || borrowBusy) return;
    setBorrowBusy(true);
    setBorrowError(null);
    try {
      const amount = parseUnits(borrowInput, FXRP_DECIMALS);
      // Dry-run finding (CD Round 2, race condition): repay was sent before
      // the approve transaction was mined, so the allowance wasn't visible
      // on-chain yet. Awaiting the mined receipt here (via sendAndConfirm)
      // fixes it; the phase state makes the wait visible instead of a dead
      // "Sending …" button.
      setRepayPhase("approving");
      await sendAndConfirm({
        address: FXRP_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [VOUCH_POOL_ADDRESS, amount],
      });
      setRepayPhase("repaying");
      const hash = await sendAndConfirm({
        address: VOUCH_POOL_ADDRESS,
        abi: VOUCH_POOL_ABI,
        functionName: "repay",
        args: [amount],
      });
      setBorrowTx(hash);
      await Promise.all([refetchBorrowed(), refetchBalance()]);
    } catch (e) {
      setBorrowError(friendlyError(e));
    } finally {
      setBorrowBusy(false);
      setRepayPhase("idle");
    }
  }

  return (
    <main className="wrap">
      <header>
        <h1>Vouch</h1>
        <p className="tagline">
          A guarantor that never burdens the chain — creditworthiness is
          computed inside a sealed enclave, not stored publicly.
        </p>
        <p className="reality">
          <strong>REAL:</strong> contracts, unsecured borrow, hash gate — every
          transaction on the Coston2 explorer. <strong>SIMULATED:</strong> only
          the hardware attestation root.
        </p>
        {!isConnected ? (
          hasInjectedWallet ? (
            <>
              <button onClick={() => connect({ connector: connectors[0] })} disabled={isConnecting}>
                {isConnecting ? "Connecting …" : "Connect wallet"}
              </button>
              {connectError && <p className="error">{friendlyError(connectError)}</p>}
            </>
          ) : (
            <p className="error">
              No wallet detected. Please install{" "}
              <a href="https://metamask.io/download" target="_blank" rel="noreferrer">
                MetaMask
              </a>{" "}
              and reload the page.
            </p>
          )
        ) : wrongChain ? (
          <div className="wallet-row">
            <p className="error">Wrong network — please switch to Flare Testnet Coston2.</p>
            <button onClick={ensureCoston2} disabled={isSwitchingChain}>
              {isSwitchingChain ? "Switching …" : "Switch to Coston2"}
            </button>
            {switchError && <p className="error">{switchError}</p>}
          </div>
        ) : (
          <div className="wallet-row">
            <code>{address}</code>
            <button onClick={() => disconnect()}>Disconnect</button>
          </div>
        )}
      </header>

      <section className="card">
        <h2>1. Demo data source</h2>
        <p className="badge">{DEMO_DATA_LABEL}</p>
        <div className="persona-picker">
          {personas.map((p) => (
            <button
              key={p.persona_id}
              className={p.persona_id === personaId ? "active" : ""}
              onClick={() => setPersonaId(p.persona_id)}
              disabled={step === "requesting" || step === "submitting"}
            >
              {p.display_name}
            </button>
          ))}
        </div>
        <p className="hint">
          {persona.history_months} months of history · Wallet for this
          request: your connected wallet (not the fixture address)
        </p>
      </section>

      <section className="card">
        <h2>2. Request a credit line</h2>
        <p className="hint">
          The rule engine, signature check, hash gate and credit line are real
          on Coston2 — run <code>make verify</code> to prove it yourself. Only
          the TEE attestation root is <strong>simulated</strong> (F12 mock-tee,
          [MOCKED/CURATED]): Flare&apos;s FCC dispatch route currently 404s
          upstream, so we built the identical signature scheme on the only
          path demonstrable today (see README).
        </p>
        <button
          disabled={!isConnected || step === "requesting" || step === "submitting"}
          onClick={requestCreditLine}
        >
          {step === "requesting"
            ? "Running in the enclave …"
            : step === "submitting"
            ? "Writing on-chain …"
            : "Request credit line"}
        </button>
        <ol className="state-machine">
          <li className={step !== "idle" ? "done" : ""}>requested</li>
          <li className={["signed", "submitting", "onchain"].includes(step) ? "done" : ""}>
            in the enclave
          </li>
          <li className={["submitting", "onchain"].includes(step) ? "done" : ""}>signed</li>
          <li className={step === "onchain" ? "done" : ""}>on-chain</li>
        </ol>
        {underwrite && (
          <p className="hint">
            Result: {underwrite.reason} · ${underwrite.credit_limit_usd} limit
          </p>
        )}
        {submitTxHash && (
          <p className="hint">
            Tx:{" "}
            <a href={explorerTx(submitTxHash)} target="_blank" rel="noreferrer">
              {submitTxHash.slice(0, 14)}…
            </a>{" "}
            {receipt.isLoading ? "(waiting for confirmation)" : receipt.isSuccess ? "confirmed" : ""}
          </p>
        )}
        {errorMsg && <p className="error">{errorMsg}</p>}

        <button
          className="ghost"
          onClick={triggerOhMoment}
          disabled={!isConnected || ohMomentBusy || step === "requesting" || step === "submitting"}
        >
          {ohMomentBusy ? "Sending …" : "'Oh!' moment: send a tampered rule version"}
        </button>
        {ohMoment && <p className="oh-moment">{ohMoment.reason}</p>}
      </section>

      <section className="card">
        <h2>3. What the chain knows</h2>
        <div className="chain-panel">
          <div>
            <h3>Private (local only, never sent)</h3>
            <ul>
              {persona.months.slice(-3).map((m) => (
                <li key={m.month}>
                  {m.month}: inflow ${m.inflow_usd} · outflow ${m.outflow_usd}
                </li>
              ))}
              <li>… {persona.months.length} months total</li>
            </ul>
          </div>
          <div>
            <h3>Public on-chain (exactly three fields)</h3>
            <ul>
              <li>limitUsd: {hasLiveCreditLine ? `$${limitUsd}` : "—"}</li>
              <li>ruleVersion: {creditLine ? Number(creditLine[1]) : "—"}</li>
              <li>
                expiry:{" "}
                {creditLine && Number(creditLine[2]) > 0
                  ? new Date(Number(creditLine[2]) * 1000).toLocaleDateString("en-US")
                  : "—"}
              </li>
            </ul>
            {address && (
              <a href={explorerAddress(VOUCH_CREDIT_LINE_ADDRESS)} target="_blank" rel="noreferrer">
                VouchCreditLine on the explorer →
              </a>
            )}
          </div>
        </div>
      </section>

      <section className="card">
        <h2>4. Borrow unsecured</h2>
        <p className="hint">
          Credit line: {hasLiveCreditLine ? `$${limitUsd}` : "none"} · Currently borrowed:{" "}
          {borrowedFxrp ? formatUnits(borrowedFxrp, FXRP_DECIMALS) : "0"} FXRP · Your FXRP balance:{" "}
          {fxrpBalance !== undefined ? formatUnits(fxrpBalance, FXRP_DECIMALS) : "…"}
        </p>
        <input
          value={borrowInput}
          onChange={(e) => setBorrowInput(e.target.value)}
          placeholder="FXRP amount"
          disabled={!hasLiveCreditLine}
        />
        <div className="borrow-row">
          <button disabled={!hasLiveCreditLine || !borrowInput || borrowBusy} onClick={borrow}>
            {borrowBusy ? "Sending …" : "Borrow (no collateral posted)"}
          </button>
          <button
            className="ghost"
            disabled={!borrowedFxrp || borrowedFxrp === 0n || !borrowInput || borrowBusy}
            onClick={repay}
          >
            {repayPhase === "approving"
              ? "Approving …"
              : repayPhase === "repaying"
              ? "Repaying …"
              : "Repay"}
          </button>
        </div>
        {borrowTx && (
          <p className="hint">
            Tx:{" "}
            <a href={explorerTx(borrowTx)} target="_blank" rel="noreferrer">
              {borrowTx.slice(0, 14)}…
            </a>
          </p>
        )}
        {borrowError && <p className="error">{borrowError}</p>}
      </section>
    </main>
  );
}
