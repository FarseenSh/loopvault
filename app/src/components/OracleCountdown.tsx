"use client";

// Live oracle-freshness gate. Two distinct clocks, surfaced honestly:
//   • PRICE feed (OraclePricesUpdated, ~1s) → oracle.timestamp on-chain. This is the
//     ONLY freshness the protocol (and our SafeMint seal) can enforce, so it drives
//     the hard Open gate at our TIGHTER 20s deadline (< the 30s protocol guard).
//   • SVI surface (OracleSVIUpdated, ~10–20s) → the smile your delta is priced from.
//     Not stored on-chain (update_svi doesn't bump the timestamp), so it can't be
//     sealed — we DISPLAY its age so you always know how fresh the surface is.

export const FRESHNESS_DEADLINE_MS = 20_000; // our gate, mirrored on-chain by SafeMint
const PROTOCOL_STALENESS_MS = 30_000; // predict's own assert_live_oracle guard
const SVI_ADVISORY_MS = 25_000; // warn (don't block) when the smile is older than this

export interface OracleAge {
  ageMs: number; // price-feed age (drives the gate)
  gateOpen: boolean;
  tone: "fresh" | "warn" | "stale";
  sviAgeMs: number; // SVI surface age (advisory)
  sviStale: boolean;
}

export function oracleAge(oracleTsMs: number, nowMs: number, sviTsMs?: number): OracleAge {
  const ageMs = Math.max(0, nowMs - oracleTsMs);
  const sviAgeMs = Math.max(0, nowMs - (sviTsMs ?? oracleTsMs));
  const tone: OracleAge["tone"] = ageMs > FRESHNESS_DEADLINE_MS ? "stale" : ageMs > 10_000 ? "warn" : "fresh";
  return { ageMs, gateOpen: ageMs <= FRESHNESS_DEADLINE_MS, tone, sviAgeMs, sviStale: sviAgeMs > SVI_ADVISORY_MS };
}

export function OracleCountdown({
  oracleTsMs,
  nowMs,
  sviTsMs,
}: {
  oracleTsMs: number;
  nowMs: number;
  sviTsMs?: number;
}) {
  const { ageMs, tone, sviAgeMs, sviStale } = oracleAge(oracleTsMs, nowMs, sviTsMs);
  const remaining = Math.max(0, FRESHNESS_DEADLINE_MS - ageMs) / 1000;
  const label = tone === "stale" ? "ORACLE STALE — Open locked" : `oracle fresh · ${remaining.toFixed(1)}s to gate`;
  return (
    <span className="pill" role="status" aria-live="polite" title="Price feed drives the on-chain seal; SVI surface age is advisory">
      <span className={`dot ${tone === "warn" ? "warn" : tone === "stale" ? "stale" : ""}`} />
      <span className="countdown">{label}</span>
      <span style={{ color: "var(--text-faint)" }}>
        price {(ageMs / 1000).toFixed(1)}s/{PROTOCOL_STALENESS_MS / 1000}s
      </span>
      <span style={{ color: sviStale ? "var(--warn)" : "var(--text-faint)" }} title="Age of the SVI smile your delta is priced from">
        · surface {(sviAgeMs / 1000).toFixed(0)}s
      </span>
    </span>
  );
}
