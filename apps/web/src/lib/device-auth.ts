import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "./db";
import { sha256 } from "./tokens";

export type DeviceContext = {
  device: typeof schema.devices.$inferSelect;
  workspace: typeof schema.workspaces.$inferSelect;
};

/** Resolves `Authorization: Bearer cob_…` to a non-revoked device and its workspace. */
export async function authenticateDevice(req: Request): Promise<DeviceContext | null> {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(cob_[A-Za-z0-9_-]{20,})$/.exec(h.trim());
  if (!m?.[1]) return null;
  const rows = await db
    .select({ device: schema.devices, workspace: schema.workspaces })
    .from(schema.devices)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.devices.workspaceId))
    .where(and(eq(schema.devices.tokenHash, sha256(m[1])), isNull(schema.devices.revokedAt)))
    .limit(1);
  return rows[0] ?? null;
}
