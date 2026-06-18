import { describe, expect, it } from "vitest";
import {
  decodeOracleSvi,
  normalizeMoveFields,
  oracleToSnapshot,
  type RawOracleObject,
  type RawOracleSviFields,
} from "./liveOracle";
import { atmImpliedVol } from "./market";

// REAL testnet data captured 2026-06-19 from fullnode.testnet.sui.io
// (deepbook_predict pkg 0xf5ea…138) via sui_getObject / suix_queryEvents. Ground truth —
// these fixtures prove LoopVault decodes the ACTUAL Block Scholes surface, not a proxy.

const REAL_BTC_ORACLE: RawOracleObject = {
  underlying_asset: "BTC",
  expiry: "1781815500000",
  active: true,
  timestamp: "1781809195546",
  prices: { forward: "62628412388029", spot: "62627102628011" },
  svi: {
    a: "29441",
    b: "806642",
    m: { is_negative: true, magnitude: "1542906" },
    rho: { is_negative: true, magnitude: "940009780" },
    sigma: "1339163",
  },
};

// The same object as the nested Sui JSON-RPC MoveStruct shape ({ type, fields }).
const REAL_BTC_ORACLE_NESTED = {
  type: "0xf5ea::oracle::OracleSVI",
  fields: {
    underlying_asset: "BTC",
    expiry: "1781815500000",
    active: true,
    timestamp: "1781809195546",
    prices: {
      type: "0xf5ea::oracle::PriceData",
      fields: { forward: "62628412388029", spot: "62627102628011" },
    },
    svi: {
      type: "0xf5ea::oracle::SVIParams",
      fields: {
        a: "29441",
        b: "806642",
        m: { type: "0xf5ea::i64::I64", fields: { is_negative: true, magnitude: "1542906" } },
        rho: { type: "0xf5ea::i64::I64", fields: { is_negative: true, magnitude: "940009780" } },
        sigma: "1339163",
      },
    },
  },
};

// Three real OracleSVIUpdated event SVI payloads (distinct expiries on the curve).
const REAL_EVENT_SVIS: RawOracleSviFields[] = [
  { a: "28016", b: "975337", sigma: "1421379", rho: { is_negative: true, magnitude: "940011659" }, m: { is_negative: true, magnitude: "2108065" } },
  { a: "24069", b: "833026", sigma: "1460984", rho: { is_negative: true, magnitude: "940011432" }, m: { is_negative: true, magnitude: "2001461" } },
  { a: "20132", b: "690074", sigma: "1540352", rho: { is_negative: true, magnitude: "940011912" }, m: { is_negative: true, magnitude: "1876865" } },
];

describe("liveOracle — decode against real testnet data", () => {
  it("decodes a real BTC OracleSVI object into a sane snapshot", () => {
    const s = oracleToSnapshot(REAL_BTC_ORACLE);
    expect(s.underlying).toBe("BTC");
    expect(s.forward).toBeCloseTo(62628.4124, 3); // 62628412388029 / 1e9
    expect(s.spot).toBeCloseTo(62627.1026, 3);
    expect(s.expiryMs).toBe(1781815500000);
    expect(s.oracleTsMs).toBe(1781809195546);
    expect(s.svi.rho).toBeCloseTo(-0.94000978, 7); // signed: is_negative=true
    expect(s.svi.m).toBeCloseTo(-0.001542906, 7);
    expect(s.svi.a).toBeGreaterThan(0);
    expect(s.svi.b).toBeGreaterThan(0);
    expect(s.svi.sigma).toBeGreaterThan(0);
    // ~105-min BTC tenor should imply a plausible annualized IV.
    const iv = atmImpliedVol(s);
    expect(iv).toBeGreaterThan(0.2);
    expect(iv).toBeLessThan(0.7);
  });

  it("normalizes the nested JSON-RPC MoveStruct shape to the identical snapshot", () => {
    const flat = normalizeMoveFields(REAL_BTC_ORACLE_NESTED) as RawOracleObject;
    expect(flat.underlying_asset).toBe("BTC");
    expect(flat.prices.forward).toBe("62628412388029");
    const s = oracleToSnapshot(flat);
    expect(s.forward).toBeCloseTo(62628.4124, 3);
    expect(s.svi.rho).toBeCloseTo(-0.94000978, 7);
  });

  it("decodes signed rho/m from real OracleSVIUpdated events (negative skew)", () => {
    for (const raw of REAL_EVENT_SVIS) {
      const p = decodeOracleSvi(raw);
      expect(p.rho).toBeLessThan(0); // puts richer than calls
      expect(p.rho).toBeCloseTo(-0.94, 2);
      expect(p.m).toBeLessThan(0);
      expect(p.a).toBeGreaterThan(0);
      expect(p.b).toBeGreaterThan(0);
      expect(p.sigma).toBeGreaterThan(0);
    }
  });
});
