"use client";

import { useEffect, useState } from "react";
import { useSuiClient } from "@mysten/dapp-kit";
import { AuthControls } from "../components/AuthControls";
import { useMarketFeed, useNow } from "../hooks/useMarketFeed";
import { useLiveOracle } from "../hooks/useLiveOracle";
import { useLoopVaultSession } from "../hooks/useLoopVaultSession";
import { atmImpliedVol, fmtPct, fmtUsd } from "../lib/market";
import { decodeCopy, type CopyPayload } from "../lib/copyTrade";
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
  const [copy, setCopy] = useState<CopyPayload | null>(null);

  const demoSnap = useMarketFeed(!frozen);
  const liveOracle = useLiveOracle(source === "live");
  const snap = source === "live" && liveOracle.snapshot ? liveOracle.snapshot : demoSnap;
  const onLive = source === "live" && !!liveOracle.snapshot;

  const session = useLoopVaultSession();
  const now = useNow(250);
  const age = oracleAge(snap.oracleTsMs, now, snap.sviTsMs);
  const atmIv = atmImpliedVol(snap);
  const pending = unresolvedIds(CFG).length;
  const expMin = Math.max(0, Math.round((snap.expiryMs - snap.oracleTsMs) / 60_000));

  // Copy-trade deep link: ?copy=<encoded> pre-fills the side and shows a banner.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const c = new URLSearchParams(window.location.search).get("copy");
    if (c) setCopy(decodeCopy(c));
  }, []);

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="mark" />
          <div>
            LoopVault <small>one-tap hedged Predict</small>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span className="pill">
            <span className={`dot ${pending ? "warn" : ""}`} />
            {NETWORK}
          </span>
          {session.status === "ready" && <StreakChip streakId={session.streakId} />}
          <AuthControls />
        </div>
      </header>

      <section className="hero">
        <h1>
          Trade BTC volatility in one tap. <span className="hl">Land fully hedged, or not at all.</span>
        </h1>
        <p>
          40,000+ joined the DeepBook Predict waitlist with no usable way to trade. LoopVault opens a Predict
          position <i>and</i> delta-hedges it on Spot in a single signature — sealed by a SafeMint hot-potato that
          re-derives the realized cost and oracle freshness <i>on-chain</i> and rolls the whole trade back unless it
          lands inside a fresh-oracle window, within your max-loss cap. No seed phrase, gasless, ~6 seconds.
        </p>
      </section>

      {copy && (
        <div className="regime" style={{ borderColor: "var(--accent)" }}>
          <span className="tag">COPY TRADE</span>
          <p>
            You followed a shared <b>{copy.isUp ? "CALL" : "PUT"}</b> on BTC. Connect, switch to the live surface, and
            tap Open to take the same hedged side in two taps.
          </p>
        </div>
      )}

      <RegimeBanner snap={snap} />

      <div className="grid" style={{ marginTop: 16 }}>
        {/* ---- left: the live Block Scholes surface + oracle freshness gate ---- */}
        <div className="panel">
          <div className="panel-title">
            <span>{onLive ? "Live testnet surface · BTC" : "Block Scholes vol surface · BTC"}</span>
            <OracleCountdown oracleTsMs={snap.oracleTsMs} nowMs={now} sviTsMs={snap.sviTsMs} />
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
            <button className="tab" data-active={source === "demo"} aria-pressed={source === "demo"} onClick={() => setSource("demo")} style={{ flex: 1 }}>
              Demo surface
            </button>
            <button className="tab" data-active={source === "live"} aria-pressed={source === "live"} onClick={() => setSource("live")} style={{ flex: 1 }}>
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
                  Oracle frozen — watch the age cross 20s and Open lock itself. The SafeMint seal re-asserts this exact
                  deadline on-chain, so a stale-oracle trade can’t land.
                </p>
              )}
            </>
          ) : (
            <p style={{ fontSize: 12.5, margin: "10px 2px 0", color: onLive ? "var(--text-dim)" : "var(--warn)" }}>
              {liveOracle.status === "ok" && liveOracle.snapshot
                ? `● Real on-chain oracle ${short(liveOracle.snapshot.oracleId)} — decoded live from ${NETWORK}. The Open submits against this exact oracle.`
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
              <button className="tab" data-active={tab === "trade"} aria-pressed={tab === "trade"} onClick={() => setTab("trade")}>
                Trade
              </button>
              <button className="tab" data-active={tab === "earn"} aria-pressed={tab === "earn"} onClick={() => setTab("earn")}>
                Earn
              </button>
            </div>

            {tab === "trade" ? (
              <TradePanel snap={snap} gateOpen={age.gateOpen} atmIv={atmIv} session={session} onOpen={setPos} initialIsUp={copy?.isUp} />
            ) : (
              <EarnPanel />
            )}
          </div>

          <ShareCardPreview pos={pos} snap={snap} />
        </div>
      </div>

      <footer className="foot">
        <span>Atomic Open: deposit → mint → Spot hedge → SafeMint::consume, all-or-nothing.</span>
        <span>{onLive ? "Live surface: real on-chain OracleSVI, decoded client-side." : "Demo surface; switch to Live testnet to submit."}</span>
        <span>DeepBook Predict · Block Scholes SVI oracle · Sui.</span>
        <span>Not financial advice.</span>
      </footer>
    </main>
  );
}

/** Tiny streak display — reads the user's Streak object's consecutive_days. */
function StreakChip({ streakId }: { streakId?: string }) {
  const client = useSuiClient();
  const [days, setDays] = useState<number | null>(null);

  useEffect(() => {
    if (!streakId) return;
    let cancelled = false;
    client
      .getObject({ id: streakId, options: { showContent: true } })
      .then((o) => {
        const f = (o.data?.content as { fields?: { consecutive_days?: string | number } } | undefined)?.fields;
        if (!cancelled && f) setDays(Number(f.consecutive_days ?? 0));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [streakId, client]);

  if (days === null) return null;
  return (
    <span className="pill" title="Consecutive trading days">
      🔥 <span className="mono">{days}d</span>
    </span>
  );
}
