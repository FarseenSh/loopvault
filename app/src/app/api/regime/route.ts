// Vol-regime one-liner, AI-flavored. The client computes a deterministic
// rule-based line from the live Block Scholes surface (lib/market.classifyRegime)
// and POSTs the numbers here; if ANTHROPIC_API_KEY is set we upgrade it to a
// punchy Claude-written sentence, else we 503 and the client keeps its own line.
//
// Server-only: the key is read from process.env (NOT NEXT_PUBLIC) so it never
// reaches the browser. Any failure returns a non-2xx the client treats as
// "fall back" — this route never throws and never blocks the trade.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Verified current per the model catalog (200K ctx, $1/$5 per MTok) — fast and
// cheap, ideal for a <28-word completion. Haiku takes a plain Messages body
// (no thinking/effort params).
const MODEL = "claude-haiku-4-5";

interface RegimeInput {
  atmIv: number; // annualized ATM implied vol (e.g. 0.62)
  rho: number; // SVI skew param (negative = puts richer)
  forward: number; // forward price in USD
  expiryMins: number; // minutes to expiry
  pUp2: number; // P(>2% up move by expiry), 0..1
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export async function POST(req: Request): Promise<Response> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    // Expected "not set up" signal — the client falls back to its rule-based line.
    return json({ error: "unconfigured" }, 503);
  }

  try {
    const b = (await req.json()) as Partial<RegimeInput>;
    const atmIv = Number(b.atmIv);
    const rho = Number(b.rho);
    const forward = Number(b.forward);
    const expiryMins = Number(b.expiryMins);
    const pUp2 = Number(b.pUp2);

    const prompt =
      "You are a crypto-derivatives desk strategist. Given this live BTC " +
      "vol surface, write ONE punchy trader-facing sentence (max 28 words) " +
      "describing the current vol regime. No preamble, no markdown, no " +
      "quotes — just the sentence.\n" +
      `ATM implied vol: ${(atmIv * 100).toFixed(0)}% annualized.\n` +
      `SVI skew (rho): ${rho.toFixed(2)} (negative means puts are richer).\n` +
      `Forward: $${Math.round(forward).toLocaleString("en-US")}.\n` +
      `Time to expiry: ${Math.round(expiryMins)} minutes.\n` +
      `Probability of a >2% up move before expiry: ${(pUp2 * 100).toFixed(0)}%.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 120,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return json({ error: `anthropic ${res.status}`, detail }, 502);
    }

    const data: unknown = await res.json();
    const text = extractText(data);
    if (!text) return json({ error: "empty completion" }, 502);

    return json({ line: text.trim(), source: "ai" }, 200);
  } catch (err) {
    // Never throw — the client only needs a non-2xx to fall back.
    const message = err instanceof Error ? err.message : "unknown error";
    return json({ error: message }, 502);
  }
}

/** Pull data.content[0].text out of the Messages API response, defensively. */
function extractText(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const content = (data as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const first = content[0];
  if (typeof first !== "object" || first === null) return null;
  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : null;
}
