// Live oracle ingestion — turns a real deepbook_predict OracleSVI (object or event)
// into a MarketSnapshot, so the terminal renders the ACTUAL Block Scholes surface
// from testnet, not just our faithful demo synthesis. Read-only RPC; no gas, no DUSDC.
//
// Empirically verified (2026-06-19) against live testnet object
// 0x2942b4efb9c32960276bb1d2eb8f6e74954b899bb4384867c55b22ff15714c75 (underlying
// "BTC"): prices.{spot,forward} are FLOAT_SCALING (1e9) fixed-point USD; `expiry`
// and `timestamp` are raw epoch-ms; rho/m are signed i64::I64. The pricing math is
// verified against oracle.move:397-428 — see the svi-encoding-verified note.

import { CFG, type LoopVaultConfig } from "../config/loopvault.config";
import { decodeU64Scaled, type I64 } from "./i64";
import { decodeSvi, type SviParams } from "./svi";
import type { MarketSnapshot } from "./market";

const YEAR_MS = 365 * 24 * 60 * 60_000;

export interface RawOracleSviFields {
  a: string | number;
  b: string | number;
  rho: I64;
  m: I64;
  sigma: string | number;
}

/** The `content.fields` of an OracleSVI object (after MoveStruct unwrapping). */
export interface RawOracleObject {
  underlying_asset: string;
  expiry: string | number;
  active: boolean;
  timestamp: string | number;
  prices: { spot: string | number; forward: string | number };
  svi: RawOracleSviFields;
}

/** Decode the SVI block (also works on an OracleSVIUpdated event's parsedJson). */
export function decodeOracleSvi(svi: RawOracleSviFields): SviParams {
  return decodeSvi({ a: svi.a, b: svi.b, rho: svi.rho, m: svi.m, sigma: svi.sigma });
}

/**
 * Recursively unwrap Sui JSON-RPC MoveStruct nodes (`{ type, fields }`) into plain
 * objects, so the nested `sui_getObject` content tree and the already-flat CLI shape
 * both normalize to the same RawOracleObject. Idempotent on flat input.
 */
export function normalizeMoveFields(v: unknown): any {
  if (Array.isArray(v)) return v.map(normalizeMoveFields);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("fields" in o && "type" in o) return normalizeMoveFields(o.fields);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) out[k] = normalizeMoveFields(o[k]);
    return out;
  }
  return v;
}

/** Decode a raw OracleSVI object (flat or nested) into a MarketSnapshot. */
export function oracleToSnapshot(raw: RawOracleObject): MarketSnapshot {
  const o = normalizeMoveFields(raw) as RawOracleObject;
  const forward = decodeU64Scaled(o.prices.forward);
  const spot = decodeU64Scaled(o.prices.spot);
  const expiryMs = Number(o.expiry);
  const oracleTsMs = Number(o.timestamp);
  const tenorYears = Math.max((expiryMs - oracleTsMs) / YEAR_MS, 1 / YEAR_MS);
  return {
    underlying: o.underlying_asset,
    spot,
    forward,
    svi: decodeOracleSvi(o.svi),
    oracleTsMs,
    sviTsMs: oracleTsMs,
    expiryMs,
    tenorYears,
  };
}

async function rpc(rpcUrl: string, method: string, params: unknown[]): Promise<any> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error?.message ?? "RPC error");
  return j.result;
}

/**
 * Discover the live BTC OracleSVI on testnet and return it as a MarketSnapshot, or
 * null if none is currently published (the protocol oracle is intermittent on
 * testnet). Read-only and CORS-safe (Sui fullnodes allow browser calls).
 */
export async function fetchBtcOracleSnapshot(
  rpcUrl: string,
  nowMs: number,
  cfg: LoopVaultConfig = CFG,
): Promise<MarketSnapshot | null> {
  const eventType = `${cfg.predictPkg}::oracle::OracleSVIUpdated`;
  const ev = await rpc(rpcUrl, "suix_queryEvents", [{ MoveEventType: eventType }, null, 25, true]);
  const rawIds = ((ev?.data ?? []) as any[]).map((e) => e?.parsedJson?.oracle_id);
  const ids = [...new Set(rawIds)].filter((x): x is string => typeof x === "string");
  if (ids.length === 0) return null;

  const objs = await rpc(rpcUrl, "sui_multiGetObjects", [ids, { showContent: true }]);
  const candidates: RawOracleObject[] = (objs ?? [])
    .map((o: any) => o?.data?.content?.fields)
    .filter(Boolean)
    .map((f: any) => normalizeMoveFields(f) as RawOracleObject)
    .filter(
      (o: RawOracleObject) =>
        o.underlying_asset === "BTC" && o.active && Number(o.expiry) > nowMs,
    );
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => Number(a.expiry) - Number(b.expiry));
  return oracleToSnapshot(candidates[0]);
}
