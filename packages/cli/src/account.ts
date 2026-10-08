import { createHash, createHmac } from "node:crypto";
import { EMAIL_PROOF_PREFIX } from "@claude-obs/shared";
import fs from "node:fs";
import path from "node:path";
import { claudeJsonCandidates } from "./paths";

export interface AccountInfo {
  /** Only ever used locally to compute a salted hash; never uploaded or logged. */
  accountUuid: string | null;
  /** Used only locally: for the one-way proof below and for error messages on this machine. Never uploaded. */
  email: string | null;
  /** sha256(prefix + lowercased e-mail); lets the server check the account e-mail without receiving it. */
  emailProof: string | null;
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
      const email = str(oa.emailAddress);
      return {
        accountUuid: str(oa.accountUuid),
        email,
        emailProof: email ? emailProof(email) : null,
        rateLimitTier: str(oa.organizationRateLimitTier) ?? str(oa.userRateLimitTier),
        seatTier: str(oa.seatTier),
        billingType: str(oa.billingType),
        source: file,
      };
    } catch {
      continue;
    }
  }
  return { accountUuid: null, email: null, emailProof: null, rateLimitTier: null, seatTier: null, billingType: null, source: null };
}

export function emailProof(email: string): string {
  return createHash("sha256").update(EMAIL_PROOF_PREFIX + email.trim().toLowerCase()).digest("hex");
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
