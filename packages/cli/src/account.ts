import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { claudeJsonCandidates } from "./paths";

export interface AccountInfo {
  /** Only ever used locally to compute a salted hash; never uploaded or logged. */
  accountUuid: string | null;
  rateLimitTier: string | null;
  seatTier: string | null;
  billingType: string | null;
  source: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** Reads only the fields we need from Claude Code's `.claude.json` (no email, name or tokens). */
export function readAccount(root: string): AccountInfo {
  for (const file of claudeJsonCandidates(root)) {
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    try {
      const oa = (JSON.parse(raw) as { oauthAccount?: Record<string, unknown> }).oauthAccount ?? {};
      return {
        accountUuid: str(oa.accountUuid),
        rateLimitTier: str(oa.organizationRateLimitTier) ?? str(oa.userRateLimitTier),
        seatTier: str(oa.seatTier),
        billingType: str(oa.billingType),
        source: file,
      };
    } catch {
      continue;
    }
  }
  return { accountUuid: null, rateLimitTier: null, seatTier: null, billingType: null, source: null };
}

export function hashAccount(salt: string, accountUuid: string): string {
  return createHmac("sha256", salt).update(`account:${accountUuid}`).digest("hex");
}

export function makeProjectNamer(salt: string, hashProjects: boolean) {
  const cache = new Map<string, string | null>();
  return (cwd: unknown): string | null => {
    if (typeof cwd !== "string" || !cwd) return null;
    let v = cache.get(cwd);
    if (v === undefined) {
      const base = path.basename(cwd.replace(/[\\/]+$/, "")) || null;
      v = base && hashProjects ? `h:${createHmac("sha256", salt).update(`project:${base}`).digest("hex").slice(0, 12)}` : base;
      if (v && v.length > 200) v = v.slice(0, 200);
      cache.set(cwd, v);
    }
    return v;
  };
}

/** Opaque, stable id for a transcript line (used for idempotent upserts of non-request records). */
export function lineId(sessionId: string, uuid: unknown, fallback: string): string {
  return createHmac("sha256", "claude-obs-line")
    .update(`${sessionId}:${typeof uuid === "string" ? uuid : fallback}`)
    .digest("hex")
    .slice(0, 32);
}
