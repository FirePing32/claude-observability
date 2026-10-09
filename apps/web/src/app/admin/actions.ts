"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, adminEnabled, newAdminToken, passwordMatches } from "@/lib/admin";
import { rateLimited } from "@/lib/http";

export async function adminLogin(_: { error?: string } | null, form: FormData): Promise<{ error?: string } | null> {
  if (!adminEnabled()) return { error: "Admin access is not configured." };
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  // 5 attempts per 15 minutes per IP (per server instance)
  if (rateLimited(`admin-login:${ip}`, 5, 15 * 60 * 1000)) return { error: "Too many attempts. Try again in 15 minutes." };
  if (!passwordMatches(String(form.get("password") ?? ""))) return { error: "Incorrect password." };
  const t = newAdminToken();
  (await cookies()).set(ADMIN_COOKIE, t.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/admin",
    expires: t.expires,
  });
  redirect("/admin");
}

export async function adminLogout() {
  (await cookies()).delete({ name: ADMIN_COOKIE, path: "/admin" });
  redirect("/admin/login");
}
