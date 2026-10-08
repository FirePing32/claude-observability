import { seqColor } from "@/lib/colors";

/** Horizontal bar list (server-rendered). Values in text tokens; the colored bar carries identity. */
export function BarList({
  items,
  format,
  max,
}: {
  items: { key: string; label: string; value: number; color?: string; sub?: string; href?: string }[];
  format: (v: number) => string;
  max?: number;
}) {
  const top = max ?? Math.max(...items.map((i) => i.value), 0);
  if (!items.length) return <div className="py-6 text-center text-sm text-muted">Nothing to show.</div>;
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.key} title={`${i.label}: ${format(i.value)}${i.sub ? ` · ${i.sub}` : ""}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">
              {i.href ? (
                <a href={i.href} className="hover:underline">
                  {i.label}
                </a>
              ) : (
                i.label
              )}
              {i.sub && <span className="ml-2 text-xs text-muted">{i.sub}</span>}
            </span>
            <span className="tabular shrink-0 text-ink-2">{format(i.value)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-2">
            <div
              className="h-1.5 rounded-full"
              style={{ width: `${top ? Math.max(1, (i.value / top) * 100) : 0}%`, background: i.color ?? "var(--series-1)" }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Hour × weekday heatmap, sequential single-hue ramp, native tooltips, with a scale legend. */
export function Heatmap({ cells, format, limitHours }: { cells: { dow: number; hour: number; value: number; requests: number }[]; format: (v: number) => string; limitHours?: Set<string> }) {
  const max = Math.max(...cells.map((c) => c.value), 0);
  const get = (d: number, h: number) => cells.find((c) => c.dow === d && c.hour === h);
  return (
    <div className="overflow-x-auto">
      <div className="inline-grid min-w-full gap-[2px]" style={{ gridTemplateColumns: "32px repeat(24, minmax(14px, 1fr))" }}>
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="text-center text-[10px] text-muted">
            {h % 3 === 0 ? h : ""}
          </div>
        ))}
        {[1, 2, 3, 4, 5, 6, 0].map((d) => (
          <div key={d} className="contents">
            <div className="pr-1 text-right text-[10px] leading-4 text-muted">{DOW[d]}</div>
            {Array.from({ length: 24 }, (_, h) => {
              const c = get(d, h);
              const v = c?.value ?? 0;
              const lim = limitHours?.has(`${d}:${h}`);
              return (
                <div
                  key={h}
                  title={`${DOW[d]} ${h}:00: ${format(v)} · ${c?.requests ?? 0} requests${lim ? " · limit hit" : ""}`}
                  className="relative h-4 rounded-[3px]"
                  style={{ background: seqColor(max ? v / max : 0) }}
                >
                  {lim && <span className="absolute inset-0 m-auto size-1.5 rounded-full bg-[var(--ink)]" />}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted">
        <span>Less</span>
        {[0, 0.17, 0.34, 0.5, 0.67, 0.84, 1].map((t) => (
          <span key={t} className="inline-block h-2.5 w-4 rounded-[3px]" style={{ background: seqColor(t) }} />
        ))}
        <span>More</span>
        {limitHours && limitHours.size > 0 && (
          <span className="ml-3 flex items-center gap-1">
            <span className="inline-block size-1.5 rounded-full bg-[var(--ink)]" /> limit hit
          </span>
        )}
      </div>
    </div>
  );
}

/** Meter: severity in the fill, lighter step of the same ramp for the track. */
export function Meter({ value, label }: { value: number | null; label?: string }) {
  const v = value ?? 0;
  const color = v >= 0.9 ? "var(--status-critical)" : v >= 0.7 ? "var(--status-warning)" : "var(--series-1)";
  return (
    <div>
      <div className="h-2 rounded-full bg-[var(--seq-1)]">
        <div className="h-2 rounded-full transition-all" style={{ width: `${Math.min(100, v * 100)}%`, background: color }} />
      </div>
      {label && <div className="mt-1 text-xs text-muted">{label}</div>}
    </div>
  );
}
