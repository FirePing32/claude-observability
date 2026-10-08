import type { ApiError } from "@claude-obs/shared";

export const MIN_CLI_VERSION = "0.1.0";

export function apiError(status: number, error: ApiError["error"], message: string, init: ResponseInit = {}) {
  return Response.json({ error, message } satisfies ApiError, { status, ...init });
}

/** semver-ish compare of x.y.z (pre-release tags ignored). */
export function versionAtLeast(v: string | null, min: string): boolean {
  if (!v) return false;
  const a = v.split("-")[0]!.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

/** Fixed-window in-memory limiter per key (per server instance; swap for Upstash when scaling out). */
const windows = new Map<string, { start: number; count: number }>();
export function rateLimited(key: string, max: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start > windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 10_000) windows.clear();
    return false;
  }
  w.count++;
  return w.count > max;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}
