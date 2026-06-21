// SPDX-License-Identifier: Apache-2.0
//
// Proves the SafeMint seal's locally-testable surface:
//   - `new` (via the test constructor) refuses degenerate / looser-than-protocol
//     seals and records capital = pre_balance + deposit_amount;
//   - the size + freshness invariants pass at the boundary and abort just past it.
//
// The full `consume` measures the realized cost from the PredictManager's balance
// delta and reads the real `oracle::timestamp`, so it needs live Manager/OracleSVI
// objects — built only inside the predict package. consume end-to-end is therefore
// proven by a live testnet tx. The hot-potato property (an un-consumed SafeMint) is
// enforced by the compiler, so it is asserted by construction, not by a test.
#[test_only]
module loopvault::safe_mint_tests;

use loopvault::safe_mint;
use sui::clock::{Self, Clock};
use sui::test_scenario::{Self as ts, Scenario};

const T0: u64 = 1_000_000;
const DEADLINE: u64 = 20_000;
const MAX_LOSS_BPS: u64 = 500; // 5%
const PRE_BALANCE: u64 = 2_000_000; // 2.0 already in the manager (6dp)
const DEPOSIT: u64 = 10_000_000; // 10.0 funded this PTB (6dp)
const CAPITAL: u64 = 12_000_000; // pre + deposit
// 5% of 12.0 = 0.6 ⇒ cost cap is 600_000.
const COST_UNDER: u64 = 500_000;
const COST_AT_CAP: u64 = 600_000;
const COST_OVER: u64 = 600_001;

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

// === new(): validation + capital accounting ===

#[test]
fun test_new_records_capital_and_accessors() {
    let (sc, clock) = setup(T0);
    let sm = safe_mint::new_for_testing(MAX_LOSS_BPS, PRE_BALANCE, DEPOSIT, DEADLINE, &clock);
    assert!(safe_mint::max_loss_bps(&sm) == MAX_LOSS_BPS, 0);
    assert!(safe_mint::pre_balance(&sm) == PRE_BALANCE, 1);
    assert!(safe_mint::deposit_amount(&sm) == DEPOSIT, 2);
    assert!(safe_mint::capital(&sm) == CAPITAL, 3); // pre + deposit
    assert!(safe_mint::oracle_freshness_deadline(&sm) == DEADLINE, 4);
    assert!(safe_mint::opened_at_ms(&sm) == T0, 5);
    safe_mint::destroy_for_testing(sm);
    teardown(sc, clock);
}

#[test, expected_failure(abort_code = 2, location = loopvault::safe_mint)]
fun test_loose_deadline_rejected() {
    let (sc, clock) = setup(T0);
    // 30_001 ms is looser than the 30_000 protocol staleness guard.
    let sm = safe_mint::new_for_testing(MAX_LOSS_BPS, PRE_BALANCE, DEPOSIT, 30_001, &clock);
    safe_mint::destroy_for_testing(sm);
    teardown(sc, clock);
}

#[test, expected_failure(abort_code = 3, location = loopvault::safe_mint)]
fun test_invalid_max_loss_rejected() {
    let (sc, clock) = setup(T0);
    let sm = safe_mint::new_for_testing(0, PRE_BALANCE, DEPOSIT, DEADLINE, &clock); // max_loss_bps must be > 0
    safe_mint::destroy_for_testing(sm);
    teardown(sc, clock);
}

#[test, expected_failure(abort_code = 4, location = loopvault::safe_mint)]
fun test_zero_deposit_rejected() {
    let (sc, clock) = setup(T0);
    let sm = safe_mint::new_for_testing(MAX_LOSS_BPS, 0, 0, DEADLINE, &clock); // deposit must be > 0
    safe_mint::destroy_for_testing(sm);
    teardown(sc, clock);
}

// === invariant math: the exact size/freshness checks consume enforces ===

#[test]
fun test_invariants_fresh_within_bounds_ok() {
    safe_mint::assert_invariants_for_testing(MAX_LOSS_BPS, CAPITAL, DEADLINE, COST_UNDER, 10_000);
}

#[test]
fun test_invariants_boundaries_ok() {
    // age == deadline (<=) and cost == cap (<=) both pass.
    safe_mint::assert_invariants_for_testing(MAX_LOSS_BPS, CAPITAL, DEADLINE, COST_AT_CAP, DEADLINE);
}

#[test, expected_failure(abort_code = 0, location = loopvault::safe_mint)]
fun test_invariants_stale_aborts() {
    safe_mint::assert_invariants_for_testing(MAX_LOSS_BPS, CAPITAL, DEADLINE, COST_UNDER, DEADLINE + 1);
}

#[test, expected_failure(abort_code = 1, location = loopvault::safe_mint)]
fun test_invariants_oversize_aborts() {
    safe_mint::assert_invariants_for_testing(MAX_LOSS_BPS, CAPITAL, DEADLINE, COST_OVER, 5_000);
}
