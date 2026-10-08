import { gunzipSync } from "node:zlib";
import { ingestBatch } from "@claude-obs/shared";
import { after } from "next/server";
import { evaluateAlerts } from "@/lib/alerts";
import { authenticateDevice } from "@/lib/device-auth";
import { apiError, MIN_CLI_VERSION, rateLimited, versionAtLeast } from "@/lib/http";
import { checkAccount, ingestTranscriptBatch } from "@/lib/ingest";
import { checkClaudeEmail, EMAIL_MISMATCH_MESSAGE, EMAIL_MISSING_MESSAGE } from "@/lib/email-check";

export const maxDuration = 60;

const MAX_COMPRESSED = 2 * 1024 * 1024;
const MAX_JSON = 16 * 1024 * 1024;

export async function POST(req: Request) {
  const ctx = await authenticateDevice(req);
  if (!ctx) return apiError(401, "unauthorized", "Unknown or revoked device token. Run `claude-obs login` again.");
  if (!versionAtLeast(req.headers.get("x-claude-obs-version"), MIN_CLI_VERSION))
    return apiError(426, "upgrade_required", `claude-obs ${MIN_CLI_VERSION} or newer is required.`);
  if (rateLimited(`ingest:${ctx.device.id}`, 120))
    return apiError(429, "rate_limited", "Too many uploads; retry shortly.", { headers: { "retry-after": "30" } });

  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.length > MAX_COMPRESSED) return apiError(413, "payload_too_large", "Batch too large.");
  let json: unknown;
  try {
    const text = req.headers.get("content-encoding") === "gzip" ? gunzipSync(raw, { maxOutputLength: MAX_JSON }) : raw;
    json = JSON.parse(text.toString("utf8"));
  } catch {
    return apiError(422, "schema", "Body is not valid (gzipped) JSON.");
  }
  const parsed = ingestBatch.safeParse(json);
  if (!parsed.success) return apiError(422, "schema", parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const batch = parsed.data;

  const email = await checkClaudeEmail(ctx.workspace, { proof: batch.accountEmailProof });
  if (email === "mismatch") return apiError(403, "email_mismatch", EMAIL_MISMATCH_MESSAGE);
  if (email === "missing") return apiError(426, "upgrade_required", EMAIL_MISSING_MESSAGE);

  const account = await checkAccount(ctx, batch.accountHash, batch.plan?.rateLimitTier ?? null);
  if (account === "mismatch")
    return apiError(409, "account_mismatch", "This machine is logged into a different Claude account than this workspace tracks.");

  const res = await ingestTranscriptBatch(ctx, batch);
  after(() => evaluateAlerts(ctx.workspace.id, { reason: "ingest" }).catch(() => undefined));
  return Response.json({
    accepted: res.accepted,
    deduplicated: res.deduplicated,
    rejected: 0,
    minCliVersion: MIN_CLI_VERSION,
    serverTime: new Date().toISOString(),
  });
}
