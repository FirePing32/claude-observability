import { sql } from "drizzle-orm";
import { cronAuthorized } from "@/lib/cron";
import { db } from "@/lib/db";

/** Daily housekeeping: raw facts kept 13 months; logs and expired auth requests pruned. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  await db.execute(sql`delete from api_requests where ts < now() - interval '13 months'`);
  await db.execute(sql`delete from session_events where ts < now() - interval '13 months'`);
  await db.execute(sql`delete from error_events where ts < now() - interval '13 months'`);
  await db.execute(sql`delete from otel_metrics where ts < now() - interval '13 months'`);
  await db.execute(sql`delete from ingest_log where received_at < now() - interval '90 days'`);
  await db.execute(sql`delete from device_auth_requests where expires_at < now() - interval '1 day'`);
  await db.execute(sql`delete from session where expires_at < now()`);
  return Response.json({ ok: true });
}
