"use client";

import { useEffect, useState } from "react";
import { DEMO_T0, demoSnapshot, type MarketSnapshot } from "../lib/market";

/**
 * Live-ticking demo market feed. `live=false` freezes the oracle (for the demo's
 * "force a stale oracle" beat — age grows, the gate closes). Initial state uses a
 * fixed seed so SSR and first client render agree.
 */
export function useMarketFeed(live: boolean): MarketSnapshot {
  const [snap, setSnap] = useState<MarketSnapshot>(() => demoSnapshot(DEMO_T0));

  useEffect(() => {
    // First client paint: jump to real time.
    setSnap(demoSnapshot(Date.now()));
    if (!live) return;
    const id = setInterval(() => setSnap(demoSnapshot(Date.now())), 1000);
    return () => clearInterval(id);
  }, [live]);

  return snap;
}

/** A monotonic "now" that ticks a few times a second, for live age/countdown. */
export function useNow(periodMs = 250): number {
  const [now, setNow] = useState<number>(DEMO_T0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), periodMs);
    return () => clearInterval(id);
  }, [periodMs]);
  return now;
}
