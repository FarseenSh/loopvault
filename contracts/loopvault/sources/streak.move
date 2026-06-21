// SPDX-License-Identifier: Apache-2.0
//
// Streak — engagement object incremented inside the Open PTB, clock-gated to at
// most one increment per day. Owned by the user, so only their own app PTB can
// touch it. A trade within the next ~2 days keeps the streak alive; a longer gap
// resets it to 1.
module loopvault::streak;

use sui::clock::{Self, Clock};
use sui::event;

// === Errors ===
const E_TOO_SOON: u64 = 0;

// === Constants ===
const ONE_DAY_MS: u64 = 86_400_000;

// === Structs ===

public struct Streak has key {
    id: UID,
    owner: address,
    consecutive_days: u64,
    best_streak: u64,
    last_increment_ms: u64,
}

// === Events ===

public struct StreakTouched has copy, drop, store {
    streak_id: ID,
    owner: address,
    consecutive_days: u64,
    best_streak: u64,
    at_ms: u64,
}

// === Public Functions ===

/// Create a streak (consecutive_days = 0). The first `touch` is allowed one day
/// later and starts the streak at 1.
public fun new(owner: address, clock: &Clock, ctx: &mut TxContext): Streak {
    Streak {
        id: object::new(ctx),
        owner,
        consecutive_days: 0,
        best_streak: 0,
        last_increment_ms: clock::timestamp_ms(clock),
    }
}

/// Create and transfer a streak to `owner`.
public fun create(owner: address, clock: &Clock, ctx: &mut TxContext) {
    transfer::transfer(new(owner, clock, ctx), owner);
}

/// Increment the streak, aborting if called less than a day after the last
/// increment. For the standalone Streak feature / strict callers.
public fun touch(self: &mut Streak, clock: &Clock) {
    assert!(try_touch(self, clock), E_TOO_SOON);
}

/// Non-aborting variant for the Open PTB: increments and returns true if a day
/// has passed, else no-ops and returns false. This is what the Open PTB calls, so
/// a 2nd Open the same day does NOT revert the whole hedged trade — the engagement
/// counter must never be able to brick a trade.
public fun touch_if_due(self: &mut Streak, clock: &Clock): bool {
    try_touch(self, clock)
}

/// Core increment logic. Returns false (no mutation, no event) when called too
/// soon; otherwise applies the consecutive/reset rule and emits StreakTouched.
fun try_touch(self: &mut Streak, clock: &Clock): bool {
    let now = clock::timestamp_ms(clock);
    if (now <= self.last_increment_ms) return false;
    let gap = now - self.last_increment_ms;
    if (gap < ONE_DAY_MS) return false;

    if (gap <= 2 * ONE_DAY_MS) {
        self.consecutive_days = self.consecutive_days + 1;
    } else {
        self.consecutive_days = 1;
    };
    if (self.consecutive_days > self.best_streak) {
        self.best_streak = self.consecutive_days;
    };
    self.last_increment_ms = now;

    event::emit(StreakTouched {
        streak_id: object::id(self),
        owner: self.owner,
        consecutive_days: self.consecutive_days,
        best_streak: self.best_streak,
        at_ms: now,
    });
    true
}

// === Accessors ===

public fun owner(s: &Streak): address { s.owner }

public fun consecutive_days(s: &Streak): u64 { s.consecutive_days }

public fun best_streak(s: &Streak): u64 { s.best_streak }

public fun last_increment_ms(s: &Streak): u64 { s.last_increment_ms }

public fun one_day_ms(): u64 { ONE_DAY_MS }
