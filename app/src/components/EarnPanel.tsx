"use client";

import { useState } from "react";
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import { buildEarnSupplyPTB } from "../ptb/buildEarnSupplyPTB";
import { buildWithdrawPTB } from "../ptb/buildWithdrawPTB";
import { CFG, unresolvedIds } from "../config/loopvault.config";
import { classifyTxError } from "../lib/errors";
import { fmtNum, fmtUsd } from "../lib/market";

const usd6 = (x: number) => BigInt(Math.max(0, Math.round(x * 1e6)));
const PLP_TYPE = `${CFG.predictPkg}::plp::PLP`;

type Toast = { tone: "ok" | "err" | "info"; msg: string } | null;

/**
 * Earn — the composable, owner-free supply → withdraw round-trip into the PLP vault
 * (Gate 1). Supply mints Coin<PLP>; Withdraw burns the user's PLP back to DUSDC.
 */
export function EarnPanel() {
  const [amount, setAmount] = useState(100);
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutateAsync, isPending } = useSignAndExecuteTransaction();
  const [busy, setBusy] = useState<"supply" | "withdraw" | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  const dusdcUnresolved = unresolvedIds(CFG).includes("dusdcType");
  const idle = !isPending && busy === null;

  async function onSupply() {
    const tx = buildEarnSupplyPTB({ amount: usd6(amount), recipient: account?.address ?? "0x0" });
    if (!account || dusdcUnresolved) {
      setToast({ tone: "info", msg: "Connect a wallet to supply (predict::supply → Coin<PLP> → you)." });
      return;
    }
    setBusy("supply");
    setToast({ tone: "info", msg: "Supplying…" });
    try {
      const res = await mutateAsync({ transaction: tx });
      setToast({ tone: "ok", msg: `Supplied ${fmtUsd(amount)} → PLP · ${res.digest.slice(0, 10)}…` });
    } catch (e) {
      const i = classifyTxError(e);
      setToast({ tone: i.kind === "rejected" ? "info" : "err", msg: `${i.title}: ${i.detail}` });
    } finally {
      setBusy(null);
    }
  }

  async function onWithdraw() {
    if (!account) {
      setToast({ tone: "info", msg: "Connect a wallet to withdraw." });
      return;
    }
    setBusy("withdraw");
    setToast({ tone: "info", msg: "Finding your PLP…" });
    try {
      const owned = await client.getOwnedObjects({
        owner: account.address,
        filter: { StructType: `0x2::coin::Coin<${PLP_TYPE}>` },
        options: { showType: true },
      });
      const lpCoinId = owned.data?.[0]?.data?.objectId;
      if (!lpCoinId) {
        setToast({ tone: "info", msg: "No PLP to withdraw — supply first." });
        return;
      }
      const tx = buildWithdrawPTB({ lpCoinId, recipient: account.address });
      const res = await mutateAsync({ transaction: tx });
      setToast({ tone: "ok", msg: `Withdrew PLP → DUSDC · ${res.digest.slice(0, 10)}…` });
    } catch (e) {
      const i = classifyTxError(e);
      setToast({ tone: i.kind === "rejected" ? "info" : "err", msg: `${i.title}: ${i.detail}` });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <p style={{ color: "var(--text-dim)", fontSize: 13.5, marginTop: 0, lineHeight: 1.5 }}>
        Provide DUSDC to the Predict liquidity vault and receive <b>PLP</b>. This leg has <i>no owner check</i> —
        auth is holding the coin — so it’s the cleanest <span className="mono">supply → withdraw</span> round-trip,
        proven atomic in our Move tests and live on testnet.
      </p>

      <label className="field" htmlFor="earn-amt">Amount (DUSDC)</label>
      <input id="earn-amt" className="num" type="number" min={1} value={amount} onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))} />

      <div style={{ marginTop: 14 }}>
        <div className="row"><span className="k">You receive</span><span className="v">≈ {fmtNum(amount)} PLP</span></div>
        <div className="row"><span className="k">Vault call</span><span className="v mono">predict::supply</span></div>
        <div className="row"><span className="k">Exit</span><span className="v mono">predict::withdraw</span></div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button className="btn btn-primary" style={{ flex: 1 }} disabled={!idle || amount <= 0} onClick={onSupply}>
          {busy === "supply" ? "Supplying…" : `Supply ${fmtUsd(amount)}`}
        </button>
        <button className="btn" style={{ flex: 1 }} disabled={!idle} onClick={onWithdraw}>
          {busy === "withdraw" ? "Withdrawing…" : "Withdraw all"}
        </button>
      </div>

      {toast && (
        <div className={`toast toast-${toast.tone}`} role="status" aria-live="polite">
          {toast.msg}
        </div>
      )}
    </div>
  );
}
