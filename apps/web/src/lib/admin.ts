import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Super-admin access: a password from the ADMIN_PASSWORD environment variable.
 * A successful login sets a signed, HTTP-only cookie (12 h). The signing key is
 * derived from the password, so changing the password ends every admin session.
 * Without ADMIN_PASSWORD the admin pages don't exist.
 */
export const ADMIN_COOKIE = "co_admin";
const TTL_MS = 12 * 60 * 60 * 1000;

export const adminEnabled = () => Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length >= 12);

const key = () => createHash("sha256").update(`admin:${process.env.ADMIN_PASSWORD}:${process.env.BETTER_AUTH_SECRET ?? ""}`).digest();
const sign = (exp: number) => createHmac("sha256", key()).update(`admin-session:${exp}`).digest("hex");

const sameHash = (a: string, b: string) =>
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

export function passwordMatches(input: string): boolean {
  return adminEnabled() && sameHash(input, process.env.ADMIN_PASSWORD!);
}

export function newAdminToken(): { value: string; expires: Date } {
  const exp = Date.now() + TTL_MS;
  return { value: `${exp}.${sign(exp)}`, expires: new Date(exp) };
}

export async function isAdmin(): Promise<boolean> {
  if (!adminEnabled()) return false;
  const raw = (await cookies()).get(ADMIN_COOKIE)?.value ?? "";
  const [expStr, sig] = raw.split(".");
  const exp = Number(expStr);
  if (!sig || !Number.isFinite(exp) || exp < Date.now()) return false;
  return sameHash(sig, sign(exp));
}
