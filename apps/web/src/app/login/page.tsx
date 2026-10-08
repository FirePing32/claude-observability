import { redirect } from "next/navigation";
import { LegalFooter } from "@/components/legal";
import { devPasswordLogin, googleConfigured } from "@/lib/auth";
import { getUser } from "@/lib/session";
import { LoginForm } from "./form";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (await getUser()) redirect(safeNext);
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-ink-2">Use the Google account you want to view the dashboard with.</p>
      {error && (
        <p className="mt-4 rounded-lg border border-line bg-surface p-3 text-sm text-bad">
          {/not_allowed|forbidden|unable_to_create/i.test(error)
            ? "This Google account doesn't have access. Ask an approved lead to invite your e-mail, or use an allowed account."
            : "Sign-in didn't complete. Please try again."}
        </p>
      )}
      <LoginForm google={googleConfigured} devPassword={devPasswordLogin} next={safeNext} />
      <p className="mt-6 text-xs text-muted">
        By signing in you agree to the <a href="/terms" className="underline">terms</a> and <a href="/privacy" className="underline">privacy policy</a>.
      </p>
      <div className="mt-8">
        <LegalFooter />
      </div>
    </main>
  );
}
