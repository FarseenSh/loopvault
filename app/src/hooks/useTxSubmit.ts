"use client";

// One submit path for every PTB. If the user is on an Enoki (Google zkLogin) wallet
// and sponsorship is configured, the trade is GASLESS: build the tx-kind → ask the
// /api/sponsor backend to wrap it (sponsor pays gas) → user signs once → backend
// executes. Any other wallet (or a sponsorship hiccup before signing) falls back to
// normal sign-and-execute so the trade still goes through (user pays gas).

import { useCallback } from "react";
import {
  useCurrentAccount,
  useCurrentWallet,
  useSignAndExecuteTransaction,
  useSignTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { isEnokiWallet } from "@mysten/enoki";
import { toBase64 } from "@mysten/sui/utils";
import type { Transaction } from "@mysten/sui/transactions";
import { enokiEnabled } from "../config/enoki";

interface SponsorCreateResp { bytes: string; digest: string }
interface SponsorExecResp { digest: string }

async function postSponsor<T>(payload: Record<string, unknown>): Promise<T> {
  const r = await fetch("/api/sponsor", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(data?.error ? `sponsor: ${data.error}` : `sponsor ${r.status}`);
  return data;
}

/** Returns a submit(tx) → {digest} that sponsors Enoki wallets and falls back otherwise. */
export function useTxSubmit(): (tx: Transaction) => Promise<{ digest: string }> {
  const client = useSuiClient();
  const account = useCurrentAccount();
  const { currentWallet } = useCurrentWallet();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { mutateAsync: signTransaction } = useSignTransaction();

  return useCallback(
    async (tx: Transaction): Promise<{ digest: string }> => {
      const address = account?.address;
      const canSponsor = enokiEnabled && !!address && !!currentWallet && isEnokiWallet(currentWallet);

      if (canSponsor) {
        // Up to the point of signing, a sponsorship failure is safe to fall back from
        // (nothing has been signed or submitted yet).
        let created: SponsorCreateResp;
        try {
          tx.setSender(address);
          const kindBytes = await tx.build({ client, onlyTransactionKind: true });
          created = await postSponsor<SponsorCreateResp>({
            action: "create",
            transactionKindBytes: toBase64(kindBytes),
            sender: address,
          });
        } catch (err) {
          // Create failed. Usually the tx would abort on-chain (e.g. the SafeMint seal
          // rejecting an over-cap Open) — Enoki won't sponsor a failing tx and returns a
          // generic error, so diagnose precisely with a dry-run and surface the real
          // MoveAbort (lets classifyTxError show "the seal held", not a generic failure).
          const dry = await client
            .devInspectTransactionBlock({ sender: address, transactionBlock: tx })
            .catch(() => null);
          const abortErr = dry?.effects?.status?.error;
          if (abortErr) throw new Error(abortErr);
          // No abort → genuine sponsorship outage → fall back to user-paid signing.
          console.warn("[loopvault] sponsorship unavailable, paying gas instead:", err);
          const res = await signAndExecute({ transaction: tx });
          return { digest: res.digest };
        }
        // Past here we have a sponsored tx; sign + execute (no fallback — avoids double-submit).
        const { signature } = await signTransaction({ transaction: created.bytes });
        const executed = await postSponsor<SponsorExecResp>({
          action: "execute",
          digest: created.digest,
          signature,
        });
        return { digest: executed.digest };
      }

      const res = await signAndExecute({ transaction: tx });
      return { digest: res.digest };
    },
    [client, account, currentWallet, signAndExecute, signTransaction],
  );
}
