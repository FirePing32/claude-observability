import { deviceStartRequest } from "@claude-obs/shared";
import { db, schema } from "@/lib/db";
import { apiError, clientIp, rateLimited } from "@/lib/http";
import { newHumanCode, sha256 } from "@/lib/tokens";
import { randomBytes } from "node:crypto";

const TTL_SEC = 600;

/** Device-code flow, step 1: the CLI asks for a code the owner approves at /device. */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (rateLimited(`device-start:${ip}`, 10)) return apiError(429, "rate_limited", "Too many attempts; wait a minute.");
  const body = deviceStartRequest.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(422, "schema", "Invalid request.");
  const deviceCode = randomBytes(32).toString("base64url");
  const userCode = newHumanCode();
  await db.insert(schema.deviceAuthRequests).values({
    deviceCodeHash: sha256(deviceCode),
    userCode,
    name: body.data.name,
    os: body.data.os,
    ip,
    accountEmailProof: body.data.accountEmailProof ?? null,
    expiresAt: new Date(Date.now() + TTL_SEC * 1000),
  });
  const origin = process.env.BETTER_AUTH_URL ?? new URL(req.url).origin;
  return Response.json({
    userCode,
    deviceCode,
    verificationUrl: `${origin}/device?code=${encodeURIComponent(userCode)}`,
    interval: 3,
    expiresIn: TTL_SEC,
  });
}
