// Block Scholes SVI volatility surface — the same parametrization the
// deepbook_predict oracle uses on-chain. We read the REAL surface, not a proxy.
//
// Total implied variance at log-moneyness k:
//   w(k) = a + b * ( rho*(k - m) + sqrt((k - m)^2 + sigma^2) )
//
// VERIFIED line-for-line against deepbook_predict::oracle::compute_nd2
// (predict-testnet-4-16, oracle.move:397-428): k = ln(strike/forward),
// inner = rho*(k-m) + sqrt((k-m)^2 + sigma^2) [asserted >= 0],
// total_var = a + b*inner, d2 = -((k + w/2)/sqrt(w)), UP price = N(d2),
// DOWN = 1 - UP. The event encodes a,b,sigma as u64 and rho,m as the SIGNED
// i64::I64 { magnitude:u64, is_negative:bool } (i64.move:13) — decoded in ./i64.

import { decodeI64Scaled, decodeU64Scaled, type I64 } from "./i64";

/** Raw SVI params as they arrive in an `OracleSVIUpdated` event. */
export interface SviParamsRaw {
  a: string | number;
  b: string | number;
  rho: I64;
  m: I64;
  sigma: string | number;
}

/** SVI params decoded to plain floats (FLOAT_SCALING removed). */
export interface SviParams {
  a: number;
  b: number;
  rho: number;
  m: number;
  sigma: number;
}

export function decodeSvi(raw: SviParamsRaw): SviParams {
  return {
    a: decodeU64Scaled(raw.a),
    b: decodeU64Scaled(raw.b),
    rho: decodeI64Scaled(raw.rho),
    m: decodeI64Scaled(raw.m),
    sigma: decodeU64Scaled(raw.sigma),
  };
}

/** SVI total implied variance w(k). */
export function sviTotalVariance(p: SviParams, k: number): number {
  const km = k - p.m;
  return p.a + p.b * (p.rho * km + Math.sqrt(km * km + p.sigma * p.sigma));
}

/** Smile slope dw/dk = b * ( rho + (k - m)/sqrt((k - m)^2 + sigma^2) ). */
export function sviSlope(p: SviParams, k: number): number {
  const km = k - p.m;
  return p.b * (p.rho + km / Math.sqrt(km * km + p.sigma * p.sigma));
}

/** Annualized implied vol from total variance and time-to-expiry (years). */
export function impliedVol(totalVariance: number, tYears: number): number {
  if (tYears <= 0) throw new Error("time-to-expiry must be positive");
  return Math.sqrt(totalVariance / tYears);
}
