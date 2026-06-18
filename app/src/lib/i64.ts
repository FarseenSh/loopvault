// Decoders for on-chain fixed-point values from deepbook_predict.
//
// All numeric oracle fields are scaled by FLOAT_SCALING (1e9). The SVI `rho` and
// `m` params are SIGNED and arrive as an `i64::I64` struct { magnitude: u64,
// is_negative: bool } — read BOTH fields or the smile silently corrupts.

export const FLOAT_SCALING = 1_000_000_000;

/** On-chain `deepbook_predict::i64::I64`, as surfaced in event JSON/BCS. */
export interface I64 {
  magnitude: string | number | bigint;
  is_negative: boolean;
}

/** Decode an i64::I64 to a signed JS number, dividing out FLOAT_SCALING. */
export function decodeI64Scaled(v: I64): number {
  const mag = Number(BigInt(v.magnitude as string | number | bigint));
  return (v.is_negative ? -mag : mag) / FLOAT_SCALING;
}

/** Decode an unsigned u64 fixed-point value, dividing out FLOAT_SCALING. */
export function decodeU64Scaled(v: string | number | bigint): number {
  return Number(BigInt(v)) / FLOAT_SCALING;
}

/** Encode a positive float to a u64 fixed-point integer (for PTB args). */
export function encodeScaled(x: number): bigint {
  if (x < 0) throw new Error("encodeScaled expects a non-negative value");
  return BigInt(Math.round(x * FLOAT_SCALING));
}
