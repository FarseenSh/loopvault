// SPDX-License-Identifier: Apache-2.0
//
// SafeMint — LoopVault's invariant seal. THE safety thesis, as a type.
//
// `SafeMint` has NO abilities (no key/store/copy/drop). Once `new` creates one
// inside a PTB it MUST be threaded to `consume` before the PTB ends, or the
// transaction fails to type-check. So the Open-Position PTB is forced to end with
// `consume`, which re-asserts ON-CHAIN that:
//   (a) the oracle the mint priced against is fresh within OUR deadline, and
//   (b) the position cost is within the user's `max_loss_bps` of their deposit.
// Any violation aborts the whole PTB → the deposit + mint + hedge all roll back.
// "Fully hedged inside a fresh window, or you never traded" becomes a property of
// the type system, not a frontend promise.
//
// This is ADDITIVE to the protocol's own `assert_live_oracle` (30s). `new` even
// refuses to build a seal looser than that 30s — our deadline is strictly tighter.
module loopvault::safe_mint;

use sui::clock::{Self, Clock};
use sui::event;

// === Errors ===
const E_ORACLE_STALE: u64 = 0; // oracle age > our deadline (or oracle in the future)
const E_SIZE_EXCEEDED: u64 = 1; // cost/deposit > max_loss_bps
const E_DEADLINE_TOO_LOOSE: u64 = 2; // deadline must be in (0, protocol staleness]
const E_INVALID_MAX_LOSS: u64 = 3; // max_loss_bps must be in (0, 10_000]
const E_ZERO_DEPOSIT: u64 = 4; // deposit_amount must be > 0

// === Constants ===
const BPS_DENOMINATOR: u64 = 10_000;
/// Predict's own oracle staleness guard (`deepbook_predict::constants`). Our
/// freshness deadline must be no looser than this.
const PROTOCOL_STALENESS_MS: u64 = 30_000;

// === Structs ===

/// Hot-potato. NO abilities ⇒ cannot be stored, copied, or dropped; the only way
/// to dispose of it is `consume`.
public struct SafeMint {
    /// Max position cost as basis points of `deposit_amount` (the size cap).
    max_loss_bps: u64,
    /// DUSDC funded into the manager this PTB — the denominator for the bps check.
    deposit_amount: u64,
    /// Tighter-than-protocol max oracle age (ms). UX target ~20_000 < 30_000.
    oracle_freshness_deadline: u64,
    /// Clock at creation — anchors the freshness window for telemetry.
    opened_at_ms: u64,
}

// === Events ===

public struct SafeMintSealed has copy, drop, store {
    cost_charged: u64,
    deposit_amount: u64,
    max_loss_bps: u64,
    oracle_age_ms: u64,
    oracle_freshness_deadline: u64,
}

// === Public Functions ===

/// Command #1 of the Open PTB. Rejects a seal that is looser than the protocol's
/// own staleness guard or that has a degenerate size cap, so the seal can only
/// ever be *tighter* than the protocol.
public fun new(
    max_loss_bps: u64,
    deposit_amount: u64,
    oracle_freshness_deadline: u64,
    clock: &Clock,
): SafeMint {
    assert!(
        oracle_freshness_deadline > 0 && oracle_freshness_deadline <= PROTOCOL_STALENESS_MS,
        E_DEADLINE_TOO_LOOSE,
    );
    assert!(max_loss_bps > 0 && max_loss_bps <= BPS_DENOMINATOR, E_INVALID_MAX_LOSS);
    assert!(deposit_amount > 0, E_ZERO_DEPOSIT);
    SafeMint {
        max_loss_bps,
        deposit_amount,
        oracle_freshness_deadline,
        opened_at_ms: clock::timestamp_ms(clock),
    }
}

/// Final command of the Open PTB — the ONLY way to destroy a `SafeMint`.
/// `cost_charged` = the DUSDC the mint actually consumed (from the PositionMinted
/// event / read-back). `oracle_ts_ms` = the timestamp of the OracleSVI the mint
/// priced against. Re-checks both invariants on-chain; any violation aborts the
/// whole PTB, so the deposit rolls back.
public fun consume(self: SafeMint, cost_charged: u64, oracle_ts_ms: u64, clock: &Clock) {
    let SafeMint {
        max_loss_bps,
        deposit_amount,
        oracle_freshness_deadline,
        opened_at_ms: _,
    } = self;
    let now = clock::timestamp_ms(clock);

    // (a) Oracle fresh within OUR (tighter) deadline. `now >= oracle_ts_ms` also
    //     rejects a nonsensical future-dated oracle without underflowing.
    assert!(now >= oracle_ts_ms, E_ORACLE_STALE);
    let oracle_age_ms = now - oracle_ts_ms;
    assert!(oracle_age_ms <= oracle_freshness_deadline, E_ORACLE_STALE);

    // (b) Position size within the user's max_loss bound:
    //     cost_charged / deposit_amount <= max_loss_bps / 10_000.
    //     Cross-multiplied in u128 to avoid overflow.
    assert!(
        (cost_charged as u128) * (BPS_DENOMINATOR as u128)
            <= (max_loss_bps as u128) * (deposit_amount as u128),
        E_SIZE_EXCEEDED,
    );

    event::emit(SafeMintSealed {
        cost_charged,
        deposit_amount,
        max_loss_bps,
        oracle_age_ms,
        oracle_freshness_deadline,
    });
}

// === Read-only accessors (let the PTB thread values without re-reading) ===

public fun max_loss_bps(self: &SafeMint): u64 { self.max_loss_bps }

public fun deposit_amount(self: &SafeMint): u64 { self.deposit_amount }

public fun oracle_freshness_deadline(self: &SafeMint): u64 { self.oracle_freshness_deadline }

public fun opened_at_ms(self: &SafeMint): u64 { self.opened_at_ms }

/// The protocol staleness ceiling our deadline must stay within (for UIs).
public fun protocol_staleness_ms(): u64 { PROTOCOL_STALENESS_MS }
