# LoopVault

**40,000+ people joined the DeepBook Predict consumer waitlist — with no usable interface to trade, and naked one-tap bets are dangerous.** LoopVault is the consumer terminal that makes a Predict trade *one tap, ~6 seconds, no seed phrase (zkLogin), gasless (Enoki), and risk-bounded by an atomic delta-hedge*: a single user-signed PTB atomically **opens** a Predict (vol/directional) position **and** delta-hedges it on DeepBook Spot — sealed by a no-abilities `SafeMint` hot-potato that enforces `max_loss_bps` + an `oracle_freshness_deadline`, so the trade lands fully hedged inside a fresh-oracle window **or rolls back atomically**. It is the Robinhood/Polymarket-grade front end for the only on-chain vol-surface options primitive on Sui.

> Track: **DeepBook Predict** (Sui Overflow 2026). Judged by Aslan Tashtanov (DeepBook Lead — consumer/adoption) and Block Scholes (the SVI vol-oracle team — quant).

---

## Status — Gate 1 complete ✅

The whole product rests on one claim: **deposit + open is all-or-nothing**. Before any UI, we proved it on the *real* `deepbook_predict` contracts (branch `predict-testnet-4-16`) with a `test_scenario` Move suite — **no DUSDC, no faucet, no live network required**:

| Test | Proves |
|---|---|
| `test_earn_supply_withdraw_roundtrip` | Earn mode: `supply` N → `withdraw` returns exactly N (clean raw-`Coin` round-trip). |
| `test_deposit_then_mint_persists` | Success path persists: after `deposit` + `mint`, `manager.position == quantity` and the cost left the deposited balance. |
| `test_deposit_persists_when_committed` | A *committed* deposit sticks — the counterfactual that makes the rollback proof meaningful. |
| `test_deposit_then_stale_mint_rolls_back` | **Atomicity:** `deposit` then `mint` against a stale oracle aborts (`EOracleStale`, code 6 in `oracle_config`) → whole tx reverts → deposit rolls back. On-thesis freshness guard. |
| `test_deposit_then_offgrid_strike_rolls_back` | **Atomicity:** second trigger — off-grid strike aborts (`EInvalidStrike`, code 2) before any cost is withdrawn → deposit rolls back. |

```
Test result: OK. Total tests: 5; passed: 5; failed: 0
```

The negative tests pin the **exact** abort code + location, so they cannot pass for the wrong reason — Move's per-transaction all-or-nothing semantics do the rest.

### Run it
```bash
brew install sui                 # Sui CLI (Move 2024)
./scripts/run-predict-tests.sh   # clones the pinned predict pkg, runs the suite
./scripts/run-predict-tests.sh loopvault   # just LoopVault's tests
```
The script reproduces `MystenLabs/deepbookv3@1159d79` into a gitignored `external/`, copies our tests (`contracts/predict-tests/`) into its `packages/predict/tests/`, and runs `sui move test`. See `contracts/README.md` for why the tests live inside that package.

---

## Repo layout
```
contracts/predict-tests/   LoopVault's atomicity + Earn tests, and a 6-dp test quote coin (our work)
scripts/sui-local.sh       Sui CLI pinned to this project's ISOLATED config (./.sui), never global
scripts/run-predict-tests.sh   Pinned-clone + copy-tests + `sui move test` runner
external/                  (gitignored) pinned MystenLabs/deepbookv3 clone — attributed dependency
00..03 + CLAUDE.md         Hackathon context, research, PRD, and the build blueprint
```

## What's next (not in this gate)
- **Gate 1b (live testnet):** once DUSDC lands, run the same flows as real PTBs against the deployed Predict object; link tx hashes here.
- The `loopvault` Move package (`SafeMint` hot-potato, `ShareCard`, `Streak`, config toggle), the DeepBook Spot delta-hedge leg, and the zkLogin/Enoki dApp.

## Confirmed early (de-risks the smile renderer)
The SVI surface event `OracleSVIUpdated` encodes `a:u64, b:u64, rho:i64::I64, m:i64::I64, sigma:u64` (all ×`FLOAT_SCALING`=1e9), where `i64::I64 = { magnitude:u64, is_negative:bool }`. `rho`/`m` are **signed structs** — decode both fields off-chain or the surface silently corrupts.
