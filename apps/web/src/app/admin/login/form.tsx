"use client";

import { useActionState } from "react";
import { Button, inputCls } from "@/components/ui";
import { adminLogin } from "../actions";

export function AdminLoginForm() {
  const [state, run, pending] = useActionState(adminLogin, null);
  return (
    <form action={run} className="mt-6 space-y-3">
      <input name="password" type="password" required autoFocus autoComplete="current-password" placeholder="Password" className={inputCls} />
      <Button className="w-full py-2" disabled={pending}>
        {pending ? "Checking…" : "Sign in"}
      </Button>
      {state?.error && <p className="text-sm text-bad">{state.error}</p>}
    </form>
  );
}
