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
  /** the hedge base coin type (e.g. wBTC) */
  hedgeBaseType: string;
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
  dusdcType: TODO_TYPE, // Gate 0: confirm full type on first faucet pull
  deepbookPkg: PLACEHOLDER, // Gate 3: DeepBook Spot pkg on testnet
  spotPoolId: PLACEHOLDER, // Gate 3: a zero-DEEP / whitelisted stablecoin pool
  deepType: TODO_TYPE, // Gate 3
  hedgeBaseType: TODO_TYPE, // Gate 3
  loopvaultPkg: PLACEHOLDER, // Gate 5: our published package id
};

// Spot/DEEP are ALREADY live on mainnet; the Predict ids are filled day-1.
export const MAINNET: LoopVaultConfig = {
  ...TESTNET,
  network: "mainnet",
  // predictPkg / predictSharedObj / predictRegistry / oracleSviId / dusdcType -> Predict mainnet day-1
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
