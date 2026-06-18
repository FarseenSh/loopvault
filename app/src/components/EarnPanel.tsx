"use client";

import { useState } from "react";
import { useCurrentAccount, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { buildEarnSupplyPTB } from "../ptb/buildEarnSupplyPTB";
import { CFG, unresolvedIds } from "../config/loopvault.config";
import { fmtNum, fmtUsd } from "../lib/market";

const usd6 = (x: number) => BigInt(Math.max(0, Math.round(x * 1e6)));

/**
 * Earn — supply DUSDC to the Predict liquidity vault and receive PLP. This is the
 * composable, owner-free `predict::supply → withdraw` round-trip (Gate 1), already
 * proven atomic in our Move tests. Live submit unlocks once the DUSDC type resolves
 * (Gate 0, from the faucet); until then a tap builds + shows the real PTB.
 */
export function EarnPanel() {
  const [amount, setAmount] = useState(250);
  const account = useCurrentAccount();
  const { mutateAsync, isPending } = useSignAndExecuteTransaction();
  const [toast, setToast] = useState<string | null>(null);

  const dusdcUnresolved = unresolvedIds(CFG).includes("dusdcType");
  const canClick = amount > 0 && !isPending;

  async function onSupply() {
    const tx = buildEarnSupplyPTB({ amount: usd6(amount), recipient: account?.address ?? "0x0" });
    const commands = (tx.getData() as { commands: unknown[] }).commands.length;

    if (account && !dusdcUnresolved) {
      try {
        const res = await mutateAsync({ transaction: tx });
        setToast(`Supplied ${fmtUsd(amount)} — ${res.digest}`);
      } catch (e) {
        setToast(`Aborted atomically: ${(e as Error).message}`);
      }
    } else {
      setToast(
        `Supply PTB built — predict::supply → Coin<PLP> → you (${commands} cmd). ` +
          (account ? "Resolve dusdcType (Gate 0) to submit." : "Connect a wallet to submit."),
      );
    }
  }

  return (
    <div>
      <p style={{ color: "var(--text-dim)", fontSize: 13.5, marginTop: 0, lineHeight: 1.5 }}>
        Provide DUSDC to the Predict liquidity vault and receive <b>PLP</b>. This leg has{" "}
        <i>no owner check</i> — auth is holding the coin — so it’s the cleanest{" "}
        <span className="mono">supply → withdraw</span> round-trip, already proven atomic in Move tests.
      </p>

      <label className="field">Amount (DUSDC)</label>
      <input
        className="num"
        type="number"
        min={1}
        value={amount}
        onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
      />

      <div style={{ marginTop: 14 }}>
        <div className="row">
          <span className="k">You receive</span>
          <span className="v">≈ {fmtNum(amount)} PLP</span>
        </div>
        <div className="row">
          <span className="k">Vault call</span>
          <span className="v mono">predict::supply</span>
        </div>
        <div className="row">
          <span className="k">Withdraw</span>
          <span className="v">burn PLP → DUSDC, anytime</span>
        </div>
      </div>

      <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={!canClick} onClick={onSupply}>
        {dusdcUnresolved ? `Supply ${fmtUsd(amount)} · build PTB` : `Supply ${fmtUsd(amount)}`}
      </button>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
