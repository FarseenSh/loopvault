"use client";

import { useState } from "react";
import { binaryDownPrice, binaryUpPrice } from "../lib/delta";
import { fmtPct, fmtUsd, type MarketSnapshot } from "../lib/market";
import type { OpenResult } from "./TradePanel";

/**
 * Live mark-to-market of the latest Open — the consumer "flex card."
 *
 * Both legs are re-priced every tick: the Predict digital against the current SVI
 * surface (exactly the on-chain N(d2)), and the Spot hedge against the current
 * forward. The net line shows the hedge doing its job — a directional move that
 * lifts the digital is offset by the hedge leg, so net P&L stays near the vol edge,
 * not the price bet. That offset is the entire LoopVault safety thesis, made visible.
 */
export function ShareCardPreview({ pos, snap }: { pos: OpenResult | null; snap: MarketSnapshot }) {
  const [copied, setCopied] = useState(false);

  if (!pos) {
    return (
      <div className="sharecard">
        <div className="panel-title" style={{ margin: 0 }}>Your position</div>
        <p style={{ color: "var(--text-dim)", fontSize: 13.5, margin: "10px 0 0", lineHeight: 1.5 }}>
          No open position yet. Tap <b>Open</b> and your hedged Predict digital marks to market
          here, live — repriced against the Block Scholes surface every second.
        </p>
      </div>
    );
  }

  const dir = pos.isUp ? "CALL" : "PUT";
  const entryPrice = pos.cost / Math.max(pos.qtyUsd, 1e-9);
  const nowPrice = pos.isUp
    ? binaryUpPrice(snap.forward, pos.strike, snap.svi)
    : binaryDownPrice(snap.forward, pos.strike, snap.svi);

  const digitalPnl = pos.qtyUsd * nowPrice - pos.cost;
  const dF = snap.forward - pos.forwardEntry;
  const hedgePnl =
    pos.hedgeSide === "sell_base" ? -pos.hedgeBaseUnits * dF
    : pos.hedgeSide === "buy_base" ? pos.hedgeBaseUnits * dF
    : 0;
  const netPnl = digitalPnl + hedgePnl;
  const netPct = netPnl / Math.max(pos.cost, 1e-9);
  const up = netPnl >= 0;

  const money = (x: number) => `${x >= 0 ? "+" : "−"}${fmtUsd(Math.abs(x), 2)}`;
  const expMin = Math.max(0, (pos.expiryMs - snap.oracleTsMs) / 60_000);

  async function share() {
    const caption =
      `LoopVault — ${dir} BTC digital, ${money(netPnl)} (${up ? "+" : "−"}${fmtPct(Math.abs(netPct), 1)}), ` +
      `delta-hedged on DeepBook. One tap, ~6s, no seed phrase.`;
    try {
      await navigator.clipboard?.writeText(caption);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="sharecard">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className={`pill ${pos.isUp ? "" : ""}`}>
          <span className="dot" style={{ background: pos.isUp ? "var(--up)" : "var(--down)", boxShadow: "none" }} />
          {pos.isUp ? "▲" : "▼"} {dir} · BTC
        </span>
        <span style={{ color: "var(--text-faint)", fontSize: 11, letterSpacing: "0.12em", fontWeight: 700 }}>
          LOOPVAULT
        </span>
      </div>

      <div className={`pl ${up ? "v-up" : "v-down"}`} style={{ marginTop: 12 }}>
        {money(netPnl)}
      </div>
      <div style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 2 }}>
        net P&L · <span className={up ? "v-up" : "v-down"}>{up ? "+" : "−"}{fmtPct(Math.abs(netPct), 1)}</span> on{" "}
        {fmtUsd(pos.cost, 2)} premium · delta-hedged
      </div>

      <div style={{ marginTop: 14 }}>
        <div className="row">
          <span className="k">Predict digital</span>
          <span className={`v ${digitalPnl >= 0 ? "v-up" : "v-down"}`}>{money(digitalPnl)}</span>
        </div>
        <div className="row">
          <span className="k">Spot hedge</span>
          <span className={`v ${hedgePnl >= 0 ? "v-up" : "v-down"}`}>
            {pos.hedgeSide === "none" ? "—" : money(hedgePnl)}
          </span>
        </div>
        <div className="row">
          <span className="k">Odds ITM · entry → now</span>
          <span className="v">{fmtPct(entryPrice, 0)} → {fmtPct(nowPrice, 0)}</span>
        </div>
        <div className="row">
          <span className="k">Strike · entry IV</span>
          <span className="v">{fmtUsd(pos.strike)} · {fmtPct(pos.entryIv, 0)}</span>
        </div>
        <div className="row">
          <span className="k">Expires in</span>
          <span className="v">{expMin.toFixed(0)}m</span>
        </div>
      </div>

      <button className="btn" style={{ width: "100%", marginTop: 14 }} onClick={share}>
        {copied ? "✓ Flex copied to clipboard" : "Share this trade"}
      </button>
    </div>
  );
}
