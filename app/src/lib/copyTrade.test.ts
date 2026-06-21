import { describe, it, expect } from "vitest";
import { encodeCopy, decodeCopy, type CopyPayload } from "./copyTrade";

describe("copyTrade codec", () => {
  it("round-trips a payload exactly", () => {
    const p: CopyPayload = {
      oracleId: "0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a",
      expiryMs: 1_736_002_700_000,
      strike: 64_000_000_000_000, // $64,000 * 1e9
      isUp: true,
      direction: 0,
    };
    const token = encodeCopy(p);
    // URL-safe: no +, /, or = so it survives a query string untouched.
    expect(token).not.toMatch(/[+/=]/);
    expect(decodeCopy(token)).toEqual(p);
  });

  it("round-trips a realistic put/straddle payload", () => {
    const p: CopyPayload = {
      oracleId: "0xabc123",
      expiryMs: 1_736_000_000_000,
      strike: 1_500_000_000, // $1.5 * 1e9 — strikes are always non-negative
      isUp: false,
      direction: 2, // straddle
    };
    expect(decodeCopy(encodeCopy(p))).toEqual(p);
  });

  it("returns null for garbage input", () => {
    expect(decodeCopy("!!!not base64!!!")).toBeNull();
    expect(decodeCopy("eyJub3QiOiJhIHBheWxvYWQifQ")).toBeNull(); // valid b64 JSON, wrong shape
  });

  it("returns null for the empty string", () => {
    expect(decodeCopy("")).toBeNull();
  });
});
