"use client";

import { useState } from "react";
import { AuthControls } from "../components/AuthControls";
import { useMarketFeed, useNow } from "../hooks/useMarketFeed";
import { useLiveOracle } from "../hooks/useLiveOracle";
import { atmImpliedVol, fmtPct, fmtUsd } from "../lib/market";
import { CFG, NETWORK, unresolvedIds } from "../config/loopvault.config";
import { RegimeBanner } from "../components/RegimeBanner";
import { VolSmile } from "../components/VolSmile";
import { OracleCountdown, oracleAge } from "../components/OracleCountdown";
import { TradePanel, type OpenResult } from "../components/TradePanel";
import { EarnPanel } from "../components/EarnPanel";
import { ShareCardPreview } from "../components/ShareCardPreview";

const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

export default function Page() {
  const [source, setSource] = useState<"demo" | "live">("demo");
  const [frozen, setFrozen] = useState(false);
  const [tab, setTab] = useState<"trade" | "earn">("trade");
  const [pos, setPos] = useState<OpenResult | null>(null);

  const demoSnap = useMarketFeed(!frozen);
  const liveOracle = useLiveOracle(source === "live");
  const snap = source === "live" && liveOracle.snapshot ? liveOracle.snapshot : demoSnap;
  const onLive = source === "live" && !!liveOracle.snapshot;

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
          <AuthControls />
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
            <span>{onLive ? "Live testnet surface · BTC" : "Block Scholes vol surface · BTC"}</span>
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

          <div className="tabs" style={{ marginTop: 12, width: "100%" }}>
            <button className="tab" data-active={source === "demo"} onClick={() => setSource("demo")} style={{ flex: 1 }}>
              Demo surface
            </button>
            <button className="tab" data-active={source === "live"} onClick={() => setSource("live")} style={{ flex: 1 }}>
              Live testnet
            </button>
          </div>

          {source === "demo" ? (
            <>
              <button className="btn" style={{ width: "100%", marginTop: 10 }} onClick={() => setFrozen((f) => !f)}>
                {frozen ? "▶ Resume live feed" : "⏸ Freeze oracle — force a stale window"}
              </button>
              {frozen && (
                <p style={{ color: "var(--warn)", fontSize: 12.5, margin: "10px 2px 0" }}>
                  Oracle frozen — watch the age cross 20s and Open lock itself. The SafeMint seal re-asserts
                  this exact deadline on-chain, so a stale-oracle trade can’t land.
                </p>
              )}
            </>
          ) : (
            <p style={{ fontSize: 12.5, margin: "10px 2px 0", color: onLive ? "var(--text-dim)" : "var(--warn)" }}>
              {liveOracle.status === "ok" && liveOracle.snapshot
                ? `● Real on-chain oracle ${short(liveOracle.snapshot.oracleId)} — decoded live from ${NETWORK}. Freshness + Open follow the real timestamp.`
                : liveOracle.status === "loading"
                  ? "Fetching the live BTC oracle from testnet…"
                  : liveOracle.status === "empty"
                    ? "No live BTC oracle is published right now — showing the demo surface (the protocol oracle is intermittent on testnet)."
                    : liveOracle.status === "error"
                      ? `Live fetch failed (${liveOracle.error ?? "network"}) — showing the demo surface.`
                      : "Connecting to the live testnet oracle…"}
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
        <span>{onLive ? "Live surface: real on-chain OracleSVI, decoded client-side." : "Demo surface; testnet ids resolve in Gates 0/3/4/5."}</span>
        <span>DeepBook Predict · Block Scholes SVI oracle · Sui.</span>
        <span>Not financial advice.</span>
      </footer>
    </main>
  );
}
