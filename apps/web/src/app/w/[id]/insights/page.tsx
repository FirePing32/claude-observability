import { desc, eq } from "drizzle-orm";
import { Card, Empty, InsightRow, PageHeader } from "@/components/ui";
import { db, schema } from "@/lib/db";
import { digestConfigured } from "@/lib/digest";
import { dateTime } from "@/lib/format";
import { computeInsights } from "@/lib/insights";
import { pageContext, type PageProps } from "@/lib/page";
import { DigestButton } from "./digest-button";

export default async function Insights(props: PageProps) {
  const { id, workspace: ws, role, tz } = await pageContext(props);
  const [insights, digests] = await Promise.all([
    computeInsights(ws),
    db.select().from(schema.digests).where(eq(schema.digests.workspaceId, id)).orderBy(desc(schema.digests.createdAt)).limit(5),
  ]);
  return (
    <>
      <PageHeader title="Insights" sub="Rule-based findings from the last 7–14 days, recomputed on every visit" />
      <Card title="Findings">
        {insights.length ? (
          <div className="-mx-2 space-y-1">
            {insights.map((i) => (
              <InsightRow key={i.id} {...i} />
            ))}
          </div>
        ) : (
          <Empty title="Nothing unusual">Insights appear when usage patterns change: limit pressure, cache drops, runaway sessions, silent machines.</Empty>
        )}
      </Card>
      <Card
        className="mt-4"
        title="Weekly AI digest"
        sub="A short narrative from Claude, written from aggregates only (no titles, prompts or code). Generated weekly by cron, or on demand."
        action={role === "owner" ? <DigestButton workspaceId={id} enabled={digestConfigured()} /> : null}
      >
        {digests.length ? (
          <div className="space-y-6">
            {digests.map((d) => (
              <article key={d.id}>
                <div className="mb-2 text-xs text-muted">
                  {dateTime(d.periodStart, tz)} → {dateTime(d.periodEnd, tz)} · {d.model} · {d.inputTokens + d.outputTokens} tokens
                </div>
                <div className="text-sm leading-6 whitespace-pre-wrap text-ink">{d.body}</div>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">{digestConfigured() ? "No digest yet." : "Set ANTHROPIC_API_KEY on the server to enable digests."}</p>
        )}
      </Card>
    </>
  );
}
