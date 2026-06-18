// Market feed. DEMO mode synthesizes a plausible live BTC surface so the UI is
// fully alive without the indexer / DUSDC; LIVE mode (TODO, Gate 4) subscribes to
// OracleSVIUpdated + OraclePricesUpdated and decodes via lib/svi + lib/i64.

import { binaryUpPrice } from "./delta";
import { impliedVol, sviTotalVariance, type SviParams } from "./svi";

export interface MarketSnapshot {
  underlying: string;
  spot: number;
  forward: number;
  svi: SviParams; // decoded floats
  oracleTsMs: number; // last OraclePricesUpdated (~1s) — drives freshness
  sviTsMs: number; // last OracleSVIUpdated (~10-20s)
  expiryMs: number;
  tenorYears: number;
  oracleId?: string; // set when sourced from a live on-chain OracleSVI object
}

const MIN_MS = 60_000;
const YEAR_MS = 365 * 24 * 60 * MIN_MS;

/** Fixed seed so the server and first client render agree (no hydration drift). */
export const DEMO_T0 = 1_736_000_000_000;

function wobble(t: number, periodMs: number, amp: number, phase = 0): number {
  return Math.sin((t / periodMs) * Math.PI * 2 + phase) * amp;
}

/** A deterministic, plausibly-evolving BTC surface for demo mode. */
export function demoSnapshot(nowMs: number): MarketSnapshot {
  const expiryMs = Math.ceil(nowMs / (45 * MIN_MS)) * (45 * MIN_MS); // next rolling 45-min expiry
  const tenorYears = Math.max((expiryMs - nowMs) / YEAR_MS, MIN_MS / YEAR_MS);
  const spot = 64_000 + wobble(nowMs, 90_000, 380) + wobble(nowMs, 23_000, 90, 1.7);
  const forward = spot * 1.0008;
  const atmVol = 0.6 + wobble(nowMs, 240_000, 0.12); // ~48%..72%
  const atmVar = atmVol * atmVol * tenorYears;
  const svi: SviParams = {
    a: atmVar * 0.7,
    b: atmVar * 4.0,
    rho: -0.35 + wobble(nowMs, 180_000, 0.08), // negative skew (puts richer)
    m: 0,
    sigma: 0.12,
  };
  return { underlying: "BTC", spot, forward, svi, oracleTsMs: nowMs, sviTsMs: nowMs - 4_000, expiryMs, tenorYears };
}

/** ATM (at-forward) annualized implied vol. */
export function atmImpliedVol(s: MarketSnapshot): number {
  return impliedVol(Math.max(sviTotalVariance(s.svi, 0), 1e-12), s.tenorYears);
}

export type RegimeTone = "calm" | "normal" | "elevated";
export interface Regime {
  label: string;
  tone: RegimeTone;
  line: string;
}

/** Rule-based "vol regime" one-liner derived from the live surface (LLM swap: TODO). */
export function classifyRegime(s: MarketSnapshot): Regime {
  const iv = atmImpliedVol(s);
  const pUp2 = binaryUpPrice(s.forward, s.forward * 1.02, s.svi); // P(>2% up by expiry)
  const tone: RegimeTone = iv > 0.68 ? "elevated" : iv < 0.5 ? "calm" : "normal";
  const label = tone === "elevated" ? "VOL ELEVATED" : tone === "calm" ? "VOL CALM" : "VOL NORMAL";
  const mins = Math.max(1, Math.round((s.expiryMs - s.oracleTsMs) / MIN_MS));
  const line =
    `${label} — the Block Scholes surface prices BTC at ~${(iv * 100).toFixed(0)}% annualized IV, ` +
    `a ~${(pUp2 * 100).toFixed(0)}% chance of a >2% up-move before the ${mins}-min expiry, ` +
    `with skew ${s.svi.rho < -0.25 ? "rich on puts" : "roughly balanced"}.`;
  return { label, tone, line };
}

export const fmtUsd = (x: number, dp = 0) =>
  "$" + x.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const fmtPct = (x: number, dp = 1) => (x * 100).toFixed(dp) + "%";
export const fmtNum = (x: number, dp = 2) => x.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
