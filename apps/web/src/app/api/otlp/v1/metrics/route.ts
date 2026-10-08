import { db, schema } from "@/lib/db";
import { apiError } from "@/lib/http";
import { decodeMetrics } from "@/lib/otlp";
import { otlpAccountOk, readOtlp } from "@/lib/otlp-route";

export async function POST(req: Request) {
  const r = await readOtlp(req);
  if (r instanceof Response) return r;
  const { ctx, body } = r;
  const d = decodeMetrics(body);
  if (!(await otlpAccountOk(ctx, d.accountUuids)))
    return apiError(409, "account_mismatch", "Telemetry is from a different Claude account than this workspace tracks.");
  if (d.points.length) {
    await db.insert(schema.otelMetrics).values(
      d.points.map((p) => ({ workspaceId: ctx.workspace.id, deviceId: ctx.device.id, ...p })),
    );
  }
  return Response.json(
    d.cumulativeSkipped
      ? { partialSuccess: { rejectedDataPoints: d.cumulativeSkipped, errorMessage: "Set OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta" } }
      : { partialSuccess: {} },
  );
}
