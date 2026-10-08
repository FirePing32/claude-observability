"use client";

import { useActionState, useState, useTransition } from "react";
import { createAlert, deleteAlert, testAlert, toggleAlert } from "@/app/actions";
import { Button, inputCls } from "@/components/ui";

const DEFAULTS: Record<string, number> = { block_pct: 80, limit_hit: 0, daily_value: 50, weekly_value: 250, device_silent: 3 };

export function AlertForm({ workspaceId, types }: { workspaceId: string; types: Record<string, string> }) {
  const [state, run, pending] = useActionState(createAlert.bind(null, workspaceId), null);
  const [type, setType] = useState("block_pct");
  const [channel, setChannel] = useState("slack");
  return (
    <form action={run} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_2fr_auto] sm:items-end">
      <label>
        <span className="text-xs text-ink-2">When</span>
        <select name="type" value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
          {Object.entries(types).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="text-xs text-ink-2">Threshold</span>
        <input key={type} name="threshold" type="number" min={0} step="any" defaultValue={DEFAULTS[type]} disabled={type === "limit_hit"} className={inputCls} />
        {type === "limit_hit" && <input type="hidden" name="threshold" value="0" />}
      </label>
      <label>
        <span className="text-xs text-ink-2">Send to</span>
        <select name="channel" value={channel} onChange={(e) => setChannel(e.target.value)} className={inputCls}>
          <option value="slack">Slack</option>
          <option value="webhook">Webhook</option>
          <option value="email">E-mail</option>
        </select>
      </label>
      <label>
        <span className="text-xs text-ink-2">{channel === "email" ? "Address" : "Webhook URL"}</span>
        <input name="target" required placeholder={channel === "slack" ? "https://hooks.slack.com/services/…" : channel === "email" ? "you@example.com" : "https://…"} className={inputCls} />
      </label>
      <Button disabled={pending}>Add</Button>
      {(state?.error || state?.message) && <p className={`text-sm sm:col-span-5 ${state.error ? "text-bad" : "text-good"}`}>{state.error ?? state.message}</p>}
    </form>
  );
}

export function AlertRowActions({ workspaceId, ruleId, enabled }: { workspaceId: string; ruleId: string; enabled: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      {msg && <span className="text-ink-2">{msg}</span>}
      <button disabled={pending} className="text-accent" onClick={() => start(async () => setMsg(((await testAlert(workspaceId, ruleId)) ?? {}).error ?? "Test sent"))}>
        Test
      </button>
      <button disabled={pending} className="text-ink-2" onClick={() => start(() => toggleAlert(workspaceId, ruleId, !enabled))}>
        {enabled ? "Disable" : "Enable"}
      </button>
      <button disabled={pending} className="text-bad" onClick={() => start(() => deleteAlert(workspaceId, ruleId))}>
        Delete
      </button>
    </span>
  );
}
