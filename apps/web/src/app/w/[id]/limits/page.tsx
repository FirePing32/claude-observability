import { BlocksChart } from "@/components/charts";
import { LiveBlock, RangePicker } from "@/components/client";
import { Badge, Card, PageHeader, Stat, Table, Td } from "@/components/ui";
import { Heatmap } from "@/components/viz";
import { unseenUsageSuspected } from "@/lib/blocks";
import { dateTime, int, pct, usd } from "@/lib/format";
import { liveBlock } from "@/lib/live";
import { pageContext, type PageProps } from "@/lib/page";
import { blockData, heatmap, limitHits, weeklyValue } from "@/lib/queries";
import { RANGES } from "@/lib/range";
import { ManualLimitForm } from "./manual";

export default async function Limits(props: PageProps) {
  const { id, range, tz } = await pageContext(props);
  const now = Date.now();
  const [{ blocks, ceiling }, live, hits, heat, week] = await Promise.all([
    blockData(id, range.from, range.to),
    liveBlock(id),
    limitHits(id, range.from, range.to),
    heatmap(id, range.from, range.to, tz),
    weeklyValue(id),
  ]);
  const bars = blocks.map((b) => ({
    start: b.start,
    end: b.end,
    value: b.value,
    requests: b.requests,
    limited: b.limits.length > 0,
    unseen: unseenUsageSuspected(b, ceiling),
    active: now >= b.start && now < b.end,
  }));
  const limited = blocks.filter((b) => b.limits.length);
  const avgBlock = blocks.length ? blocks.reduce((s, b) => s + b.value, 0) / blocks.length : 0;
  const hourKey = (t: Date) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(t);
    const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.find((x) => x.type === "weekday")!.value);
    return `${wd}:${Number(p.find((x) => x.type === "hour")!.value)}`;
  };
  return (
    <>
      <PageHeader title="Limits" sub="5-hour blocks reconstructed from this account's activity across every machine">
        <RangePicker ranges={RANGES} current={range.key} />
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Current block">
          <LiveBlock workspaceId={id} tz={tz} initial={live} />
        </Card>
        <div className="grid grid-cols-2 gap-4 lg:col-span-2">
          <Stat label="Blocks in range" value={int(blocks.length)} note={`avg ${usd(avgBlock)}`} />
          <Stat label="Blocks that hit a limit" value={int(limited.length)} note={blocks.length ? pct(limited.length / blocks.length) : undefined} upIsGood={false} />
          <Stat label="Learned 5-hour limit" value={ceiling ? `≈ ${usd(ceiling.median)}` : "Not yet"} note={ceiling ? `from ${ceiling.samples} limit hit${ceiling.samples > 1 ? "s" : ""}; conservative ${usd(ceiling.p10)}` : "Needs at least one recorded limit hit"} />
          <Stat label="Last 7 days" value={usd(week.value)} note={`${int(week.requests)} requests`} />
        </div>
      </div>
      <Card className="mt-4" title="Blocks" sub="API-equivalent value used in each 5-hour block. Bars labelled 'limit' ran out.">
        <BlocksChart blocks={bars} ceiling={ceiling?.median ?? null} tz={tz} />
        <p className="mt-2 text-xs text-muted">
          Anthropic doesn't publish exact limits or reset rules. Blocks start at the first request after the previous one expired (rounded to the hour);
          the learned limit is the median usage at which this account actually hit a limit. claude.ai chat use counts against the same limits but isn't visible here.
        </p>
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="When the account is busiest" sub={`Value by hour of week (${tz})`}>
          <Heatmap cells={heat} format={usd} limitHours={new Set(hits.map((h) => hourKey(new Date(h.ts))))} />
        </Card>
        <Card className="lg:col-span-2" title="Limit hits" sub="Detected from Claude Code's limit messages, or marked by hand">
          <ManualLimitForm workspaceId={id} />
          <Table className="mt-3" head={["When", "Kind", "Source"]}>
            {hits.map((h, i) => (
              <tr key={i}>
                <Td right={false}>{dateTime(h.ts, tz)}</Td>
                <Td>{h.limit_kind === "weekly" ? "weekly" : h.limit_kind === "five_hour" ? "5-hour" : "unknown"}</Td>
                <Td>
                  <Badge tone={h.source === "manual" ? "neutral" : "accent"}>{h.source}</Badge>
                </Td>
              </tr>
            ))}
          </Table>
          {!hits.length && <p className="mt-2 text-sm text-muted">No limit hits in this range.</p>}
        </Card>
      </div>
    </>
  );
}
