import { enrollRequest } from "@claude-obs/shared";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { checkClaudeEmail, EMAIL_MISMATCH_MESSAGE, EMAIL_MISSING_MESSAGE } from "@/lib/email-check";
import { apiError, clientIp, rateLimited } from "@/lib/http";
import { newDeviceToken, newId, normalizeCode, sha256 } from "@/lib/tokens";

/** Enroll a machine with an owner-issued code: `claude-obs login --code XXXX-XXXX`. */
export async function POST(req: Request) {
  if (rateLimited(`enroll:${clientIp(req)}`, 10)) return apiError(429, "rate_limited", "Too many attempts; wait a minute.");
  const body = enrollRequest.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(422, "schema", "Invalid enrollment request.");

  const codeHash = sha256(normalizeCode(body.data.code));
  // Check the machine's Claude account e-mail before spending a use of the code.
  const [pending] = await db
    .select({ ws: schema.workspaces })
    .from(schema.enrollmentCodes)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.enrollmentCodes.workspaceId))
    .where(and(eq(schema.enrollmentCodes.codeHash, codeHash), isNull(schema.enrollmentCodes.revokedAt), gt(schema.enrollmentCodes.expiresAt, new Date())));
  if (pending) {
    const email = await checkClaudeEmail(pending.ws, { proof: body.data.accountEmailProof });
    if (email === "mismatch") return apiError(403, "email_mismatch", EMAIL_MISMATCH_MESSAGE);
    if (email === "missing") return apiError(426, "upgrade_required", EMAIL_MISSING_MESSAGE);
  }
  // Atomically consume one use of a live code.
  const [code] = await db
    .update(schema.enrollmentCodes)
    .set({ uses: sql`${schema.enrollmentCodes.uses} + 1` })
    .where(
      and(
        eq(schema.enrollmentCodes.codeHash, codeHash),
        isNull(schema.enrollmentCodes.revokedAt),
        gt(schema.enrollmentCodes.expiresAt, new Date()),
        sql`${schema.enrollmentCodes.uses} < ${schema.enrollmentCodes.maxUses}`,
      ),
    )
    .returning();
  if (!code) return apiError(401, "invalid_code", "That code is invalid, expired or used up. Create a new one in Settings → Machines.");

  const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, code.workspaceId));
  if (!ws) return apiError(401, "invalid_code", "Workspace no longer exists.");
  const token = newDeviceToken();
  const deviceId = newId("dev");
  await db.insert(schema.devices).values({
    id: deviceId,
    workspaceId: ws.id,
    name: body.data.name,
    os: body.data.os,
    tokenHash: sha256(token),
    enrolledVia: "code",
  });
  return Response.json({ deviceId, token, workspaceId: ws.id, workspaceName: ws.name, hashSalt: ws.hashSalt });
}
