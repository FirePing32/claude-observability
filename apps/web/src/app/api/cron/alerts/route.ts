import { eq } from "drizzle-orm";
import { evaluateAlerts } from "@/lib/alerts";
import { cronAuthorized } from "@/lib/cron";
import { db, schema } from "@/lib/db";

export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  const ws = await db.selectDistinct({ id: schema.alertRules.workspaceId }).from(schema.alertRules).where(eq(schema.alertRules.enabled, true));
  let fired = 0;
  for (const w of ws) fired += (await evaluateAlerts(w.id, { reason: "cron" }).catch(() => [])).length;
  return Response.json({ workspaces: ws.length, fired });
}
