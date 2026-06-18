# contracts/

LoopVault's on-chain work and tests.

## `predict-tests/` — why these tests live inside the predict package

LoopVault's safety thesis is **atomic deposit + open**. To prove it on the real
contracts we need to stand up a *mintable* system — a `Predict` object, a fresh
ACTIVE `OracleSVI` with a strike grid, a funded `PredictManager`, and seeded vault
liquidity — and then drive `deposit` + `mint`.

Every constructor required for that is `public(package)` or `#[test_only]
public(package)` in `deepbook_predict` (verified on branch `predict-testnet-4-16`):

- `predict::create_test_predict<Quote>` — `#[test_only] public(package)`
- `oracle::create_oracle`, `oracle::create_oracle_cap`, `oracle::register_cap` — `public(package)`
- `predict::add_oracle_grid`, `predict::set_max_total_exposure_pct` — `public(package)`
- `predict_manager::new` — `public(package)` (only `predict::create_manager` is public)

An external package calling only the public API **cannot create a `Predict` or an
`OracleSVI` at all**. So the tests must compile *as part of* `deepbook_predict`'s
test target. They are LoopVault's own authored work; the surrounding package is the
attributed MystenLabs/deepbookv3 dependency (Apache-2.0), reproduced at a pinned
commit and **never committed** to this repo (it lives in gitignored `external/`).

`scripts/run-predict-tests.sh` copies these files into the pinned clone's
`packages/predict/tests/` and runs `sui move test`.

### Files
- `loopvault_atomicity_tests.move` — the Earn round-trip + the deposit/mint
  atomicity suite (2 success-path + 1 committed-counterfactual + 2
  rollback `expected_failure` tests pinned to exact abort codes).
- `tq.move` — a 6-decimal `Currency<TQ>` test fixture (Predict requires a 6-dp quote),
  built via `coin_registry::new_currency_with_otw` + `unwrap_for_testing`, mirroring
  the shipped `plp::init_for_testing` one-time-witness pattern.

## Later gates
The `loopvault` Move package — `SafeMint` (no-abilities hot-potato enforcing
`max_loss_bps` + `oracle_freshness_deadline`), `ShareCard`, `Streak`, and the
config-only mainnet toggle — will be added here as its own package once Gate 1b
(live testnet) is confirmed.
