// SPDX-License-Identifier: Apache-2.0
//
// LoopVault — Gate 1 atomicity proof (Move test_scenario, no DUSDC / no network).
//
// LoopVault's entire safety thesis is atomicity: a deposit + position-open must
// either both land or both revert. This suite proves the load-bearing primitive
// — predict_manager::deposit + predict::mint — behaves all-or-nothing on the REAL
// deepbook_predict contracts, plus the clean Earn round-trip (supply → withdraw).
//
// Why the suite lives INSIDE the package: standing up a mintable system needs
// public(package) / #[test_only] constructors (create_test_predict,
// oracle::create_oracle / create_oracle_cap, add_oracle_grid, predict_manager::new)
// that no external package can reach. scripts/run-predict-tests.sh copies this
// file into a pinned clone's packages/predict/tests/ and runs `sui move test`.
//
// Tests:
//   1. test_earn_supply_withdraw_roundtrip   — supply N → withdraw → get N back.
//   2. test_deposit_then_mint_persists        — success path persists (position == qty).
//   3. test_deposit_persists_when_committed   — a committed deposit DOES stick
//        (the counterfactual that makes the rollback tests meaningful).
//   4. test_deposit_then_stale_mint_rolls_back (expected_failure) — deposit, then
//        mint against a STALE oracle aborts (EOracleStale); the whole tx reverts,
//        so the deposit rolls back. This is the on-thesis freshness guard.
//   5. test_deposit_then_offgrid_strike_rolls_back (expected_failure) — second
//        rollback trigger (off-grid strike ⇒ EInvalidStrike), aborting before the
//        cost is even withdrawn.
//
// expected_failure asserts the combined deposit+mint transaction aborts; Move's
// per-transaction all-or-nothing semantics then guarantee the deposit reverted
// (test #3 proves a committed deposit would otherwise persist).
#[test_only]
module deepbook_predict::loopvault_atomicity_tests;

use deepbook_predict::i64;
use deepbook_predict::market_key;
use deepbook_predict::oracle::{Self, OracleSVI, OracleSVICap};
use deepbook_predict::predict::{Self, Predict};
use deepbook_predict::predict_manager::{Self, PredictManager};
use deepbook_predict::tq::{Self, TQ};
use std::unit_test;
use sui::clock::{Self, Clock};
use sui::coin;
use sui::coin_registry::Currency;
use sui::test_scenario::{Self as ts, Scenario};

const USER: address = @0xA11CE;

// FLOAT_SCALING (1e9) — prices/strikes are fixed-point at this scale.
const FLOAT_SCALING: u64 = 1_000_000_000;

// "now" and a 1-day expiry (= START_MS + 86_400_000) so the oracle stays ACTIVE
// (pre-expiry) while we test staleness independently.
const START_MS: u64 = 1_000_000;
const EXPIRY_MS: u64 = 87_400_000;

// Oracle prices (FLOAT_SCALING): forward = 100.0; spot = 100.0.
const FORWARD: u64 = 100_000_000_000;
const SPOT: u64 = 100_000_000_000;

// Strike grid: [50.0 .. 50.0 + 0.01*100_000] with 0.01 ticks (10_000_000 is a
// multiple of oracle_tick_size_unit = 10_000).
const MIN_STRIKE: u64 = 50_000_000_000;
const TICK_SIZE: u64 = 10_000_000;
// ATM, on-grid: (100.0 - 50.0)/0.01 = 5000 ticks exactly.
const STRIKE_ATM: u64 = 100_000_000_000;

// SVI: a = 0.01 total variance, b = 0 ⇒ total_var = a (constant, strictly > 0),
// rho = m = 0 ⇒ the SVI `inner` term is sqrt(...) ≥ 0 (no ECannotBeNegative).
// At ATM this prices ~0.48, well inside the [1%, 99%] mint ask bounds.
const SVI_A: u64 = 10_000_000;
const SVI_SIGMA: u64 = 100_000_000;

const QUANTITY: u64 = 1_000_000; // 1 contract == $1 (quote units, 6 dp)
const DEPOSIT: u64 = 10_000_000; // 10.0 quote — comfortably covers the ~0.5 cost
const SEED_SUPPLY: u64 = 1_000_000_000; // 1000.0 vault liquidity (exposure ~0)
const STALE_GAP_MS: u64 = 30_001; // just past staleness_threshold_ms (30_000)

// === Earn round-trip (no oracle/manager needed) ===

#[test]
fun test_earn_supply_withdraw_roundtrip() {
    let mut sc = ts::begin(USER);
    let currency = tq::new_currency_for_testing(ts::ctx(&mut sc));
    let mut predict = predict::create_test_predict<TQ>(&currency, ts::ctx(&mut sc));
    let mut clock = clock::create_for_testing(ts::ctx(&mut sc));
    clock::set_for_testing(&mut clock, START_MS);

    let coin_in = coin::mint_for_testing<TQ>(SEED_SUPPLY, ts::ctx(&mut sc));
    // First depositor mints shares 1:1.
    let lp = predict::supply<TQ>(&mut predict, coin_in, &clock, ts::ctx(&mut sc));
    // Burning all shares returns the full vault value — a clean round-trip.
    let out = predict::withdraw<TQ>(&mut predict, lp, &clock, ts::ctx(&mut sc));
    assert!(coin::value(&out) == SEED_SUPPLY, 1);

    unit_test::destroy(out);
    unit_test::destroy(predict);
    unit_test::destroy(currency);
    clock::destroy_for_testing(clock);
    ts::end(sc);
}

// === deposit + mint ===

#[test]
fun test_deposit_then_mint_persists() {
    let mut sc = ts::begin(USER);
    let (mut env, clock) = new_env(&mut sc);
    let mut manager = ts::take_shared<PredictManager>(&sc);
    let oracle = ts::take_shared<OracleSVI>(&sc);

    let bal0 = predict_manager::balance<TQ>(&manager);
    let coin_in = coin::mint_for_testing<TQ>(DEPOSIT, ts::ctx(&mut sc));
    predict_manager::deposit<TQ>(&mut manager, coin_in, ts::ctx(&mut sc));
    let bal1 = predict_manager::balance<TQ>(&manager);
    assert!(bal1 == bal0 + DEPOSIT, 2);

    let key = market_key::up(env.oracle_id, EXPIRY_MS, STRIKE_ATM);
    predict::mint<TQ>(&mut env.predict, &mut manager, &oracle, key, QUANTITY, &clock, ts::ctx(&mut sc));

    // Position recorded, and the cost was pulled from the deposited balance.
    assert!(predict_manager::position(&manager, key) == QUANTITY, 3);
    assert!(predict_manager::balance<TQ>(&manager) < bal1, 4);

    ts::return_shared(oracle);
    ts::return_shared(manager);
    destroy_env(env, clock);
    ts::end(sc);
}

#[test]
fun test_deposit_persists_when_committed() {
    let mut sc = ts::begin(USER);
    let (env, clock) = new_env(&mut sc);
    let mut manager = ts::take_shared<PredictManager>(&sc);

    let coin_in = coin::mint_for_testing<TQ>(DEPOSIT, ts::ctx(&mut sc));
    predict_manager::deposit<TQ>(&mut manager, coin_in, ts::ctx(&mut sc));
    ts::return_shared(manager);

    // Commit the deposit-only transaction, then observe it persisted.
    ts::next_tx(&mut sc, USER);
    let manager2 = ts::take_shared<PredictManager>(&sc);
    assert!(predict_manager::balance<TQ>(&manager2) == DEPOSIT, 5);
    ts::return_shared(manager2);

    destroy_env(env, clock);
    ts::end(sc);
}

// Deposit, then mint against a STALE oracle. assert_live_oracle aborts
// (EOracleStale), reverting the whole tx — the deposit rolls back.
#[test]
#[expected_failure(abort_code = 6, location = deepbook_predict::oracle_config)]
fun test_deposit_then_stale_mint_rolls_back() {
    let mut sc = ts::begin(USER);
    let (mut env, mut clock) = new_env(&mut sc);
    let mut manager = ts::take_shared<PredictManager>(&sc);
    let oracle = ts::take_shared<OracleSVI>(&sc);

    let coin_in = coin::mint_for_testing<TQ>(DEPOSIT, ts::ctx(&mut sc));
    predict_manager::deposit<TQ>(&mut manager, coin_in, ts::ctx(&mut sc)); // must roll back

    // Push the clock past the 30s staleness window (still pre-expiry ⇒ ACTIVE,
    // so the abort is staleness, not expiry).
    clock::set_for_testing(&mut clock, START_MS + STALE_GAP_MS);

    let key = market_key::up(env.oracle_id, EXPIRY_MS, STRIKE_ATM);
    predict::mint<TQ>(&mut env.predict, &mut manager, &oracle, key, QUANTITY, &clock, ts::ctx(&mut sc));

    // Unreachable at runtime (mint aborts), but required for the success path to type-check.
    ts::return_shared(oracle);
    ts::return_shared(manager);
    destroy_env(env, clock);
    ts::end(sc);
}

// Deposit, then mint with an off-grid strike. assert_valid_strike aborts
// (EInvalidStrike) before any cost is withdrawn — the deposit rolls back.
#[test]
#[expected_failure(abort_code = 2, location = deepbook_predict::oracle_config)]
fun test_deposit_then_offgrid_strike_rolls_back() {
    let mut sc = ts::begin(USER);
    let (mut env, clock) = new_env(&mut sc);
    let mut manager = ts::take_shared<PredictManager>(&sc);
    let oracle = ts::take_shared<OracleSVI>(&sc);

    let coin_in = coin::mint_for_testing<TQ>(DEPOSIT, ts::ctx(&mut sc));
    predict_manager::deposit<TQ>(&mut manager, coin_in, ts::ctx(&mut sc)); // must roll back

    // MIN_STRIKE + 1 is in range but not on a tick boundary.
    let key = market_key::up(env.oracle_id, EXPIRY_MS, MIN_STRIKE + 1);
    predict::mint<TQ>(&mut env.predict, &mut manager, &oracle, key, QUANTITY, &clock, ts::ctx(&mut sc));

    ts::return_shared(oracle);
    ts::return_shared(manager);
    destroy_env(env, clock);
    ts::end(sc);
}

// === Cross-language pricing golden vector ===

// Pins the on-chain fair UP-digital price for fixed SVI params so the TS delta
// engine can be proven to reproduce it (see app/src/lib/delta.test.ts golden test).
// Params: a=0.01, b=0, rho=0, m=0, sigma=0.1; F=K=100 ⇒ k=0, w=a=0.01,
// d2=-(w/2)/sqrt(w)=-0.05, UP = N(-0.05) = 0.4800612 (×1e9 = 480_061_xxx).
#[test]
fun test_compute_price_golden_atm_digital() {
    let mut sc = ts::begin(USER);
    let cap = oracle::create_oracle_cap(ts::ctx(&mut sc));
    let _oracle_id = oracle::create_oracle(b"BTC".to_string(), EXPIRY_MS, ts::ctx(&mut sc));
    let mut clock = clock::create_for_testing(ts::ctx(&mut sc));
    clock::set_for_testing(&mut clock, START_MS);

    ts::next_tx(&mut sc, USER);
    let mut oracle = ts::take_shared<OracleSVI>(&sc);
    oracle::register_cap(&mut oracle, &cap);
    oracle::activate(&mut oracle, &cap, &clock);
    oracle::update_prices(&mut oracle, &cap, oracle::new_price_data(SPOT, FORWARD), &clock);
    oracle::update_svi(
        &mut oracle,
        &cap,
        oracle::new_svi_params(SVI_A, 0, i64::zero(), i64::zero(), SVI_SIGMA),
        &clock,
    );

    let up = oracle::compute_price(&oracle, STRIKE_ATM); // fair N(d2), ×1e9
    // 0.4800612 ± 5e-5 — tight enough to catch a sign/convention bug, loose enough
    // for the Cody-vs-A&S normCdf approximation gap (~1e-7).
    assert!(up > 480_011_000 && up < 480_111_000, 0);

    ts::return_shared(oracle);
    unit_test::destroy(cap);
    clock::destroy_for_testing(clock);
    ts::end(sc);
}

// === Fixtures ===

// Held-by-value objects that must survive across test_scenario tx boundaries.
// The Clock is kept as a SEPARATE local (not a field) so a call can borrow it
// alongside `&mut env.predict` without tripping the borrow checker. The oracle
// and manager are shared and re-taken via take_shared each tx.
public struct Env {
    predict: Predict,
    currency: Currency<TQ>,
    cap: OracleSVICap,
    oracle_id: ID,
}

// Stand up a live, fresh, ACTIVE oracle with a strike grid, a seeded vault, and a
// USER-owned PredictManager. Leaves the scenario in a fresh tx where the shared
// oracle + manager are takeable.
fun new_env(sc: &mut Scenario): (Env, Clock) {
    // tx1: currency, predict, oracle (shared), cap, clock.
    let currency = tq::new_currency_for_testing(ts::ctx(sc));
    let mut predict = predict::create_test_predict<TQ>(&currency, ts::ctx(sc));
    predict::set_max_total_exposure_pct(&mut predict, FLOAT_SCALING); // permissive cap
    let cap = oracle::create_oracle_cap(ts::ctx(sc));
    let oracle_id = oracle::create_oracle(b"BTC".to_string(), EXPIRY_MS, ts::ctx(sc));
    let mut clock = clock::create_for_testing(ts::ctx(sc));
    clock::set_for_testing(&mut clock, START_MS);

    // tx2: configure the now-shared oracle, register the grid, seed the vault,
    // create the manager (shared).
    ts::next_tx(sc, USER);
    let mut oracle = ts::take_shared<OracleSVI>(sc);
    oracle::register_cap(&mut oracle, &cap);
    oracle::activate(&mut oracle, &cap, &clock);
    // update_prices sets oracle.timestamp (= freshness anchor); forward must be > 0.
    oracle::update_prices(&mut oracle, &cap, oracle::new_price_data(SPOT, FORWARD), &clock);
    oracle::update_svi(
        &mut oracle,
        &cap,
        oracle::new_svi_params(SVI_A, 0, i64::zero(), i64::zero(), SVI_SIGMA),
        &clock,
    );
    ts::return_shared(oracle);

    predict::add_oracle_grid(&mut predict, oracle_id, MIN_STRIKE, TICK_SIZE, ts::ctx(sc));
    let seed = coin::mint_for_testing<TQ>(SEED_SUPPLY, ts::ctx(sc));
    let plp = predict::supply<TQ>(&mut predict, seed, &clock, ts::ctx(sc));
    unit_test::destroy(plp);

    predict::create_manager(ts::ctx(sc)); // shared, owner == USER

    // Advance so the shared manager + oracle are takeable by the test body.
    ts::next_tx(sc, USER);
    (Env { predict, currency, cap, oracle_id }, clock)
}

fun destroy_env(env: Env, clock: Clock) {
    let Env { predict, currency, cap, oracle_id: _ } = env;
    unit_test::destroy(predict);
    unit_test::destroy(currency);
    unit_test::destroy(cap);
    clock::destroy_for_testing(clock);
}
