import "server-only";
import { gunzipSync } from "node:zlib";
import type { DeviceContext } from "./device-auth";
import { authenticateDevice } from "./device-auth";
import { apiError, rateLimited } from "./http";
import { checkAccount } from "./ingest";
import { hashAccountUuid } from "./otlp";

/** Shared front half of the OTLP receivers: auth, size, gzip, JSON-only, account check. */
export async function readOtlp(req: Request): Promise<{ ctx: DeviceContext; body: unknown } | Response> {
  const ctx = await authenticateDevice(req);
  if (!ctx) return apiError(401, "unauthorized", "Unknown or revoked device token.");
  if (rateLimited(`otlp:${ctx.device.id}`, 600)) return apiError(429, "rate_limited", "Too many requests.", { headers: { "retry-after": "10" } });
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("json"))
    return new Response("Only OTLP/HTTP JSON is supported: set OTEL_EXPORTER_OTLP_PROTOCOL=http/json", { status: 415 });
  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.length > 1024 * 1024) return apiError(413, "payload_too_large", "OTLP payload over 1 MB.");
  try {
    const text = req.headers.get("content-encoding") === "gzip" ? gunzipSync(raw, { maxOutputLength: 8 * 1024 * 1024 }) : raw;
    return { ctx, body: JSON.parse(text.toString("utf8")) };
  } catch {
    return apiError(422, "schema", "Body is not valid OTLP JSON.");
  }
}

export async function otlpAccountOk(ctx: DeviceContext, uuids: Set<string>): Promise<boolean> {
  for (const u of uuids) {
    if ((await checkAccount(ctx, hashAccountUuid(ctx.workspace.hashSalt, u), null)) === "mismatch") return false;
  }
  return true;
}
