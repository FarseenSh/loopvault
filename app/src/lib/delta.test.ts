import { describe, expect, it } from "vitest";
import { decodeSvi, sviTotalVariance, type SviParams } from "./svi";
import {
  binaryDownForwardDelta,
  binaryUpForwardDelta,
  binaryUpPrice,
  binaryDownPrice,
  hedgeForPosition,
} from "./delta";
import { normCdf, normPdf } from "./normal";

const SC = 1_000_000_000;
const scaled = (x: number) => Math.round(x * SC);
const i64 = (x: number) => ({ magnitude: Math.abs(scaled(x)), is_negative: x < 0 });

// A flat surface (b=0 ⇒ w=a) and a skewed smile (b>0, rho<0 — puts richer).
const FLAT: SviParams = { a: 0.01, b: 0, rho: 0, m: 0, sigma: 0.1 };
const SKEW: SviParams = { a: 0.04, b: 0.1, rho: -0.3, m: 0.0, sigma: 0.2 };

describe("SVI decode (signed i64 params)", () => {
  it("decodes magnitude + sign and divides FLOAT_SCALING", () => {
    const p = decodeSvi({
      a: scaled(0.04),
      b: scaled(0.1),
      rho: i64(-0.3), // negative skew must survive
      m: i64(0.05),
      sigma: scaled(0.2),
    });
    expect(p.a).toBeCloseTo(0.04, 9);
    expect(p.b).toBeCloseTo(0.1, 9);
    expect(p.rho).toBeCloseTo(-0.3, 9); // sign preserved
    expect(p.m).toBeCloseTo(0.05, 9);
    expect(p.sigma).toBeCloseTo(0.2, 9);
  });
});

describe("binary digital price (matches on-chain compute_nd2)", () => {
  it("ATM flat surface ≈ N(-sqrt(w)/2)", () => {
    // F=K ⇒ k=0; w=a=0.01 ⇒ d2 = -sqrt(0.01)/2 = -0.05 ⇒ N(-0.05).
    const price = binaryUpPrice(100, 100, FLAT);
    expect(price).toBeCloseTo(normCdf(-0.05), 9);
    expect(price).toBeCloseTo(0.480_06, 4);
  });

  it("is monotonically decreasing in strike", () => {
    const lo = binaryUpPrice(100, 90, SKEW);
    const mid = binaryUpPrice(100, 100, SKEW);
    const hi = binaryUpPrice(100, 110, SKEW);
    expect(lo).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(hi);
  });

  it("UP + DOWN = 1 (binary parity)", () => {
    expect(binaryUpPrice(100, 103, SKEW) + binaryDownPrice(100, 103, SKEW)).toBeCloseTo(1, 12);
  });
});

describe("forward delta == numerical derivative of the price (the rigor proof)", () => {
  const fd = (F: number, K: number, p: SviParams, h = 1e-3) =>
    (binaryUpPrice(F + h, K, p) - binaryUpPrice(F - h, K, p)) / (2 * h);

  it("matches finite-difference on a FLAT surface", () => {
    for (const K of [90, 100, 110]) {
      const analytic = binaryUpForwardDelta(100, K, FLAT);
      expect(analytic).toBeCloseTo(fd(100, K, FLAT), 6);
    }
  });

  it("matches finite-difference on a SKEWED smile (incl. dw/dk term)", () => {
    for (const K of [85, 95, 100, 105, 115]) {
      const analytic = binaryUpForwardDelta(100, K, SKEW);
      const numeric = fd(100, K, SKEW);
      expect(analytic).toBeCloseTo(numeric, 6);
    }
  });

  it("the smile-slope term is load-bearing (a naive flat-w delta would be WRONG)", () => {
    // Naive delta drops dw/dk: dd2/dk = -1/sqrt(w).
    const F = 100, K = 110;
    const k = Math.log(K / F);
    const w = sviTotalVariance(SKEW, k);
    const d2 = -((k + w / 2) / Math.sqrt(w));
    const naive = normPdf(d2) * (-1 / Math.sqrt(w)) * (-1 / F);
    const numeric = fd(F, K, SKEW);
    const correct = binaryUpForwardDelta(F, K, SKEW);
    expect(correct).toBeCloseTo(numeric, 6); // ours is right
    expect(Math.abs(naive - numeric)).toBeGreaterThan(1e-4); // naive is measurably wrong
  });

  it("UP delta is positive; DOWN delta is its negation", () => {
    const up = binaryUpForwardDelta(100, 100, SKEW);
    expect(up).toBeGreaterThan(0);
    expect(binaryDownForwardDelta(100, 100, SKEW)).toBeCloseTo(-up, 12);
  });
});

describe("hedge plan", () => {
  it("UP position sells base, DOWN buys base, notional = |Δ|·F", () => {
    const up = hedgeForPosition(100, 100, SKEW, 1_000_000, "up");
    expect(up.side).toBe("sell_base");
    expect(up.hedgeQuoteNotional).toBeCloseTo(up.hedgeBaseUnits * 100, 9);

    const down = hedgeForPosition(100, 100, SKEW, 1_000_000, "down");
    expect(down.side).toBe("buy_base");
    expect(down.positionDelta).toBeCloseTo(-up.positionDelta, 9);
  });
});

describe("cross-language golden vector (TS ↔ on-chain compute_price)", () => {
  it("ATM UP digital matches the Move test's pinned on-chain band", () => {
    // Same params the Move test pins (contracts/predict-tests:
    // test_compute_price_golden_atm_digital): a=0.01, b=0, rho=0, m=0, sigma=0.1;
    // F=K=100 ⇒ on-chain oracle::compute_price ∈ [0.480011, 0.480111] (×1e9).
    const p: SviParams = { a: 0.01, b: 0, rho: 0, m: 0, sigma: 0.1 };
    const up = binaryUpPrice(100, 100, p);
    expect(up).toBeGreaterThan(0.480011);
    expect(up).toBeLessThan(0.480111);
    // analytic N(-0.05) = 0.4800612 — TS reproduces the on-chain digital to <1e-4.
    expect(Math.abs(up - 0.4800612)).toBeLessThan(1e-4);
  });
});
