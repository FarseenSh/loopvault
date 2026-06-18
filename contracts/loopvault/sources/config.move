// SPDX-License-Identifier: Apache-2.0
//
// On-chain mirror of the network this package instance targets. The canonical
// IDs (Predict pkg / shared obj / registry / DUSDC / Spot pool / DEEP / oracle)
// live in the TS config and are passed into PTBs — so retargeting to mainnet is a
// config-only change. This module exists so a redeploy can carry an explicit
// `NETWORK` marker for the "Predict mainnet day-1" toggle (Gate 6).
module loopvault::config;

const NETWORK: vector<u8> = b"testnet"; // -> b"mainnet" on Predict mainnet day-1
const VERSION: u64 = 1;

/// The network this published instance targets ("testnet" | "mainnet").
public fun network(): vector<u8> { NETWORK }

public fun is_testnet(): bool { NETWORK == b"testnet" }

public fun is_mainnet(): bool { NETWORK == b"mainnet" }

public fun version(): u64 { VERSION }
