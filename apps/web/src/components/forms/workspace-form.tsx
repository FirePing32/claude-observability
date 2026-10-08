"use client";

import { PLANS } from "@claude-obs/shared";
import { useActionState, useState } from "react";
import type { ActionState } from "@/app/actions";
import { Button, inputCls } from "@/components/ui";

type Action = (s: ActionState, f: FormData) => Promise<ActionState>;

export function WorkspaceForm({
  action,
  initial,
  submitLabel,
}: {
  action: Action;
  initial?: { name: string; plan: string; price: number; timezone: string; billingDay: number };
  submitLabel: string;
}) {
  const [state, run, pending] = useActionState(action, null);
  const [plan, setPlan] = useState(initial?.plan ?? "max5x");
  const [price, setPrice] = useState(String(initial?.price ?? PLANS.max5x.monthlyUsd));
  const tz = initial?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <form action={run} className="space-y-4">
      <label className="block">
        <span className="text-xs font-medium text-ink-2">Name</span>
        <input name="name" required maxLength={80} defaultValue={initial?.name ?? "Our Claude account"} className={inputCls} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-ink-2">Plan</span>
          <select
            name="plan"
            value={plan}
            onChange={(e) => {
              setPlan(e.target.value);
              const p = PLANS[e.target.value as keyof typeof PLANS];
              if (p.monthlyUsd) setPrice(String(p.monthlyUsd));
            }}
            className={inputCls}
          >
            {Object.entries(PLANS).map(([k, p]) => (
              <option key={k} value={k}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-ink-2">Monthly price (USD)</span>
          <input name="price" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-ink-2">Timezone</span>
          <input name="timezone" defaultValue={tz} className={inputCls} />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-ink-2">Plan renews on day</span>
          <input name="billingDay" type="number" min={1} max={28} defaultValue={initial?.billingDay ?? 1} className={inputCls} />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Button disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
        {state?.error && <span className="text-sm text-bad">{state.error}</span>}
        {state?.message && <span className="text-sm text-good">{state.message}</span>}
      </div>
    </form>
  );
}
