import "server-only";
import { createHash } from "node:crypto";
import { EMAIL_PROOF_PREFIX } from "@claude-obs/shared";
import { and, eq } from "drizzle-orm";
import { db, schema } from "./db";

/** sha256(prefix + lowercased e-mail). Must match the collector's computation exactly. */
export const emailProof = (email: string) =>
  createHash("sha256").update(EMAIL_PROOF_PREFIX + email.trim().toLowerCase()).digest("hex");

/** E-mails whose Claude account may upload to this workspace: its owners plus the extra list. */
export async function allowedClaudeEmails(ws: { id: string; extraClaudeEmails: string[] }): Promise<string[]> {
  const owners = await db
    .select({ email: schema.user.email })
    .from(schema.memberships)
    .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.workspaceId, ws.id), eq(schema.memberships.role, "owner")));
  return [...new Set([...owners.map((o) => o.email.toLowerCase()), ...ws.extraClaudeEmails.map((e) => e.toLowerCase())])];
}

export type EmailCheck = "ok" | "missing" | "mismatch";

/**
 * Is the machine's Claude login one of the workspace's approved e-mails?
 * Proofs and raw e-mails (from OTel) are compared in memory and never stored.
 */
export async function checkClaudeEmail(
  ws: { id: string; requireEmailMatch: boolean; extraClaudeEmails: string[] },
  input: { proof?: string | null; emails?: Iterable<string> },
): Promise<EmailCheck> {
  if (!ws.requireEmailMatch) return "ok";
  const proofs = new Set<string>();
  if (input.proof) proofs.add(input.proof);
  for (const e of input.emails ?? []) proofs.add(emailProof(e));
  if (!proofs.size) return "missing";
  const allowed = new Set((await allowedClaudeEmails(ws)).map(emailProof));
  for (const p of proofs) if (!allowed.has(p)) return "mismatch";
  return "ok";
}

export const EMAIL_MISMATCH_MESSAGE =
  "This machine's Claude account e-mail isn't approved for this workspace. Log in to Claude with an approved account, or ask a workspace owner to add the e-mail under Settings → Claude account.";
export const EMAIL_MISSING_MESSAGE =
  "This workspace verifies the Claude account e-mail on every upload. Update the collector: npm install -g claude-obs@latest";
