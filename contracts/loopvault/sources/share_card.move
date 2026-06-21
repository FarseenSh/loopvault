// SPDX-License-Identifier: Apache-2.0
//
// ShareCard — the social NFT minted inside the Open PTB. It encodes the trade so
// the OG-image edge function can render a shareable card with live P&L, and so a
// friend can copy-trade from the embedded market coordinates (oracle/expiry/strike/
// side). P&L is read LIVE off the position state at request time — never stored
// stale on-chain.
//
// Provenance: a card can only be minted by the PredictManager's owner, for a
// MarketKey the manager actually holds a position in — so a ShareCard is proof you
// hold the trade, not an unbacked claim. (Made possible by depending on the real
// deepbook_predict package.)
module loopvault::share_card;

use sui::clock::{Self, Clock};
use sui::event;
use deepbook_predict::predict_manager::PredictManager;
use deepbook_predict::market_key;

// === Errors ===
const E_INVALID_DIRECTION: u64 = 0;
const E_NOT_MANAGER_OWNER: u64 = 1; // caller is not the PredictManager owner
const E_NO_POSITION: u64 = 2; // manager holds no position for this market

// === Direction codes ===
const DIRECTION_CALL: u8 = 0; // UP / call
const DIRECTION_PUT: u8 = 1; // DOWN / put
const DIRECTION_STRADDLE: u8 = 2;

// === Structs ===

public struct ShareCard has key, store {
    id: UID,
    owner: address, // zkLogin address (masked in UI) == the manager owner
    oracle_id: ID, // the OracleSVI this market priced against (for copy-trade)
    direction: u8, // see DIRECTION_* codes
    is_up: bool, // the bound leg's side (straddle binds its up leg)
    strike: u64, // FLOAT_SCALING = 1e9
    expiry_ms: u64,
    entry_iv_bps: u64, // SVI snapshot at open
    entry_ts_ms: u64,
}

// === Events ===

public struct ShareCardMinted has copy, drop, store {
    card_id: ID,
    owner: address,
    oracle_id: ID,
    direction: u8,
    strike: u64,
    expiry_ms: u64,
    entry_iv_bps: u64,
    entry_ts_ms: u64,
}

// === Public Functions ===

/// Mint a ShareCard PROVABLY backed by a position the caller's manager holds.
/// Asserts the caller is the manager owner AND the manager has a long position for
/// the exact MarketKey — so a card cannot attribute a trade you do not hold.
/// `entry_ts_ms` is taken from the clock so the card and the trade share one stamp.
public fun mint(
    manager: &PredictManager,
    oracle_id: ID,
    expiry_ms: u64,
    strike: u64,
    is_up: bool,
    direction: u8,
    entry_iv_bps: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): ShareCard {
    let owner = ctx.sender();
    assert!(manager.owner() == owner, E_NOT_MANAGER_OWNER);
    let key = market_key::new(oracle_id, expiry_ms, strike, is_up);
    assert!(manager.position(key) > 0, E_NO_POSITION);
    build_card(owner, oracle_id, expiry_ms, strike, is_up, direction, entry_iv_bps, clock, ctx)
}

/// Convenience: mint a provenance-checked card and transfer it to the caller.
public fun mint_to(
    manager: &PredictManager,
    oracle_id: ID,
    expiry_ms: u64,
    strike: u64,
    is_up: bool,
    direction: u8,
    entry_iv_bps: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let owner = ctx.sender();
    let card = mint(manager, oracle_id, expiry_ms, strike, is_up, direction, entry_iv_bps, clock, ctx);
    transfer::public_transfer(card, owner);
}

fun build_card(
    owner: address,
    oracle_id: ID,
    expiry_ms: u64,
    strike: u64,
    is_up: bool,
    direction: u8,
    entry_iv_bps: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): ShareCard {
    assert!(direction <= DIRECTION_STRADDLE, E_INVALID_DIRECTION);
    let card = ShareCard {
        id: object::new(ctx),
        owner,
        oracle_id,
        direction,
        is_up,
        strike,
        expiry_ms,
        entry_iv_bps,
        entry_ts_ms: clock::timestamp_ms(clock),
    };
    event::emit(ShareCardMinted {
        card_id: object::id(&card),
        owner,
        oracle_id,
        direction,
        strike,
        expiry_ms,
        entry_iv_bps,
        entry_ts_ms: card.entry_ts_ms,
    });
    card
}

// === Accessors ===

public fun owner(c: &ShareCard): address { c.owner }

public fun oracle_id(c: &ShareCard): ID { c.oracle_id }

public fun direction(c: &ShareCard): u8 { c.direction }

public fun is_up(c: &ShareCard): bool { c.is_up }

public fun strike(c: &ShareCard): u64 { c.strike }

public fun expiry_ms(c: &ShareCard): u64 { c.expiry_ms }

public fun entry_iv_bps(c: &ShareCard): u64 { c.entry_iv_bps }

public fun entry_ts_ms(c: &ShareCard): u64 { c.entry_ts_ms }

// === Direction code helpers ===

public fun direction_call(): u8 { DIRECTION_CALL }

public fun direction_put(): u8 { DIRECTION_PUT }

public fun direction_straddle(): u8 { DIRECTION_STRADDLE }

// === Test-only helpers ===

/// Build a card without the manager/position provenance checks, so field-setting
/// and direction validation can be unit-tested without standing up a PredictManager
/// (whose constructor is `public(package)`). The provenance path is proven live.
#[test_only]
public fun mint_unchecked_for_testing(
    owner: address,
    oracle_id: ID,
    expiry_ms: u64,
    strike: u64,
    is_up: bool,
    direction: u8,
    entry_iv_bps: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): ShareCard {
    build_card(owner, oracle_id, expiry_ms, strike, is_up, direction, entry_iv_bps, clock, ctx)
}
