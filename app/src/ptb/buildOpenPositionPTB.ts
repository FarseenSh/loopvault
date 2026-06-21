// The centerpiece — the single-signature atomic Open. One PTB:
//   safe_mint::new → predict_manager::deposit → market_key::new → predict::mint
//   → DeepBook Spot delta-hedge → ShareCard + Streak → safe_mint::consume
//
// The SafeMint hot-potato (CMD1) can only be destroyed by consume (last CMD), so
// any abort in between rolls back the deposit/mint/hedge — fully hedged or nothing.
//
// The seal binds to ON-CHAIN truth: `new` snapshots the manager balance + reads the
// deposit coin's real value; `consume` re-derives the realized cost from the manager
// balance delta and reads the real oracle timestamp. No client-supplied cost/ts.
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { SUI_CLOCK_OBJECT_ID } from "@mysten/sui/utils";
import { CFG, type LoopVaultConfig } from "../config/loopvault.config";

/**
 * Spot hedge leg, sized + sided by the SVI delta engine (lib/delta.ts). Amounts are
 * in the coin's NATIVE units and `minOut` already has the slippage tolerance applied
 * by the caller (which knows each coin's decimals + the live book).
 */
export type HedgeLeg =
  | { side: "buy_base"; quoteIn: bigint; minBaseOut: bigint }
  | { side: "sell_base"; baseIn: bigint; minQuoteOut: bigint }
  | { side: "none" };

export interface OpenPositionArgs {
  managerId: string; // the user's PredictManager (shared; owner == sender)
  oracleId: string; // the live OracleSVI object id (discovered at runtime)
  isUp: boolean; // call (up) vs put (down)
  strike: bigint; // FLOAT_SCALING (1e9)
  expiryMs: bigint;
  quantity: bigint; // contracts (quote units, 6dp)
  capital: bigint; // DUSDC funded this PTB == capital backing the position (6dp); the bps denominator
  maxLossBps: bigint; // e.g. 500n
  oracleFreshnessDeadlineMs: bigint; // <= 30000, e.g. 20000n
  hedge: HedgeLeg;
  // social
  direction: number; // 0 call / 1 put / 2 straddle (ShareCard)
  entryIvBps: bigint;
  streakId?: string; // the user's Streak object (touch_if_due — non-fatal); omitted if none yet
  recipient: string; // zkLogin address (receives the hedge swap outputs)
}

export function buildOpenPositionPTB(a: OpenPositionArgs, cfg: LoopVaultConfig = CFG): Transaction {
  const tx = new Transaction();
  const clock = tx.object(SUI_CLOCK_OBJECT_ID);
  const predict = tx.object(cfg.predictSharedObj);
  const manager = tx.object(a.managerId);
  const oracle = tx.object(a.oracleId);

  // CMD 1 — create the no-abilities hot-potato. It reads the deposit coin's REAL
  // value and the manager's pre-balance ON-CHAIN (the size-cap denominator), then
  // hands the same coin back so we thread it straight into deposit.
  const depositCoin = coinWithBalance({ balance: a.capital, type: cfg.dusdcType });
  const [safe, coin] = tx.moveCall({
    target: `${cfg.loopvaultPkg}::safe_mint::new`,
    typeArguments: [cfg.dusdcType],
    arguments: [
      tx.pure.u64(a.maxLossBps),
      depositCoin,
      manager,
      tx.pure.u64(a.oracleFreshnessDeadlineMs),
      clock,
    ],
  });

  // CMD 2 — fund the manager's internal balance (sender == owner).
  tx.moveCall({
    target: `${cfg.predictPkg}::predict_manager::deposit`,
    typeArguments: [cfg.dusdcType],
    arguments: [manager, coin],
  });

  // CMD 3 — build the MarketKey, then OPEN the position (assert_live_oracle on-chain).
  const key = tx.moveCall({
    target: `${cfg.predictPkg}::market_key::new`,
    arguments: [tx.pure.id(a.oracleId), tx.pure.u64(a.expiryMs), tx.pure.u64(a.strike), tx.pure.bool(a.isUp)],
  });
  tx.moveCall({
    target: `${cfg.predictPkg}::predict::mint`,
    typeArguments: [cfg.dusdcType],
    arguments: [predict, manager, oracle, key, tx.pure.u64(a.quantity), clock],
  });

  // CMD 4 — DeepBook Spot delta-hedge (size + side from lib/delta.ts, native units,
  // slippage already applied). zero-DEEP pool ⇒ pass a fresh zero Coin<DEEP> as fee.
  if (a.hedge.side !== "none") {
    const pool = tx.object(cfg.spotPoolId);
    const deepIn = tx.moveCall({ target: `0x2::coin::zero`, typeArguments: [cfg.deepType] });
    const hedge = a.hedge;
    const swap =
      hedge.side === "buy_base"
        ? tx.moveCall({
            target: `${cfg.deepbookPkg}::pool::swap_exact_quote_for_base`,
            typeArguments: [cfg.hedgeBaseType, cfg.hedgeQuoteType],
            arguments: [
              pool,
              coinWithBalance({ balance: hedge.quoteIn, type: cfg.hedgeQuoteType }),
              deepIn,
              tx.pure.u64(hedge.minBaseOut),
              clock,
            ],
          })
        : tx.moveCall({
            target: `${cfg.deepbookPkg}::pool::swap_exact_base_for_quote`,
            typeArguments: [cfg.hedgeBaseType, cfg.hedgeQuoteType],
            arguments: [
              pool,
              coinWithBalance({ balance: hedge.baseIn, type: cfg.hedgeBaseType }),
              deepIn,
              tx.pure.u64(hedge.minQuoteOut),
              clock,
            ],
          });
    // (Coin<Base>, Coin<Quote>, Coin<DEEP>) — return all three to the user.
    tx.transferObjects([swap[0], swap[1], swap[2]], tx.pure.address(a.recipient));
  }

  // CMD 5 — social: ShareCard NFT (provenance-checked: caller must own the manager
  // AND hold this position; transfers to the caller) + non-fatal streak increment.
  tx.moveCall({
    target: `${cfg.loopvaultPkg}::share_card::mint_to`,
    arguments: [
      manager,
      tx.pure.id(a.oracleId),
      tx.pure.u64(a.expiryMs),
      tx.pure.u64(a.strike),
      tx.pure.bool(a.isUp),
      tx.pure.u8(a.direction),
      tx.pure.u64(a.entryIvBps),
      clock,
    ],
  });
  if (a.streakId) {
    tx.moveCall({
      target: `${cfg.loopvaultPkg}::streak::touch_if_due`,
      arguments: [tx.object(a.streakId), clock],
    });
  }

  // CMD 6 — CONSUME the hot-potato; re-derive cost from the manager balance delta +
  // read the real oracle timestamp, re-assert freshness + size. Any violation aborts
  // the whole PTB ⇒ the deposit rolls back.
  tx.moveCall({
    target: `${cfg.loopvaultPkg}::safe_mint::consume`,
    typeArguments: [cfg.dusdcType],
    arguments: [safe, manager, oracle, clock],
  });

  return tx;
}
