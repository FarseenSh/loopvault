// Land the SafeMint-sealed atomic Open live on testnet, proving the NEW on-chain
// seal end-to-end. Runs two transactions against the published loopvault package:
//   (A) a within-cap Open  → SafeMintSealed emitted (cost re-derived on-chain).
//   (B) an over-cap Open    → consume aborts E_SIZE_EXCEEDED, whole PTB reverts.
//
// Usage:  cd app && node scripts/open-live.mjs
// Signs with the project's ISOLATED keypair (../.sui/sui.keystore). Hedge is off
// (testnet DUSDC != DBUSDC); the Spot-hedge leg is a mainnet-day-1 unlock.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { SUI_CLOCK_OBJECT_ID } from "@mysten/sui/utils";

const HERE = dirname(fileURLToPath(import.meta.url));
const ADDR = "0x71a7ae403edf789b79acb3ea0f4e7bfc2eafcaa9ee30f82ba1f51058bceab690";
const MANAGER = "0xd0ef79ecf7b5027e8d97bad36b6f66b4f17d708382f9804f82eff2b0b06cc82c";
const LOOPVAULT = "0x7e8a79d1aa42cc453969f8765f67348e46fe51b08667b84c1e109b5d7d03fcf0";
const PREDICT_PKG = "0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138";
const PREDICT_OBJ = "0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a";
const DUSDC = "0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC";

function loadKeypair() {
  const arr = JSON.parse(readFileSync(resolve(HERE, "../../.sui/sui.keystore"), "utf8"));
  for (const b64 of arr) {
    const raw = Buffer.from(b64, "base64");
    const secret = raw.length === 33 ? raw.subarray(1) : raw; // strip the scheme flag byte
    const kp = Ed25519Keypair.fromSecretKey(new Uint8Array(secret));
    if (kp.toSuiAddress() === ADDR) return kp;
  }
  throw new Error(`no key for ${ADDR} in keystore`);
}

async function pickOracle(client) {
  const ev = await client.queryEvents({
    query: { MoveEventType: `${PREDICT_PKG}::oracle::OracleSVIUpdated` },
    limit: 25,
    order: "descending",
  });
  const ids = [...new Set(ev.data.map((e) => e.parsedJson?.oracle_id))].filter(Boolean);
  const objs = await client.multiGetObjects({ ids, options: { showContent: true } });
  const now = Date.now();
  const cands = objs
    .map((o) => ({ id: o.data?.objectId, f: o.data?.content?.fields }))
    .filter((x) => x.f && x.f.underlying_asset === "BTC" && x.f.active && Number(x.f.expiry) > now + 60_000)
    .map((x) => ({
      id: x.id,
      expiry: Number(x.f.expiry),
      forward: Number(x.f.prices?.fields?.forward ?? x.f.prices?.forward),
      ts: Number(x.f.timestamp),
    }))
    .filter((x) => Number.isFinite(x.forward) && now - x.ts < 25_000) // price-fresh
    .sort((a, b) => a.expiry - b.expiry);
  if (!cands.length) throw new Error("no fresh, active, pre-expiry BTC oracle right now");
  return cands[0];
}

function buildOpen({ oracleId, expiry, strike1e9, capital6, qty6, maxLossBps }) {
  const tx = new Transaction();
  const clock = tx.object(SUI_CLOCK_OBJECT_ID);
  const predict = tx.object(PREDICT_OBJ);
  const manager = tx.object(MANAGER);
  const oracle = tx.object(oracleId);

  const [safe, coin] = tx.moveCall({
    target: `${LOOPVAULT}::safe_mint::new`,
    typeArguments: [DUSDC],
    arguments: [tx.pure.u64(maxLossBps), coinWithBalance({ balance: capital6, type: DUSDC }), manager, tx.pure.u64(20_000), clock],
  });
  tx.moveCall({ target: `${PREDICT_PKG}::predict_manager::deposit`, typeArguments: [DUSDC], arguments: [manager, coin] });
  const key = tx.moveCall({
    target: `${PREDICT_PKG}::market_key::new`,
    arguments: [tx.pure.id(oracleId), tx.pure.u64(expiry), tx.pure.u64(strike1e9), tx.pure.bool(true)],
  });
  tx.moveCall({ target: `${PREDICT_PKG}::predict::mint`, typeArguments: [DUSDC], arguments: [predict, manager, oracle, key, tx.pure.u64(qty6), clock] });
  tx.moveCall({
    target: `${LOOPVAULT}::share_card::mint_to`,
    arguments: [manager, tx.pure.id(oracleId), tx.pure.u64(expiry), tx.pure.u64(strike1e9), tx.pure.bool(true), tx.pure.u8(0), tx.pure.u64(4000), clock],
  });
  tx.moveCall({ target: `${LOOPVAULT}::safe_mint::consume`, typeArguments: [DUSDC], arguments: [safe, manager, oracle, clock] });
  return tx;
}

const mkClient = () => new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" });
const ONLY_B = process.argv.includes("--reject-only");

async function run() {
  const kp = loadKeypair();
  const client = mkClient();
  const o = await pickOracle(client);
  const strike1e9 = BigInt(Math.round(o.forward / 1e9)) * 1_000_000_000n; // snap to the $1 grid
  console.log(`oracle ${o.id}  forward $${(o.forward / 1e9).toFixed(0)}  strike $${strike1e9 / 1_000_000_000n}  expiry in ${Math.round((o.expiry - Date.now()) / 60000)}m`);

  // (A) within-cap → seals
  if (!ONLY_B) {
    try {
      const tx = buildOpen({ oracleId: o.id, expiry: o.expiry, strike1e9, capital6: 5_000_000n, qty6: 1_000_000n, maxLossBps: 3000n });
      const r = await client.signAndExecuteTransaction({ signer: kp, transaction: tx, options: { showEffects: true, showEvents: true } });
      const sealed = r.events?.find((e) => e.type.endsWith("::safe_mint::SafeMintSealed"))?.parsedJson;
      const minted = r.events?.find((e) => e.type.endsWith("::predict::PositionMinted"))?.parsedJson;
      console.log(`\n(A) SEALED OPEN  status=${r.effects?.status?.status}  digest=${r.digest}`);
      console.log("    PositionMinted:", minted && { cost: minted.cost, ask: minted.ask_price, strike: minted.strike });
      console.log("    SafeMintSealed:", sealed);
      await client.waitForTransaction({ digest: r.digest }); // settle before (B) so versions are current
    } catch (e) {
      console.log("(A) FAILED:", String(e.message || e).slice(0, 300));
    }
  }

  // (B) over-cap → consume aborts E_SIZE_EXCEEDED on-chain; whole PTB reverts.
  // Fresh client so object versions reflect (A)'s mutations.
  try {
    const clientB = mkClient();
    const tx = buildOpen({ oracleId: o.id, expiry: o.expiry, strike1e9, capital6: 5_000_000n, qty6: 1_000_000n, maxLossBps: 1n });
    tx.setGasBudget(50_000_000n); // skip the gas-estimation dry-run so the abort COMMITS as a real failed tx
    const r = await clientB.signAndExecuteTransaction({ signer: kp, transaction: tx, options: { showEffects: true } });
    console.log(`\n(B) status=${r.effects?.status?.status} digest=${r.digest}  err=${JSON.stringify(r.effects?.status)}`);
  } catch (e) {
    const m = String(e.message || e);
    const dg = m.match(/[A-HJ-NP-Za-km-z1-9]{43,46}/)?.[0];
    console.log(`\n(B) SEAL REJECTED over-cap (expected) — ${m.includes("safe_mint") ? "MoveAbort in safe_mint (E_SIZE_EXCEEDED)" : "abort"}${dg ? `  digest=${dg}` : ""}: ${m.slice(0, 220)}`);
  }
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
