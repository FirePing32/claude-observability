import { computeValueUsd, modelLabel } from "@claude-obs/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContextGrowth, RequestBars } from "@/components/charts";
import { Badge, Card, PageHeader, Stat, Table, Td } from "@/components/ui";
import { BarList } from "@/components/viz";
import { modelColor } from "@/lib/colors";
import { compact, dateTime, duration, int, pct, usd } from "@/lib/format";
import { sessionDetail } from "@/lib/queries";
import { requireMember } from "@/lib/session";

export default async function SessionPage({ params }: { params: Promise<{ id: string; sid: string }> }) {
  const { id, sid } = await params;
  const sessionId = decodeURIComponent(sid);
  const { workspace } = await requireMember(id);
  const d = await sessionDetail(id, sessionId);
  if (!d.reqs.length) notFound();
  const tz = workspace.timezone;

  const value = d.reqs.reduce((s, r) => s + r.value_usd, 0);
  const sub = d.reqs.filter((r) => r.is_subagent);
  const subValue = sub.reduce((s, r) => s + r.value_usd, 0);
  const tok = (k: "input" | "output" | "cache_read" | "cache_write_5m" | "cache_write_1h") => d.reqs.reduce((s, r) => s + r[k], 0);
  const prompt = tok("input") + tok("cache_read") + tok("cache_write_5m") + tok("cache_write_1h");
  const first = new Date(d.reqs[0]!.ts).getTime();
  const last = new Date(d.reqs.at(-1)!.ts).getTime();

  const main = d.reqs.filter((r) => !r.is_subagent);
  const points = main.map((r, i) => ({ i: i + 1, ts: new Date(r.ts).toISOString(), context: r.input + r.cache_read + r.cache_write_5m + r.cache_write_1h }));
  const compactionIdx = d.events
    .filter((e) => e.event === "compaction")
    .map((e) => main.findIndex((r) => new Date(r.ts) >= new Date(e.ts)) + 1)
    .filter((i) => i > 0);
  const bars = d.reqs.map((r, i) => ({ i: i + 1, ts: new Date(r.ts).toISOString(), model: r.model, value: r.value_usd }));

  const byModel = new Map<string, number>();
  for (const r of d.reqs) byModel.set(r.model, (byModel.get(r.model) ?? 0) + r.value_usd);
  const byAgent = new Map<string, number>();
  for (const r of sub) byAgent.set(r.agent_type ?? "subagent", (byAgent.get(r.agent_type ?? "subagent") ?? 0) + r.value_usd);
  const meta = d.reqs[0]!;

  return (
    <>
      <div className="mb-2 text-xs">
        <Link href={`/w/${id}/sessions`} className="text-accent">
          ← Sessions
        </Link>
      </div>
      <PageHeader
        title={d.meta?.title ?? d.meta?.agent_name ?? `Session ${sessionId.slice(0, 8)}`}
        sub={
          <span className="flex flex-wrap gap-2">
            <span>{dateTime(d.reqs[0]!.ts, tz)} → {dateTime(d.reqs.at(-1)!.ts, tz)}</span>
            {meta.project && <Badge>{meta.project}</Badge>}
            {meta.git_branch && meta.git_branch !== "HEAD" && <Badge>{meta.git_branch}</Badge>}
            {meta.entrypoint && <Badge>{meta.entrypoint}</Badge>}
            {meta.cc_version && <Badge>Claude Code {meta.cc_version}</Badge>}
          </span>
        }
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Stat label="API-equivalent value" value={usd(value)} />
        <Stat label="Requests" value={int(d.reqs.length)} note={sub.length ? `${sub.length} by subagents` : undefined} />
        <Stat label="Span" value={duration(last - first)} />
        <Stat label="Cache hit rate" value={pct(prompt ? tok("cache_read") / prompt : null)} />
        <Stat label="Output tokens" value={compact(tok("output"))} />
        <Stat label="Compactions" value={int(d.events.filter((e) => e.event === "compaction").length)} note={d.errors.length ? `${d.errors.length} errors` : undefined} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Context size per request" sub="Prompt tokens sent on each main-thread request (input + cache read + cache write)">
          <ContextGrowth points={points} compactions={compactionIdx} />
        </Card>
        <Card title="Where the value went">
          <BarList items={[...byModel].map(([m, v]) => ({ key: m, label: modelLabel(m), value: v, color: modelColor(m) }))} format={usd} />
          {byAgent.size > 0 && (
            <>
              <div className="mt-5 mb-2 text-xs font-medium text-ink-2">Subagents ({pct(subValue / value)})</div>
              <BarList items={[...byAgent].map(([a, v]) => ({ key: a, label: a, value: v, color: "var(--series-7)" }))} format={usd} />
            </>
          )}
        </Card>
      </div>

      <Card className="mt-4" title="Value per request">
        <RequestBars points={bars} />
      </Card>

      {d.snapshot && d.snapshot.total_cost_usd > 0 && (
        <Card className="mt-4" title="Claude Code's own accounting" sub="From the session's cost-state record. It covers the last run of the session only, and includes side requests (titles, classifiers) that transcripts don't log.">
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <div className="text-xs text-muted">Claude Code cost (last run)</div>
              <div className="tabular font-medium">{usd(d.snapshot.total_cost_usd)}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Lines added / removed</div>
              <div className="tabular font-medium">
                +{int(d.snapshot.lines_added)} / −{int(d.snapshot.lines_removed)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">API time</div>
              <div className="tabular font-medium">{duration(d.snapshot.api_ms)}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Tool time</div>
              <div className="tabular font-medium">{duration(d.snapshot.tool_ms)}</div>
            </div>
          </div>
        </Card>
      )}

      <Card className="mt-4" title="Requests" sub={d.reqs.length > 400 ? `Showing the 400 most expensive of ${int(d.reqs.length)} requests` : undefined}>
        <Table head={["Time", "Model", "Agent / skill", "Input", "Cache read", "Cache write", "Output", "Effort", "Latency", "Value"]}>
          {(d.reqs.length > 400 ? [...d.reqs].sort((a, b) => b.value_usd - a.value_usd).slice(0, 400).sort((a, b) => +new Date(a.ts) - +new Date(b.ts)) : d.reqs).map((r) => (
            <tr key={r.request_id} className="hover:bg-surface-2">
              <Td right={false}>{new Date(r.ts).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", second: "2-digit" })}</Td>
              <Td>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-sm" style={{ background: modelColor(r.model) }} />
                  {modelLabel(r.model)}
                  {r.speed === "fast" && <Badge>fast</Badge>}
                </span>
              </Td>
              <Td>{r.is_subagent ? r.agent_type ?? "subagent" : r.skill ?? "-"}</Td>
              <Td>{compact(r.input)}</Td>
              <Td>{compact(r.cache_read)}</Td>
              <Td>{compact(r.cache_write_5m + r.cache_write_1h)}</Td>
              <Td>{compact(r.output)}</Td>
              <Td>{r.effort ?? "-"}</Td>
              <Td>{r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : "-"}</Td>
              <Td className="font-medium">{usd(r.value_usd)}</Td>
            </tr>
          ))}
        </Table>
        {d.errors.length > 0 && (
          <div className="mt-4 text-sm">
            <div className="mb-1 text-xs font-medium text-ink-2">Errors</div>
            {d.errors.map((e, i) => (
              <div key={i} className="text-ink-2">
                {dateTime(e.ts, tz)} · {e.reason_class.replace(/_/g, " ")}
                {e.code ? ` (${e.code})` : ""}
              </div>
            ))}
          </div>
        )}
      </Card>
      <p className="mt-3 text-xs text-muted">
        Value for each request is computed from the price book (e.g. {modelLabel(meta.model)}: {usd(computeValueUsd(meta.model, { input: 1e6, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }) ?? 0)} per million input tokens).
      </p>
    </>
  );
}
