# LoopVault

**40,000+ people joined the DeepBook Predict consumer waitlist — with no usable interface to trade, and naked one-tap bets are dangerous.** LoopVault is the consumer terminal that makes a Predict trade *one tap, ~6 seconds, no seed phrase (zkLogin), gasless (Enoki), and risk-bounded by an atomic delta-hedge*: a single user-signed PTB atomically **opens** a Predict (vol/directional) position **and** delta-hedges it on DeepBook Spot — sealed by a no-abilities `SafeMint` hot-potato that **re-derives the realized cost and the oracle's freshness on-chain** and rolls the whole trade back unless it lands inside a fresh-oracle window, within your max-loss cap. It is the Robinhood/Polymarket-grade front end for the only on-chain vol-surface options primitive on Sui.

> Track: **DeepBook Predict** (Sui Overflow 2026). Judged by Aslan Tashtanov (DeepBook Lead — consumer/adoption) and Block Scholes (the SVI vol-oracle team — quant).
>
> **🟢 Live on Sui testnet** — `loopvault` package **`0x7e8a79d1aa42cc453969f8765f67348e46fe51b08667b84c1e109b5d7d03fcf0`** (modules `safe_mint` · `share_card` · `streak` · `config`); publish tx [`8qXSuH3b…`](https://suiscan.xyz/testnet/tx/8qXSuH3bpxEMjnQYjaSs7W512pJXX5BDWoXkXoBb6ZiG). It links against the **real** `deepbook_predict` package, so the seal calls into the live protocol.

---

## The safety thesis, now enforced on-chain (not by the client)

The whole product rests on one claim: **you land fully hedged inside a fresh-oracle window, or you never traded at all.** `SafeMint` is a struct with **no abilities** — a true hot-potato that *must* be consumed in the same PTB or the transaction fails to type-check. Its `consume` re-asserts, entirely from **on-chain state**:

- **Realized cost ≤ `max_loss_bps` of your capital.** `new` snapshots the `PredictManager` balance before the deposit and reads the deposit coin's real value; `consume` reads the balance again at the end. The only things that move the manager balance in the Open PTB are the deposit (+) and the mint (−cost), so `cost = (pre_balance + deposit) − balance_now` is *exactly* the DUSDC the mint pulled — measured, never asserted by the caller.
- **Oracle fresh within our tighter deadline**, read from `oracle::timestamp` (the real on-chain update time), strictly tighter than the protocol's own 30s `assert_live_oracle`.

> An earlier version accepted `cost_charged` / `oracle_ts` / `deposit_amount` as **caller arguments** — which made the seal a frontend attestation. This version derives all three from chain state, so the "atomic risk bound" is a property of the type system bound to real protocol state. *That is the difference between a hot-potato that looks like a guarantee and one that is one.*

**Proven live on testnet — every row is a real transaction you can open in an explorer:**

| Flow | On-chain result | Tx |
|---|---|---|
| **SafeMint-sealed atomic Open** — `new`→`deposit`→`market_key`→`mint`→`ShareCard`→`consume`, one PTB, both packages | `PositionMinted` cost **0.502695**; `SafeMintSealed` **cost_charged 502695 == the minted cost** (re-derived on-chain), oracle_age **475ms** < 20000 | [`E4dGnUgv…`](https://suiscan.xyz/testnet/tx/E4dGnUgvZBvVnvqjCp4svXyGhaxmjgg65mc8BYWbBWfd) |
| **Seal rejects an over-cap Open** — same PTB, `max_loss_bps` too tight | **status `failure`** — `MoveAbort … safe_mint::assert_invariants, 1` (E_SIZE_EXCEEDED) **in command 6** → whole PTB reverts, deposit rolls back | [`BQqzAAbH…`](https://suiscan.xyz/testnet/tx/BQqzAAbHMv4WQfBQ2esJoA6Wk1t5VZfjvzKmjbdtgiVd) |
| Earn `supply`→`withdraw` round-trip | DUSDC reconciles | [`9EbwuUAw…`](https://suiscan.xyz/testnet/tx/9EbwuUAwg36xSLoDDWT1JNSQGhbiSPFeT2PhUd58w9zA) |
| DeepBook **Spot swap composes** in a PTB (zero-DEEP fee leg) | success on the whitelisted pool — resolves the #1 Spot-swap abort | [`FKGVyurv…`](https://suiscan.xyz/testnet/tx/FKGVyurvUxDJ96zHy3xSfRfJ3SXpn4TQr1UwA1Xaw89G) |
| PredictManager (owner == the signer) | `0xd0ef…cc82c` | [`HgNgiEmB…`](https://suiscan.xyz/testnet/tx/HgNgiEmBtyzBmX3td6pD6syYyre8RFsVNRRPBsENgL77) |

Row 1 **is** `buildOpenPositionPTB` (minus the Spot hedge leg — see *Hedge, honestly* below): one signature, two packages, a real SVI-priced Predict mint sealed by the no-abilities `SafeMint` enforcing freshness + `max_loss_bps` from chain state — or it all reverts (row 2). Reproduce both with `cd app && node scripts/open-live.mjs`.

---

## What's built

### 1. The atomic core — proven on the real contracts ✅
Before any UI, we proved deposit + open is all-or-nothing on the *real* `deepbook_predict` contracts (branch `predict-testnet-4-16`, pinned) with a `test_scenario` suite — **no DUSDC, no faucet, no live network**:

| Test | Proves |
|---|---|
| `test_earn_supply_withdraw_roundtrip` | Earn: `supply` N → `withdraw` returns exactly N. |
| `test_deposit_then_mint_persists` | Success path persists: `manager.position == quantity`, cost left the deposit. |
| `test_deposit_persists_when_committed` | A committed deposit sticks — the counterfactual that makes the rollback proof meaningful. |
| `test_deposit_then_stale_mint_rolls_back` | **Atomicity:** stale oracle → `EOracleStale` (code 6, `oracle_config`) → deposit rolls back. |
| `test_deposit_then_offgrid_strike_rolls_back` | **Atomicity:** off-grid strike → `EInvalidStrike` (code 2) before any cost is withdrawn. |
| `test_compute_price_golden_atm_digital` | **Cross-language golden vector:** on-chain `oracle::compute_price` for fixed SVI params ∈ [0.480011, 0.480111] — the band the TS engine must reproduce. |

`Move: 6/6 (predict suite) + 16/16 (loopvault unit) · TS: 21/21`. Negative tests pin the **exact** abort code + location, so they can't pass for the wrong reason.

### 2. A *genuine* SVI delta hedge — verified against the chain, not assumed
`app/src/lib/{svi,delta}.ts` reads the **real** SVI surface and computes a real digital forward-delta — not a 1:1 dummy. A Predict UP position is a cash-or-nothing digital priced `N(d2)`, `d2 = −((k + w/2)/√w)`, `k = ln(K/F)`, `w` the SVI total variance — *exactly* `deepbook_predict::oracle::compute_nd2`. The hedge is its forward delta, and because `w = w(k)`, the derivative carries the **smile slope** `dw/dk`. Validated three ways:
- **Finite-difference** bump (`delta.test.ts`) — and the test proves the naive flat-vol delta is measurably *wrong*.
- **Cross-language golden vector** — the same SVI params run through the on-chain `compute_price` (Move test) and the TS `binaryUpPrice` agree to <1e-4 (closing the language boundary, not asserting it).
- **Against live testnet** — `liveOracle.test.ts` bakes in a real `OracleSVIUpdated` event + `OracleSVI` object and asserts the decoder reproduces it (forward $62,628, `rho = −0.940`, signed `i64`).

### 3. The single-signature Open PTB
`app/src/ptb/buildOpenPositionPTB.ts` assembles the centerpiece, in order:
`safe_mint::new` → `predict_manager::deposit` → `market_key::new` → `predict::mint` → **DeepBook Spot delta-hedge** (buy/sell/none, real 3-tuple sig + zero-DEEP fee leg) → `share_card::mint_to` → `streak::touch_if_due` → `safe_mint::consume`. The signer **is** the PredictManager owner, so the `sender == owner` gates pass natively — no third-party router.

### 4. The consumer dApp (Next.js 16 / React 19) — the Open actually executes
`app/` — a dark, game-feel terminal that **submits the real Open on testnet**:
- **zkLogin onboarding** (`useLoopVaultSession`) — on connect we discover the user's `PredictManager` (cache → chain-event recovery), and if absent, one gasless onboarding tx (`predict::create_manager` + `streak::create`) creates it owned by their zkLogin address. The linchpin that makes the owner-gates pass.
- **One-tap Trade** — Call/Put, stake/contracts, a live max-loss-cap slider tied to the `SafeMint` guard; tapping against the **live oracle** signs + submits the real Open. An over-cap tap submits anyway and lets the seal reject it — the demo's killer beat, on-chain.
- **Honest oracle freshness** — the gate watches the **price feed** (~1s, the only clock the protocol/seal can enforce) *and* separately surfaces the **SVI surface age** (`update_svi` never bumps `oracle.timestamp`), so you always know how fresh the smile your delta uses is.
- **Honest errors** — a real `safe_mint` abort reads as "the seal held"; a wallet rejection or RPC error does not (`lib/errors.ts`).
- **Earn** — `supply` → **and Withdraw** round-trip, both live.
- **Social** — provenance-checked `ShareCard` NFT (only mintable for a position your manager actually holds), an OG-image route (`/api/card/[id]`), a copy-trade deep link, and a real **LLM** vol-regime line (`/api/regime`, Claude) with a deterministic fallback honestly labeled `SURFACE` vs `AI`.
- **Demo ↔ Live testnet toggle**, Block Scholes vol smile (SVG), oracle countdown, mobile-first PWA. `pnpm build` green, `tsc` clean, **21/21** unit tests pass.

### 5. zkLogin + gasless — no seed phrase
`RegisterEnokiWallets`/`AuthControls` register Enoki zkLogin (Google) into the wallet-standard registry, so **"Continue with Google"** appears in the normal connect flow and Enoki sponsors gas. Env-gated: with no keys the app cleanly falls back to wallet-extension connect (`app/.env.example`).

---

## Hedge, honestly (testnet vs mainnet)
The Open PTB composes the Predict mint **and** the DeepBook Spot hedge in one signature (the builder + `ptb.test.ts` pin the exact command order; the Spot swap is proven composing in a PTB, tx `FKGVyurv…`). On **testnet**, Predict quotes in its own **DUSDC** while DeepBook Spot quotes in **DBUSDC** — *different* stablecoins — so a single-coin hedged Open isn't possible without also holding DBUSDC. The proven live Open is therefore `deposit → mint → seal` (hedge toggle off), and the single-tap, one-balance hedged Open is a **mainnet-day-1 unlock** (`hedgeQuoteType === dusdcType ===` the canonical USDC), flipped by config with zero code change. The genuine SVI delta that *sizes* the hedge (with correct per-coin decimals + a slippage guard) is exact and golden-vector-tested today.

## Run it
```bash
# Move proofs (clones the pinned predict pkg into ./external, gitignored)
brew install sui
./scripts/run-predict-tests.sh                 # atomicity + golden vector on the REAL predict pkg
cd contracts/loopvault && sui move test         # SafeMint / ShareCard / Streak units (16/16)

# Land the sealed Open + the over-cap rejection live (uses the project's isolated key)
cd app && node scripts/open-live.mjs

# The dApp
cd app && pnpm install
cp .env.example .env.local                       # optional: Enoki + Google (zkLogin), ANTHROPIC_API_KEY (AI line)
pnpm dev                                          # http://localhost:3000
pnpm build && pnpm test                           # green build + 21 tests
```

## Config-only mainnet toggle (the 50/50 prize path)
Every on-chain id lives in **one** module — `app/src/config/loopvault.config.ts` — with `TESTNET`/`MAINNET` records and an `assertResolved()` guard. The day Predict ships mainnet we fill the `MAINNET` ids and flip `NEXT_PUBLIC_NETWORK`; no PTB builder or component holds a literal id, and one canonical USDC funds both the position and its hedge.

## Repo layout
```
contracts/loopvault/       SafeMint seal (binds cost+oracle on-chain) + ShareCard + Streak + config
contracts/predict-tests/   Atomicity + golden-vector tests against the real predict pkg
app/src/ptb/               Open PTB + onboarding + Earn supply/withdraw builders
app/src/lib/               SVI surface + genuine digital delta + session + errors + copy-trade
app/src/hooks/             useLoopVaultSession (manager/streak), live oracle, market feed
app/src/components/        Trade / Earn / share card / vol smile / oracle gate / zkLogin
app/src/app/api/           OG share image + LLM regime route
app/scripts/open-live.mjs  Lands the sealed Open + the over-cap rejection on testnet
00..03 + CLAUDE.md         Hackathon context, research, PRD, build blueprint
```

## Verified against the real surface (not assumed)
The SVI event `OracleSVIUpdated` encodes `a:u64, b:u64, rho:i64::I64, m:i64::I64, sigma:u64` (all ×`FLOAT_SCALING`=1e9), where `i64::I64 = { magnitude:u64, is_negative:bool }` — `rho`/`m` are **signed**, decoded field-by-field in `app/src/lib/i64.ts` or the surface silently corrupts. Verified against `oracle.move:397-428` line-for-line **and** against live testnet data — both as passing tests.
