// SPDX-License-Identifier: Apache-2.0
//
// Field-setting + direction validation are unit-tested via the unchecked helper
// (the provenance path — owner == manager owner AND manager holds the position —
// needs a real PredictManager, whose constructor is public(package), so it is
// proven by a live testnet tx instead).
#[test_only]
module loopvault::share_card_tests;

use loopvault::share_card;
use std::unit_test;
use sui::clock;
use sui::test_scenario as ts;

const OWNER: address = @0xB0B;

#[test]
fun test_mint_sets_fields() {
    let mut sc = ts::begin(@0xA);
    let mut clock = clock::create_for_testing(ts::ctx(&mut sc));
    clock::set_for_testing(&mut clock, 1_234_000);
    let oracle_id = object::id_from_address(@0xACE);

    let card = share_card::mint_unchecked_for_testing(
        OWNER,
        oracle_id,
        87_400_000, // expiry
        100_000_000_000, // strike 100.0
        true, // is_up
        share_card::direction_call(),
        5_000, // entry IV bps
        &clock,
        ts::ctx(&mut sc),
    );

    assert!(share_card::owner(&card) == OWNER, 0);
    assert!(share_card::oracle_id(&card) == oracle_id, 1);
    assert!(share_card::direction(&card) == share_card::direction_call(), 2);
    assert!(share_card::is_up(&card) == true, 3);
    assert!(share_card::strike(&card) == 100_000_000_000, 4);
    assert!(share_card::expiry_ms(&card) == 87_400_000, 5);
    assert!(share_card::entry_iv_bps(&card) == 5_000, 6);
    assert!(share_card::entry_ts_ms(&card) == 1_234_000, 7); // taken from the clock

    unit_test::destroy(card);
    clock::destroy_for_testing(clock);
    ts::end(sc);
}

#[test, expected_failure(abort_code = 0, location = loopvault::share_card)]
fun test_invalid_direction_aborts() {
    let mut sc = ts::begin(@0xA);
    let mut clock = clock::create_for_testing(ts::ctx(&mut sc));
    clock::set_for_testing(&mut clock, 1);
    let oracle_id = object::id_from_address(@0xABC);

    // direction 3 > straddle (2)
    let card = share_card::mint_unchecked_for_testing(OWNER, oracle_id, 1, 1, true, 3, 1, &clock, ts::ctx(&mut sc));
    unit_test::destroy(card);
    clock::destroy_for_testing(clock);
    ts::end(sc);
}
