"use client";

import { useEffect, useRef, useState } from "react";
import { binaryUpPrice } from "../lib/delta";
import { atmImpliedVol, classifyRegime, type MarketSnapshot } from "../lib/market";

/**
 * Vol-regime one-liner. Prefers a real LLM read of the live surface via /api/regime
 * (Claude), and falls back to the deterministic rule-based line when the route is
 * unconfigured (HTTP 503) or errors. The tag is honest: "AI" only when the line
 * actually came from the model, else "SURFACE".
 */
export function RegimeBanner({ snap }: { snap: MarketSnapshot }) {
  const rule = classifyRegime(snap);
  const [ai, setAi] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const snapRef = useRef(snap);
  snapRef.current = snap;

  useEffect(() => {
    if (!enabled) return;
    const s = snapRef.current;
    const body = {
      atmIv: atmImpliedVol(s),
      rho: s.svi.rho,
      forward: s.forward,
      expiryMins: Math.max(1, Math.round((s.expiryMs - s.oracleTsMs) / 60_000)),
      pUp2: binaryUpPrice(s.forward, s.forward * 1.02, s.svi),
    };
    let cancelled = false;
    fetch("/api/regime", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(async (r) => {
        if (!r.ok) {
          if (r.status === 503) setEnabled(false); // not configured — stop trying
          throw new Error(String(r.status));
        }
        return r.json();
      })
      .then((d) => {
        if (!cancelled && typeof d?.line === "string") setAi(d.line);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Refetch only when the regime tone shifts, not on every price tick.
  }, [rule.tone, enabled]);

  return (
    <div className="regime">
      <span className="tag">{ai ? "AI" : "SURFACE"} · {rule.label}</span>
      <p>{ai ?? rule.line}</p>
    </div>
  );
}
