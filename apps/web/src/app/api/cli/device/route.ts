import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { authenticateDevice } from "@/lib/device-auth";
import { apiError } from "@/lib/http";

/** `claude-obs logout`: the device revokes its own token. */
export async function DELETE(req: Request) {
  const ctx = await authenticateDevice(req);
  if (!ctx) return apiError(401, "unauthorized", "Unknown or revoked device token.");
  await db.update(schema.devices).set({ revokedAt: new Date() }).where(eq(schema.devices.id, ctx.device.id));
  return new Response(null, { status: 204 });
}
