// SPDX-License-Identifier: Apache-2.0
//
// ShareCard — the social NFT minted inside the Open PTB. It encodes the trade so
// the OG-image edge function can render a shareable card with live P&L, and so a
// friend can copy-trade from the embedded MarketKey. P&L is read LIVE off the
// position state at request time — never stored stale on-chain.
module loopvault::share_card;

use sui::clock::{Self, Clock};
use sui::event;

// === Errors ===
const E_INVALID_DIRECTION: u64 = 0;

// === Direction codes ===
const DIRECTION_CALL: u8 = 0; // UP / call
const DIRECTION_PUT: u8 = 1; // DOWN / put
const DIRECTION_STRADDLE: u8 = 2;

// === Structs ===

public struct ShareCard has key, store {
    id: UID,
    owner: address, // zkLogin address (masked in UI)
    direction: u8, // see DIRECTION_* codes
    strike: u64, // FLOAT_SCALING = 1e9
    expiry_ms: u64,
    entry_iv_bps: u64, // SVI snapshot at open
    entry_ts_ms: u64,
    market_key_bytes: vector<u8>, // encoded MarketKey for the copy-trade hot path
}

// === Events ===

public struct ShareCardMinted has copy, drop, store {
    card_id: ID,
    owner: address,
    direction: u8,
    strike: u64,
    expiry_ms: u64,
    entry_iv_bps: u64,
    entry_ts_ms: u64,
}

// === Public Functions ===

/// Mint a ShareCard for an opened position. `entry_ts_ms` is taken from the clock
/// so the card and the trade share one timestamp.
public fun mint(
    owner: address,
    direction: u8,
    strike: u64,
    expiry_ms: u64,
    entry_iv_bps: u64,
    market_key_bytes: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
): ShareCard {
    assert!(direction <= DIRECTION_STRADDLE, E_INVALID_DIRECTION);
    let card = ShareCard {
        id: object::new(ctx),
        owner,
        direction,
        strike,
        expiry_ms,
        entry_iv_bps,
        entry_ts_ms: clock::timestamp_ms(clock),
        market_key_bytes,
    };
    event::emit(ShareCardMinted {
        card_id: object::id(&card),
        owner,
        direction,
        strike,
        expiry_ms,
        entry_iv_bps,
        entry_ts_ms: card.entry_ts_ms,
    });
    card
}

/// Convenience: mint and transfer to `owner` in one call.
public fun mint_to(
    owner: address,
    direction: u8,
    strike: u64,
    expiry_ms: u64,
    entry_iv_bps: u64,
    market_key_bytes: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let card = mint(owner, direction, strike, expiry_ms, entry_iv_bps, market_key_bytes, clock, ctx);
    transfer::public_transfer(card, owner);
}

// === Accessors ===

public fun owner(c: &ShareCard): address { c.owner }

public fun direction(c: &ShareCard): u8 { c.direction }

public fun strike(c: &ShareCard): u64 { c.strike }

public fun expiry_ms(c: &ShareCard): u64 { c.expiry_ms }

public fun entry_iv_bps(c: &ShareCard): u64 { c.entry_iv_bps }

public fun entry_ts_ms(c: &ShareCard): u64 { c.entry_ts_ms }

public fun market_key_bytes(c: &ShareCard): vector<u8> { c.market_key_bytes }

// === Direction code helpers ===

public fun direction_call(): u8 { DIRECTION_CALL }

public fun direction_put(): u8 { DIRECTION_PUT }

public fun direction_straddle(): u8 { DIRECTION_STRADDLE }
