"use client";

import { useState, useTransition } from "react";
import { generateDigestNow } from "@/app/actions";
import { Button } from "@/components/ui";

export function DigestButton({ workspaceId, enabled }: { workspaceId: string; enabled: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-ink-2">{msg}</span>}
      <Button
        variant="ghost"
        disabled={!enabled || pending}
        onClick={() =>
          start(async () => {
            const r = await generateDigestNow(workspaceId);
            setMsg(r?.error ?? r?.message ?? null);
          })
        }
      >
        {pending ? "Writing…" : "Generate now"}
      </Button>
    </div>
  );
}
