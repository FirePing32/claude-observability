import { after } from "next/server";
import { evaluateAlerts } from "@/lib/alerts";
import { db, schema } from "@/lib/db";
import { apiError } from "@/lib/http";
import { ingestOtelRequests, recordIngest } from "@/lib/ingest";
import { decodeLogs } from "@/lib/otlp";
import { otlpAccountOk, readOtlp } from "@/lib/otlp-route";

/** OTLP/HTTP JSON log receiver for Claude Code (`OTEL_EXPORTER_OTLP_ENDPOINT=<app>/api/otlp`). */
export async function POST(req: Request) {
  const r = await readOtlp(req);
  if (r instanceof Response) return r;
  const { ctx, body } = r;
  const d = decodeLogs(body);
  if (!(await otlpAccountOk(ctx, d.accountUuids)))
    return apiError(409, "account_mismatch", "Telemetry is from a different Claude account than this workspace tracks.");

  const res = await ingestOtelRequests(ctx, d.requests);
  if (d.errors.length) {
    await db
      .insert(schema.errorEvents)
      .values(d.errors.map((e) => ({ workspaceId: ctx.workspace.id, deviceId: ctx.device.id, source: "otel", ...e })))
      .onConflictDoNothing();
  }
  await recordIngest(ctx, "otel", d.requests.length + d.errors.length, res.accepted + d.errors.length, res.deduplicated);
  if (d.requests.length) after(() => evaluateAlerts(ctx.workspace.id, { reason: "ingest" }).catch(() => undefined));
  return Response.json({ partialSuccess: {} });
}
