"use client";

import { useActionState } from "react";
import { addManualLimit } from "@/app/actions";
import { Button, inputCls } from "@/components/ui";

export function ManualLimitForm({ workspaceId }: { workspaceId: string }) {
  const [state, run, pending] = useActionState(addManualLimit.bind(null, workspaceId), null);
  return (
    <form
      action={(f) => {
        const local = String(f.get("local") ?? "");
        if (local) f.set("when", new Date(local).toISOString());
        run(f);
      }}
      className="flex flex-wrap items-end gap-2"
    >
      <label className="flex-1">
        <span className="text-xs text-ink-2">I hit a limit at</span>
        <input type="datetime-local" name="local" required className={inputCls} />
      </label>
      <select name="kind" className={`${inputCls} w-auto`}>
        <option value="five_hour">5-hour</option>
        <option value="weekly">weekly</option>
      </select>
      <Button variant="ghost" disabled={pending}>
        Record
      </Button>
      {state?.error && <span className="w-full text-xs text-bad">{state.error}</span>}
      {state?.message && <span className="w-full text-xs text-good">{state.message}</span>}
    </form>
  );
}
