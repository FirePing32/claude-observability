import { modelLabel } from "@claude-obs/shared";
import Link from "next/link";
import { RangePicker, SelectFilter } from "@/components/client";
import { Badge, Card, PageHeader, Stat, Table, Td, inputCls } from "@/components/ui";
import { duration, int, pct, usd } from "@/lib/format";
import { pageContext, type PageProps } from "@/lib/page";
import { filterOptions, sessions, sessionSummaryStats } from "@/lib/queries";
import { RANGES } from "@/lib/range";

export default async function Sessions(props: PageProps) {
  const { id, sp, range, filters } = await pageContext(props);
  const sort = sp.sort === "recent" || sp.sort === "requests" ? sp.sort : "value";
  const [rows, stats, opts] = await Promise.all([
    sessions(id, range.from, range.to, { ...filters, sort, q: sp.q ?? null, limit: 300 }),
    sessionSummaryStats(id, range.from, range.to),
    filterOptions(id),
  ]);
  const qs = (s: string) => {
    const p = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
    p.set("sort", s);
    return `?${p}`;
  };
  return (
    <>
      <PageHeader title="Sessions" sub={`${range.label} · usage inside the range`}>
        <RangePicker ranges={RANGES} current={range.key} />
      </PageHeader>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Sessions" value={int(stats.n)} />
        <Stat label="Median session" value={stats.median != null ? usd(stats.median) : "-"} />
        <Stat label="95th percentile" value={stats.p95 != null ? usd(stats.p95) : "-"} />
        <Stat label="Largest" value={rows.length ? usd(Math.max(...rows.map((r) => r.value))) : "-"} />
      </div>
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <form className="min-w-56 flex-1">
            {Object.entries(sp)
              .filter(([k, v]) => k !== "q" && v)
              .map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Search titles or projects" className={`${inputCls} max-w-sm`} />
          </form>
          <SelectFilter name="model" value={filters.model} placeholder="All models" options={opts.models.map((m) => ({ value: m, label: modelLabel(m) }))} />
          <SelectFilter name="project" value={filters.project} placeholder="All projects" options={opts.projects.map((p) => ({ value: p, label: p }))} />
          <div className="flex gap-1 text-xs">
            {(["value", "recent", "requests"] as const).map((s) => (
              <Link key={s} href={qs(s)} className={`rounded-md px-2 py-1 ${sort === s ? "bg-surface-2 font-medium" : "text-ink-2"}`}>
                {s === "value" ? "Top value" : s === "recent" ? "Recent" : "Most requests"}
              </Link>
            ))}
          </div>
        </div>
        <Table head={["Session", "Project · branch", "Started", "Duration", "Models", "Req.", "Subagents", "Compact.", "Value"]}>
          {rows.map((s) => (
            <tr key={s.session_id} className="hover:bg-surface-2">
              <Td right={false} className="max-w-80 truncate">
                <Link href={`/w/${id}/sessions/${encodeURIComponent(s.session_id)}`} className="hover:underline">
                  {s.title ?? <span className="text-muted">{s.session_id.slice(0, 8)}</span>}
                </Link>
                {s.errors > 0 && (
                  <span className="ml-2">
                    <Badge tone="warn">{s.errors} err</Badge>
                  </span>
                )}
              </Td>
              <Td>
                {s.project ?? "-"}
                {s.git_branch && s.git_branch !== "HEAD" ? <span className="text-muted"> · {s.git_branch}</span> : null}
              </Td>
              <Td>{new Date(s.started).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</Td>
              <Td>{duration(new Date(s.ended).getTime() - new Date(s.started).getTime())}</Td>
              <Td>{s.models.map(modelLabel).join(", ")}</Td>
              <Td>{int(s.requests)}</Td>
              <Td>{s.subagent_value > 0 ? pct(s.subagent_value / s.value) : "-"}</Td>
              <Td>{s.compactions || "-"}</Td>
              <Td className="font-medium">{usd(s.value)}</Td>
            </tr>
          ))}
        </Table>
        {!rows.length && <p className="py-8 text-center text-sm text-muted">No sessions match.</p>}
      </Card>
    </>
  );
}
