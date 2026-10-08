import { modelLabel } from "@claude-obs/shared";
import { DailyStacked } from "@/components/charts";
import { RangePicker } from "@/components/client";
import { Card, PageHeader, Table, Td } from "@/components/ui";
import { BarList } from "@/components/viz";
import { modelColor } from "@/lib/colors";
import { compact, int, pct, usd } from "@/lib/format";
import { pageContext, type PageProps } from "@/lib/page";
import { byModel, dailyByModel, effortMix, entrypointSplit, skillBreakdown, subagentBreakdown } from "@/lib/queries";
import { RANGES } from "@/lib/range";

export default async function Models(props: PageProps) {
  const { id, range, tz } = await pageContext(props);
  const [models, daily, effort, entry, subs, skills] = await Promise.all([
    byModel(id, range.from, range.to),
    dailyByModel(id, range.from, range.to, tz),
    effortMix(id, range.from, range.to),
    entrypointSplit(id, range.from, range.to),
    subagentBreakdown(id, range.from, range.to),
    skillBreakdown(id, range.from, range.to),
  ]);
  const total = models.reduce((s, m) => s + m.value, 0);
  return (
    <>
      <PageHeader title="Models" sub={range.label}>
        <RangePicker ranges={RANGES} current={range.key} />
      </PageHeader>
      <Card title="Tokens per day by model" sub="All token types (input, output, cache reads and writes)">
        <DailyStacked rows={daily} metric="tokens" />
      </Card>
      <Card className="mt-4" title="By model">
        <Table head={["Model", "Requests", "Sessions", "Input", "Output", "Thinking", "Cache read", "Cache write 5m / 1h", "Cache hit", "Effective $/MTok", "Avg latency", "Value", "Share"]}>
          {models.map((m) => {
            const prompt = m.input + m.cache_read + m.cache_write_5m + m.cache_write_1h;
            const all = prompt + m.output;
            return (
              <tr key={m.model} className="hover:bg-surface-2">
                <Td right={false}>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block size-2.5 rounded-sm" style={{ background: modelColor(m.model) }} />
                    {modelLabel(m.model)}
                  </span>
                </Td>
                <Td>{int(m.requests)}</Td>
                <Td>{int(m.sessions)}</Td>
                <Td>{compact(m.input)}</Td>
                <Td>{compact(m.output)}</Td>
                <Td>{m.thinking ? compact(m.thinking) : "-"}</Td>
                <Td>{compact(m.cache_read)}</Td>
                <Td>
                  {compact(m.cache_write_5m)} / {compact(m.cache_write_1h)}
                </Td>
                <Td>{pct(prompt ? m.cache_read / prompt : null)}</Td>
                <Td>{all ? usd((m.value / all) * 1e6) : "-"}</Td>
                <Td>{m.avg_duration_ms ? `${(m.avg_duration_ms / 1000).toFixed(1)}s` : "-"}</Td>
                <Td className="font-medium">{usd(m.value)}</Td>
                <Td>{pct(total ? m.value / total : 0)}</Td>
              </tr>
            );
          })}
        </Table>
        <p className="mt-3 text-xs text-muted">
          Effective $/MTok blends all token types, so heavy cache reuse makes it far lower than list input prices. Latency needs OpenTelemetry.
        </p>
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Effort level" sub="Share of value by the effort Claude Code requested">
          <BarList items={effort.map((e) => ({ key: e.effort, label: e.effort, value: e.value, sub: `${int(e.requests)} req` }))} format={usd} />
        </Card>
        <Card title="Where it ran" sub="Claude Code entry point">
          <BarList items={entry.map((e) => ({ key: e.entrypoint, label: e.entrypoint, value: e.value, sub: `${int(e.requests)} req` }))} format={usd} />
        </Card>
        <Card title="Subagents" sub="Value by subagent type">
          <BarList items={subs.map((s) => ({ key: s.agent, label: s.agent, value: s.value, color: "var(--series-7)", sub: `${int(s.requests)} req` }))} format={usd} />
        </Card>
        <Card title="Skills & plugins" sub="Requests made while a skill or plugin was active">
          <BarList items={skills.map((s) => ({ key: s.skill, label: s.skill, value: s.value, color: "var(--series-3)", sub: `${int(s.requests)} req` }))} format={usd} />
        </Card>
      </div>
    </>
  );
}
