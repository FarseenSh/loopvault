// SINGLE SOURCE OF TRUTH for every on-chain id. Switching testnet → mainnet is a
// config-only change (Gate 6): the day Predict ships mainnet we fill MAINNET and
// flip NEXT_PUBLIC_NETWORK. No PTB builder or component holds a literal id.

export type Network = "testnet" | "mainnet";

export interface LoopVaultConfig {
  network: Network;
  /** deepbook_predict package id */
  predictPkg: string;
  /** the shared Predict object */
  predictSharedObj: string;
  /** the Predict registry object */
  predictRegistry: string;
  /** the live OracleSVI shared object (per underlying+expiry) */
  oracleSviId: string;
  /** full DUSDC coin type, e.g. 0x..::dusdc::DUSDC */
  dusdcType: string;
  /** DeepBook Spot package id */
  deepbookPkg: string;
  /** the Spot Pool<Base, DUSDC> used for the delta hedge (prefer zero-DEEP/whitelisted) */
  spotPoolId: string;
  /** full DEEP coin type */
  deepType: string;
  /** the hedge base coin type (e.g. DBTC / wBTC) */
  hedgeBaseType: string;
  /** the Spot pool's QUOTE coin type. On testnet this is DeepBook's DBUSDC, which
   *  DIFFERS from the Predict DUSDC; on mainnet both are the same canonical USDC. */
  hedgeQuoteType: string;
  /** our published loopvault package id */
  loopvaultPkg: string;
}

/** Marks an id that must be resolved (Gate 0/3/4/5) before any live use. */
export const PLACEHOLDER = "0x0000000000000000000000000000000000000000000000000000000000000000";
const TODO_TYPE = `${PLACEHOLDER}::TODO::TODO`;

// Verified testnet ids (00-HACKATHON-CONTEXT §3). Unknowns are PLACEHOLDER and
// resolved in the Day-1 gates: oracleSviId (Gate 4), dusdcType (Gate 0, from the
// faucet), Spot pool/DEEP/base (Gate 3), loopvaultPkg (Gate 5, on publish).
export const TESTNET: LoopVaultConfig = {
  network: "testnet",
  predictPkg: "0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138",
  predictSharedObj: "0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a",
  predictRegistry: "0x43af14fed5480c20ff77e2263d5f794c35b9fab7e2212903127062f4fe2a6e64",
  oracleSviId: PLACEHOLDER, // Gate 4: discover from the indexer / object query
  dusdcType: "0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC", // Gate 0: confirmed from faucet (6dp)
  deepbookPkg: "0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c", // Gate 3: current DeepBook Spot pkg (testnet)
  spotPoolId: "0x0dce0aa771074eb83d1f4a29d48be8248d4d2190976a5241f66b43ec18fa34de", // Gate 3: DBTC/DBUSDC Spot pool (the BTC hedge pair)
  deepType: "0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP", // Gate 3
  hedgeBaseType: "0x6502dae813dbe5e42643c119a6450a518481f03063febc7e20238e43b6ea9e86::dbtc::DBTC", // Gate 3: DBTC (BTC base)
  hedgeQuoteType: "0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC", // Gate 3: Spot quote (DBUSDC; != predict DUSDC on testnet)
  loopvaultPkg: "0xaf1fdf8441f3d5f0c24beb095b8de144a789f2b76f6f7ca1e6cfc7fe130e18e1", // Gate 5: PUBLISHED to testnet (tx CHjn3Ns2E2o2hhP4n6xLWbj95kv6coKPLnvz3wKHNSoE)
};

// Spot/DEEP are ALREADY live on mainnet; the Predict ids are filled day-1.
export const MAINNET: LoopVaultConfig = {
  ...TESTNET,
  network: "mainnet",
  // predictPkg / predictSharedObj / predictRegistry / oracleSviId / dusdcType -> Predict mainnet day-1.
  // On mainnet hedgeQuoteType === dusdcType === the canonical USDC, so one stablecoin funds both legs.
};

export const NETWORK: Network =
  (typeof process !== "undefined" && (process.env?.NEXT_PUBLIC_NETWORK as Network)) || "testnet";

export const CFG: LoopVaultConfig = NETWORK === "mainnet" ? MAINNET : TESTNET;

/** Field names that are still placeholders — call before any live PTB submission. */
export function unresolvedIds(cfg: LoopVaultConfig): string[] {
  return Object.entries(cfg)
    .filter(([, v]) => typeof v === "string" && (v === PLACEHOLDER || v.startsWith(PLACEHOLDER)))
    .map(([k]) => k);
}

/** Throw if any required id is still a placeholder. */
export function assertResolved(cfg: LoopVaultConfig): void {
  const missing = unresolvedIds(cfg);
  if (missing.length > 0) {
    throw new Error(`LoopVault config has unresolved ids: ${missing.join(", ")}`);
  }
}
