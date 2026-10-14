import { sql } from "drizzle-orm";
import { cronAuthorized } from "@/lib/cron";
import { db } from "@/lib/db";
import { INGEST_LOG_DAYS, RETENTION_DAYS } from "@/lib/retention";

/** Daily housekeeping: raw facts kept RETENTION_DAYS; logs and expired auth requests pruned. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  const keep = sql`now() - make_interval(days => ${RETENTION_DAYS})`;
  await db.execute(sql`delete from api_requests where ts < ${keep}`);
  await db.execute(sql`delete from session_events where ts < ${keep}`);
  await db.execute(sql`delete from error_events where ts < ${keep}`);
  await db.execute(sql`delete from limit_events where ts < ${keep}`);
  await db.execute(sql`delete from otel_metrics where ts < ${keep}`);
  // sessions with no activity inside the window have no requests left to describe
  await db.execute(sql`delete from session_meta where updated_at < ${keep}`);
  await db.execute(sql`delete from session_snapshots where updated_at < ${keep}`);
  await db.execute(sql`delete from ingest_log where received_at < now() - make_interval(days => ${INGEST_LOG_DAYS})`);
  await db.execute(sql`delete from device_auth_requests where expires_at < now() - interval '1 day'`);
  await db.execute(sql`delete from session where expires_at < now()`);
  return Response.json({ ok: true });
}
