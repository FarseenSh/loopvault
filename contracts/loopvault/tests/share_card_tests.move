// SPDX-License-Identifier: Apache-2.0
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

    let card = share_card::mint(
        OWNER,
        share_card::direction_call(),
        100_000_000_000, // strike 100.0
        87_400_000, // expiry
        5_000, // entry IV bps
        b"market-key-bytes",
        &clock,
        ts::ctx(&mut sc),
    );

    assert!(share_card::owner(&card) == OWNER, 0);
    assert!(share_card::direction(&card) == share_card::direction_call(), 1);
    assert!(share_card::strike(&card) == 100_000_000_000, 2);
    assert!(share_card::expiry_ms(&card) == 87_400_000, 3);
    assert!(share_card::entry_iv_bps(&card) == 5_000, 4);
    assert!(share_card::entry_ts_ms(&card) == 1_234_000, 5); // taken from the clock
    assert!(share_card::market_key_bytes(&card) == b"market-key-bytes", 6);

    unit_test::destroy(card);
    clock::destroy_for_testing(clock);
    ts::end(sc);
}

#[test]
#[expected_failure(abort_code = 0, location = loopvault::share_card)]
fun test_invalid_direction_aborts() {
    let mut sc = ts::begin(@0xA);
    let mut clock = clock::create_for_testing(ts::ctx(&mut sc));
    clock::set_for_testing(&mut clock, 1);

    let card = share_card::mint(OWNER, 3, 1, 1, 1, b"x", &clock, ts::ctx(&mut sc)); // 3 > straddle
    unit_test::destroy(card);
    clock::destroy_for_testing(clock);
    ts::end(sc);
}
