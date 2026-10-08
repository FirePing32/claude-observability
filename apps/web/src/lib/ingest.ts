import "server-only";
import type { IngestBatch, UsageRecord } from "@claude-obs/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db";
import type { DeviceContext } from "./device-auth";
import { mergeOtel, mergeTranscript, type OtelRequest, type RequestRow } from "./merge";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AccountCheck = "ok" | "pinned" | "mismatch";

/**
 * The first upload pins the workspace to that Claude account (salted hash);
 * afterwards uploads from any other account are rejected so they can't skew totals.
 */
export async function checkAccount(ctx: DeviceContext, accountHash: string, tier: string | null): Promise<AccountCheck> {
  if (ctx.workspace.accountHash) return ctx.workspace.accountHash === accountHash ? "ok" : "mismatch";
  const updated = await db
    .update(schema.workspaces)
    .set({ accountHash, detectedTier: tier })
    .where(and(eq(schema.workspaces.id, ctx.workspace.id), sql`${schema.workspaces.accountHash} is null`))
    .returning({ id: schema.workspaces.id });
  if (updated.length) return "pinned";
  // lost a race with another device; re-read
  const [w] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, ctx.workspace.id));
  return w?.accountHash === accountHash ? "ok" : "mismatch";
}

const UPSERT_SET = {
  messageId: sql`excluded.message_id`,
  sessionId: sql`excluded.session_id`,
  deviceId: sql`excluded.device_id`,
  ts: sql`excluded.ts`,
  model: sql`excluded.model`,
  isSubagent: sql`excluded.is_subagent`,
  agentId: sql`excluded.agent_id`,
  agentType: sql`excluded.agent_type`,
  skill: sql`excluded.skill`,
  plugin: sql`excluded.plugin`,
  input: sql`excluded.input`,
  // never let a concurrent, staler write lower the final streamed output
  output: sql`greatest(${schema.apiRequests.output}, excluded.output)`,
  cacheRead: sql`excluded.cache_read`,
  cacheWrite5m: sql`excluded.cache_write_5m`,
  cacheWrite1h: sql`excluded.cache_write_1h`,
  thinking: sql`excluded.thinking`,
  webSearch: sql`excluded.web_search`,
  webFetch: sql`excluded.web_fetch`,
  serviceTier: sql`excluded.service_tier`,
  speed: sql`excluded.speed`,
  inferenceGeo: sql`excluded.inference_geo`,
  effort: sql`excluded.effort`,
  entrypoint: sql`excluded.entrypoint`,
  ccVersion: sql`excluded.cc_version`,
  project: sql`excluded.project`,
  gitBranch: sql`excluded.git_branch`,
  valueUsd: sql`excluded.value_usd`,
  priced: sql`excluded.priced`,
  durationMs: sql`excluded.duration_ms`,
  querySource: sql`excluded.query_source`,
  otelCostUsd: sql`excluded.otel_cost_usd`,
  sources: sql`excluded.sources`,
  updatedAt: sql`now()`,
};

async function upsertRequests<T extends { requestId: string }>(
  tx: Tx,
  workspaceId: string,
  incoming: T[],
  merge: (existing: RequestRow | undefined, rec: T) => { row: RequestRow; changed: boolean },
): Promise<{ accepted: number; deduplicated: number }> {
  if (!incoming.length) return { accepted: 0, deduplicated: 0 };
  // collapse duplicates inside one batch first (keep largest output via the merge itself)
  const existingRows = await tx
    .select()
    .from(schema.apiRequests)
    .where(
      and(
        eq(schema.apiRequests.workspaceId, workspaceId),
        inArray(
          schema.apiRequests.requestId,
          incoming.map((r) => r.requestId),
        ),
      ),
    )
    .for("update");
  const current = new Map<string, RequestRow>(existingRows.map((r) => [r.requestId, r]));
  let deduplicated = 0;
  const changed = new Map<string, RequestRow>();
  for (const rec of incoming) {
    const m = merge(current.get(rec.requestId), rec);
    if (!m.changed) {
      deduplicated++;
      continue;
    }
    current.set(rec.requestId, m.row);
    changed.set(rec.requestId, m.row);
  }
  const rows = [...changed.values()];
  for (let i = 0; i < rows.length; i += 250) {
    await tx
      .insert(schema.apiRequests)
      .values(rows.slice(i, i + 250))
      .onConflictDoUpdate({ target: [schema.apiRequests.workspaceId, schema.apiRequests.requestId], set: UPSERT_SET });
  }
  return { accepted: incoming.length - deduplicated, deduplicated };
}

export async function ingestTranscriptBatch(ctx: DeviceContext, batch: IngestBatch) {
  const ws = ctx.workspace.id;
  const deviceId = ctx.device.id;
  const usage: UsageRecord[] = [];
  let accepted = 0;
  let deduplicated = 0;

  await db.transaction(async (tx) => {
    for (const r of batch.records) {
      switch (r.kind) {
        case "usage":
          usage.push(r);
          break;
        case "session_meta":
          await tx
            .insert(schema.sessionMeta)
            .values({ workspaceId: ws, sessionId: r.sessionId, title: r.title, titleSource: r.titleSource, agentName: r.agentName })
            .onConflictDoUpdate({
              target: [schema.sessionMeta.workspaceId, schema.sessionMeta.sessionId],
              set: {
                // a user-set (custom) title is never replaced by a generated one
                title: sql`case when ${schema.sessionMeta.titleSource} = 'custom' and excluded.title_source = 'ai' then ${schema.sessionMeta.title} else coalesce(excluded.title, ${schema.sessionMeta.title}) end`,
                titleSource: sql`case when ${schema.sessionMeta.titleSource} = 'custom' and excluded.title_source = 'ai' then ${schema.sessionMeta.titleSource} else coalesce(excluded.title_source, ${schema.sessionMeta.titleSource}) end`,
                agentName: sql`coalesce(excluded.agent_name, ${schema.sessionMeta.agentName})`,
                updatedAt: sql`now()`,
              },
            });
          accepted++;
          break;
        case "session_snapshot":
          await tx
            .insert(schema.sessionSnapshots)
            .values({
              workspaceId: ws,
              sessionId: r.sessionId,
              startedAt: r.ts ? new Date(r.ts) : null,
              totalCostUsd: r.totalCostUSD,
              apiMs: r.apiMs,
              toolMs: r.toolMs,
              linesAdded: r.linesAdded,
              linesRemoved: r.linesRemoved,
              modelUsage: r.modelUsage,
            })
            .onConflictDoUpdate({
              target: [schema.sessionSnapshots.workspaceId, schema.sessionSnapshots.sessionId],
              set: {
                startedAt: sql`excluded.started_at`,
                totalCostUsd: sql`excluded.total_cost_usd`,
                apiMs: sql`excluded.api_ms`,
                toolMs: sql`excluded.tool_ms`,
                linesAdded: sql`excluded.lines_added`,
                linesRemoved: sql`excluded.lines_removed`,
                modelUsage: sql`excluded.model_usage`,
                updatedAt: sql`now()`,
              },
            });
          accepted++;
          break;
        case "session_event": {
          const res = await tx
            .insert(schema.sessionEvents)
            .values({
              workspaceId: ws,
              id: r.id,
              sessionId: r.sessionId,
              ts: new Date(r.ts),
              event: r.event,
              durationMs: r.durationMs,
              preTokens: r.preTokens,
              trigger: r.trigger,
            })
            .onConflictDoNothing()
            .returning({ id: schema.sessionEvents.id });
          if (res.length) accepted++;
          else deduplicated++;
          break;
        }
        case "error": {
          const res = await tx
            .insert(schema.errorEvents)
            .values({ workspaceId: ws, id: r.id, sessionId: r.sessionId, deviceId, ts: new Date(r.ts), code: r.code, reasonClass: r.reasonClass })
            .onConflictDoNothing()
            .returning({ id: schema.errorEvents.id });
          if (res.length) accepted++;
          else deduplicated++;
          break;
        }
        case "limit": {
          const res = await tx
            .insert(schema.limitEvents)
            .values({
              workspaceId: ws,
              id: r.id,
              sessionId: r.sessionId,
              deviceId,
              ts: new Date(r.ts),
              limitKind: r.limitKind,
              resetsAt: r.resetsAt ? new Date(r.resetsAt) : null,
            })
            .onConflictDoNothing()
            .returning({ id: schema.limitEvents.id });
          if (res.length) accepted++;
          else deduplicated++;
          break;
        }
      }
    }
    const u = await upsertRequests(tx, ws, usage, (ex, rec) => mergeTranscript(ex, rec, ws, deviceId));
    accepted += u.accepted;
    deduplicated += u.deduplicated;
  });

  await recordIngest(ctx, "transcript", batch.records.length, accepted, deduplicated, {
    parserVersion: batch.parser.version,
    unknownTypes: batch.parser.unknownTypes,
    malformedLines: batch.parser.malformedLines,
    ccVersions: batch.device.ccVersions,
    os: batch.device.os,
  });
  return { accepted, deduplicated };
}

export async function ingestOtelRequests(ctx: DeviceContext, reqs: OtelRequest[]) {
  const ws = ctx.workspace.id;
  const r = await db.transaction((tx) => upsertRequests(tx, ws, reqs, (ex, rec) => mergeOtel(ex, rec, ws, ctx.device.id)));
  return r;
}

export async function recordIngest(
  ctx: DeviceContext,
  source: "transcript" | "otel",
  records: number,
  accepted: number,
  deduplicated: number,
  extra: { parserVersion?: string; unknownTypes?: Record<string, number>; malformedLines?: number; ccVersions?: string[]; os?: string } = {},
) {
  await db.insert(schema.ingestLog).values({
    workspaceId: ctx.workspace.id,
    deviceId: ctx.device.id,
    source,
    records,
    accepted,
    deduplicated,
    parserVersion: extra.parserVersion ?? null,
    unknownTypes: extra.unknownTypes && Object.keys(extra.unknownTypes).length ? extra.unknownTypes : null,
    malformedLines: extra.malformedLines ?? 0,
  });
  const versions = [...new Set([...(ctx.device.ccVersions ?? []), ...(extra.ccVersions ?? [])])].sort().slice(-10);
  await db
    .update(schema.devices)
    .set({
      lastSeenAt: new Date(),
      ccVersions: versions,
      ...(extra.parserVersion ? { parserVersion: extra.parserVersion } : {}),
      ...(extra.os ? { os: extra.os } : {}),
    })
    .where(eq(schema.devices.id, ctx.device.id));
}
