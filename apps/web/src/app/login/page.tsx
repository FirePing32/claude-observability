import { redirect } from "next/navigation";
import { devPasswordLogin, googleConfigured } from "@/lib/auth";
import { getUser } from "@/lib/session";
import { LoginForm } from "./form";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (await getUser()) redirect(safeNext);
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-ink-2">Use the Google account you want to view the dashboard with.</p>
      <LoginForm google={googleConfigured} devPassword={devPasswordLogin} next={safeNext} />
    </main>
  );
}
