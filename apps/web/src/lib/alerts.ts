import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { activeBlock } from "./blocks";
import { db, schema } from "./db";
import { usd, pct } from "./format";
import { blockData, devicesWithStats, totals } from "./queries";

export const ALERT_TYPES = {
  block_pct: { label: "Current 5-hour block reaches % of learned limit", unit: "%" },
  limit_hit: { label: "A usage limit was hit", unit: "" },
  daily_value: { label: "Daily API-equivalent value exceeds", unit: "$" },
  weekly_value: { label: "Rolling 7-day value exceeds", unit: "$" },
  device_silent: { label: "A machine stops reporting for N days", unit: "days" },
} as const;

/** Webhook targets must be public https URLs (no SSRF into private networks). */
export function validateTarget(channel: string, target: string): string | null {
  if (channel === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target) ? null : "Enter a valid e-mail address.";
  let u: URL;
  try {
    u = new URL(target);
  } catch {
    return "Enter a valid URL.";
  }
  if (u.protocol !== "https:") return "Webhook URLs must use https.";
  const h = u.hostname;
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$|\[?f[cd])/i.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith(".internal") || h.endsWith(".local"))
    return "Webhook URLs must be public.";
  if (channel === "slack" && h !== "hooks.slack.com") return "Slack webhooks live on hooks.slack.com.";
  return null;
}

async function deliver(rule: typeof schema.alertRules.$inferSelect, message: string, workspaceName: string): Promise<string | null> {
  try {
    if (rule.channel === "slack") {
      const r = await fetch(rule.target, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `*${workspaceName}*: ${message}` }), signal: AbortSignal.timeout(10_000), redirect: "error" });
      return r.ok ? null : `slack ${r.status}`;
    }
    if (rule.channel === "webhook") {
      const r = await fetch(rule.target, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspace: workspaceName, type: rule.type, threshold: rule.threshold, message, at: new Date().toISOString() }),
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      });
      return r.ok ? null : `webhook ${r.status}`;
    }
    if (!process.env.RESEND_API_KEY) return "email not configured (RESEND_API_KEY)";
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: process.env.ALERT_FROM_EMAIL ?? "alerts@example.com",
        to: [rule.target],
        subject: `[Claude Observability] ${workspaceName}`,
        text: message,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok ? null : `resend ${r.status}`;
  } catch (e) {
    return (e as Error).message;
  }
}

/**
 * Evaluate a workspace's alert rules. Each firing is keyed (rule + period/block)
 * and recorded once, so repeated evaluations never re-send the same alert.
 */
export async function evaluateAlerts(workspaceId: string, _opts: { reason: "ingest" | "cron" | "test" } = { reason: "cron" }) {
  const rules = await db
    .select()
    .from(schema.alertRules)
    .where(and(eq(schema.alertRules.workspaceId, workspaceId), eq(schema.alertRules.enabled, true)));
  if (!rules.length) return [];
  const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
  if (!ws) return [];
  const now = new Date();
  const fired: string[] = [];
  const needBlocks = rules.some((r) => r.type === "block_pct" || r.type === "limit_hit");
  const blocks = needBlocks ? await blockData(workspaceId, new Date(now.getTime() - 2 * 86_400_000), now) : null;

  for (const rule of rules) {
    let key: string | null = null;
    let message = "";
    switch (rule.type) {
      case "block_pct": {
        const a = blocks && activeBlock(blocks.blocks, now.getTime(), blocks.ceiling);
        if (a?.pctOfCeiling != null && a.pctOfCeiling * 100 >= rule.threshold) {
          key = `block:${a.block.start}`;
          message = `Current 5-hour block is at ${pct(a.pctOfCeiling)} of the learned limit (${usd(a.block.value)} used; resets ${new Date(a.block.end).toISOString().slice(11, 16)} UTC).`;
        }
        break;
      }
      case "limit_hit": {
        const last = blocks?.blocks.filter((b) => b.limits.length).at(-1);
        const hit = last?.limits.at(-1);
        if (hit && now.getTime() - hit.ts < 6 * 3600_000) {
          key = `limit:${hit.ts}`;
          message = `A ${hit.kind === "weekly" ? "weekly" : "5-hour"} usage limit was hit${hit.resetsAt ? `; resets ${new Date(hit.resetsAt).toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}.`;
        }
        break;
      }
      case "daily_value": {
        // "today" in the workspace's timezone, not UTC
        const [row] = (await db.execute(
          sql`select extract(epoch from date_trunc('day', now() at time zone ${ws.timezone}) at time zone ${ws.timezone})::float8 * 1000 as start, to_char(now() at time zone ${ws.timezone}, 'YYYY-MM-DD') as day`,
        )) as unknown as { start: number; day: string }[];
        const dayStart = new Date(row!.start);
        const t = await totals(workspaceId, dayStart, now, ws.timezone);
        if (t.value >= rule.threshold) {
          key = `day:${row!.day}`;
          message = `Today's API-equivalent usage reached ${usd(t.value)} (threshold ${usd(rule.threshold)}).`;
        }
        break;
      }
      case "weekly_value": {
        const t = await totals(workspaceId, new Date(now.getTime() - 7 * 86_400_000), now, ws.timezone);
        if (t.value >= rule.threshold) {
          key = `week:${Math.floor(now.getTime() / (7 * 86_400_000))}`;
          message = `Rolling 7-day usage reached ${usd(t.value)} (threshold ${usd(rule.threshold)}).`;
        }
        break;
      }
      case "device_silent": {
        const silent = (await devicesWithStats(workspaceId)).filter(
          (d) => !d.revoked_at && d.last_seen_at && now.getTime() - new Date(d.last_seen_at).getTime() > rule.threshold * 86_400_000,
        );
        if (silent.length) {
          key = `silent:${silent.map((d) => d.id).sort().join(",")}:${Math.floor(now.getTime() / 86_400_000)}`;
          message = `No uploads for ${rule.threshold}+ days from: ${silent.map((d) => d.name).join(", ")}.`;
        }
        break;
      }
    }
    if (!key) continue;
    const inserted = await db
      .insert(schema.alertEvents)
      .values({ ruleId: rule.id, workspaceId, dedupeKey: key, message, delivered: false })
      .onConflictDoNothing()
      .returning({ id: schema.alertEvents.id });
    if (!inserted[0]) continue; // already fired for this block/period
    const err = await deliver(rule, message, ws.name);
    await db.update(schema.alertEvents).set({ delivered: !err, error: err }).where(eq(schema.alertEvents.id, inserted[0].id));
    fired.push(message);
  }
  return fired;
}

export async function sendTestAlert(rule: typeof schema.alertRules.$inferSelect, workspaceName: string) {
  return deliver(rule, "Test alert from Claude Observability: this channel works.", workspaceName);
}
