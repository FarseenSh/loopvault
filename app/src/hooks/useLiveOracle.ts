"use client";

import { useEffect, useRef, useState } from "react";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { NETWORK } from "../config/loopvault.config";
import { fetchBtcOracleSnapshot } from "../lib/liveOracle";
import type { MarketSnapshot } from "../lib/market";

export type LiveStatus = "idle" | "loading" | "ok" | "empty" | "error";

export interface LiveOracleState {
  snapshot: MarketSnapshot | null;
  status: LiveStatus;
  error?: string;
  lastFetchMs: number | null;
}

const RPC_URL = getJsonRpcFullnodeUrl(NETWORK === "mainnet" ? "mainnet" : "testnet");
const IDLE: LiveOracleState = { snapshot: null, status: "idle", lastFetchMs: null };

/**
 * Polls the live BTC OracleSVI on the configured network and returns the decoded
 * surface. Fully guarded: a throw -> "error", a missing oracle -> "empty"; in both
 * cases the caller keeps the previous/demo snapshot, so the UI never breaks. Stale
 * in-flight requests are ignored (monotonic request id), and polling stops on
 * disable/unmount. `status === "ok"` means `snapshot` is a real on-chain surface.
 */
export function useLiveOracle(enabled: boolean, periodMs = 6000): LiveOracleState {
  const [state, setState] = useState<LiveOracleState>(IDLE);
  const reqId = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setState((s) => (s.status === "idle" ? s : IDLE));
      return;
    }
    let cancelled = false;

    const run = () => {
      const id = ++reqId.current;
      setState((s) => (s.snapshot ? s : { ...s, status: "loading" }));
      fetchBtcOracleSnapshot(RPC_URL, Date.now())
        .then((snap) => {
          if (cancelled || id !== reqId.current) return;
          setState({ snapshot: snap, status: snap ? "ok" : "empty", lastFetchMs: Date.now() });
        })
        .catch((e: unknown) => {
          if (cancelled || id !== reqId.current) return;
          setState((s) => ({
            snapshot: s.snapshot,
            status: "error",
            error: e instanceof Error ? e.message : String(e),
            lastFetchMs: Date.now(),
          }));
        });
    };

    run();
    const iv = setInterval(run, periodMs);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [enabled, periodMs]);

  return state;
}
