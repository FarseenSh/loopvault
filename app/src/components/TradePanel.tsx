"use client";

import { useMemo, useState } from "react";
import { useSuiClientQuery } from "@mysten/dapp-kit";
import { hedgeForPosition } from "../lib/delta";
import { useTxSubmit } from "../hooks/useTxSubmit";
import { classifyTxError } from "../lib/errors";
import { fmtNum, fmtPct, fmtUsd, type MarketSnapshot } from "../lib/market";
import { buildOpenPositionPTB, type HedgeLeg } from "../ptb/buildOpenPositionPTB";
import { CFG } from "../config/loopvault.config";
import { FRESHNESS_DEADLINE_MS } from "./OracleCountdown";
import type { LoopVaultSession } from "../hooks/useLoopVaultSession";

export interface OpenResult {
  isUp: boolean;
  strike: number;
  cost: number;
  qtyUsd: number;
  capital: number;
  entryIv: number;
  hedgeSide: string;
  hedgeNotional: number;
  hedgeBaseUnits: number;
  forwardEntry: number;
  expiryMs: number;
  commands: number;
  digest?: string;
  oracleId?: string;
  direction: number;
}

const HEDGE_SLIPPAGE = 0.01; // 1% min-out guard on the Spot hedge leg
const usd6 = (x: number) => BigInt(Math.max(0, Math.round(x * 1e6)));
const fs9 = (x: number) => BigInt(Math.max(0, Math.round(x * 1e9)));
const scale = (x: number, decimals: number) => BigInt(Math.max(0, Math.round(x * 10 ** decimals)));

type Toast = { tone: "ok" | "warn" | "err" | "info"; title: string; detail: string } | null;

export function TradePanel({
  snap,
  gateOpen,
  atmIv,
  session,
  onOpen,
  initialIsUp,
}: {
  snap: MarketSnapshot;
  gateOpen: boolean;
  atmIv: number;
  session: LoopVaultSession;
  onOpen: (r: OpenResult) => void;
  initialIsUp?: boolean;
}) {
  const [isUp, setIsUp] = useState(initialIsUp ?? true);
  const [contracts, setContracts] = useState(10); // each digital pays $1 if ITM
  const [stake, setStake] = useState(50); // DUSDC committed (deposit) == max-loss denominator
  const [maxLossBps, setMaxLossBps] = useState(1500);
  const [hedgeOn, setHedgeOn] = useState(false); // testnet: DUSDC != DBUSDC, so default off
  const submit = useTxSubmit();
  const [isPending, setIsPending] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  const account = !!session.address;
  const liveOracle = !!snap.oracleId; // a real on-chain OracleSVI to submit against

  // Live DUSDC wallet balance (the capital available to stake).
  const { data: balData } = useSuiClientQuery(
    "getBalance",
    { owner: session.address ?? "", coinType: CFG.dusdcType },
    { enabled: !!session.address, refetchInterval: 5000 },
  );
  const dusdcBal = balData ? Number(balData.totalBalance) / 10 ** CFG.dusdcDecimals : null;

  const c = useMemo(() => {
    const strike = snap.forward; // ATM open
    const plan = hedgeForPosition(snap.forward, strike, snap.svi, contracts, isUp ? "up" : "down");
    const cost = plan.price * contracts;
    const sizeBps = (cost / Math.max(stake, 1e-9)) * 10_000;
    return { strike, plan, cost, sizeBps, withinCap: sizeBps <= maxLossBps, affordable: cost <= stake };
  }, [snap, contracts, stake, isUp, maxLossBps]);

  function buildTx() {
    const plan = c.plan;
    const hedge: HedgeLeg = !hedgeOn
      ? { side: "none" }
      : plan.side === "buy_base"
        ? {
            side: "buy_base",
            quoteIn: scale(plan.hedgeQuoteNotional, CFG.hedgeQuoteDecimals),
            minBaseOut: scale(plan.hedgeBaseUnits * (1 - HEDGE_SLIPPAGE), CFG.hedgeBaseDecimals),
          }
        : plan.side === "sell_base"
          ? {
              side: "sell_base",
              baseIn: scale(plan.hedgeBaseUnits, CFG.hedgeBaseDecimals),
              minQuoteOut: scale(plan.hedgeQuoteNotional * (1 - HEDGE_SLIPPAGE), CFG.hedgeQuoteDecimals),
            }
          : { side: "none" };

    return buildOpenPositionPTB({
      managerId: session.managerId ?? "0x0",
      oracleId: snap.oracleId ?? CFG.oracleSviId,
      isUp,
      strike: fs9(c.strike),
      expiryMs: BigInt(snap.expiryMs),
      quantity: usd6(contracts),
      capital: usd6(stake),
      maxLossBps: BigInt(maxLossBps),
      oracleFreshnessDeadlineMs: BigInt(FRESHNESS_DEADLINE_MS),
      hedge,
      direction: isUp ? 0 : 1,
      entryIvBps: BigInt(Math.round(atmIv * 10_000)),
      streakId: session.streakId,
      recipient: session.address ?? "0x0",
    });
  }

  function emitResult(commands: number, digest?: string) {
    onOpen({
      isUp,
      strike: c.strike,
      cost: c.cost,
      qtyUsd: contracts,
      capital: stake,
      entryIv: atmIv,
      hedgeSide: hedgeOn ? c.plan.side : "none",
      hedgeNotional: c.plan.hedgeQuoteNotional,
      hedgeBaseUnits: c.plan.hedgeBaseUnits,
      forwardEntry: snap.forward,
      expiryMs: snap.expiryMs,
      commands,
      digest,
      oracleId: snap.oracleId,
      direction: isUp ? 0 : 1,
    });
  }

  async function onTap() {
    const tx = buildTx();
    const commands = (tx.getData() as { commands: unknown[] }).commands.length;

    // Submit live only against a REAL on-chain oracle + a ready session.
    if (account && session.status === "ready" && liveOracle) {
      setToast({ tone: "info", title: "Opening…", detail: "Sign once — gasless, deposit → mint → seal, atomic." });
      setIsPending(true);
      try {
        const res = await submit(tx);
        setToast({ tone: "ok", title: "Opened — fully sealed on-chain", detail: `Digest ${res.digest.slice(0, 10)}… · SafeMint consumed.` });
        emitResult(commands, res.digest);
        return;
      } catch (e) {
        const info = classifyTxError(e);
        setToast({ tone: info.kind === "seal" ? "ok" : "err", title: info.title, detail: info.detail });
        emitResult(commands);
        return;
      } finally {
        setIsPending(false);
      }
    }

    // Not submittable yet — explain precisely why, and still show the real PTB shape.
    const why = !account
      ? "Connect or continue with Google to trade."
      : session.status !== "ready"
        ? "Finish creating your account above."
        : "Switch the surface to Live testnet to submit against the real oracle.";
    setToast({ tone: "info", title: `Atomic Open PTB built — ${commands} commands`, detail: `safe_mint::new → deposit → mint → ${hedgeOn ? "Spot hedge → " : ""}ShareCard → safe_mint::consume. ${why}` });
    emitResult(commands);
  }

  const onboarding = session.status === "onboarding";
  const needsOnboarding = session.status === "needs-onboarding";
  const overCap = !c.withinCap || !c.affordable;
  const canTap = !isPending && !onboarding && contracts > 0 && stake > 0 && (gateOpen || !liveOracle);

  const buttonLabel = isPending
    ? "Sealing your trade…"
    : !gateOpen && liveOracle
      ? "Oracle stale — Open locked"
      : overCap
        ? `Over cap — Open anyway, watch the seal reject`
        : `Open ${isUp ? "Call" : "Put"} · one tap${hedgeOn ? ", hedged" : ""}`;

  return (
    <div>
      {needsOnboarding && (
        <button className="btn btn-primary" style={{ marginBottom: 12 }} disabled={onboarding} onClick={() => session.onboard()}>
          {onboarding ? "Creating your account…" : "Create your account — 1 gasless tx"}
        </button>
      )}

      <div className="seg" style={{ marginBottom: 6 }}>
        <button className={`btn ${isUp ? "btn-up" : ""}`} aria-pressed={isUp} onClick={() => setIsUp(true)}>
          ▲ Buy Call
        </button>
        <button className={`btn ${!isUp ? "btn-down" : ""}`} aria-pressed={!isUp} onClick={() => setIsUp(false)}>
          ▼ Buy Put
        </button>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
            <label className="field" htmlFor="lv-stake">Stake / capital (DUSDC)</label>
            {dusdcBal != null && (
              <span style={{ fontSize: 11, color: "var(--text-faint)", whiteSpace: "nowrap" }}>
                bal {fmtNum(dusdcBal, 2)}{" "}
                <button type="button" className="linkbtn" onClick={() => setStake(Math.max(1, Math.floor(dusdcBal)))}>
                  max
                </button>
              </span>
            )}
          </div>
          <input id="lv-stake" className="num" type="number" min={1} value={stake} onChange={(e) => setStake(Math.max(0, Number(e.target.value)))} />
          {dusdcBal != null && stake > dusdcBal && (
            <div style={{ fontSize: 11, color: "var(--down)", marginTop: 3 }}>
              Exceeds wallet balance ({fmtNum(dusdcBal, 2)} DUSDC) — tap “max”.
            </div>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <label className="field" htmlFor="lv-size">Contracts (×$1)</label>
          <input id="lv-size" className="num" type="number" min={1} value={contracts} onChange={(e) => setContracts(Math.max(0, Number(e.target.value)))} />
        </div>
      </div>

      <label className="field" htmlFor="lv-cap" style={{ marginTop: 8 }}>
        Max loss cap — {maxLossBps} bps ({fmtPct(maxLossBps / 10_000, 1)} of {fmtUsd(stake)} stake)
      </label>
      <input id="lv-cap" type="range" min={50} max={5000} step={50} value={maxLossBps} aria-valuetext={`${maxLossBps} basis points`} onChange={(e) => setMaxLossBps(Number(e.target.value))} />

      <label className="checkrow" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 13, color: "var(--text-dim)" }}>
        <input type="checkbox" checked={hedgeOn} onChange={(e) => setHedgeOn(e.target.checked)} />
        Atomic Spot delta-hedge {hedgeOn ? "on" : "off"} <span style={{ color: "var(--text-faint)" }}>(testnet needs DBUSDC; one USDC funds both on mainnet)</span>
      </label>

      <div style={{ marginTop: 12 }}>
        <Row k="Strike (ATM)" v={fmtUsd(c.strike)} />
        <Row k="Premium / cost" v={fmtUsd(c.cost, 2)} />
        <Row
          k="SVI delta (per contract)"
          v={fmtNum(c.plan.positionDelta / Math.max(contracts, 1e-9), 4)}
          cls={isUp ? "v-up" : "v-down"}
        />
        <Row
          k="Spot hedge"
          v={!hedgeOn || c.plan.side === "none" ? "—" : `${c.plan.side === "buy_base" ? "buy" : "sell"} ${fmtNum(c.plan.hedgeBaseUnits, 5)} BTC ≈ ${fmtUsd(c.plan.hedgeQuoteNotional, 2)}`}
        />
        <Row k="Size vs cap" v={`${fmtNum(c.sizeBps, 0)} / ${maxLossBps} bps`} cls={c.withinCap ? "v-up" : "v-down"} />
      </div>

      <button className={`btn btn-primary ${isUp ? "" : "is-down"}`} style={{ marginTop: 14 }} disabled={!canTap} onClick={onTap}>
        {buttonLabel}
      </button>

      {toast && (
        <div className={`toast toast-${toast.tone}`} role="status" aria-live="polite">
          <b>{toast.title}</b>
          <div style={{ marginTop: 3, color: "var(--text-dim)", fontWeight: 400 }}>{toast.detail}</div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return (
    <div className="row">
      <span className="k">{k}</span>
      <span className={`v ${cls ?? ""}`}>{v}</span>
    </div>
  );
}
