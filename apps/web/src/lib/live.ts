import "server-only";
import { sql } from "drizzle-orm";
import { activeBlock } from "./blocks";
import { db } from "./db";
import { blockData } from "./queries";

export async function liveBlock(workspaceId: string) {
  const now = new Date();
  const { blocks, ceiling } = await blockData(workspaceId, new Date(now.getTime() - 6 * 3600_000), now);
  const a = activeBlock(blocks, now.getTime(), ceiling);
  const [last] = (await db.execute(sql`select max(received_at) t from ingest_log where workspace_id = ${workspaceId}`)) as unknown as { t: Date | null }[];
  return {
    active: Boolean(a),
    value: a?.block.value ?? 0,
    requests: a?.block.requests ?? 0,
    burnPerHour: a?.burnPerHour ?? 0,
    projected: a?.projected ?? 0,
    pctOfCeiling: a?.pctOfCeiling ?? null,
    projectedPctOfCeiling: a?.projectedPctOfCeiling ?? null,
    ceiling: ceiling?.median ?? null,
    ceilingSamples: ceiling?.samples ?? 0,
    start: a?.block.start ?? null,
    end: a?.block.end ?? null,
    lastIngest: last?.t ? new Date(last.t).toISOString() : null,
    serverTime: now.getTime(),
  };
}
