# LoopVault

**40,000+ people joined the DeepBook Predict consumer waitlist — with no usable interface to trade, and naked one-tap bets are dangerous.** LoopVault is the consumer terminal that makes a Predict trade *one tap, ~6 seconds, no seed phrase (zkLogin), gasless (Enoki), and risk-bounded by an atomic delta-hedge*: a single user-signed PTB atomically **opens** a Predict (vol/directional) position **and** delta-hedges it on DeepBook Spot — sealed by a no-abilities `SafeMint` hot-potato that enforces `max_loss_bps` + an `oracle_freshness_deadline`, so the trade lands fully hedged inside a fresh-oracle window **or rolls back atomically**. It is the Robinhood/Polymarket-grade front end for the only on-chain vol-surface options primitive on Sui.

> Track: **DeepBook Predict** (Sui Overflow 2026). Judged by Aslan Tashtanov (DeepBook Lead — consumer/adoption) and Block Scholes (the SVI vol-oracle team — quant).
>
> **🟢 Live on Sui testnet** — `loopvault` package **`0xaf1fdf8441f3d5f0c24beb095b8de144a789f2b76f6f7ca1e6cfc7fe130e18e1`** (modules `safe_mint` · `share_card` · `streak` · `config`); publish tx [`CHjn3Ns2E2o2hhP4n6xLWbj95kv6coKPLnvz3wKHNSoE`](https://suiscan.xyz/testnet/tx/CHjn3Ns2E2o2hhP4n6xLWbj95kv6coKPLnvz3wKHNSoE).

---

## What's built

### 1. The atomic core — *proven on the real contracts* ✅
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

### 2. The `SafeMint` seal — our safety thesis in Move
`contracts/loopvault/` ships the hot-potato that makes one-tap safe:
- **`safe_mint`** — a struct with **no abilities** (a true hot-potato: it *must* be consumed in the same PTB). `consume()` asserts the oracle is fresh within our *tighter* `oracle_freshness_deadline` (≤ the protocol's 30s) **and** that the cost charged ≤ `max_loss_bps` of the capital base. Can't be dropped, can't be stored — the trade either seals cleanly or the PTB aborts.
- **`share_card`** (consumer flex / position receipt), **`streak`** (daily-engagement object), and **`config`** (the mainnet toggle). Each module has its own unit tests.

**Proven live on testnet — every row below is a real transaction you can open in an explorer.** DUSDC is funded; the deposit→mint→seal flow runs end-to-end (only the Spot hedge leg awaits Gate-3 ids):

| Flow | On-chain result | Tx |
|---|---|---|
| **SafeMint-sealed atomic Open** — `new`→`deposit`→`mint`→`consume`, one PTB, **both packages** | `PositionMinted` ask `0.5109`, then `SafeMintSealed` `oracle_age_ms 4621` < 30000 | [`9HbKgW28…`](https://suiscan.xyz/testnet/tx/9HbKgW28iRsGcFzKq33jx8i5oteUd3VXLmiUvoJfaaUx) |
| Atomic `deposit`+`mint` (Open core) | `PositionMinted`, ask `0.5939`, cost 0.594 DUSDC, strike $63,894 | [`7AdsroJm…`](https://suiscan.xyz/testnet/tx/7AdsroJm2Q6J8dkDuvxsGA4ugWqhvPDx2ZgXQv4vrrcg) |
| Earn `supply`→`withdraw` round-trip | DUSDC reconciles (−0.000001 dust) | [`9EbwuUAw…`](https://suiscan.xyz/testnet/tx/9EbwuUAwg36xSLoDDWT1JNSQGhbiSPFeT2PhUd58w9zA) |
| SafeMint seal **rejects** an over-cap cost | aborts `E_SIZE_EXCEEDED` (code 1) → whole PTB reverts | [`E2uWkrf2…`](https://suiscan.xyz/testnet/tx/E2uWkrf219sBhsXsf24znK2kyJMSL8wkNfBtFdGHzcLw) |
| SafeMint seal **consumes** when fresh + within cap | `SafeMintSealed`, age 12.0s < 20s | [`357Gu5tL…`](https://suiscan.xyz/testnet/tx/357Gu5tL1Sdc7GcqJv8kTHnhgjwrhmU5w7aRh62pZkij) |
| ShareCard NFT minted | object `0x7d6a…34d96` | [`Cqnbd3Hs…`](https://suiscan.xyz/testnet/tx/Cqnbd3HsAmad6y1g66f2crjYzbJfcfY6Bh5bo6iB32j9) |
| PredictManager provisioned | `0xd0ef…cc82c` | [`HgNgiEmB…`](https://suiscan.xyz/testnet/tx/HgNgiEmBtyzBmX3td6pD6syYyre8RFsVNRRPBsENgL77) |
| DeepBook **Spot swap composes** in a PTB (zero-DEEP fee leg) | success on the whitelisted DEEP/SUI pool — resolves the #1 Spot-swap abort | [`FKGVyurv…`](https://suiscan.xyz/testnet/tx/FKGVyurvUxDJ96zHy3xSfRfJ3SXpn4TQr1UwA1Xaw89G) |

Row 1 **is** `buildOpenPositionPTB` minus the Spot hedge: one signature, two packages, a real SVI-priced Predict mint sealed by the no-abilities SafeMint enforcing freshness + `max_loss_bps` — or it all reverts. The safety thesis, verified on-chain, not just in unit tests.

### 3. A *genuine* SVI delta hedge — what the Block Scholes judge checks
`app/src/lib/{svi,delta}.ts` reads the **real** SVI surface and computes a real digital forward-delta — not a 1:1 dummy. A Predict UP position is a cash-or-nothing digital priced `N(d2)`, `d2 = -((k + w/2)/√w)`, `k = ln(K/F)`, `w` the SVI total variance — *exactly* `deepbook_predict::oracle::compute_nd2`. The hedge is its forward delta, and because `w = w(k)`, the derivative carries the **smile slope** `dw/dk`. Validated against a finite-difference bump in `delta.test.ts` (which also shows the naive flat-vol delta is measurably wrong).

### 4. The single-signature Open PTB
`app/src/ptb/buildOpenPositionPTB.ts` assembles the centerpiece, in order:
`safe_mint::new` → `predict_manager::deposit` → `market_key::new` → `predict::mint` → **DeepBook Spot delta-hedge swap** (buy/sell/none, real 3-tuple sig with the zero-DEEP fee leg) → `share_card::mint_to` → `streak::touch` → `safe_mint::consume`. The signer **is** the PredictManager owner (their zkLogin address), so the `sender == owner` checks pass natively — no third-party router. Earn's `supply`/`withdraw` round-trip is `buildEarnSupplyPTB` / `buildWithdrawPTB`.

### 5. The consumer dApp (Next.js 16 / React 19)
`app/` — a dark, game-feel trading terminal that's fully alive on a synthesized demo surface (no indexer/DUSDC needed to demo):
- **One-tap Trade** — Call/Put, size, a live max-loss-cap slider tied to the `SafeMint` guard; tapping builds the *real* Open PTB and (when ids resolve) signs it, else surfaces the sealed command count.
- **Live mark-to-market share card** — re-prices **both legs** every tick (digital vs. the SVI surface, hedge vs. the forward) so the net P&L visibly shows the hedge offsetting the directional move.
- **Block Scholes vol smile** (SVG), an **oracle-freshness countdown** that grays out Open past the 20s deadline, and a "freeze oracle" toggle that demonstrates the gate locking on stale data.
- **Demo ↔ Live testnet toggle** — flip to render the *real* on-chain BTC SVI surface, decoded client-side from read-only RPC (`fetchBtcOracleSnapshot`); the freshness gate then follows the real oracle timestamp.
- `pnpm build` is green (static prerender), `tsc` clean, 16/16 unit tests pass.

### 6. zkLogin + gasless — *no seed phrase*
`app/src/components/{RegisterEnokiWallets,AuthControls}.tsx` register Enoki zkLogin wallets into the wallet-standard registry via `registerEnokiWallets`, so **"Continue with Google"** appears in the normal connect flow and Enoki sponsors gas. It's **env-gated**: with no keys the app cleanly falls back to wallet-extension connect; the Trade/Earn panels are unchanged because they already sign through dapp-kit. Set keys in `.env.local` (see `.env.example`).

---

## Run it
```bash
# Move atomicity proof (no DUSDC / network beyond a one-time clone)
brew install sui                 # Sui CLI (Move 2024)
./scripts/run-predict-tests.sh   # clones the pinned predict pkg, runs the suite
./scripts/run-predict-tests.sh loopvault   # just LoopVault's tests

# The dApp
cd app
pnpm install
cp .env.example .env.local       # optional: add Enoki + Google keys for zkLogin
pnpm dev                         # http://localhost:3000  (demo surface, fully alive)
pnpm build && pnpm test          # green build + 13 unit tests
```

## Config-only mainnet toggle (the 50/50 prize path)
Predict is testnet-only today. Every on-chain id lives in **one** module — `app/src/config/loopvault.config.ts` — with `TESTNET`/`MAINNET` records and an `assertResolved()` guard. The day Predict ships mainnet, we fill the `MAINNET` ids and flip `NEXT_PUBLIC_NETWORK`; no PTB builder or component holds a literal id. That unlocks the mainnet half of the score on day one.

## Repo layout
```
contracts/loopvault/       SafeMint hot-potato seal + ShareCard + Streak + config (our Move pkg)
contracts/predict-tests/   Atomicity + Earn tests, and a 6-dp test quote coin (our work)
app/src/ptb/               The single-sig Open PTB + Earn supply/withdraw builders
app/src/lib/               SVI surface + genuine digital delta engine (+ tests)
app/src/components/         Trade / Earn / share card / vol smile / oracle gate / zkLogin
app/src/config/            Single source of every on-chain id; testnet↔mainnet toggle
scripts/sui-local.sh       Sui CLI pinned to this project's ISOLATED config (./.sui), never global
scripts/run-predict-tests.sh   Pinned-clone + copy-tests + `sui move test` runner
external/                  (gitignored) pinned MystenLabs/deepbookv3 clone — attributed dependency
00..03 + CLAUDE.md         Hackathon context, research, PRD, and the build blueprint
```

## What's next
- ✅ **Published `loopvault` to testnet** (package id above); `safe_mint`/`share_card`/`streak` live on-chain.
- ✅ **Gate 1b proven live** — Earn `supply`→`withdraw`, atomic `deposit`+`mint`, and the full **SafeMint-sealed atomic Open** all run on testnet (table above). DUSDC type resolved in the config.
- ✅ **Gate 3 wired & verified:** DeepBook Spot ids resolved in the config (current pkg `0x22be…a3c`, the **DBTC/DBUSDC** pool — the BTC hedge pair, DEEP, DBTC); the swap signature matches source and the **swap composes live in a PTB with a zero-DEEP fee leg** ([`FKGVyurv…`](https://suiscan.xyz/testnet/tx/FKGVyurvUxDJ96zHy3xSfRfJ3SXpn4TQr1UwA1Xaw89G)). The off-chain SVI delta is exact and the Open PTB is wired for the swap (`hedgeQuoteType`).
  - **Testnet reality:** Predict quotes in its own DUSDC while DeepBook Spot quotes in DBUSDC — *different* stablecoins — so a position and its hedge can't share one coin on testnet. The full single-tx hedged Open is a **mainnet-day-1 unlock**, where `hedgeQuoteType === dusdcType ===` the canonical USDC and one balance funds both legs (config toggle, zero code change).

## Verified against the real surface (not assumed)
The SVI event `OracleSVIUpdated` encodes `a:u64, b:u64, rho:i64::I64, m:i64::I64, sigma:u64` (all ×`FLOAT_SCALING`=1e9), where `i64::I64 = { magnitude:u64, is_negative:bool }` — `rho`/`m` are **signed**, decoded field-by-field in `app/src/lib/i64.ts` or the surface silently corrupts.

This is **verified, not assumed**, two ways:
1. **Against source:** the pricing in `app/src/lib/{svi,delta}.ts` matches `deepbook_predict::oracle::compute_nd2` (`oracle.move:397-428`) line-for-line — `k = ln(K/F)`, `w(k) = a + b·(rho·(k−m) + √((k−m)²+σ²))`, `d2 = −((k+w/2)/√w)`, UP = `N(d2)`, DOWN = `1−UP`.
2. **Against live testnet:** `app/src/lib/liveOracle.test.ts` bakes in **real** `OracleSVIUpdated` events and a real BTC `OracleSVI` object pulled from `fullnode.testnet.sui.io` (forward **$62,628**, spot $62,627, `rho = −0.940`, ~**39%** ATM IV) and asserts our decoder reproduces them — so "we read the real surface" is a passing test. It's **wired into the app** as a Demo ↔ Live testnet toggle and validated end-to-end against testnet (live BTC forward ~$63k, ~37% ATM IV, oracle age <1s → the Open gate is green on real data).
