import Link from "next/link";
import { LegalFooter } from "@/components/legal";
import { redirect } from "next/navigation";
import { acceptInvites, getUser, listWorkspaces } from "@/lib/session";

export default async function Home() {
  const user = await getUser();
  if (user) {
    await acceptInvites(user);
    const ws = await listWorkspaces(user.id);
    redirect(ws[0] ? `/w/${ws[0].id}` : "/onboarding");
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-6 py-16">
      <div className="text-sm font-medium text-accent">Claude Observability</div>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">See where your Claude subscription goes.</h1>
      <p className="mt-4 text-lg text-ink-2">
        Sessions, models, projects and 5-hour limit windows for your Claude Code usage, with the API-equivalent value of every token,
        across every machine that shares the account.
      </p>
      <ul className="mt-8 grid gap-3 text-sm text-ink-2 sm:grid-cols-3">
        <li className="rounded-xl border border-line bg-surface p-4">
          <strong className="block text-ink">Usage only</strong>Token counts and model names. Never prompts, code or responses.
        </li>
        <li className="rounded-xl border border-line bg-surface p-4">
          <strong className="block text-ink">Every machine</strong>A small collector on each computer; deduplicated account totals.
        </li>
        <li className="rounded-xl border border-line bg-surface p-4">
          <strong className="block text-ink">Limit aware</strong>Live 5-hour block, burn rate and a limit learned from your own history.
        </li>
      </ul>
      <div className="mt-10">
        <Link href="/login" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">
          Sign in with Google
        </Link>
      </div>
      <div className="mt-16">
        <LegalFooter />
      </div>
    </main>
  );
}
