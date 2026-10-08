export function usd(n: number, digits?: number): string {
  const d = digits ?? (Math.abs(n) >= 100 ? 0 : 2);
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

export function compact(n: number): string {
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: n >= 1000 ? 1 : 0 }).format(n);
}

export const int = (n: number) => Math.round(n).toLocaleString("en-US");

export function pct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  return `${(n * 100).toFixed(digits)}%`;
}

export function duration(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function relTime(d: Date | string | null, now = Date.now()): string {
  if (!d) return "never";
  const t = typeof d === "string" ? Date.parse(d) : d.getTime();
  const s = Math.round((now - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function dateTime(d: Date | string, tz: string): string {
  return new Date(d).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Relative change, hidden when the previous period is too small to compare meaningfully. */
export function delta(cur: number, prev: number): number | null {
  if (!prev || prev < Math.abs(cur) * 0.1) return null;
  return (cur - prev) / prev;
}
