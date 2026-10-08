import { authenticateDevice } from "@/lib/device-auth";
import { apiError, MIN_CLI_VERSION } from "@/lib/http";

export async function GET(req: Request) {
  const ctx = await authenticateDevice(req);
  if (!ctx) return apiError(401, "unauthorized", "Unknown or revoked device token.");
  return Response.json({
    deviceId: ctx.device.id,
    deviceName: ctx.device.name,
    workspaceId: ctx.workspace.id,
    workspaceName: ctx.workspace.name,
    hashSalt: ctx.workspace.hashSalt,
    minCliVersion: MIN_CLI_VERSION,
  });
}
