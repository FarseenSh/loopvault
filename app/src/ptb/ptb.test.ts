import { describe, expect, it } from "vitest";
import type { Transaction } from "@mysten/sui/transactions";
import type { LoopVaultConfig } from "../config/loopvault.config";
import { buildEarnSupplyPTB } from "./buildEarnSupplyPTB";
import { buildOpenPositionPTB, type OpenPositionArgs } from "./buildOpenPositionPTB";

// Fully-resolved dummy config (valid address format) for offline structural tests.
const cfg: LoopVaultConfig = {
  network: "testnet",
  predictPkg: "0xa1",
  predictSharedObj: "0xb2",
  predictRegistry: "0xb3",
  oracleSviId: "0xc4",
  dusdcType: "0xd5::dusdc::DUSDC",
  deepbookPkg: "0xe6",
  spotPoolId: "0xf7",
  deepType: "0xa8::deep::DEEP",
  hedgeBaseType: "0xb9::wbtc::WBTC",
  hedgeQuoteType: "0xd5::dusdc::DUSDC",
  loopvaultPkg: "0xca",
  dusdcDecimals: 6,
  hedgeBaseDecimals: 8,
  hedgeQuoteDecimals: 6,
};

// Extract the ordered list of `module::function` for every MoveCall command.
function moveCallLabels(tx: Transaction): string[] {
  const data = tx.getData() as unknown as { commands: any[] };
  return data.commands
    .map((c) => {
      const mc = c?.MoveCall ?? (c?.$kind === "MoveCall" ? c.MoveCall : undefined);
      return mc ? `${mc.module}::${mc.function}` : null;
    })
    .filter((x): x is string => x !== null);
}

const openArgs: OpenPositionArgs = {
  managerId: "0x111",
  oracleId: "0xc4",
  isUp: true,
  strike: 100_000_000_000n,
  expiryMs: 87_400_000n,
  quantity: 1_000_000n,
  capital: 10_000_000n,
  maxLossBps: 500n,
  oracleFreshnessDeadlineMs: 20_000n,
  hedge: { side: "buy_base", quoteIn: 200_000n, minBaseOut: 1n },
  direction: 0,
  entryIvBps: 5_000n,
  streakId: "0x222",
  recipient: "0x333",
};

describe("buildOpenPositionPTB", () => {
  it("emits the Open sequence, sealed by SafeMint, in the right order", () => {
    const labels = moveCallLabels(buildOpenPositionPTB(openArgs, cfg));

    // The hot-potato is created first and consumed last.
    expect(labels[0]).toBe("safe_mint::new");
    expect(labels[labels.length - 1]).toBe("safe_mint::consume");

    // Core legs in causal order.
    const idx = (s: string) => labels.indexOf(s);
    expect(idx("market_key::new")).toBeGreaterThanOrEqual(0);
    expect(idx("predict_manager::deposit")).toBeGreaterThan(idx("safe_mint::new"));
    expect(idx("predict::mint")).toBeGreaterThan(idx("predict_manager::deposit"));
    expect(idx("pool::swap_exact_quote_for_base")).toBeGreaterThan(idx("predict::mint"));
    expect(idx("share_card::mint_to")).toBeGreaterThan(idx("pool::swap_exact_quote_for_base"));
    expect(idx("streak::touch_if_due")).toBeGreaterThan(idx("share_card::mint_to"));
    expect(idx("safe_mint::consume")).toBeGreaterThan(idx("streak::touch_if_due"));
  });

  it("sell_base hedge uses swap_exact_base_for_quote", () => {
    const labels = moveCallLabels(
      buildOpenPositionPTB(
        { ...openArgs, hedge: { side: "sell_base", baseIn: 100n, minQuoteOut: 1n } },
        cfg,
      ),
    );
    expect(labels).toContain("pool::swap_exact_base_for_quote");
  });

  it("hedge 'none' omits any Spot swap but still seals with SafeMint", () => {
    const labels = moveCallLabels(buildOpenPositionPTB({ ...openArgs, hedge: { side: "none" } }, cfg));
    expect(labels.some((l) => l.startsWith("pool::swap"))).toBe(false);
    expect(labels[labels.length - 1]).toBe("safe_mint::consume");
  });
});

describe("buildEarnSupplyPTB", () => {
  it("calls predict::supply with the DUSDC type", () => {
    const labels = moveCallLabels(buildEarnSupplyPTB({ amount: 100_000_000n, recipient: "0x333" }, cfg));
    expect(labels).toContain("predict::supply");
  });
});
