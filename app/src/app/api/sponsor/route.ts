// Enoki gas-station sponsor endpoint — makes the one-tap trade truly GASLESS.
//
// Flow (two calls from the client):
//   1) action:"create"  → Enoki builds a sponsored tx (sponsor pays gas) from the
//      client's transactionKindBytes, restricted to OUR move-call allowlist.
//   2) action:"execute" → after the user signs the sponsored bytes, Enoki adds the
//      sponsor signature and submits.
//
// The Enoki PRIVATE key lives ONLY here (server, process.env) — never NEXT_PUBLIC,
// never in the bundle. The allowlist is the abuse guard: even a hostile client can
// only get our own package calls sponsored (and those carry their own owner checks).

import { EnokiClient } from "@mysten/enoki";
import { CFG } from "../../../config/loopvault.config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Every move-call target the onboarding + Open PTBs can emit, from the live config. */
function allowedMoveCallTargets(): string[] {
  const c = CFG;
  return [
    `${c.loopvaultPkg}::safe_mint::new`,
    `${c.loopvaultPkg}::safe_mint::consume`,
    `${c.loopvaultPkg}::share_card::mint_to`,
    `${c.loopvaultPkg}::streak::create`,
    `${c.loopvaultPkg}::streak::touch_if_due`,
    `${c.predictPkg}::predict::create_manager`,
    `${c.predictPkg}::predict::mint`,
    `${c.predictPkg}::predict_manager::deposit`,
    `${c.predictPkg}::market_key::new`,
    // Hedge leg (only present when the user enables it):
    `0x2::coin::zero`,
    `${c.deepbookPkg}::pool::swap_exact_quote_for_base`,
    `${c.deepbookPkg}::pool::swap_exact_base_for_quote`,
  ];
}

interface SponsorBody {
  action?: "create" | "execute";
  transactionKindBytes?: string;
  sender?: string;
  digest?: string;
  signature?: string;
}

export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.ENOKI_PRIVATE_KEY;
  if (!apiKey) return json({ error: "sponsorship-unconfigured" }, 503);

  let body: SponsorBody;
  try {
    body = (await req.json()) as SponsorBody;
  } catch {
    return json({ error: "bad-json" }, 400);
  }

  const enoki = new EnokiClient({ apiKey });
  // Server-authoritative network — never trust a client-supplied value.
  const network = CFG.network === "mainnet" ? "mainnet" : "testnet";

  try {
    if (body.action === "create") {
      if (typeof body.transactionKindBytes !== "string" || typeof body.sender !== "string") {
        return json({ error: "missing-fields" }, 400);
      }
      const res = await enoki.createSponsoredTransaction({
        network,
        transactionKindBytes: body.transactionKindBytes,
        sender: body.sender,
        allowedMoveCallTargets: allowedMoveCallTargets(),
      });
      return json({ bytes: res.bytes, digest: res.digest }, 200);
    }

    if (body.action === "execute") {
      if (typeof body.digest !== "string" || typeof body.signature !== "string") {
        return json({ error: "missing-fields" }, 400);
      }
      const res = await enoki.executeSponsoredTransaction({ digest: body.digest, signature: body.signature });
      return json({ digest: res.digest }, 200);
    }

    return json({ error: "unknown-action" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : "sponsor-failed";
    return json({ error: message }, 502);
  }
}
