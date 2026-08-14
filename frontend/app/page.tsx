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
      setOhMoment({ reason: "FEHLER: manipuliertes Ergebnis wurde akzeptiert!" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setOhMoment({
        reason: msg.includes("unattested underwriter")
          ? "abgelehnt: unattested underwriter"
          : `abgelehnt (${msg.slice(0, 120)})`,
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
          Ein Bürge, der die Chain nicht belastet — Kreditwürdigkeit wird in
          einer versiegelten Enklave berechnet, nicht öffentlich gespeichert.
        </p>
        {!isConnected ? (
          hasInjectedWallet ? (
            <>
              <button onClick={() => connect({ connector: connectors[0] })} disabled={isConnecting}>
                {isConnecting ? "Verbinde …" : "Wallet verbinden"}
              </button>
              {connectError && <p className="error">{connectError.message}</p>}
            </>
          ) : (
            <p className="error">
              Kein Wallet erkannt. Bitte{" "}
              <a href="https://metamask.io/download" target="_blank" rel="noreferrer">
                MetaMask
              </a>{" "}
              installieren und die Seite neu laden.
            </p>
          )
        ) : wrongChain ? (
          <div className="wallet-row">
            <p className="error">Falsches Netzwerk — bitte zu Flare Testnet Coston2 wechseln.</p>
            <button onClick={() => switchChain({ chainId: coston2.id })} disabled={isSwitchingChain}>
              {isSwitchingChain ? "Wechsle …" : "Zu Coston2 wechseln"}
            </button>
          </div>
        ) : (
          <div className="wallet-row">
            <code>{address}</code>
            <button onClick={() => disconnect()}>Trennen</button>
          </div>
        )}
      </header>

      <section className="card">
        <h2>1. Demo-Datenquelle</h2>
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
          {persona.history_months} Monate Historie · Wallet für diese Anfrage:
          Ihr verbundenes Wallet (nicht die Fixture-Adresse)
        </p>
      </section>

      <section className="card">
        <h2>2. Kreditlinie anfragen</h2>
        <p className="hint">
          TEE-Signatur: <strong>simuliert</strong> (F12 mock-tee, [GEMOCKT/KURATIERT]) —
          die echte FCC-Dispatch-Route ist derzeit durch einen FTDC-Infra-Fehler
          blockiert (siehe README). Regel-Engine, Hash-Gate und alles danach sind
          echt auf Coston2.
        </p>
        <button
          disabled={!isConnected || step === "requesting" || step === "submitting"}
          onClick={requestCreditLine}
        >
          {step === "requesting"
            ? "Läuft in der Enklave …"
            : step === "submitting"
            ? "Wird on-chain geschrieben …"
            : "Kreditlinie anfragen"}
        </button>
        <ol className="state-machine">
          <li className={step !== "idle" ? "done" : ""}>angefordert</li>
          <li className={["signed", "submitting", "onchain"].includes(step) ? "done" : ""}>
            in der Enklave
          </li>
          <li className={["submitting", "onchain"].includes(step) ? "done" : ""}>signiert</li>
          <li className={step === "onchain" ? "done" : ""}>on-chain</li>
        </ol>
        {underwrite && (
          <p className="hint">
            Ergebnis: {underwrite.reason} · ${underwrite.credit_limit_usd} Limit
          </p>
        )}
        {submitTxHash && (
          <p className="hint">
            Tx:{" "}
            <a href={explorerTx(submitTxHash)} target="_blank" rel="noreferrer">
              {submitTxHash.slice(0, 14)}…
            </a>{" "}
            {receipt.isLoading ? "(wartet auf Bestätigung)" : receipt.isSuccess ? "bestätigt" : ""}
          </p>
        )}
        {errorMsg && <p className="error">{errorMsg}</p>}

        <button
          className="ghost"
          onClick={triggerOhMoment}
          disabled={!isConnected || ohMomentBusy || step === "requesting" || step === "submitting"}
        >
          {ohMomentBusy ? "Wird gesendet …" : "'Oh!'-Moment: manipulierte Regel-Version senden"}
        </button>
        {ohMoment && <p className="oh-moment">{ohMoment.reason}</p>}
      </section>

      <section className="card">
        <h2>3. Was die Chain weiß</h2>
        <div className="chain-panel">
          <div>
            <h3>Privat (nur lokal, nie gesendet)</h3>
            <ul>
              {persona.months.slice(-3).map((m) => (
                <li key={m.month}>
                  {m.month}: Zufluss ${m.inflow_usd} · Abfluss ${m.outflow_usd}
                </li>
              ))}
              <li>… {persona.months.length} Monate insgesamt</li>
            </ul>
          </div>
          <div>
            <h3>Öffentlich on-chain (genau drei Felder)</h3>
            <ul>
              <li>limitUsd: {hasLiveCreditLine ? `$${limitUsd}` : "—"}</li>
              <li>ruleVersion: {creditLine ? Number(creditLine[1]) : "—"}</li>
              <li>
                expiry:{" "}
                {creditLine && Number(creditLine[2]) > 0
                  ? new Date(Number(creditLine[2]) * 1000).toLocaleDateString("de-DE")
                  : "—"}
              </li>
            </ul>
            {address && (
              <a href={explorerAddress(VOUCH_CREDIT_LINE_ADDRESS)} target="_blank" rel="noreferrer">
                VouchCreditLine im Explorer →
              </a>
            )}
          </div>
        </div>
      </section>

      <section className="card">
        <h2>4. Unterbesichert leihen</h2>
        <p className="hint">
          Kreditlinie: {hasLiveCreditLine ? `$${limitUsd}` : "keine"} · Aktuell geliehen:{" "}
          {borrowedFxrp ? formatUnits(borrowedFxrp, FXRP_DECIMALS) : "0"} FXRP · Ihr FXRP-Guthaben:{" "}
          {fxrpBalance !== undefined ? formatUnits(fxrpBalance, FXRP_DECIMALS) : "…"}
        </p>
        <input
          value={borrowInput}
          onChange={(e) => setBorrowInput(e.target.value)}
          placeholder="FXRP-Betrag"
          disabled={!hasLiveCreditLine}
        />
        <div className="borrow-row">
          <button disabled={!hasLiveCreditLine || !borrowInput || borrowBusy} onClick={borrow}>
            {borrowBusy ? "Wird gesendet …" : "Leihen (keine Sicherheit hinterlegt)"}
          </button>
          <button
            className="ghost"
            disabled={!borrowedFxrp || borrowedFxrp === 0n || !borrowInput || borrowBusy}
            onClick={repay}
          >
            {borrowBusy ? "Wird gesendet …" : "Zurückzahlen"}
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
