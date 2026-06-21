// Tell the truth about a failed tx: a SafeMint assert (the seal doing its job, the
// whole Open rolling back atomically) is a FEATURE; a wallet rejection or an RPC/arg
// failure is NOT — and must not be dressed up as "the seal held." On-chain MoveAbort
// errors surface the defining module + abort code in the message, which we parse.

export type TxErrorKind = "seal" | "rejected" | "oracle" | "balance" | "error";

export interface TxErrorInfo {
  kind: TxErrorKind;
  title: string;
  detail: string;
}

export function classifyTxError(e: unknown): TxErrorInfo {
  const msg = (e instanceof Error ? e.message : String(e)) || "Unknown error";
  const low = msg.toLowerCase();

  if (low.includes("reject") || low.includes("denied") || low.includes("cancel")) {
    return { kind: "rejected", title: "Signature cancelled", detail: "You dismissed the wallet request — nothing was sent." };
  }

  // Our seal aborted: MoveAbort in module `safe_mint`. Code 0 = stale, 1 = oversize.
  if (low.includes("safe_mint")) {
    const code = abortCode(msg);
    if (code === 0)
      return {
        kind: "seal",
        title: "The seal held — oracle stale",
        detail:
          "At consume-time the oracle had aged past your freshness deadline, so the entire Open reverted atomically. No deposit, no half-open position — you were never exposed.",
      };
    if (code === 1)
      return {
        kind: "seal",
        title: "The seal held — over your max-loss cap",
        detail:
          "The realized cost exceeded your max-loss cap, so deposit + mint + hedge all rolled back in one atomic revert. Nothing was opened.",
      };
    return {
      kind: "seal",
      title: "The seal held — Open reverted atomically",
      detail: "SafeMint refused to seal, so the whole PTB rolled back. Either fully hedged in a fresh window, or nothing.",
    };
  }

  // Predict's own protocol guards (its oracle staleness / strike checks).
  if (low.includes("oracle_config") || (low.includes("oracle") && low.includes("stale"))) {
    return { kind: "oracle", title: "Oracle moved — Open reverted", detail: "The Predict protocol's own freshness guard fired; the trade rolled back. Retry on a fresh tick." };
  }

  if (low.includes("insufficient") || low.includes("notenough") || low.includes("balance")) {
    return {
      kind: "balance",
      title: "Insufficient balance",
      detail: "Not enough DUSDC (or the hedge coin) to fund this Open. Use the faucet, lower the size, or turn the Spot hedge off.",
    };
  }

  return { kind: "error", title: "Open failed", detail: msg.slice(0, 220) };
}

/** Extract the abort code from a MoveAbort message, e.g. `…name: Identifier("safe_mint")…}, 1)`. */
function abortCode(msg: string): number | null {
  const m =
    msg.match(/}\s*,\s*(\d+)\s*\)/) ?? // MoveAbort(MoveLocation { … }, <code>)
    msg.match(/abort[_ ]?code[:\s]+(\d+)/i);
  return m ? Number(m[1]) : null;
}
