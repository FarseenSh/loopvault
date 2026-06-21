// SPDX-License-Identifier: Apache-2.0
//
// SafeMint — LoopVault's invariant seal. THE safety thesis, as a type.
//
// `SafeMint` has NO abilities (no key/store/copy/drop). Once `new` creates one
// inside a PTB it MUST be threaded to `consume` before the PTB ends, or the
// transaction fails to type-check. So the Open-Position PTB is forced to end with
// `consume`, which re-asserts — entirely from ON-CHAIN state, never caller input:
//   (a) the oracle the mint priced against is fresh within OUR (tighter) deadline,
//       read from `oracle::timestamp` (the real on-chain update time), and
//   (b) the REALIZED mint cost is within `max_loss_bps` of the user's capital.
//
// The realized cost is measured EXACTLY, with no re-pricing: `new` snapshots the
// PredictManager's balance before the deposit and records the deposit Coin's real
// value; `consume` reads the balance again at the end. Since the only thing that
// moves the manager balance in the Open PTB is the deposit (+) and the mint (−cost)
// — the Spot hedge swaps the user's own coins, not the manager balance —
//   cost_charged = (pre_balance + deposit) − balance_now
// is precisely the DUSDC the mint pulled. No client-supplied numbers, no estimate.
//
// Any violation aborts the whole PTB → the deposit + mint + hedge all roll back.
// "Fully hedged inside a fresh window, or you never traded" becomes a property of
// the type system bound to real protocol state, not a frontend promise.
//
// This is ADDITIVE to the protocol's own `assert_live_oracle` (30s). `new` even
// refuses to build a seal looser than that 30s — our deadline is strictly tighter.
//
// Earlier versions took `cost_charged`/`oracle_ts_ms`/`deposit_amount` as plain
// caller arguments — which made the seal a client attestation. This version derives
// all three from chain state, closing that loophole.
module loopvault::safe_mint;

use sui::clock::{Self, Clock};
use sui::coin::Coin;
use sui::event;
use deepbook_predict::predict_manager::PredictManager;
use deepbook_predict::oracle::{Self, OracleSVI};

// === Errors ===
const E_ORACLE_STALE: u64 = 0; // oracle age > our deadline (or oracle in the future)
const E_SIZE_EXCEEDED: u64 = 1; // realized cost / capital > max_loss_bps
const E_DEADLINE_TOO_LOOSE: u64 = 2; // deadline must be in (0, protocol staleness]
const E_INVALID_MAX_LOSS: u64 = 3; // max_loss_bps must be in (0, 10_000]
const E_ZERO_DEPOSIT: u64 = 4; // deposited capital must be > 0
const E_BALANCE_ANOMALY: u64 = 5; // manager balance grew between new and consume (impossible in a well-formed Open)

// === Constants ===
const BPS_DENOMINATOR: u64 = 10_000;
/// Predict's own oracle staleness guard (`deepbook_predict::constants`). Our
/// freshness deadline must be no looser than this.
const PROTOCOL_STALENESS_MS: u64 = 30_000;

// === Structs ===

/// Hot-potato. NO abilities ⇒ cannot be stored, copied, or dropped; the only way
/// to dispose of it is `consume`.
public struct SafeMint {
    /// Max realized position cost as basis points of capital (the size cap).
    max_loss_bps: u64,
    /// The manager's Quote balance BEFORE this PTB's deposit — snapshotted on-chain
    /// in `new`, so the cost measurement is exact regardless of any prior balance.
    pre_balance: u64,
    /// The Quote actually funded this PTB — read from the deposit Coin in `new`.
    deposit_amount: u64,
    /// Tighter-than-protocol max oracle age (ms). UX target ~20_000 < 30_000.
    oracle_freshness_deadline: u64,
    /// Clock at creation — anchors the freshness window for telemetry.
    opened_at_ms: u64,
}

// === Events ===

public struct SafeMintSealed has copy, drop, store {
    /// Realized cost = (pre_balance + deposit_amount) − balance_now. Exact.
    cost_charged: u64,
    /// Capital backing the position = pre_balance + deposit_amount.
    capital: u64,
    max_loss_bps: u64,
    oracle_age_ms: u64,
    oracle_freshness_deadline: u64,
}

// === Public Functions ===

/// Command #1 of the Open PTB. Snapshots the manager's current Quote balance and
/// the deposit Coin's REAL value (both read on-chain, not caller-asserted), then
/// hands the same Coin back so the PTB threads it straight into the deposit.
/// Rejects seals looser than the protocol guard or with a degenerate size cap.
public fun new<Quote>(
    max_loss_bps: u64,
    deposit: Coin<Quote>,
    manager: &PredictManager,
    oracle_freshness_deadline: u64,
    clock: &Clock,
): (SafeMint, Coin<Quote>) {
    let deposit_amount = deposit.value();
    let pre_balance = manager.balance<Quote>();
    let safe = build_safe(max_loss_bps, pre_balance, deposit_amount, oracle_freshness_deadline, clock);
    (safe, deposit)
}

/// Final command of the Open PTB — the ONLY way to destroy a `SafeMint`.
/// Pass the SAME manager that was deposited into and minted from, and the oracle
/// the mint priced against. Re-derives the realized cost from the manager's balance
/// delta and reads the oracle's real timestamp — both from chain state. Any
/// violation aborts the whole PTB, so the deposit rolls back.
public fun consume<Quote>(self: SafeMint, manager: &PredictManager, oracle: &OracleSVI, clock: &Clock) {
    let SafeMint {
        max_loss_bps,
        pre_balance,
        deposit_amount,
        oracle_freshness_deadline,
        opened_at_ms: _,
    } = self;
    let now = clock::timestamp_ms(clock);

    // (a) Oracle fresh within OUR (tighter) deadline, from the real on-chain
    //     update timestamp. `now >= oracle_ts` rejects a future-dated oracle.
    let oracle_ts = oracle::timestamp(oracle);
    assert!(now >= oracle_ts, E_ORACLE_STALE);
    let oracle_age_ms = now - oracle_ts;

    // (b) Realized cost = capital deposited this PTB minus what remains. The mint
    //     only ever withdraws, so balance_now <= capital.
    let capital = pre_balance + deposit_amount;
    let balance_now = manager.balance<Quote>();
    assert!(capital >= balance_now, E_BALANCE_ANOMALY);
    let cost_charged = capital - balance_now;

    assert_invariants(max_loss_bps, capital, oracle_freshness_deadline, cost_charged, oracle_age_ms);

    event::emit(SafeMintSealed {
        cost_charged,
        capital,
        max_loss_bps,
        oracle_age_ms,
        oracle_freshness_deadline,
    });
}

// === Internal ===

fun build_safe(
    max_loss_bps: u64,
    pre_balance: u64,
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
        pre_balance,
        deposit_amount,
        oracle_freshness_deadline,
        opened_at_ms: clock::timestamp_ms(clock),
    }
}

/// The pure size+freshness check, factored out so it can be unit-tested with
/// crafted values (the full `consume` reads real on-chain Manager/Oracle objects,
/// which can only be built inside the predict package). `consume` calls this with
/// values it derives from chain state.
fun assert_invariants(
    max_loss_bps: u64,
    capital: u64,
    oracle_freshness_deadline: u64,
    cost_charged: u64,
    oracle_age_ms: u64,
) {
    assert!(oracle_age_ms <= oracle_freshness_deadline, E_ORACLE_STALE);
    // size_bps = cost_charged / capital <= max_loss_bps / 10_000.
    // Cross-multiplied in u128 to avoid overflow.
    assert!(
        (cost_charged as u128) * (BPS_DENOMINATOR as u128)
            <= (max_loss_bps as u128) * (capital as u128),
        E_SIZE_EXCEEDED,
    );
}

// === Read-only accessors (let the PTB thread values without re-reading) ===

public fun max_loss_bps(self: &SafeMint): u64 { self.max_loss_bps }

public fun pre_balance(self: &SafeMint): u64 { self.pre_balance }

public fun deposit_amount(self: &SafeMint): u64 { self.deposit_amount }

public fun capital(self: &SafeMint): u64 { self.pre_balance + self.deposit_amount }

public fun oracle_freshness_deadline(self: &SafeMint): u64 { self.oracle_freshness_deadline }

public fun opened_at_ms(self: &SafeMint): u64 { self.opened_at_ms }

/// The protocol staleness ceiling our deadline must stay within (for UIs).
public fun protocol_staleness_ms(): u64 { PROTOCOL_STALENESS_MS }

// === Test-only helpers ===

/// Build a seal from raw numbers (bypassing the on-chain manager/coin reads) so the
/// `new` validation + accessors can be unit-tested without a PredictManager.
#[test_only]
public fun new_for_testing(
    max_loss_bps: u64,
    pre_balance: u64,
    deposit_amount: u64,
    oracle_freshness_deadline: u64,
    clock: &Clock,
): SafeMint {
    build_safe(max_loss_bps, pre_balance, deposit_amount, oracle_freshness_deadline, clock)
}

/// Exercise the size/freshness math directly (the boundary cases `consume`
/// enforces) without standing up a Predict system.
#[test_only]
public fun assert_invariants_for_testing(
    max_loss_bps: u64,
    capital: u64,
    oracle_freshness_deadline: u64,
    cost_charged: u64,
    oracle_age_ms: u64,
) {
    assert_invariants(max_loss_bps, capital, oracle_freshness_deadline, cost_charged, oracle_age_ms);
}

/// Destroy a SafeMint in tests (it has no `drop`, and `consume` needs real
/// on-chain objects).
#[test_only]
public fun destroy_for_testing(self: SafeMint) {
    let SafeMint {
        max_loss_bps: _,
        pre_balance: _,
        deposit_amount: _,
        oracle_freshness_deadline: _,
        opened_at_ms: _,
    } = self;
}
