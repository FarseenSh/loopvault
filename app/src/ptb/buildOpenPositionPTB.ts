// The centerpiece — the single-signature atomic Open. One PTB:
//   safe_mint::new → predict_manager::deposit → predict::mint
//   → DeepBook Spot delta-hedge → ShareCard + Streak → safe_mint::consume
// The SafeMint hot-potato (CMD1) can only be destroyed by consume (last CMD), so
// any abort in between rolls back the deposit/mint/hedge — fully hedged or nothing.
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { SUI_CLOCK_OBJECT_ID } from "@mysten/sui/utils";
import { CFG, type LoopVaultConfig } from "../config/loopvault.config";

/** Spot hedge leg, sized + sided by the SVI delta engine (lib/delta.ts). */
export type HedgeLeg =
  | { side: "buy_base"; quoteIn: bigint; minBaseOut: bigint }
  | { side: "sell_base"; baseIn: bigint; minQuoteOut: bigint }
  | { side: "none" };

export interface OpenPositionArgs {
  managerId: string; // the user's PredictManager (owner == sender)
  isUp: boolean; // call (up) vs put (down)
  strike: bigint; // FLOAT_SCALING
  expiryMs: bigint;
  quantity: bigint; // contracts (quote units, 6dp)
  costCharged: bigint; // previewed mint cost (get_trade_amounts) — funded + asserted
  capitalBase: bigint; // risk denominator for max_loss_bps (the user's capital/budget)
  maxLossBps: bigint; // e.g. 500n
  oracleFreshnessDeadlineMs: bigint; // <= 30000, e.g. 20000n
  oracleTsMs: bigint; // timestamp of the priced OracleSVI (from the WS feed)
  hedge: HedgeLeg;
  // social
  direction: number; // 0 call / 1 put / 2 straddle (ShareCard)
  entryIvBps: bigint;
  marketKeyBytes: number[]; // encoded MarketKey for the copy-trade hot path
  streakId: string;
  recipient: string; // zkLogin address (owner)
}

export function buildOpenPositionPTB(a: OpenPositionArgs, cfg: LoopVaultConfig = CFG): Transaction {
  const tx = new Transaction();
  const clock = tx.object(SUI_CLOCK_OBJECT_ID);
  const predict = tx.object(cfg.predictSharedObj);
  const manager = tx.object(a.managerId);
  const oracle = tx.object(cfg.oracleSviId);

  // CMD 1 — create the no-abilities hot-potato. deposit_amount = capitalBase (the
  // risk denominator), NOT the per-trade cost, so max_loss_bps is meaningful.
  const safe = tx.moveCall({
    target: `${cfg.loopvaultPkg}::safe_mint::new`,
    arguments: [
      tx.pure.u64(a.maxLossBps),
      tx.pure.u64(a.capitalBase),
      tx.pure.u64(a.oracleFreshnessDeadlineMs),
      clock,
    ],
  });

  // CMD 2 — fund the manager's internal balance with the position cost.
  tx.moveCall({
    target: `${cfg.predictPkg}::predict_manager::deposit`,
    typeArguments: [cfg.dusdcType],
    arguments: [manager, coinWithBalance({ balance: a.costCharged, type: cfg.dusdcType })],
  });

  // CMD 3 — build the MarketKey, then OPEN the position (assert_live_oracle on-chain).
  const key = tx.moveCall({
    target: `${cfg.predictPkg}::market_key::new`,
    arguments: [
      tx.pure.id(cfg.oracleSviId),
      tx.pure.u64(a.expiryMs),
      tx.pure.u64(a.strike),
      tx.pure.bool(a.isUp),
    ],
  });
  tx.moveCall({
    target: `${cfg.predictPkg}::predict::mint`,
    typeArguments: [cfg.dusdcType],
    arguments: [predict, manager, oracle, key, tx.pure.u64(a.quantity), clock],
  });

  // CMD 4 — DeepBook Spot delta-hedge (size + side from lib/delta.ts). zero-DEEP
  // pool ⇒ pass a fresh zero Coin<DEEP> as the fee leg.
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

  // CMD 5 — social: ShareCard NFT + streak increment.
  tx.moveCall({
    target: `${cfg.loopvaultPkg}::share_card::mint_to`,
    arguments: [
      tx.pure.address(a.recipient),
      tx.pure.u8(a.direction),
      tx.pure.u64(a.strike),
      tx.pure.u64(a.expiryMs),
      tx.pure.u64(a.entryIvBps),
      tx.pure.vector("u8", a.marketKeyBytes),
      clock,
    ],
  });
  tx.moveCall({
    target: `${cfg.loopvaultPkg}::streak::touch`,
    arguments: [tx.object(a.streakId), clock],
  });

  // CMD 6 — CONSUME the hot-potato; re-assert freshness + size on-chain. Any
  // violation aborts the whole PTB ⇒ the deposit rolls back.
  tx.moveCall({
    target: `${cfg.loopvaultPkg}::safe_mint::consume`,
    arguments: [safe, tx.pure.u64(a.costCharged), tx.pure.u64(a.oracleTsMs), clock],
  });

  return tx;
}
