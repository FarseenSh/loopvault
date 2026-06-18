"use client";

import { useMemo, useState } from "react";
import { useCurrentAccount, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { hedgeForPosition } from "../lib/delta";
import { fmtNum, fmtPct, fmtUsd, type MarketSnapshot } from "../lib/market";
import { buildOpenPositionPTB, type HedgeLeg } from "../ptb/buildOpenPositionPTB";
import { CFG, unresolvedIds } from "../config/loopvault.config";
import { FRESHNESS_DEADLINE_MS } from "./OracleCountdown";

export interface OpenResult {
  isUp: boolean;
  strike: number;
  cost: number;
  qtyUsd: number;
  entryIv: number;
  hedgeSide: string;
  hedgeNotional: number;
  hedgeBaseUnits: number;
  forwardEntry: number;
  expiryMs: number;
  commands: number;
}

const CAPITAL_USD = 1_000; // demo testnet DUSDC balance — the max_loss_bps denominator
const usd6 = (x: number) => BigInt(Math.max(0, Math.round(x * 1e6)));
const fs9 = (x: number) => BigInt(Math.max(0, Math.round(x * 1e9)));

export function TradePanel({
  snap,
  gateOpen,
  atmIv,
  onOpen,
}: {
  snap: MarketSnapshot;
  gateOpen: boolean;
  atmIv: number;
  onOpen: (r: OpenResult) => void;
}) {
  const [isUp, setIsUp] = useState(true);
  const [qtyUsd, setQtyUsd] = useState(50);
  const [maxLossBps, setMaxLossBps] = useState(500);
  const account = useCurrentAccount();
  const { mutateAsync, isPending } = useSignAndExecuteTransaction();
  const [toast, setToast] = useState<string | null>(null);

  const c = useMemo(() => {
    const strike = snap.forward; // ATM open
    const plan = hedgeForPosition(snap.forward, strike, snap.svi, qtyUsd, isUp ? "up" : "down");
    const cost = plan.price * qtyUsd;
    const sizeBps = (cost / CAPITAL_USD) * 10_000;
    return { strike, plan, cost, sizeBps, withinCap: sizeBps <= maxLossBps };
  }, [snap, qtyUsd, isUp, maxLossBps]);

  const canOpen = gateOpen && c.withinCap && qtyUsd > 0 && !isPending;

  async function onTap() {
    const hedge: HedgeLeg =
      c.plan.side === "buy_base"
        ? { side: "buy_base", quoteIn: usd6(c.plan.hedgeQuoteNotional), minBaseOut: 0n }
        : c.plan.side === "sell_base"
          ? { side: "sell_base", baseIn: usd6(c.plan.hedgeBaseUnits), minQuoteOut: 0n }
          : { side: "none" };

    const tx = buildOpenPositionPTB({
      managerId: account?.address ?? "0x0",
      isUp,
      strike: fs9(c.strike),
      expiryMs: BigInt(snap.expiryMs),
      quantity: usd6(qtyUsd),
      costCharged: usd6(c.cost),
      capitalBase: usd6(CAPITAL_USD),
      maxLossBps: BigInt(maxLossBps),
      oracleFreshnessDeadlineMs: BigInt(FRESHNESS_DEADLINE_MS),
      oracleTsMs: BigInt(snap.oracleTsMs),
      hedge,
      direction: isUp ? 0 : 1,
      entryIvBps: BigInt(Math.round(atmIv * 10_000)),
      marketKeyBytes: [],
      streakId: "0x0",
      recipient: account?.address ?? "0x0",
    });
    const commands = (tx.getData() as { commands: unknown[] }).commands.length;
    const unresolved = unresolvedIds(CFG);

    if (account && unresolved.length === 0) {
      try {
        const res = await mutateAsync({ transaction: tx });
        setToast(`Opened on-chain — ${res.digest}`);
      } catch (e) {
        setToast(`The seal held — PTB aborted atomically: ${(e as Error).message}`);
      }
    } else {
      setToast(
        `Atomic Open PTB built — ${commands} commands, sealed by safe_mint::consume. ` +
          (account ? `Resolve ${unresolved.length} testnet IDs to submit.` : `Connect a wallet to submit.`),
      );
    }

    onOpen({
      isUp,
      strike: c.strike,
      cost: c.cost,
      qtyUsd,
      entryIv: atmIv,
      hedgeSide: c.plan.side,
      hedgeNotional: c.plan.hedgeQuoteNotional,
      hedgeBaseUnits: c.plan.hedgeBaseUnits,
      forwardEntry: snap.forward,
      expiryMs: snap.expiryMs,
      commands,
    });
  }

  return (
    <div>
      <div className="seg" style={{ marginBottom: 6 }}>
        <button className={`btn ${isUp ? "btn-up" : ""}`} data-active={isUp} onClick={() => setIsUp(true)}>
          ▲ Buy Call
        </button>
        <button className={`btn ${!isUp ? "btn-down" : ""}`} data-active={!isUp} onClick={() => setIsUp(false)}>
          ▼ Buy Put
        </button>
      </div>

      <label className="field">Size (USDC)</label>
      <input
        className="num"
        type="number"
        min={1}
        value={qtyUsd}
        onChange={(e) => setQtyUsd(Math.max(0, Number(e.target.value)))}
      />

      <label className="field">
        Max loss cap — {maxLossBps} bps ({fmtPct(maxLossBps / 10_000, 1)} of {fmtUsd(CAPITAL_USD)})
      </label>
      <input
        type="range"
        min={50}
        max={3000}
        step={50}
        value={maxLossBps}
        onChange={(e) => setMaxLossBps(Number(e.target.value))}
      />

      <div style={{ marginTop: 14 }}>
        <div className="row">
          <span className="k">Strike (ATM)</span>
          <span className="v">{fmtUsd(c.strike)}</span>
        </div>
        <div className="row">
          <span className="k">Premium / cost</span>
          <span className="v">{fmtUsd(c.cost, 2)}</span>
        </div>
        <div className="row">
          <span className="k">SVI delta (per contract)</span>
          <span className={`v ${isUp ? "v-up" : "v-down"}`}>{fmtNum(c.plan.positionDelta / Math.max(qtyUsd, 1e-9), 4)}</span>
        </div>
        <div className="row">
          <span className="k">Spot hedge</span>
          <span className="v">
            {c.plan.side === "none"
              ? "—"
              : `${c.plan.side === "buy_base" ? "buy" : "sell"} ${fmtUsd(c.plan.hedgeQuoteNotional, 2)} base`}
          </span>
        </div>
        <div className="row">
          <span className="k">Size vs cap</span>
          <span className={`v ${c.withinCap ? "v-up" : "v-down"}`}>
            {fmtNum(c.sizeBps, 0)} / {maxLossBps} bps
          </span>
        </div>
      </div>

      <button
        className={`btn btn-primary ${isUp ? "" : "is-down"}`}
        style={{ marginTop: 14 }}
        disabled={!canOpen}
        onClick={onTap}
      >
        {!gateOpen
          ? "Oracle stale — Open locked"
          : !c.withinCap
            ? "Exceeds max-loss cap"
            : `Open ${isUp ? "Call" : "Put"} · one tap, hedged`}
      </button>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
