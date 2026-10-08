import { modelLabel } from "@claude-obs/shared";
import { and, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import { DailyStacked } from "@/components/charts";
import { Card, PageHeader, Stat } from "@/components/ui";
import { BarList } from "@/components/viz";
import { modelColor } from "@/lib/colors";
import { db, schema } from "@/lib/db";
import { compact, int, pct, usd } from "@/lib/format";
import { byModel, dailyByModel, totals } from "@/lib/queries";
import { resolveRange } from "@/lib/range";
import { sha256 } from "@/lib/tokens";

export const dynamic = "force-dynamic";

/** Read-only overview: aggregate numbers only, no session titles, projects or machines. */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [link] = await db
    .select({ link: schema.shareLinks, ws: schema.workspaces })
    .from(schema.shareLinks)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.shareLinks.workspaceId))
    .where(and(eq(schema.shareLinks.tokenHash, sha256(token)), isNull(schema.shareLinks.revokedAt)));
  if (!link || (link.link.expiresAt && link.link.expiresAt < new Date())) notFound();
  const ws = link.ws;
  const range = resolveRange("30d", ws.billingDay);
  const [t, daily, models] = await Promise.all([
    totals(ws.id, range.from, range.to, ws.timezone),
    dailyByModel(ws.id, range.from, range.to, ws.timezone),
    byModel(ws.id, range.from, range.to),
  ]);
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader title={ws.name} sub="Shared read-only view · last 30 days · API-equivalent value" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="API-equivalent value" value={usd(t.value)} note={ws.planPriceUsd ? `${(t.value / ws.planPriceUsd).toFixed(1)}× plan price` : undefined} />
        <Stat label="Sessions" value={int(t.sessions)} />
        <Stat label="Requests" value={compact(t.requests)} />
        <Stat label="Cache hit rate" value={pct(t.cacheHitRate)} />
      </div>
      <Card className="mt-4" title="Daily usage by model">
        <DailyStacked rows={daily} />
      </Card>
      <Card className="mt-4" title="Model mix">
        <BarList items={models.map((m) => ({ key: m.model, label: modelLabel(m.model), value: m.value, color: modelColor(m.model) }))} format={usd} />
      </Card>
    </main>
  );
}
