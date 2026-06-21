"use client";

// The user's LoopVault session: discover or create their PredictManager + Streak.
// Cache-first (instant on repeat visits), then chain recovery, then onboarding.
// Onboarding is one gasless (Enoki) tx: create_manager + streak::create.

import { useCallback, useEffect, useState } from "react";
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import { CFG } from "../config/loopvault.config";
import { buildOnboardingPTB } from "../ptb/buildOnboardingPTB";
import {
  loadCachedSession,
  parseOnboardingResult,
  recoverSession,
  saveCachedSession,
  type Session,
} from "../lib/session";

export type SessionStatus =
  | "disconnected"
  | "loading"
  | "ready"
  | "needs-onboarding"
  | "onboarding"
  | "error";

export interface LoopVaultSession {
  address?: string;
  managerId?: string;
  streakId?: string;
  status: SessionStatus;
  error?: string;
  onboard: () => Promise<void>;
  refresh: () => void;
}

export function useLoopVaultSession(): LoopVaultSession {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const address = account?.address;

  const [sess, setSess] = useState<Session>({});
  const [status, setStatus] = useState<SessionStatus>("disconnected");
  const [error, setError] = useState<string | undefined>();
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    if (!address) {
      setStatus("disconnected");
      setSess({});
      return;
    }
    setStatus("loading");
    setError(undefined);

    (async () => {
      const cached = loadCachedSession(address);
      if (cached?.managerId) {
        if (!cancelled) {
          setSess(cached);
          setStatus("ready");
        }
        return;
      }
      try {
        const rec = await recoverSession(client, address, CFG);
        if (cancelled) return;
        if (rec.managerId) saveCachedSession(address, rec);
        setSess(rec);
        setStatus(rec.managerId ? "ready" : "needs-onboarding");
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address, client, nonce]);

  const onboard = useCallback(async () => {
    if (!address) return;
    setStatus("onboarding");
    setError(undefined);
    try {
      const tx = buildOnboardingPTB({
        createManager: !sess.managerId,
        createStreak: !sess.streakId,
        owner: address,
      });
      const { digest } = await signAndExecute({ transaction: tx });
      const res = await client.waitForTransaction({ digest, options: { showObjectChanges: true } });
      const created = parseOnboardingResult(res.objectChanges, CFG);
      const next: Session = {
        managerId: sess.managerId ?? created.managerId,
        streakId: sess.streakId ?? created.streakId,
      };
      saveCachedSession(address, next);
      setSess(next);
      setStatus(next.managerId ? "ready" : "needs-onboarding");
    } catch (e) {
      setError((e as Error).message);
      setStatus("needs-onboarding");
    }
  }, [address, client, sess.managerId, sess.streakId, signAndExecute]);

  return {
    address,
    managerId: sess.managerId,
    streakId: sess.streakId,
    status,
    error,
    onboard,
    refresh,
  };
}
