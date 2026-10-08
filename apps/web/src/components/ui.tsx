import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Card({ title, sub, action, children, className }: { title?: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-xl border border-line bg-surface p-4 sm:p-5", className)}>
      {(title || action) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-ink-2">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

/** Stat tile: label · value · optional delta (direction × whether up is good) · optional note. */
export function Stat({
  label,
  value,
  delta,
  upIsGood = true,
  note,
  children,
}: {
  label: string;
  value: ReactNode;
  delta?: number | null;
  upIsGood?: boolean;
  note?: ReactNode;
  children?: ReactNode;
}) {
  const good = delta == null ? null : delta === 0 ? null : (delta > 0) === upIsGood;
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="text-xs text-ink-2">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {delta != null && Number.isFinite(delta) && (
          <span className={cx("tabular", good === true && "text-good", good === false && "text-bad", good === null && "text-muted")}>
            {delta > 0 ? "▲" : delta < 0 ? "▼" : "•"} {Math.abs(delta * 100).toFixed(0)}%
            <span className="text-muted"> vs prev.</span>
          </span>
        )}
        {note && <span className="text-muted">{note}</span>}
      </div>
      {children}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "good" | "warn" | "bad" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
        tone === "neutral" && "border-line bg-surface-2 text-ink-2",
        tone === "accent" && "border-transparent bg-[var(--seq-1)] text-ink",
        tone === "good" && "border-transparent bg-[color-mix(in_oklab,var(--status-good)_18%,transparent)] text-good",
        tone === "warn" && "border-transparent bg-[color-mix(in_oklab,var(--status-warning)_22%,transparent)] text-ink",
        tone === "bad" && "border-transparent bg-[color-mix(in_oklab,var(--status-critical)_18%,transparent)] text-bad",
      )}
    >
      {children}
    </span>
  );
}

export const SEVERITY = {
  critical: { icon: OctagonAlert, color: "var(--status-critical)", label: "Critical" },
  warning: { icon: AlertTriangle, color: "var(--status-warning)", label: "Warning" },
  info: { icon: Info, color: "var(--accent)", label: "Info" },
  good: { icon: CheckCircle2, color: "var(--status-good)", label: "Good" },
} as const;

export function InsightRow({ severity, title, body, href }: { severity: keyof typeof SEVERITY; title: string; body: string; href?: string }) {
  const s = SEVERITY[severity];
  const Icon = s.icon;
  const inner = (
    <div className="flex gap-3 rounded-lg p-2 hover:bg-surface-2">
      <Icon size={18} style={{ color: s.color }} aria-label={s.label} className="mt-0.5 shrink-0" />
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-0.5 text-xs text-ink-2">{body}</div>
      </div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface p-8 text-center">
      <div className="text-sm font-medium">{title}</div>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-ink-2">{children}</div>}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50",
        variant === "primary" && "bg-accent text-white hover:opacity-90",
        variant === "ghost" && "border border-line bg-surface text-ink hover:bg-surface-2",
        variant === "danger" && "border border-line bg-surface text-bad hover:bg-surface-2",
        className,
      )}
    >
      {children}
    </button>
  );
}

export const inputCls =
  "w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none";

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px]">{children}</code>;
}

export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto", className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            {head.map((h, i) => (
              <th key={i} className={cx("px-2 py-2 font-medium whitespace-nowrap", i > 0 && "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className, right = true }: { children: ReactNode; className?: string; right?: boolean }) {
  return <td className={cx("border-b border-line px-2 py-2 whitespace-nowrap", right && "text-right", className)}>{children}</td>;
}

export function Swatch({ color, line = false }: { color: string; line?: boolean }) {
  return line ? (
    <span className="inline-block h-0.5 w-3 rounded" style={{ background: color }} />
  ) : (
    <span className="inline-block size-2.5 rounded-sm" style={{ background: color }} />
  );
}
