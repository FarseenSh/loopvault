// SPDX-License-Identifier: Apache-2.0
#[test_only]
module loopvault::streak_tests;

use loopvault::streak;
use std::unit_test;
use sui::clock::{Self, Clock};
use sui::test_scenario::{Self as ts, Scenario};

const OWNER: address = @0xB0B;
const DAY: u64 = 86_400_000;

fun setup(t: u64): (Scenario, Clock) {
    let mut sc = ts::begin(@0xA);
    let mut clock = clock::create_for_testing(ts::ctx(&mut sc));
    clock::set_for_testing(&mut clock, t);
    (sc, clock)
}

#[test]
fun test_new_starts_zero() {
    let (mut sc, clock) = setup(0);
    let s = streak::new(OWNER, &clock, ts::ctx(&mut sc));
    assert!(streak::consecutive_days(&s) == 0, 0);
    assert!(streak::best_streak(&s) == 0, 1);
    assert!(streak::owner(&s) == OWNER, 2);
    unit_test::destroy(s);
    clock::destroy_for_testing(clock);
    ts::end(sc);
}

#[test]
#[expected_failure(abort_code = 0, location = loopvault::streak)]
fun test_touch_too_soon_aborts() {
    let (mut sc, mut clock) = setup(0);
    let mut s = streak::new(OWNER, &clock, ts::ctx(&mut sc));
    clock::set_for_testing(&mut clock, DAY - 1); // < 1 day after creation
    streak::touch(&mut s, &clock);
    unit_test::destroy(s);
    clock::destroy_for_testing(clock);
    ts::end(sc);
}

#[test]
fun test_touch_after_one_day_increments() {
    let (mut sc, mut clock) = setup(0);
    let mut s = streak::new(OWNER, &clock, ts::ctx(&mut sc));
    clock::set_for_testing(&mut clock, DAY);
    streak::touch(&mut s, &clock);
    assert!(streak::consecutive_days(&s) == 1, 0);
    assert!(streak::best_streak(&s) == 1, 1);
    unit_test::destroy(s);
    clock::destroy_for_testing(clock);
    ts::end(sc);
}

#[test]
fun test_consecutive_within_window() {
    let (mut sc, mut clock) = setup(0);
    let mut s = streak::new(OWNER, &clock, ts::ctx(&mut sc));
    clock::set_for_testing(&mut clock, DAY);
    streak::touch(&mut s, &clock); // day 1
    clock::set_for_testing(&mut clock, 2 * DAY);
    streak::touch(&mut s, &clock); // gap exactly 1 day ⇒ consecutive
    assert!(streak::consecutive_days(&s) == 2, 0);
    assert!(streak::best_streak(&s) == 2, 1);
    unit_test::destroy(s);
    clock::destroy_for_testing(clock);
    ts::end(sc);
}

#[test]
fun test_reset_after_long_gap_preserves_best() {
    let (mut sc, mut clock) = setup(0);
    let mut s = streak::new(OWNER, &clock, ts::ctx(&mut sc));
    clock::set_for_testing(&mut clock, DAY);
    streak::touch(&mut s, &clock); // 1
    clock::set_for_testing(&mut clock, 2 * DAY);
    streak::touch(&mut s, &clock); // 2 (best = 2)
    clock::set_for_testing(&mut clock, 2 * DAY + 3 * DAY); // 3-day gap > 2-day window
    streak::touch(&mut s, &clock); // resets to 1, best preserved
    assert!(streak::consecutive_days(&s) == 1, 0);
    assert!(streak::best_streak(&s) == 2, 1);
    unit_test::destroy(s);
    clock::destroy_for_testing(clock);
    ts::end(sc);
}
