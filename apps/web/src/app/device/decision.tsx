"use client";

import { useActionState } from "react";
import { decideDevice } from "@/app/actions";
import { Button, inputCls } from "@/components/ui";

export function DeviceDecision({ code, workspaces }: { code: string; workspaces: { id: string; name: string }[] }) {
  const [state, run, pending] = useActionState(decideDevice, null);
  if (state?.ok) return <p className="mt-4 text-sm text-good">{state.message}</p>;
  return (
    <form action={run} className="mt-4 space-y-3">
      <input type="hidden" name="code" value={code} />
      <label className="block">
        <span className="text-xs font-medium text-ink-2">Workspace</span>
        <select name="workspaceId" className={inputCls}>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        <Button name="decision" value="approve" disabled={pending}>
          Approve
        </Button>
        <Button name="decision" value="deny" variant="ghost" disabled={pending}>
          Deny
        </Button>
      </div>
      {state?.error && <p className="text-sm text-bad">{state.error}</p>}
    </form>
  );
}
