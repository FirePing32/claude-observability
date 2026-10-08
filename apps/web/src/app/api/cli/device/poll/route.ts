import { devicePollRequest } from "@claude-obs/shared";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { apiError, clientIp, rateLimited } from "@/lib/http";
import { sha256 } from "@/lib/tokens";

/** Device-code flow, step 2: the CLI polls until the owner approves; the token is handed over exactly once. */
export async function POST(req: Request) {
  if (rateLimited(`device-poll:${clientIp(req)}`, 60)) return apiError(429, "rate_limited", "Slow down.");
  const body = devicePollRequest.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(422, "schema", "Invalid request.");
  const hash = sha256(body.data.deviceCode);
  const [r] = await db.select().from(schema.deviceAuthRequests).where(eq(schema.deviceAuthRequests.deviceCodeHash, hash));
  if (!r || r.expiresAt < new Date() || r.status === "delivered") return Response.json({ status: "expired" });
  if (r.status === "denied") return Response.json({ status: "denied" });
  if (r.status === "pending") return Response.json({ status: "pending" });

  // approved: deliver once, then wipe the plain token
  const [claimed] = await db
    .update(schema.deviceAuthRequests)
    .set({ status: "delivered", pendingToken: null })
    .where(and(eq(schema.deviceAuthRequests.deviceCodeHash, hash), eq(schema.deviceAuthRequests.status, "approved")))
    .returning();
  // `returning()` shows the row after the wipe, so the token comes from the read above; the guarded
  // update guarantees only one poll can claim it.
  if (!claimed || !r.pendingToken || !r.workspaceId || !r.deviceId) return Response.json({ status: "expired" });
  const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, r.workspaceId));
  if (!ws) return Response.json({ status: "expired" });
  return Response.json({
    status: "approved",
    deviceId: r.deviceId,
    token: r.pendingToken,
    workspaceId: ws.id,
    workspaceName: ws.name,
    hashSalt: ws.hashSalt,
  });
}
