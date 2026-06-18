"use client";

import { useState } from "react";
import { ConnectButton } from "@mysten/dapp-kit";
import { useMarketFeed, useNow } from "../hooks/useMarketFeed";
import { atmImpliedVol, fmtPct, fmtUsd } from "../lib/market";
import { CFG, NETWORK, unresolvedIds } from "../config/loopvault.config";
import { RegimeBanner } from "../components/RegimeBanner";
import { VolSmile } from "../components/VolSmile";
import { OracleCountdown, oracleAge } from "../components/OracleCountdown";
import { TradePanel, type OpenResult } from "../components/TradePanel";
import { EarnPanel } from "../components/EarnPanel";
import { ShareCardPreview } from "../components/ShareCardPreview";

export default function Page() {
  const [live, setLive] = useState(true);
  const [tab, setTab] = useState<"trade" | "earn">("trade");
  const [pos, setPos] = useState<OpenResult | null>(null);

  const snap = useMarketFeed(live);
  const now = useNow(250);
  const age = oracleAge(snap.oracleTsMs, now);
  const atmIv = atmImpliedVol(snap);
  const pending = unresolvedIds(CFG).length;
  const expMin = Math.max(0, Math.round((snap.expiryMs - snap.oracleTsMs) / 60_000));

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="mark" />
          <div>
            LoopVault <small>one-tap hedged Predict</small>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="pill">
            <span className={`dot ${pending ? "warn" : ""}`} />
            {NETWORK} · {pending ? `${pending} ids pending` : "live"}
          </span>
          <ConnectButton />
        </div>
      </header>

      <section className="hero">
        <h1>
          Trade BTC volatility in one tap. <span className="hl">Land fully hedged, or not at all.</span>
        </h1>
        <p>
          40,000+ joined the DeepBook Predict waitlist with no usable way to trade. LoopVault opens a
          Predict position <i>and</i> delta-hedges it on Spot in a single signature — sealed by a SafeMint
          hot-potato that rolls the whole trade back unless it lands inside a fresh-oracle window, within
          your max-loss cap. No seed phrase, gasless, ~6 seconds.
        </p>
      </section>

      <RegimeBanner snap={snap} />

      <div className="grid" style={{ marginTop: 16 }}>
        {/* ---- left: the live Block Scholes surface + oracle freshness gate ---- */}
        <div className="panel">
          <div className="panel-title">
            <span>Block Scholes vol surface · BTC</span>
            <OracleCountdown oracleTsMs={snap.oracleTsMs} nowMs={now} />
          </div>

          <VolSmile snap={snap} />

          <div style={{ marginTop: 8 }}>
            <div className="row">
              <span className="k">Spot · forward</span>
              <span className="v">{fmtUsd(snap.spot)} · {fmtUsd(snap.forward)}</span>
            </div>
            <div className="row">
              <span className="k">ATM implied vol</span>
              <span className="v">{fmtPct(atmIv, 1)}</span>
            </div>
            <div className="row">
              <span className="k">Expiry</span>
              <span className="v">{expMin}m · rolling</span>
            </div>
          </div>

          <button className="btn" style={{ width: "100%", marginTop: 12 }} onClick={() => setLive((l) => !l)}>
            {live ? "⏸ Freeze oracle — force a stale window" : "▶ Resume live feed"}
          </button>
          {!live && (
            <p style={{ color: "var(--warn)", fontSize: 12.5, margin: "10px 2px 0" }}>
              Oracle frozen — watch the age cross 20s and Open lock itself. The SafeMint seal re-asserts
              this exact deadline on-chain, so a stale-oracle trade can’t land.
            </p>
          )}
        </div>

        {/* ---- right: trade / earn, then the live mark-to-market flex card ---- */}
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <div className="panel">
            <div className="tabs" style={{ marginBottom: 14 }}>
              <button className="tab" data-active={tab === "trade"} onClick={() => setTab("trade")}>
                Trade
              </button>
              <button className="tab" data-active={tab === "earn"} onClick={() => setTab("earn")}>
                Earn
              </button>
            </div>

            {tab === "trade" ? (
              <TradePanel snap={snap} gateOpen={age.gateOpen} atmIv={atmIv} onOpen={setPos} />
            ) : (
              <EarnPanel />
            )}
          </div>

          <ShareCardPreview pos={pos} snap={snap} />
        </div>
      </div>

      <footer className="foot">
        <span>Atomic Open: deposit → mint → Spot hedge → SafeMint::consume, all-or-nothing.</span>
        <span>Demo surface; testnet ids resolve in Gates 0/3/4/5.</span>
        <span>DeepBook Predict · Block Scholes SVI oracle · Sui.</span>
        <span>Not financial advice.</span>
      </footer>
    </main>
  );
}
