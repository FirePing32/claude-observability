"use client";

import { Check, Copy, RefreshCw } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Meter } from "./viz";

export function RangePicker({ ranges, current }: { ranges: Record<string, string>; current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-line bg-surface p-0.5" aria-busy={pending}>
      {Object.entries(ranges).map(([k, label]) => (
        <button
          key={k}
          title={label}
          onClick={() => {
            const p = new URLSearchParams(params);
            p.set("range", k);
            start(() => router.push(`${pathname}?${p.toString()}`));
          }}
          className={`rounded-md px-2 py-1 text-xs font-medium ${k === current ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink"}`}
        >
          {k === "cycle" ? "Cycle" : k === "mtd" ? "MTD" : k === "all" ? "All" : k}
        </button>
      ))}
    </div>
  );
}

export function SelectFilter({ name, value, options, placeholder }: { name: string; value: string | null; options: { value: string; label: string }[]; placeholder: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <select
      aria-label={placeholder}
      value={value ?? ""}
      onChange={(e) => {
        const p = new URLSearchParams(params);
        if (e.target.value) p.set(name, e.target.value);
        else p.delete(name);
        router.push(`${pathname}?${p.toString()}`);
      }}
      className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-2 hover:text-ink"
    >
      {done ? <Check size={12} /> : <Copy size={12} />} {done ? "Copied" : label}
    </button>
  );
}

export function CommandBlock({ command }: { command: string }) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-lg border border-line bg-surface-2 p-3">
      <pre className="overflow-x-auto font-mono text-[12px] leading-5 whitespace-pre-wrap text-ink">{command}</pre>
      <CopyButton text={command} />
    </div>
  );
}

interface Live {
  active: boolean;
  value: number;
  requests: number;
  burnPerHour: number;
  projected: number;
  pctOfCeiling: number | null;
  projectedPctOfCeiling: number | null;
  ceiling: number | null;
  ceilingSamples: number;
  start: number | null;
  end: number | null;
  lastIngest: string | null;
  serverTime: number;
}

const money = (n: number) => `$${n.toFixed(n >= 100 ? 0 : 2)}`;

/** Current 5-hour block, refreshed every 30 s (no websockets needed on Vercel). */
export function LiveBlock({ workspaceId, tz, initial }: { workspaceId: string; tz: string; initial: Live }) {
  const [d, setD] = useState<Live>(initial);
  const [now, setNow] = useState(initial.serverTime);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/w/${workspaceId}/live`, { cache: "no-store" });
        if (r.ok && !stop) setD(await r.json());
      } catch {
        /* keep last frame */
      }
    };
    const a = setInterval(tick, 30_000);
    const b = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      stop = true;
      clearInterval(a);
      clearInterval(b);
    };
  }, [workspaceId]);

  const time = (t: number) => new Date(t).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  if (!d.active || !d.start || !d.end || now >= d.end) {
    return (
      <div>
        <div className="text-sm text-ink-2">No active 5-hour block.</div>
        <div className="mt-1 text-xs text-muted">The next request starts a new one.{d.ceiling ? ` Learned limit ≈ ${money(d.ceiling)}.` : ""}</div>
      </div>
    );
  }
  const remaining = Math.max(0, d.end - now);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div className="text-3xl font-semibold tracking-tight">{money(d.value)}</div>
        <div className="text-xs text-muted">
          resets {time(d.end)} · {Math.floor(remaining / 3600000)}h {Math.floor((remaining % 3600000) / 60000)}m left
        </div>
      </div>
      <div className="mt-3">
        {d.ceiling ? (
          <Meter
            value={d.pctOfCeiling}
            label={`${Math.round((d.pctOfCeiling ?? 0) * 100)}% of learned limit (≈ ${money(d.ceiling)}, ${d.ceilingSamples} sample${d.ceilingSamples === 1 ? "" : "s"}) · on pace for ${Math.round((d.projectedPctOfCeiling ?? 0) * 100)}%`}
          />
        ) : (
          <div className="text-xs text-muted">No limit hits recorded yet, so there's no learned limit to compare against.</div>
        )}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted">Burn rate</dt>
          <dd className="tabular font-medium">{money(d.burnPerHour)}/h</dd>
        </div>
        <div>
          <dt className="text-muted">Projected</dt>
          <dd className="tabular font-medium">{money(d.projected)}</dd>
        </div>
        <div>
          <dt className="text-muted">Requests</dt>
          <dd className="tabular font-medium">{d.requests}</dd>
        </div>
      </dl>
    </div>
  );
}

export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => start(() => router.refresh())}
      className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink-2 hover:text-ink"
      aria-label="Refresh data"
    >
      <RefreshCw size={12} className={pending ? "animate-spin" : ""} /> Refresh
    </button>
  );
}

/** Polls until the first upload lands (used on the setup page). */
export function WaitForData({ workspaceId, hasData }: { workspaceId: string; hasData: boolean }) {
  const router = useRouter();
  const [ok, setOk] = useState(hasData);
  useEffect(() => {
    if (ok) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/w/${workspaceId}/live`, { cache: "no-store" }).catch(() => null);
      const j = r?.ok ? await r.json() : null;
      if (j?.lastIngest) {
        setOk(true);
        router.refresh();
      }
    }, 4000);
    return () => clearInterval(t);
  }, [ok, workspaceId, router]);
  return ok ? (
    <div className="flex items-center gap-2 text-sm text-good">
      <Check size={16} /> Data is arriving.
    </div>
  ) : (
    <div className="flex items-center gap-2 text-sm text-ink-2">
      <RefreshCw size={14} className="animate-spin" /> Waiting for the first upload…
    </div>
  );
}
