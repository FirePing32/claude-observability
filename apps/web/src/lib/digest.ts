import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { modelLabel } from "@claude-obs/shared";
import { db, schema } from "./db";
import { computeInsights } from "./insights";
import { byModel, blockData, projects, totals } from "./queries";

const MODEL = "claude-opus-5-5";
const DAY = 86_400_000;

export const digestConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

/**
 * Weekly narrative digest. Only aggregates are sent to the Claude API: totals,
 * per-model and per-project numbers, block stats and rule-based findings.
 * No prompts, titles or content.
 */
export async function generateDigest(ws: typeof schema.workspaces.$inferSelect, now = new Date()) {
  const from = new Date(now.getTime() - 7 * DAY);
  const prevFrom = new Date(now.getTime() - 14 * DAY);
  const [cur, prev, models, projs, blocks, insights] = await Promise.all([
    totals(ws.id, from, now, ws.timezone),
    totals(ws.id, prevFrom, from, ws.timezone),
    byModel(ws.id, from, now),
    projects(ws.id, from, now),
    blockData(ws.id, from, now),
    computeInsights(ws, now),
  ]);
  const facts = {
    plan: ws.plan,
    planPriceUsdPerMonth: ws.planPriceUsd,
    thisWeek: cur,
    previousWeek: prev,
    models: models.map((m) => ({ model: modelLabel(m.model), requests: m.requests, apiEquivalentUsd: +m.value.toFixed(2) })),
    topProjects: projs.slice(0, 5).map((p, i) => ({ project: `project ${i + 1}`, sessions: p.sessions, apiEquivalentUsd: +p.value.toFixed(2) })),
    fiveHourBlocks: {
      count: blocks.blocks.length,
      withLimitHit: blocks.blocks.filter((b) => b.limits.length).length,
      learnedCeilingUsd: blocks.ceiling?.median ?? null,
    },
    detectedFindings: insights.map((i) => i.title),
  };

  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    // Server-side fallback: if the request is declined, the API re-runs it on its recommended fallback model.
    fallbacks: "default",
    system:
      "You write a short weekly usage digest for a Claude subscription shared by a small team. Dollar amounts are API-equivalent value (what the tokens would cost on the pay-as-you-go API), not money spent. Write 3 short paragraphs in plain language, then exactly 3 concrete recommendations as a bulleted list. No headings, no tables. Do not invent numbers that are not in the data.",
    messages: [{ role: "user", content: `Usage data for the last 7 days (JSON):\n${JSON.stringify(facts)}` }],
  } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);

  if (response.stop_reason === "refusal") throw new Error("The digest request was declined.");
  const body = response.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!body) throw new Error("Empty digest.");
  const [row] = await db
    .insert(schema.digests)
    .values({
      workspaceId: ws.id,
      periodStart: from,
      periodEnd: now,
      body,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    })
    .returning();
  return row!;
}
