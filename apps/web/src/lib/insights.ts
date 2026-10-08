import "server-only";
import { PLANS, type PlanKey } from "@claude-obs/shared";
import { activeBlock, unseenUsageSuspected } from "./blocks";
import { usd, pct } from "./format";
import { blockData, devicesWithStats, errorSummary, sessions, sessionSummaryStats, subagentBreakdown, totals } from "./queries";

export type Severity = "critical" | "warning" | "info" | "good";

export interface Insight {
  id: string;
  severity: Severity;
  title: string;
  body: string;
  href?: string;
}

const DAY = 86_400_000;

/** Rule-based detectors over the account's own data. Cheap enough to run on page load. */
export async function computeInsights(
  ws: { id: string; timezone: string; plan: string; planPriceUsd: number },
  now = new Date(),
): Promise<Insight[]> {
  const out: Insight[] = [];
  const w0 = new Date(now.getTime() - 7 * DAY);
  const w1 = new Date(now.getTime() - 14 * DAY);
  const base = `/w/${ws.id}`;

  const [cur, prev, blocks, errs, devs, top, stats, subs] = await Promise.all([
    totals(ws.id, w0, now, ws.timezone),
    totals(ws.id, w1, w0, ws.timezone),
    blockData(ws.id, new Date(now.getTime() - 14 * DAY), now),
    errorSummary(ws.id, w0, now),
    devicesWithStats(ws.id),
    sessions(ws.id, w0, now, { limit: 5 }),
    sessionSummaryStats(ws.id, new Date(now.getTime() - 30 * DAY), now),
    subagentBreakdown(ws.id, w0, now),
  ]);

  // 1. live block
  const active = activeBlock(blocks.blocks, now.getTime(), blocks.ceiling);
  if (active?.projectedPctOfCeiling && active.projectedPctOfCeiling >= 0.9) {
    out.push({
      id: "block-projection",
      severity: active.pctOfCeiling && active.pctOfCeiling >= 0.9 ? "critical" : "warning",
      title: `Current 5-hour block is on pace for ${pct(active.projectedPctOfCeiling)} of your usual limit`,
      body: `${usd(active.block.value)} used so far at ${usd(active.burnPerHour)}/h. Switching routine work to Sonnet or a lower effort for the rest of the block stretches it further.`,
      href: `${base}/limits`,
    });
  }

  // 2. limit hits trend
  const hits = (from: Date, to: Date) =>
    blocks.blocks.filter((b) => b.limits.length && b.start >= from.getTime() && b.start < to.getTime()).length;
  const hitsNow = hits(w0, now);
  const hitsPrev = hits(w1, w0);
  if (hitsNow >= 2 && hitsNow > hitsPrev) {
    out.push({
      id: "limit-trend",
      severity: "warning",
      title: `Hit a usage limit in ${hitsNow} blocks this week (vs ${hitsPrev} the week before)`,
      body: "See which hours and projects drive the blocks that run out.",
      href: `${base}/limits`,
    });
  }
  const unseen = blocks.blocks.filter((b) => unseenUsageSuspected(b, blocks.ceiling));
  if (unseen.length) {
    out.push({
      id: "unseen-usage",
      severity: "warning",
      title: `${unseen.length} limit hit${unseen.length > 1 ? "s" : ""} happened with little tracked usage`,
      body: "Something uses the account that isn't reporting: a machine without claude-obs, cloud sessions, or claude.ai chat. Check Settings → Machines.",
      href: `${base}/settings`,
    });
  }

  // 3. Opus share
  if (cur.value > 5 && cur.opusValue / cur.value > 0.75) {
    out.push({
      id: "opus-heavy",
      severity: "info",
      title: `${pct(cur.opusValue / cur.value)} of this week's usage was on Opus models`,
      body: "Opus-tier requests drain subscription limits fastest. Routine edits, searches and subagent work often do fine on Sonnet.",
      href: `${base}/models`,
    });
  }

  // 4. cache efficiency
  if (cur.cacheHitRate !== null && prev.cacheHitRate !== null && prev.cacheHitRate - cur.cacheHitRate > 0.15) {
    out.push({
      id: "cache-drop",
      severity: "warning",
      title: `Cache hit rate fell from ${pct(prev.cacheHitRate)} to ${pct(cur.cacheHitRate)} week over week`,
      body: "Frequent /clear, switching models mid-session, or long idle gaps (cache expiry) re-send the whole context at full price.",
      href: `${base}/models`,
    });
  }

  // 5. runaway sessions
  if (stats.median && stats.n >= 5) {
    for (const s of top.filter((t) => t.value > Math.max(10 * stats.median!, 5)).slice(0, 2)) {
      out.push({
        id: `runaway-${s.session_id}`,
        severity: "info",
        title: `"${s.title ?? s.project ?? "Untitled session"}" used ${usd(s.value)}: ${Math.round(s.value / stats.median)}× your median session`,
        body: s.compactions ? `${s.compactions} compactions so far.` : "Long-running context grows the cost of every turn; /compact or a fresh session helps.",
        href: `${base}/sessions/${encodeURIComponent(s.session_id)}`,
      });
    }
  }

  // 6. errors
  const tooLong = errs.find((e) => e.reason_class === "prompt_too_long")?.n ?? 0;
  if (tooLong >= 3) {
    out.push({
      id: "prompt-too-long",
      severity: "info",
      title: `"Prompt is too long" happened ${tooLong} times this week`,
      body: "Sessions are hitting the context window; earlier /compact avoids lost turns.",
      href: `${base}/sessions?sort=recent`,
    });
  }

  // 7. subagents
  const subValue = subs.reduce((s, x) => s + x.value, 0);
  if (cur.value > 5 && subValue / cur.value > 0.4) {
    out.push({
      id: "subagent-share",
      severity: "info",
      title: `Subagents accounted for ${pct(subValue / cur.value)} of this week's usage`,
      body: `Top: ${subs.slice(0, 3).map((s) => `${s.agent} (${usd(s.value)})`).join(", ")}.`,
      href: `${base}/sessions`,
    });
  }

  // 8. plan fit (weekly value × ~4.3 vs plan price)
  const plan = PLANS[ws.plan as PlanKey];
  if (plan && ws.planPriceUsd > 0 && cur.value > 0) {
    const monthly = cur.value * (30 / 7);
    const multiple = monthly / ws.planPriceUsd;
    if (multiple >= 1.5) {
      out.push({
        id: "plan-value",
        severity: "good",
        title: `On pace for ${usd(monthly, 0)} of API-equivalent usage this month: ${multiple.toFixed(1)}× your ${plan.label} price`,
        body: "Pay-as-you-go API pricing for the same tokens would cost that much.",
        href: `${base}/value`,
      });
    } else if (multiple < 0.8 && ws.plan !== "pro") {
      out.push({
        id: "plan-underused",
        severity: "info",
        title: `This week's pace is ${multiple.toFixed(1)}× your plan price`,
        body: "If this continues, a smaller plan (or API pay-as-you-go) may cost less.",
        href: `${base}/value`,
      });
    }
    if (ws.plan === "max5x" && hitsNow >= 4) {
      out.push({
        id: "upgrade-hint",
        severity: "info",
        title: "Frequent limit hits on Max 5x",
        body: `${hitsNow} blocks ran out this week. If that blocks real work, Max 20x raises the limits; otherwise lean on Sonnet for routine turns.`,
        href: `${base}/limits`,
      });
    }
  }

  // 9. machines
  const live = devs.filter((d) => !d.revoked_at);
  const silent = live.filter((d) => d.last_seen_at && now.getTime() - new Date(d.last_seen_at).getTime() > 3 * DAY);
  if (silent.length && live.length > silent.length) {
    out.push({
      id: "device-silent",
      severity: "warning",
      title: `${silent.map((d) => `"${d.name}"`).join(", ")} hasn't reported in over 3 days`,
      body: "If it's still in use, its usage is missing. Run `claude-obs status` there, or install the background agent.",
      href: `${base}/settings`,
    });
  }
  if (cur.unpriced > 0) {
    out.push({
      id: "unpriced",
      severity: "info",
      title: `${cur.unpriced} requests use a model missing from the price book`,
      body: "Their API-equivalent value is counted as $0 until prices are added.",
    });
  }

  const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2, good: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}
