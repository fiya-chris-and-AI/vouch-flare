"use client";

import { useEffect, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { coston2 } from "@/lib/chains";
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
  const { switchChain, isPending: isSwitchingChain } = useSwitchChain();

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
      const hash = await writeContractAsync({
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
      setErrorMsg(e instanceof Error ? e.message : String(e));
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
      await writeContractAsync({
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
      const msg = e instanceof Error ? e.message : String(e);
      setOhMoment({
        reason: msg.includes("unattested underwriter")
          ? "Rejected: unattested underwriter."
          : `Rejected (${msg.slice(0, 120)})`,
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
      const hash = await writeContractAsync({
        address: VOUCH_POOL_ADDRESS,
        abi: VOUCH_POOL_ABI,
        functionName: "borrow",
        args: [amount],
      });
      setBorrowTx(hash);
      await Promise.all([refetchBorrowed(), refetchBalance()]);
    } catch (e) {
      setBorrowError(e instanceof Error ? e.message : String(e));
    } finally {
      setBorrowBusy(false);
    }
  }

  async function repay() {
    if (!borrowInput || borrowBusy) return;
    setBorrowBusy(true);
    setBorrowError(null);
    try {
      const amount = parseUnits(borrowInput, FXRP_DECIMALS);
      await writeContractAsync({
        address: FXRP_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [VOUCH_POOL_ADDRESS, amount],
      });
      const hash = await writeContractAsync({
        address: VOUCH_POOL_ADDRESS,
        abi: VOUCH_POOL_ABI,
        functionName: "repay",
        args: [amount],
      });
      setBorrowTx(hash);
      await Promise.all([refetchBorrowed(), refetchBalance()]);
    } catch (e) {
      setBorrowError(e instanceof Error ? e.message : String(e));
    } finally {
      setBorrowBusy(false);
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
        {!isConnected ? (
          hasInjectedWallet ? (
            <>
              <button onClick={() => connect({ connector: connectors[0] })} disabled={isConnecting}>
                {isConnecting ? "Connecting …" : "Connect wallet"}
              </button>
              {connectError && <p className="error">{connectError.message}</p>}
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
            <button onClick={() => switchChain({ chainId: coston2.id })} disabled={isSwitchingChain}>
              {isSwitchingChain ? "Switching …" : "Switch to Coston2"}
            </button>
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
          TEE signature: <strong>simulated</strong> (F12 mock-tee, [MOCKED/CURATED]) —
          the real FCC dispatch route is currently blocked by an upstream
          FTDC infra issue (see README). The rule engine, hash gate, and
          everything after it are real on Coston2.
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
            {borrowBusy ? "Sending …" : "Repay"}
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
