/**
 * API list prices in USD per million tokens, from
 * https://platform.claude.com/docs/en/about-claude/pricing (fetched 2026-10-08).
 * Cache-read prices are explicit because the ratio to input differs by model
 * (0.1x standard, 0.05x Opus 5.5 / Sonnet 5.5, 0.025x Fable 5.1 / Mythos 5.1).
 */
export interface ModelPrice {
  /** Canonical model id prefix, matched after normalization. */
  model: string;
  label: string;
  family: "fable" | "mythos" | "opus" | "sonnet" | "haiku";
  effectiveFrom: string; // YYYY-MM-DD
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
  /** Multiplier applied to every token category when speed === "fast". */
  fastMultiplier: number | null;
  /** Haiku 5.5 tiered pricing: prompts above this many input tokens use `longContext` prices. */
  longContextThreshold?: number;
  longContext?: Omit<ModelPrice, "model" | "label" | "family" | "effectiveFrom" | "fastMultiplier" | "longContextThreshold" | "longContext">;
}

const P = (
  model: string,
  label: string,
  family: ModelPrice["family"],
  input: number,
  cw5: number,
  cw1h: number,
  cr: number,
  output: number,
  fastMultiplier: number | null = null,
): ModelPrice => ({
  model,
  label,
  family,
  effectiveFrom: "2026-01-01",
  input,
  cacheWrite5m: cw5,
  cacheWrite1h: cw1h,
  cacheRead: cr,
  output,
  fastMultiplier,
});

export const PRICE_BOOK: ModelPrice[] = [
  P("claude-fable-5-1", "Fable 5.1", "fable", 10, 12.5, 20, 0.25, 50),
  P("claude-mythos-5-1", "Mythos 5.1", "mythos", 10, 12.5, 20, 0.25, 50),
  P("claude-fable-5", "Fable 5", "fable", 10, 12.5, 20, 1, 50),
  P("claude-mythos-5", "Mythos 5", "mythos", 10, 12.5, 20, 1, 50),
  P("claude-opus-5-5", "Opus 5.5", "opus", 4, 5, 8, 0.2, 20, 2),
  P("claude-opus-5", "Opus 5", "opus", 5, 6.25, 10, 0.5, 25, 2),
  P("claude-opus-4-8", "Opus 4.8", "opus", 5, 6.25, 10, 0.5, 25, 2),
  P("claude-opus-4-7", "Opus 4.7", "opus", 5, 6.25, 10, 0.5, 25),
  P("claude-opus-4-6", "Opus 4.6", "opus", 5, 6.25, 10, 0.5, 25),
  P("claude-opus-4-5", "Opus 4.5", "opus", 5, 6.25, 10, 0.5, 25),
  P("claude-opus-4-1", "Opus 4.1", "opus", 15, 18.75, 30, 1.5, 75),
  P("claude-opus-4", "Opus 4", "opus", 15, 18.75, 30, 1.5, 75),
  P("claude-sonnet-5-5", "Sonnet 5.5", "sonnet", 2, 2.5, 4, 0.1, 10),
  P("claude-sonnet-5", "Sonnet 5", "sonnet", 2, 2.5, 4, 0.2, 10),
  P("claude-sonnet-4-6", "Sonnet 4.6", "sonnet", 3, 3.75, 6, 0.3, 15),
  P("claude-sonnet-4-5", "Sonnet 4.5", "sonnet", 3, 3.75, 6, 0.3, 15),
  P("claude-sonnet-4", "Sonnet 4", "sonnet", 3, 3.75, 6, 0.3, 15),
  {
    ...P("claude-haiku-5-5", "Haiku 5.5", "haiku", 0.1, 0.125, 0.2, 0.01, 0.5),
    longContextThreshold: 100_000,
    longContext: { input: 0.5, cacheWrite5m: 0.625, cacheWrite1h: 1, cacheRead: 0.05, output: 2.5 },
  },
  P("claude-haiku-4-5", "Haiku 4.5", "haiku", 1, 1.25, 2, 0.1, 5),
  P("claude-3-5-haiku", "Haiku 3.5", "haiku", 0.8, 1, 1.6, 0.08, 4),
];

/** Web search is billed per request on top of tokens. */
export const WEB_SEARCH_USD_PER_REQUEST = 10 / 1000;

/**
 * Normalize ids such as `claude-sonnet-4-5-20250929`, `claude-opus-5-5[1m]`,
 * `anthropic.claude-opus-5-5`, `claude-opus-5-5@20260101` to a price-book key.
 * Longest matching prefix wins, so `claude-opus-5-5` beats `claude-opus-5`.
 */
const SORTED = [...PRICE_BOOK].sort((a, b) => b.model.length - a.model.length);
export function findPrice(model: string): ModelPrice | null {
  const m = model
    .toLowerCase()
    .replace(/^anthropic\./, "")
    .replace(/\[.*\]$/, "")
    .replace(/@.*$/, "");
  for (const p of SORTED) {
    if (m === p.model || m.startsWith(p.model + "-")) {
      // guard: "claude-opus-5" must not match "claude-opus-5-5"
      const rest = m.slice(p.model.length);
      if (rest === "" || /^-\d{8}$/.test(rest) || /^-v\d/.test(rest) || /^-latest$/.test(rest)) return p;
    }
  }
  return null;
}

export function modelLabel(model: string): string {
  return findPrice(model)?.label ?? model;
}

export function modelFamily(model: string): ModelPrice["family"] | "other" {
  return findPrice(model)?.family ?? "other";
}

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  webSearch?: number;
  speed?: string | null;
  inferenceGeo?: string | null;
}

/** US-only inference (`inference_geo: "us"`) costs 1.1x on Claude 4.6+ models. */
const US_GEO_MULTIPLIER = 1.1;

/** API-equivalent value in USD for one request. Returns null for unknown models. */
export function computeValueUsd(model: string, t: TokenCounts): number | null {
  const p = findPrice(model);
  if (!p) return null;
  const promptTokens = t.input + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h;
  const rates = p.longContext && p.longContextThreshold && promptTokens > p.longContextThreshold ? p.longContext : p;
  const mult =
    (t.speed === "fast" && p.fastMultiplier ? p.fastMultiplier : 1) *
    (t.inferenceGeo === "us" ? US_GEO_MULTIPLIER : 1);
  const tokens =
    t.input * rates.input +
    t.output * rates.output +
    t.cacheRead * rates.cacheRead +
    t.cacheWrite5m * rates.cacheWrite5m +
    t.cacheWrite1h * rates.cacheWrite1h;
  return (tokens * mult) / 1_000_000 + (t.webSearch ?? 0) * WEB_SEARCH_USD_PER_REQUEST;
}

/** What the cached reads would have cost as uncached input, minus what they did cost. */
export function cacheSavingsUsd(model: string, cacheRead: number): number {
  const p = findPrice(model);
  if (!p) return 0;
  return (cacheRead * (p.input - p.cacheRead)) / 1_000_000;
}

export const PLANS = {
  pro: { label: "Pro", monthlyUsd: 20 },
  max5x: { label: "Max 5x", monthlyUsd: 100 },
  max20x: { label: "Max 20x", monthlyUsd: 200 },
  team: { label: "Team", monthlyUsd: 0 },
  other: { label: "Other", monthlyUsd: 0 },
} as const;
export type PlanKey = keyof typeof PLANS;

/** Best-effort plan detection from ~/.claude.json oauthAccount tiers. */
export function detectPlan(rateLimitTier: string | null | undefined): PlanKey | null {
  const t = (rateLimitTier ?? "").toLowerCase();
  if (!t) return null;
  if (t.includes("max") && t.includes("20")) return "max20x";
  if (t.includes("max") && t.includes("5")) return "max5x";
  if (t.includes("pro")) return "pro";
  if (t.includes("team")) return "team";
  return null;
}
