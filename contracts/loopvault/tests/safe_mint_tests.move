// SPDX-License-Identifier: Apache-2.0
//
// Proves the SafeMint seal: a fresh-within-deadline + within-size consume passes;
// stale or oversize consume aborts; and `new` refuses degenerate / looser-than-
// protocol seals. The hot-potato property (a SafeMint that is never consumed) is
// enforced by the compiler — such a test would not type-check — so it is asserted
// by construction, not by a runtime test.
#[test_only]
module loopvault::safe_mint_tests;

use loopvault::safe_mint;
use sui::clock::{Self, Clock};
use sui::test_scenario::{Self as ts, Scenario};

const T0: u64 = 1_000_000;
const DEADLINE: u64 = 20_000;
const MAX_LOSS_BPS: u64 = 500; // 5%
const DEPOSIT: u64 = 10_000_000; // 10.0 (6dp)
// 5% of 10.0 = 0.5 ⇒ cost cap is 500_000.
const COST_UNDER: u64 = 400_000;
const COST_AT_CAP: u64 = 500_000;
const COST_OVER: u64 = 500_001;

fun setup(t: u64): (Scenario, Clock) {
    let mut sc = ts::begin(@0xA);
    let mut clock = clock::create_for_testing(ts::ctx(&mut sc));
    clock::set_for_testing(&mut clock, t);
    (sc, clock)
}

fun teardown(sc: Scenario, clock: Clock) {
    clock::destroy_for_testing(clock);
    ts::end(sc);
}

#[test]
fun test_fresh_within_bounds_ok() {
    let (sc, mut clock) = setup(T0);
    let sm = safe_mint::new(MAX_LOSS_BPS, DEPOSIT, DEADLINE, &clock);
    clock::set_for_testing(&mut clock, T0 + 10_000); // age 10s < deadline
    safe_mint::consume(sm, COST_UNDER, T0, &clock);
    teardown(sc, clock);
}

#[test]
fun test_boundaries_ok() {
    let (sc, mut clock) = setup(T0);
    let sm = safe_mint::new(MAX_LOSS_BPS, DEPOSIT, DEADLINE, &clock);
    clock::set_for_testing(&mut clock, T0 + DEADLINE); // age == deadline (<=)
    safe_mint::consume(sm, COST_AT_CAP, T0, &clock); // cost == cap (<=)
    teardown(sc, clock);
}

#[test]
#[expected_failure(abort_code = 0, location = loopvault::safe_mint)]
fun test_stale_oracle_aborts() {
    let (sc, mut clock) = setup(T0);
    let sm = safe_mint::new(MAX_LOSS_BPS, DEPOSIT, DEADLINE, &clock);
    clock::set_for_testing(&mut clock, T0 + DEADLINE + 1); // age > deadline
    safe_mint::consume(sm, COST_UNDER, T0, &clock);
    teardown(sc, clock);
}

#[test]
#[expected_failure(abort_code = 1, location = loopvault::safe_mint)]
fun test_oversize_aborts() {
    let (sc, mut clock) = setup(T0);
    let sm = safe_mint::new(MAX_LOSS_BPS, DEPOSIT, DEADLINE, &clock);
    clock::set_for_testing(&mut clock, T0 + 5_000); // fresh
    safe_mint::consume(sm, COST_OVER, T0, &clock); // one over the cap
    teardown(sc, clock);
}

#[test]
#[expected_failure(abort_code = 2, location = loopvault::safe_mint)]
fun test_loose_deadline_rejected() {
    let (sc, clock) = setup(T0);
    // 30_001 ms is looser than the 30_000 protocol staleness guard.
    let sm = safe_mint::new(MAX_LOSS_BPS, DEPOSIT, 30_001, &clock);
    safe_mint::consume(sm, 0, T0, &clock); // unreachable; for type-check
    teardown(sc, clock);
}

#[test]
#[expected_failure(abort_code = 3, location = loopvault::safe_mint)]
fun test_invalid_max_loss_rejected() {
    let (sc, clock) = setup(T0);
    let sm = safe_mint::new(0, DEPOSIT, DEADLINE, &clock); // max_loss_bps must be > 0
    safe_mint::consume(sm, 0, T0, &clock);
    teardown(sc, clock);
}

#[test]
#[expected_failure(abort_code = 4, location = loopvault::safe_mint)]
fun test_zero_deposit_rejected() {
    let (sc, clock) = setup(T0);
    let sm = safe_mint::new(MAX_LOSS_BPS, 0, DEADLINE, &clock); // deposit must be > 0
    safe_mint::consume(sm, 0, T0, &clock);
    teardown(sc, clock);
}

#[test]
fun test_accessors() {
    let (sc, clock) = setup(T0);
    let sm = safe_mint::new(MAX_LOSS_BPS, DEPOSIT, DEADLINE, &clock);
    assert!(safe_mint::max_loss_bps(&sm) == MAX_LOSS_BPS, 0);
    assert!(safe_mint::deposit_amount(&sm) == DEPOSIT, 1);
    assert!(safe_mint::oracle_freshness_deadline(&sm) == DEADLINE, 2);
    assert!(safe_mint::opened_at_ms(&sm) == T0, 3);
    safe_mint::consume(sm, COST_UNDER, T0, &clock);
    teardown(sc, clock);
}
