import Link from "next/link";
import type { ReactNode } from "react";

export const REPO_URL = "https://github.com/FirePing32/claude-observability";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-14">
      <Link href="/" className="text-sm text-accent">
        ← Claude Observability
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted">Last updated {updated}</p>
      <div className="mt-8 space-y-6 text-[15px] leading-7 text-ink-2 [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_a]:text-accent [&_a]:underline [&_strong]:text-ink">
        {children}
      </div>
    </main>
  );
}

export function LegalFooter() {
  return (
    <footer className="flex gap-4 text-xs text-muted">
      <Link href="/privacy" className="hover:text-ink">
        Privacy
      </Link>
      <Link href="/terms" className="hover:text-ink">
        Terms
      </Link>
      <a href={REPO_URL} className="hover:text-ink">
        Source
      </a>
    </footer>
  );
}
