import { sql } from "drizzle-orm";
import { cronAuthorized } from "@/lib/cron";
import { db, schema } from "@/lib/db";
import { digestConfigured, generateDigest } from "@/lib/digest";

export const maxDuration = 300;

/** Weekly: a digest for every workspace with activity in the last 7 days. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  if (!digestConfigured()) return Response.json({ skipped: "ANTHROPIC_API_KEY not set" });
  const active = await db
    .select()
    .from(schema.workspaces)
    .where(sql`exists (select 1 from api_requests r where r.workspace_id = ${schema.workspaces.id} and r.ts > now() - interval '7 days')`);
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const ws of active) {
    try {
      await generateDigest(ws);
      results.push({ id: ws.id, ok: true });
    } catch (e) {
      results.push({ id: ws.id, ok: false, error: (e as Error).message });
    }
  }
  return Response.json({ results });
}
