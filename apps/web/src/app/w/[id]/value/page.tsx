import { PLANS, type PlanKey } from "@claude-obs/shared";
import { asc, eq } from "drizzle-orm";
import { CumulativeValue } from "@/components/charts";
import { Card, PageHeader, Stat, Table, Td } from "@/components/ui";
import { db, schema } from "@/lib/db";
import { int, usd } from "@/lib/format";
import { pageContext, type PageProps } from "@/lib/page";
import { blockData, cumulativeDaily, valueByCycle } from "@/lib/queries";
import { cycleStart } from "@/lib/range";

export default async function Value(props: PageProps) {
  const { id, workspace: ws, tz } = await pageContext(props);
  const now = new Date();
  const cStart = cycleStart(now, ws.billingDay);
  const [cycles, daily, periods, blocks] = await Promise.all([
    valueByCycle(id, ws.billingDay, tz),
    cumulativeDaily(id, cStart, now, tz),
    db.select().from(schema.planPeriods).where(eq(schema.planPeriods.workspaceId, id)).orderBy(asc(schema.planPeriods.effectiveFrom)),
    blockData(id, new Date(now.getTime() - 30 * 86_400_000), now),
  ]);
  const cycleValue = daily.reduce((s, d) => s + d.value, 0);
  const elapsedDays = Math.max(1, (now.getTime() - cStart.getTime()) / 86_400_000);
  const projected = (cycleValue / elapsedDays) * 30.4;
  const limitedBlocks = blocks.blocks.filter((b) => b.limits.length).length;
  const priceFor = (cycle: string) => {
    const end = `${cycle}-28`;
    return [...periods].reverse().find((p) => p.effectiveFrom <= end)?.monthlyPriceUsd ?? ws.planPriceUsd;
  };
  const planLabel = PLANS[ws.plan as PlanKey]?.label ?? ws.plan;
  return (
    <>
      <PageHeader title="Plan value" sub={`${planLabel} at ${usd(ws.planPriceUsd)}/month, compared with what the same tokens cost on the pay-as-you-go API`} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="This cycle so far" value={usd(cycleValue)} note={`${elapsedDays.toFixed(0)} days in`} />
        <Stat label="Value multiple" value={ws.planPriceUsd ? `${(cycleValue / ws.planPriceUsd).toFixed(1)}×` : "-"} />
        <Stat label="Projected for the cycle" value={usd(projected)} note={ws.planPriceUsd ? `${(projected / ws.planPriceUsd).toFixed(1)}× plan price` : undefined} />
        <Stat label="Blocks that hit a limit (30d)" value={int(limitedBlocks)} upIsGood={false} />
      </div>
      <Card className="mt-4" title="Cumulative value this cycle" sub={`Since ${cStart.toISOString().slice(0, 10)} · the line is your plan price`}>
        <CumulativeValue points={daily} planPrice={ws.planPriceUsd} />
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="By billing cycle" action={<a href={`/api/w/${id}/export?range=all`} className="text-xs text-accent">Export CSV</a>}>
          <Table head={["Cycle", "Sessions", "Requests", "Plan price", "API-equivalent", "Multiple"]}>
            {[...cycles].reverse().map((c) => {
              const price = priceFor(c.cycle);
              return (
                <tr key={c.cycle}>
                  <Td right={false}>{c.cycle}</Td>
                  <Td>{int(c.sessions)}</Td>
                  <Td>{int(c.requests)}</Td>
                  <Td>{usd(price)}</Td>
                  <Td className="font-medium">{usd(c.value)}</Td>
                  <Td>{price ? `${(c.value / price).toFixed(1)}×` : "-"}</Td>
                </tr>
              );
            })}
          </Table>
        </Card>
        <Card title="Is this the right plan?">
          <ul className="space-y-3 text-sm text-ink-2">
            <li>
              <strong className="text-ink">Against the API:</strong> on pace for {usd(projected)} this cycle at pay-as-you-go prices{" "}
              {ws.planPriceUsd ? (projected > ws.planPriceUsd ? `, ${usd(projected - ws.planPriceUsd)} more than the plan costs.` : `, ${usd(ws.planPriceUsd - projected)} less than the plan costs.`) : "."}
            </li>
            <li>
              <strong className="text-ink">Against the limits:</strong>{" "}
              {limitedBlocks === 0
                ? "no blocks ran out in the last 30 days, so a smaller plan might be enough if the multiple stays high."
                : `${limitedBlocks} blocks ran out in the last 30 days.${ws.plan === "max5x" ? " If those interruptions cost real work, Max 20x raises the limits." : ""}`}
            </li>
            <li className="text-xs text-muted">
              Limits aren't published as numbers, and claude.ai chat use shares them, so treat this as guidance, not a guarantee.
            </li>
          </ul>
          <div className="mt-4 text-xs text-ink-2">
            Plan history:{" "}
            {periods.map((p) => `${PLANS[p.plan as PlanKey]?.label ?? p.plan} ${usd(p.monthlyPriceUsd)} from ${p.effectiveFrom}`).join(" → ")}
          </div>
        </Card>
      </div>
    </>
  );
}
