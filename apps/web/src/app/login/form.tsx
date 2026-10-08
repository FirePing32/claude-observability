"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button, inputCls } from "@/components/ui";

export function LoginForm({ google, devPassword, next }: { google: boolean; devPassword: boolean; next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-6 space-y-6">
      {google ? (
        <Button
          className="w-full py-2"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await authClient.signIn.social({ provider: "google", callbackURL: next });
            if (r.error) {
              setError(r.error.message ?? "Sign-in failed");
              setBusy(false);
            }
          }}
        >
          Continue with Google
        </Button>
      ) : (
        <p className="rounded-lg border border-line bg-surface p-3 text-sm text-ink-2">
          Google sign-in isn't configured. Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code>.
        </p>
      )}
      {devPassword && (
        <form
          className="space-y-2 rounded-xl border border-dashed border-line p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            const f = new FormData(e.currentTarget);
            const email = String(f.get("email"));
            const password = String(f.get("password"));
            const signIn = await authClient.signIn.email({ email, password });
            const r = signIn.error ? await authClient.signUp.email({ email, password, name: email.split("@")[0] ?? "dev" }) : signIn;
            if (r.error) {
              setError(r.error.message ?? "Failed");
              setBusy(false);
            } else window.location.href = next;
          }}
        >
          <div className="text-xs font-medium text-muted">Local development sign-in (disabled in production)</div>
          <input name="email" type="email" required placeholder="email" className={inputCls} autoComplete="username" />
          <input name="password" type="password" required minLength={8} placeholder="password (8+ chars)" className={inputCls} autoComplete="current-password" />
          <Button variant="ghost" className="w-full" disabled={busy}>
            Sign in / create dev user
          </Button>
        </form>
      )}
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}
