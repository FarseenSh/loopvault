// Copy-trade payload codec. A ShareCard links to /?copy=<token>; decoding the
// token pre-fills the one-tap Open so a friend lands on the SAME Predict leg
// (oracle + strike + direction) in ~6s. Pure & isomorphic: works in the browser
// (btoa/atob) and in Node (Buffer) so the OG route and the client share it.

/** The minimal trade shape a ShareCard encodes — enough to reconstruct the Open. */
export interface CopyPayload {
  /** the OracleSVI shared-object id this position reads */
  oracleId: string;
  /** expiry in ms since epoch (matches the on-chain expiry_ms) */
  expiryMs: number;
  /** strike in USD * FLOAT_SCALING (1e9), as the card stores it */
  strike: number;
  /** direction sense for binary legs (true = up) */
  isUp: boolean;
  /** 0 = call, 1 = put, 2 = straddle (matches share_card direction u8) */
  direction: number;
}

/** Base64 → URL-safe base64 (no padding): +→-, /→_, strip trailing =. */
function toBase64Url(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** URL-safe base64 → standard base64 (re-add padding). */
function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  return pad === 0 ? b64 : b64 + "=".repeat(4 - pad);
}

/** Encode a UTF-8 string to standard base64 in browser or Node. */
function encodeBase64(s: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(s, "utf-8").toString("base64");
  // Browser: btoa needs a binary string; round-trip through UTF-8 bytes.
  if (typeof btoa !== "undefined") {
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }
  throw new Error("no base64 encoder available");
}

/** Decode standard base64 to a UTF-8 string in browser or Node. */
function decodeBase64(b64: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(b64, "base64").toString("utf-8");
  if (typeof atob !== "undefined") {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  throw new Error("no base64 decoder available");
}

/** Serialize a payload to a URL-safe, padding-free base64 token. */
export function encodeCopy(p: CopyPayload): string {
  const json = JSON.stringify({
    oracleId: p.oracleId,
    expiryMs: p.expiryMs,
    strike: p.strike,
    isUp: p.isUp,
    direction: p.direction,
  });
  return toBase64Url(encodeBase64(json));
}

/** Inverse of `encodeCopy`. Returns null on any malformed / wrong-typed input. */
export function decodeCopy(s: string): CopyPayload | null {
  if (typeof s !== "string" || s.length === 0) return null;
  try {
    const json = decodeBase64(fromBase64Url(s));
    const o: unknown = JSON.parse(json);
    if (typeof o !== "object" || o === null) return null;
    const r = o as Record<string, unknown>;
    if (typeof r.oracleId !== "string" || r.oracleId.length === 0) return null;
    if (typeof r.expiryMs !== "number" || !Number.isFinite(r.expiryMs)) return null;
    if (typeof r.strike !== "number" || !Number.isFinite(r.strike)) return null;
    if (typeof r.isUp !== "boolean") return null;
    if (typeof r.direction !== "number" || !Number.isFinite(r.direction)) return null;
    return {
      oracleId: r.oracleId,
      expiryMs: r.expiryMs,
      strike: r.strike,
      isUp: r.isUp,
      direction: r.direction,
    };
  } catch {
    return null;
  }
}
