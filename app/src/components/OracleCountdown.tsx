"use client";

// Live oracle-age gate. The protocol rejects oracles older than 30s; we gray out
// Open at our TIGHTER deadline (default 20s) with a live countdown — the same
// deadline the SafeMint hot-potato re-asserts on-chain.

export const FRESHNESS_DEADLINE_MS = 20_000;
const PROTOCOL_STALENESS_MS = 30_000;

export interface OracleAge {
  ageMs: number;
  gateOpen: boolean;
  tone: "fresh" | "warn" | "stale";
}

export function oracleAge(oracleTsMs: number, nowMs: number): OracleAge {
  const ageMs = Math.max(0, nowMs - oracleTsMs);
  const tone: OracleAge["tone"] = ageMs > FRESHNESS_DEADLINE_MS ? "stale" : ageMs > 10_000 ? "warn" : "fresh";
  return { ageMs, gateOpen: ageMs <= FRESHNESS_DEADLINE_MS, tone };
}

export function OracleCountdown({ oracleTsMs, nowMs }: { oracleTsMs: number; nowMs: number }) {
  const { ageMs, tone } = oracleAge(oracleTsMs, nowMs);
  const remaining = Math.max(0, FRESHNESS_DEADLINE_MS - ageMs) / 1000;
  const label =
    tone === "stale"
      ? "ORACLE STALE — Open locked"
      : `oracle fresh · ${remaining.toFixed(1)}s to gate`;
  return (
    <span className="pill">
      <span className={`dot ${tone === "warn" ? "warn" : tone === "stale" ? "stale" : ""}`} />
      <span className="countdown">{label}</span>
      <span style={{ color: "var(--text-faint)" }}>
        age {(ageMs / 1000).toFixed(1)}s / {PROTOCOL_STALENESS_MS / 1000}s
      </span>
    </span>
  );
}
