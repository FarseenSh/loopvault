// LoopVault session = the user's PredictManager (shared; owner field == them) and
// their Streak (owned, soulbound). The PredictManager is the linchpin of the whole
// architecture: because the signer IS its owner, the `sender == owner` gates inside
// deposit/mint pass natively. We discover or create it on connect.
//
// PredictManager is a SHARED object, so it isn't returned by getOwnedObjects — we
// recover it from the PredictManagerCreated event the user's own tx emitted, and we
// cache the ids in localStorage for instant subsequent loads.

import type { useSuiClient } from "@mysten/dapp-kit";
import type { LoopVaultConfig } from "../config/loopvault.config";

// The configured JSON-RPC client type, derived from the dapp-kit hook so we don't
// depend on a specific @mysten/sui subpath (it moved between versions).
type SuiRpcClient = ReturnType<typeof useSuiClient>;

// Minimal structural shape of a tx object-change (only what we read).
type ObjChange = { type: string; objectType?: string; objectId?: string };

export interface Session {
  managerId?: string;
  streakId?: string;
}

const KEY = (addr: string) => `loopvault.session.${addr}`;

export function loadCachedSession(address: string): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY(address));
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveCachedSession(address: string, s: Session): void {
  if (typeof window === "undefined") return;
  try {
    const prev = loadCachedSession(address) ?? {};
    window.localStorage.setItem(KEY(address), JSON.stringify({ ...prev, ...s }));
  } catch {
    /* ignore quota / disabled storage */
  }
}

/**
 * Recover a session from chain when the cache is cold: the Streak via owned objects,
 * the (shared) PredictManager via the PredictManagerCreated event the user emitted.
 */
export async function recoverSession(
  client: SuiRpcClient,
  address: string,
  cfg: LoopVaultConfig,
): Promise<Session> {
  const out: Session = {};

  // Streak is owned + soulbound → findable directly.
  try {
    const owned = await client.getOwnedObjects({
      owner: address,
      filter: { StructType: `${cfg.loopvaultPkg}::streak::Streak` },
      options: { showType: true },
    });
    out.streakId = owned.data?.[0]?.data?.objectId;
  } catch {
    /* leave undefined */
  }

  // PredictManager is shared → recover its id from the creation event we emitted.
  try {
    const ev = await client.queryEvents({ query: { Sender: address }, limit: 50, order: "descending" });
    const created = ev.data.find((e) => e.type.endsWith("::predict_manager::PredictManagerCreated"));
    const mid = (created?.parsedJson as { manager_id?: string } | undefined)?.manager_id;
    if (mid) out.managerId = mid;
  } catch {
    /* leave undefined */
  }

  return out;
}

/** Pull the created PredictManager + Streak ids out of an onboarding tx's effects. */
export function parseOnboardingResult(
  changes: readonly ObjChange[] | null | undefined,
  cfg: LoopVaultConfig,
): Session {
  const out: Session = {};
  for (const c of changes ?? []) {
    if (c.type !== "created" || !c.objectType || !c.objectId) continue;
    if (c.objectType.startsWith(`${cfg.predictPkg}::predict_manager::PredictManager`)) out.managerId = c.objectId;
    else if (c.objectType.startsWith(`${cfg.loopvaultPkg}::streak::Streak`)) out.streakId = c.objectId;
  }
  return out;
}
