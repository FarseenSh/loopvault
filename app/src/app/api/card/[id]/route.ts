// OG share-card image for a ShareCard object. /api/card/<objectId> renders a
// 1200x630 PNG so a pasted LoopVault link unfurls into a branded trade card on
// X / Telegram / Discord. Reads the REAL on-chain ShareCard (testnet) and
// degrades to a generic branded card if the object is missing or wrong-typed —
// it never crashes the unfurl.

import { createElement, type CSSProperties, type ReactElement } from "react";
import { ImageResponse } from "next/og";
// @mysten/sui v2: the legacy JSON-RPC client is SuiJsonRpcClient + getJsonRpcFullnodeUrl
// (same entrypoint the rest of the app uses — see hooks/useLiveOracle.ts).
import { getJsonRpcFullnodeUrl, SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { CFG } from "@/config/loopvault.config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FLOAT_SCALING = 1e9;
const BG_FROM = "#0a0b0f";
const BG_TO = "#12141c";
const GREEN = "#22d39a";
const RED = "#ff5a76";
const MUTED = "#8a90a2";
const SHARE_CARD_TYPE = `${CFG.loopvaultPkg}::share_card::ShareCard`;

interface CardFields {
  owner: string;
  direction: number; // 0 = call, 1 = put, 2 = straddle
  isUp: boolean;
  strike: number; // USD * 1e9
  expiryMs: number;
  entryIvBps: number;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<ImageResponse> {
  const { id } = await ctx.params;
  const fields = await loadCard(id);
  return render(fields);
}

/** Fetch + parse the ShareCard, or null if absent / not a ShareCard. */
async function loadCard(id: string): Promise<CardFields | null> {
  try {
    const client = new SuiJsonRpcClient({
      url: getJsonRpcFullnodeUrl("testnet"),
      network: "testnet",
    });
    const obj = await client.getObject({ id, options: { showContent: true } });
    const content = obj.data?.content;
    if (!content || content.dataType !== "moveObject") return null;
    if (content.type !== SHARE_CARD_TYPE) return null;
    const f = content.fields as Record<string, unknown>;
    return {
      owner: str(f.owner),
      direction: num(f.direction),
      isUp: f.is_up === true,
      strike: num(f.strike),
      expiryMs: num(f.expiry_ms),
      entryIvBps: num(f.entry_iv_bps),
    };
  } catch {
    return null;
  }
}

const num = (v: unknown): number =>
  typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

const DIRECTION_LABEL: Record<number, { glyph: string; label: string; color: string }> = {
  0: { glyph: "▲", label: "CALL", color: GREEN }, // ▲
  1: { glyph: "▼", label: "PUT", color: RED }, // ▼
  2: { glyph: "◈", label: "STRADDLE", color: GREEN }, // ◈
};

function headline(f: CardFields): { text: string; color: string } {
  const d = DIRECTION_LABEL[f.direction] ?? DIRECTION_LABEL[0];
  // For a binary call/put, isUp can flip the arrow vs the stated direction.
  const glyph = f.direction === 2 ? d.glyph : f.isUp ? "▲" : "▼";
  const color = f.direction === 2 ? d.color : f.isUp ? GREEN : RED;
  return { text: `${glyph} ${d.label} · BTC`, color };
}

function fmtStrike(strike: number): string {
  const usd = strike / FLOAT_SCALING;
  return "$" + usd.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmtExpiry(expiryMs: number): string {
  const deltaMs = expiryMs - Date.now();
  if (deltaMs <= 0) return "expired";
  const mins = Math.round(deltaMs / 60_000);
  if (mins < 60) return `in ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `in ${hrs}h`;
  return `in ${Math.round(hrs / 24)}d`;
}

const fmtIv = (bps: number): string => (bps / 100).toFixed(0) + "%";

/** Mask an address to 0x1234…abcd. */
function maskOwner(owner: string): string {
  if (!owner || owner.length < 10) return "0x????…????";
  return `${owner.slice(0, 6)}…${owner.slice(-4)}`;
}

// Hyperscript helper — this is a .ts file (no JSX), so build the element tree
// with createElement. next/og's ImageResponse takes a ReactElement.
const box = (style: CSSProperties, children?: ReactElement | ReactElement[] | string): ReactElement =>
  createElement("div", { style }, children);

function render(f: CardFields | null): ImageResponse {
  const head = f ? headline(f) : { text: "DELTA-HEDGED PREDICT", color: GREEN };

  const rows: Array<[string, string]> = f
    ? [
        ["Strike", fmtStrike(f.strike)],
        ["Expiry", fmtExpiry(f.expiryMs)],
        ["Entry IV", fmtIv(f.entryIvBps)],
        ["Trader", maskOwner(f.owner)],
      ]
    : [
        ["Network", "Sui · testnet"],
        ["Primitive", "DeepBook Predict vol surface"],
      ];

  // Wordmark
  const wordmark = box({ display: "flex", alignItems: "center" }, [
    box(
      {
        display: "flex",
        fontSize: "34px",
        fontWeight: 700,
        letterSpacing: "0.18em",
        color: "#ffffff",
      },
      "LOOPVAULT",
    ),
  ]);

  // Headline
  const headline_ = box(
    { display: "flex", fontSize: "92px", fontWeight: 800, color: head.color, lineHeight: 1.05 },
    head.text,
  );

  // Stat rows
  const rowEls = rows.map(([k, v]) =>
    box(
      {
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        width: "640px",
        marginBottom: "14px",
      },
      [
        box({ display: "flex", fontSize: "30px", color: MUTED }, k),
        box({ display: "flex", fontSize: "38px", fontWeight: 600 }, v),
      ],
    ),
  );

  const middle = box({ display: "flex", flexDirection: "column" }, [
    headline_,
    box({ display: "flex", flexDirection: "column", marginTop: "36px" }, rowEls),
  ]);

  // Footer
  const footer = box(
    { display: "flex", fontSize: "26px", color: MUTED },
    "Delta-hedged on DeepBook Predict · one tap, no seed phrase",
  );

  const root = box(
    {
      width: "1200px",
      height: "630px",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: "64px",
      background: `linear-gradient(135deg, ${BG_FROM} 0%, ${BG_TO} 100%)`,
      color: "#ffffff",
      fontFamily: "sans-serif",
    },
    [wordmark, middle, footer],
  );

  return new ImageResponse(root, { width: 1200, height: 630 });
}
