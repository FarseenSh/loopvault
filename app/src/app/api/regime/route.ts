// Vol-regime one-liner, AI-flavored. The client computes a deterministic
// rule-based line from the live Block Scholes surface (lib/market.classifyRegime)
// and POSTs the numbers here; if a model key is configured we upgrade it to a
// punchy model-written sentence, else we 503 and the client keeps its own line.
//
// Provider-agnostic: prefers OpenRouter (OPENROUTER_API_KEY, OpenAI-compatible —
// any model via REGIME_MODEL, default Qwen3.7-Plus) and falls back to Anthropic
// (ANTHROPIC_API_KEY) if that's what's set instead.
//
// Server-only: keys are read from process.env (NOT NEXT_PUBLIC) so they never
// reach the browser. Any failure returns a non-2xx the client treats as
// "fall back" — this route never throws and never blocks the trade.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Default OpenRouter model; override with REGIME_MODEL. Qwen3.7-Plus is a
// *reasoning* model, so callOpenRouter always sends reasoning:{enabled:false} —
// without that it spends thousands of hidden tokens and ~100s on a one-liner.
const OPENROUTER_MODEL = process.env.REGIME_MODEL || "qwen/qwen3.7-plus";
const ANTHROPIC_MODEL = "claude-haiku-4-5";
// Abort well before any serverless wall-clock limit so a slow upstream degrades
// to the client's SURFACE line instead of a hung function.
const TIMEOUT_MS = 8000;

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

function buildPrompt(b: Partial<RegimeInput>): string {
  const atmIv = Number(b.atmIv);
  const rho = Number(b.rho);
  const forward = Number(b.forward);
  const expiryMins = Number(b.expiryMins);
  const pUp2 = Number(b.pUp2);
  return (
    "You are a crypto-derivatives desk strategist. Given this live BTC " +
    "vol surface, write ONE punchy trader-facing sentence (max 28 words) " +
    "describing the current vol regime. No preamble, no markdown, no " +
    "quotes — just the sentence.\n" +
    `ATM implied vol: ${(atmIv * 100).toFixed(0)}% annualized.\n` +
    `SVI skew (rho): ${rho.toFixed(2)} (negative means puts are richer).\n` +
    `Forward: $${Math.round(forward).toLocaleString("en-US")}.\n` +
    `Time to expiry: ${Math.round(expiryMins)} minutes.\n` +
    `Probability of a >2% up move before expiry: ${(pUp2 * 100).toFixed(0)}%.`
  );
}

export async function POST(req: Request): Promise<Response> {
  const orKey = process.env.OPENROUTER_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!orKey && !anthropicKey) {
    // Expected "not set up" signal — the client falls back to its rule-based line.
    return json({ error: "unconfigured" }, 503);
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const prompt = buildPrompt((await req.json()) as Partial<RegimeInput>);
    const line = orKey
      ? await callOpenRouter(prompt, orKey, ctl.signal)
      : await callAnthropic(prompt, anthropicKey as string, ctl.signal);
    if (!line) return json({ error: "empty completion" }, 502);
    return json({ line: line.trim(), source: "ai" }, 200);
  } catch (err) {
    // Never throw — the client only needs a non-2xx to fall back.
    const message = err instanceof Error ? err.message : "unknown error";
    return json({ error: message }, 502);
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenRouter(prompt: string, key: string, signal: AbortSignal): Promise<string | null> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      // Optional OpenRouter attribution headers (public, not secret).
      "http-referer": "https://loopvault-beta.vercel.app",
      "x-title": "LoopVault",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      max_tokens: 160,
      temperature: 0.7,
      // Critical: keeps a reasoning model's one-liner at ~2s, not ~100s.
      // Non-reasoning models simply ignore this field.
      reasoning: { enabled: false },
      messages: [{ role: "user", content: prompt }],
    }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`openrouter ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }
  return extractChatText(await res.json());
}

async function callAnthropic(prompt: string, key: string, signal: AbortSignal): Promise<string | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 120,
      messages: [{ role: "user", content: prompt }],
    }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`anthropic ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }
  return extractAnthropicText(await res.json());
}

/** choices[0].message.content from an OpenAI-compatible (OpenRouter) response. */
function extractChatText(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const msg = (choices[0] as { message?: unknown }).message;
  if (typeof msg !== "object" || msg === null) return null;
  const content = (msg as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

/** content[0].text from an Anthropic Messages response. */
function extractAnthropicText(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const content = (data as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const first = content[0];
  if (typeof first !== "object" || first === null) return null;
  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : null;
}
