import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { adminEnabled, isAdmin } from "@/lib/admin";
import { AdminLoginForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · Claude Observability", robots: { index: false, follow: false } };

export default async function AdminLogin() {
  if (!adminEnabled()) notFound();
  if (await isAdmin()) redirect("/admin");
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
      <p className="mt-1 text-sm text-ink-2">Enter the admin password.</p>
      <AdminLoginForm />
    </main>
  );
}
