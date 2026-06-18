"use client";

import { classifyRegime, type MarketSnapshot } from "../lib/market";

/** AI vol-regime one-liner derived from the live SVI surface (rule-based; LLM TODO). */
export function RegimeBanner({ snap }: { snap: MarketSnapshot }) {
  const r = classifyRegime(snap);
  return (
    <div className="regime">
      <span className="tag">AI · {r.label}</span>
      <p>{r.line}</p>
    </div>
  );
}
