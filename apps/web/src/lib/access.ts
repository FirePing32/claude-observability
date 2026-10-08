import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "./db";

/**
 * Who may use the app. ALLOWED_EMAILS is a comma-separated list of e-mails and/or
 * "@domain.com" entries for leads (Claude account owners). When it is unset the app
 * is open to any Google account.
 */
const entries = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const accessRestricted = entries.length > 0;

/** Leads: may sign in and create workspaces. */
export function isAllowlisted(email: string): boolean {
  if (!accessRestricted) return true;
  const e = email.trim().toLowerCase();
  const domain = e.slice(e.indexOf("@"));
  return entries.some((x) => x === e || (x.startsWith("@") && x === domain));
}

/** Leads, plus anyone a workspace owner has invited or added (view-only access to those workspaces). */
export async function mayUseApp(email: string): Promise<boolean> {
  if (isAllowlisted(email)) return true;
  const e = email.trim().toLowerCase();
  const [invite] = await db
    .select({ id: schema.invites.id })
    .from(schema.invites)
    .where(and(eq(schema.invites.email, e), isNull(schema.invites.acceptedAt)))
    .limit(1);
  if (invite) return true;
  const [member] = await db
    .select({ id: schema.memberships.workspaceId })
    .from(schema.memberships)
    .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
    .where(eq(schema.user.email, e))
    .limit(1);
  return Boolean(member);
}

export const NOT_ALLOWED = "not_allowed";
