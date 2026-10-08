import { modelLabel, PLANS, type PlanKey } from "@claude-obs/shared";
import Link from "next/link";
import { DailyStacked } from "@/components/charts";
import { LiveBlock, RangePicker, RefreshButton } from "@/components/client";
import { Badge, Card, Empty, InsightRow, PageHeader, Stat, Table, Td } from "@/components/ui";
import { BarList } from "@/components/viz";
import { modelColor } from "@/lib/colors";
import { compact, delta, duration, int, pct, relTime, usd } from "@/lib/format";
import { computeInsights } from "@/lib/insights";
import { liveBlock } from "@/lib/live";
import { pageContext, type PageProps } from "@/lib/page";
import { byModel, cumulativeDaily, dailyByModel, dataQuality, devicesWithStats, errorSummary, sessions, totals } from "@/lib/queries";
import { cycleStart, RANGES } from "@/lib/range";

export default async function Overview(props: PageProps) {
  const { id, workspace: ws, range, tz } = await pageContext(props);
  const now = new Date();
  const cStart = cycleStart(now, ws.billingDay);
  const [cur, prev, daily, models, top, live, insights, cycleDaily, devs, dq, errs] = await Promise.all([
    totals(id, range.from, range.to, tz),
    totals(id, range.prevFrom, range.prevTo, tz),
    dailyByModel(id, range.from, range.to, tz),
    byModel(id, range.from, range.to),
    sessions(id, range.from, range.to, { limit: 6 }),
    liveBlock(id),
    computeInsights(ws, now),
    cumulativeDaily(id, cStart, now, tz),
    devicesWithStats(id),
    dataQuality(id),
    errorSummary(id, range.from, range.to),
  ]);

  if (!dq.last_ingest) {
    return (
      <>
        <PageHeader title="Overview" />
        <Empty title="No usage data yet">
          Link the machines that use this Claude account. It takes a minute per machine.{" "}
          <Link className="text-accent underline" href={`/w/${id}/setup`}>
            Connect machines →
          </Link>
        </Empty>
      </>
    );
  }

  const cycleValue = cycleDaily.reduce((s, d) => s + d.value, 0);
  let run = 0;
  const breakEven = ws.planPriceUsd > 0 ? cycleDaily.find((d) => (run += d.value) >= ws.planPriceUsd)?.day : undefined;
  const planLabel = PLANS[ws.plan as PlanKey]?.label ?? ws.plan;
  const errorsTotal = errs.reduce((s, e) => s + e.n, 0);
  const liveDevices = devs.filter((d) => !d.revoked_at);
  const staleDevices = liveDevices.filter((d) => !d.last_seen_at || now.getTime() - new Date(d.last_seen_at).getTime() > 3 * 86_400_000);

  return (
    <>
      <PageHeader title="Overview" sub={`${range.label} · values are API-equivalent (what these tokens would cost on the pay-as-you-go API)`}>
        <div className="flex items-center gap-2">
          <RangePicker ranges={RANGES} current={range.key} />
          <RefreshButton />
        </div>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Current 5-hour block" sub="Account-wide, all machines" action={<Link href={`/w/${id}/limits`} className="text-xs text-accent">Limits →</Link>}>
          <LiveBlock workspaceId={id} tz={tz} initial={live} />
        </Card>
        <Card title="Plan value this cycle" sub={`${planLabel} · since ${cStart.toISOString().slice(0, 10)}`} action={<Link href={`/w/${id}/value`} className="text-xs text-accent">Value →</Link>}>
          <div className="text-5xl font-semibold tracking-tight">{ws.planPriceUsd > 0 ? `${(cycleValue / ws.planPriceUsd).toFixed(1)}×` : usd(cycleValue)}</div>
          <div className="mt-2 text-sm text-ink-2">
            {usd(cycleValue)} of API-equivalent usage on a {usd(ws.planPriceUsd)} plan.
          </div>
          <div className="mt-1 text-xs text-muted">{breakEven ? `Broke even on ${breakEven}.` : ws.planPriceUsd > 0 ? `${usd(Math.max(0, ws.planPriceUsd - cycleValue))} to break even.` : ""}</div>
        </Card>
        <Card title="Data completeness" action={<Link href={`/w/${id}/settings#machines`} className="text-xs text-accent">Machines →</Link>}>
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between">
              <span className="text-ink-2">Machines reporting</span>
              <span className="tabular">
                {liveDevices.length - staleDevices.length}/{liveDevices.length}
              </span>
            </li>
            <li className="flex justify-between">
              <span className="text-ink-2">Last upload</span>
              <span>{relTime(dq.last_ingest)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-ink-2">Live telemetry (OTel) coverage</span>
              <span className="tabular">{pct((dq.both + dq.otel_only) / Math.max(1, dq.both + dq.otel_only + dq.transcript_only))}</span>
            </li>
            {staleDevices.length > 0 && (
              <li>
                <Badge tone="warn">⚠ {staleDevices.map((d) => d.name).join(", ")} silent 3+ days</Badge>
              </li>
            )}
          </ul>
          <p className="mt-3 text-xs text-muted">claude.ai chat and cloud sessions also use the shared limits but can't be measured.</p>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Stat label="API-equivalent value" value={usd(cur.value)} delta={delta(cur.value, prev.value)} />
        <Stat label="Sessions" value={int(cur.sessions)} delta={delta(cur.sessions, prev.sessions)} note={`${cur.activeDays} active days`} />
        <Stat label="Requests" value={compact(cur.requests)} delta={delta(cur.requests, prev.requests)} />
        <Stat label="Cache hit rate" value={pct(cur.cacheHitRate)} note={`saved ${usd(cur.cacheSavings, 0)}`} />
        <Stat label="Opus share of value" value={pct(cur.value ? cur.opusValue / cur.value : null)} upIsGood={false} />
        <Stat label="API errors" value={int(errorsTotal)} upIsGood={false} note={errs[0] ? errs[0].reason_class.replace(/_/g, " ") : undefined} />
      </div>

      <Card className="mt-4" title="Daily usage by model" sub="API-equivalent value per day">
        <DailyStacked rows={daily} />
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Insights" action={<Link href={`/w/${id}/insights`} className="text-xs text-accent">All →</Link>}>
          {insights.length ? (
            <div className="-mx-2 space-y-1">
              {insights.slice(0, 4).map((i) => (
                <InsightRow key={i.id} {...i} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">Nothing unusual right now.</p>
          )}
        </Card>
        <Card title="Model mix" sub="Share of API-equivalent value" action={<Link href={`/w/${id}/models`} className="text-xs text-accent">Models →</Link>}>
          <BarList
            items={models.map((m) => ({ key: m.model, label: modelLabel(m.model), value: m.value, color: modelColor(m.model), sub: `${int(m.requests)} req` }))}
            format={(v) => `${usd(v)} · ${pct(cur.value ? v / cur.value : 0)}`}
          />
        </Card>
      </div>

      <Card className="mt-4" title="Top sessions" action={<Link href={`/w/${id}/sessions`} className="text-xs text-accent">All sessions →</Link>}>
        <Table head={["Session", "Project", "Models", "Requests", "Duration", "Value"]}>
          {top.map((s) => (
            <tr key={s.session_id} className="hover:bg-surface-2">
              <Td right={false} className="max-w-72 truncate">
                <Link href={`/w/${id}/sessions/${encodeURIComponent(s.session_id)}`} className="hover:underline">
                  {s.title ?? <span className="text-muted">{s.session_id.slice(0, 8)}</span>}
                </Link>
              </Td>
              <Td>{s.project ?? "-"}</Td>
              <Td>{s.models.map(modelLabel).join(", ")}</Td>
              <Td>{int(s.requests)}</Td>
              <Td>{duration(new Date(s.ended).getTime() - new Date(s.started).getTime())}</Td>
              <Td className="font-medium">{usd(s.value)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
