// SPDX-License-Identifier: Apache-2.0
//
// LoopVault test fixture — copied into packages/predict/tests/ by
// scripts/run-predict-tests.sh so it compiles as part of the deepbook_predict
// package's TEST target (where public(package) + #[test_only] constructors are
// reachable). This file is LoopVault's own work; the surrounding package is the
// attributed MystenLabs/deepbookv3 dependency.
//
// `TQ` is a 6-decimal "test quote" coin. The Predict `mint`/`supply` path needs
// a `Currency<Quote>` with decimals == 6 (treasury_config::required_quote_decimals).
// We build one exactly the way DUSDC does — coin_registry::new_currency_with_otw —
// but `unwrap_for_testing` hands back the `Currency<TQ>` value directly, so tests
// don't need a shared CoinRegistry. This mirrors the shipped `plp::init_for_testing`
// one-time-witness pattern (constructing the OTW struct directly is permitted in
// test code, which is why is_one_time_witness(&TQ{}) holds).
#[test_only]
module deepbook_predict::tq;

use sui::coin_registry::{Self, Currency};

/// One-time witness. Module `tq` ⇒ OTW type `TQ` (name match is required by
/// sui::types::is_one_time_witness).
public struct TQ has drop {}

/// Build a 6-decimal `Currency<TQ>` for tests. The TreasuryCap is unused (test
/// coins come from `coin::mint_for_testing`), so it is parked on the sender.
public fun new_currency_for_testing(ctx: &mut TxContext): Currency<TQ> {
    let (builder, treasury_cap) = coin_registry::new_currency_with_otw(
        TQ {},
        6,
        b"TQ".to_string(),
        b"Test Quote".to_string(),
        b"LoopVault test quote asset (6 decimals)".to_string(),
        b"".to_string(),
        ctx,
    );
    transfer::public_transfer(treasury_cap, ctx.sender());
    coin_registry::unwrap_for_testing(builder)
}
