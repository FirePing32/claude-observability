import "server-only";

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

/** Who may sign in: only allowlisted leads. (Inviting other people was removed on purpose.) */
export async function mayUseApp(email: string): Promise<boolean> {
  return isAllowlisted(email);
}

export const NOT_ALLOWED = "not_allowed";
