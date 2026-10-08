"use client";

import { useActionState, useState, useTransition } from "react";
import {
  createEnrollmentCode,
  createShareLink,
  deleteWorkspace,
  inviteMember,
  updateClaudeEmailPolicy,
  renameDevice,
  revokeDevice,
} from "@/app/actions";
import { CommandBlock, CopyButton } from "@/components/client";
import { Button, inputCls } from "@/components/ui";

export function EnrollCodeForm({ workspaceId, server }: { workspaceId: string; server?: string }) {
  const [state, run, pending] = useActionState(createEnrollmentCode.bind(null, workspaceId), null);
  return (
    <div>
      <form action={run} className="flex flex-wrap items-end gap-2">
        <label>
          <span className="text-xs text-ink-2">Machines</span>
          <input name="maxUses" type="number" min={1} max={20} defaultValue={4} className={`${inputCls} w-20`} />
        </label>
        <label>
          <span className="text-xs text-ink-2">Valid for (days)</span>
          <input name="days" type="number" min={1} max={30} defaultValue={7} className={`${inputCls} w-24`} />
        </label>
        <label className="flex-1">
          <span className="text-xs text-ink-2">Label (optional)</span>
          <input name="label" maxLength={80} placeholder="e.g. team laptops" className={inputCls} />
        </label>
        <Button disabled={pending}>Create code</Button>
      </form>
      {state?.secret && (
        <div className="mt-4 rounded-lg border border-line bg-surface-2 p-4">
          <div className="text-xs text-ink-2">Enrollment code (shown once)</div>
          <div className="mt-1 flex items-center gap-3">
            <span className="font-mono text-2xl font-semibold tracking-widest">{state.secret}</span>
            <CopyButton text={state.secret} />
          </div>
          <div className="mt-1 text-xs text-muted">{state.message}</div>
          {server && (
            <div className="mt-3">
              <CommandBlock command={`claude-obs login --code ${state.secret} --server ${server}`} />
            </div>
          )}
        </div>
      )}
      {state?.error && <p className="mt-2 text-sm text-bad">{state.error}</p>}
    </div>
  );
}

export function InviteForm({ workspaceId }: { workspaceId: string }) {
  const [state, run, pending] = useActionState(inviteMember.bind(null, workspaceId), null);
  return (
    <form action={run} className="flex flex-wrap items-end gap-2">
      <label className="flex-1">
        <span className="text-xs text-ink-2">Google e-mail</span>
        <input name="email" type="email" required className={inputCls} placeholder="name@gmail.com" />
      </label>
      <select name="role" className={`${inputCls} w-auto`}>
        <option value="viewer">Viewer</option>
        <option value="owner">Owner</option>
      </select>
      <Button disabled={pending}>Invite</Button>
      {(state?.error || state?.message) && <p className={`w-full text-sm ${state.error ? "text-bad" : "text-good"}`}>{state.error ?? state.message}</p>}
    </form>
  );
}

export function DeviceActions({ workspaceId, deviceId, name }: { workspaceId: string; deviceId: string; name: string }) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  if (editing)
    return (
      <form
        action={async (f) => {
          await renameDevice(workspaceId, deviceId, f);
          setEditing(false);
        }}
        className="inline-flex gap-1"
      >
        <input name="name" defaultValue={name} className={`${inputCls} w-40 py-0.5`} autoFocus />
        <button className="text-xs text-accent">Save</button>
      </form>
    );
  return (
    <span className="inline-flex gap-3 text-xs">
      <button className="text-ink-2 hover:text-ink" onClick={() => setEditing(true)}>
        Rename
      </button>
      <button
        className="text-bad"
        disabled={pending}
        onClick={() => {
          if (confirm(`Revoke "${name}"? It stops uploading until re-enrolled.`)) start(() => revokeDevice(workspaceId, deviceId));
        }}
      >
        Revoke
      </button>
    </span>
  );
}

export function SmallAction({ label, run, confirmText, tone = "bad" }: { label: string; run: () => Promise<unknown>; confirmText?: string; tone?: "bad" | "accent" }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      className={`text-xs ${tone === "bad" ? "text-bad" : "text-accent"}`}
      onClick={() => {
        if (!confirmText || confirm(confirmText)) start(async () => void (await run()));
      }}
    >
      {label}
    </button>
  );
}

export function ShareLinkButton({ workspaceId }: { workspaceId: string }) {
  const [pending, start] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  return (
    <div>
      <Button
        variant="ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await createShareLink(workspaceId);
            if (r?.secret) setLink(`${window.location.origin}${r.secret}`);
          })
        }
      >
        Create read-only link
      </Button>
      {link && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-surface-2 p-3">
          <code className="flex-1 truncate font-mono text-xs">{link}</code>
          <CopyButton text={link} />
        </div>
      )}
    </div>
  );
}

export function ClaudeEmailPolicyForm({ workspaceId, require, extra }: { workspaceId: string; require: boolean; extra: string[] }) {
  const [state, run, pending] = useActionState(updateClaudeEmailPolicy.bind(null, workspaceId), null);
  return (
    <form action={run} className="space-y-3">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="requireEmailMatch" defaultChecked={require} className="mt-1" />
        <span>
          Only accept data from machines logged into Claude with an approved e-mail
          <span className="block text-xs text-muted">Approved: every workspace owner&apos;s sign-in e-mail, plus the list below.</span>
        </span>
      </label>
      <label className="block">
        <span className="text-xs text-ink-2">Extra approved Claude account e-mails (comma or new line separated)</span>
        <textarea name="extraClaudeEmails" rows={2} defaultValue={extra.join("\n")} className={inputCls} placeholder="claude-account@company.com" />
      </label>
      <div className="flex items-center gap-3">
        <Button variant="ghost" disabled={pending}>
          Save
        </Button>
        {(state?.error || state?.message) && <span className={`text-sm ${state.error ? "text-bad" : "text-good"}`}>{state.error ?? state.message}</span>}
      </div>
    </form>
  );
}

export function DeleteWorkspaceForm({ workspaceId, name }: { workspaceId: string; name: string }) {
  const [state, run, pending] = useActionState(deleteWorkspace.bind(null, workspaceId), null);
  return (
    <form action={run} className="flex flex-wrap items-end gap-2">
      <label className="flex-1">
        <span className="text-xs text-ink-2">Type &ldquo;{name}&rdquo; to delete the workspace and all its data</span>
        <input name="confirm" className={inputCls} autoComplete="off" />
      </label>
      <Button variant="danger" disabled={pending}>
        Delete workspace
      </Button>
      {state?.error && <p className="w-full text-sm text-bad">{state.error}</p>}
    </form>
  );
}
