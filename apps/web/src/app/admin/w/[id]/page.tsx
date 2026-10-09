import { modelLabel, PLANS, type PlanKey } from "@claude-obs/shared";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DailyStacked } from "@/components/charts";
import { Badge, Card, PageHeader, Stat, Table, Td } from "@/components/ui";
import { BarList } from "@/components/viz";
import { adminEnabled, isAdmin } from "@/lib/admin";
import { modelColor } from "@/lib/colors";
import { db, schema } from "@/lib/db";
import { compact, dateTime, int, pct, relTime, usd } from "@/lib/format";
import { byModel, dailyByModel, devicesWithStats, totals } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · Workspace · Claude Observability", robots: { index: false, follow: false } };

const RANGES = { "7": "7 days", "30": "30 days", "90": "90 days" } as const;

/** Admin view of one workspace: model usage over time, who has access, and its machines. No sessions, titles or projects. */
export default async function AdminWorkspace({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ days?: string }> }) {
  if (!adminEnabled()) notFound();
  if (!(await isAdmin())) redirect("/admin/login");
  const { id } = await params;
  const { days: d } = await searchParams;
  const days = d && d in RANGES ? Number(d) : 30;

  const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, id));
  if (!ws) notFound();
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);

  const [t, daily, models, machines, people] = await Promise.all([
    totals(id, from, to, ws.timezone),
    dailyByModel(id, from, to, ws.timezone),
    byModel(id, from, to),
    devicesWithStats(id),
    db
      .select({ name: schema.user.name, email: schema.user.email, role: schema.memberships.role, joined: schema.memberships.createdAt })
      .from(schema.memberships)
      .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
      .where(eq(schema.memberships.workspaceId, id)),
  ]);
  const now = Date.now();

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-2 text-xs">
        <Link href={`/admin?days=${days}`} className="text-accent">
          ← All workspaces
        </Link>
      </div>
      <PageHeader
        title={ws.name}
        sub={`${PLANS[ws.plan as PlanKey]?.label ?? ws.plan} · ${usd(ws.planPriceUsd, 0)}/month · created ${dateTime(ws.createdAt, ws.timezone)} · last ${days} days, API-equivalent`}
      >
        <div className="flex gap-1 rounded-lg border border-line bg-surface p-0.5">
          {Object.entries(RANGES).map(([k, label]) => (
            <Link
              key={k}
              href={`/admin/w/${id}?days=${k}`}
              className={`rounded-md px-2 py-1 text-xs font-medium ${Number(k) === days ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink"}`}
            >
              {label}
            </Link>
          ))}
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="API-equivalent value" value={usd(t.value)} note={ws.planPriceUsd ? `${((t.value / ws.planPriceUsd) * (30 / days)).toFixed(1)}× plan / month` : undefined} />
        <Stat label="Requests" value={compact(t.requests)} />
        <Stat label="Sessions" value={int(t.sessions)} note={`${t.activeDays} active days`} />
        <Stat label="People" value={int(people.length)} />
        <Stat label="Machines" value={int(machines.filter((m) => !m.revoked_at).length)} />
      </div>

      <Card className="mt-4" title="Daily usage by model" sub="API-equivalent value per day">
        <DailyStacked rows={daily} />
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Model mix">
          <BarList
            items={models.map((m) => ({ key: m.model, label: modelLabel(m.model), value: m.value, color: modelColor(m.model), sub: `${compact(m.requests)} req` }))}
            format={(v) => `${usd(v)} · ${pct(t.value ? v / t.value : 0)}`}
          />
        </Card>
        <Card title="People" sub="Google accounts with access to this workspace">
          <Table head={["Person", "Role", "Joined"]}>
            {people.map((p) => (
              <tr key={p.email}>
                <Td right={false}>
                  <div>{p.name}</div>
                  <div className="text-xs text-muted">{p.email}</div>
                </Td>
                <Td>{p.role}</Td>
                <Td>{relTime(p.joined)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <Card className="mt-4" title="Machines" sub="Computers reporting usage for this workspace">
        <Table head={["Machine", "System", "Enrolled", "Last upload", "Status"]}>
          {machines.map((m) => {
            const silent = !m.revoked_at && (!m.last_seen_at || now - new Date(m.last_seen_at).getTime() > 3 * 86_400_000);
            return (
              <tr key={m.id} className={m.revoked_at ? "text-muted" : ""}>
                <Td right={false}>{m.name}</Td>
                <Td>{m.os ?? "-"}</Td>
                <Td>{dateTime(m.created_at, ws.timezone)}</Td>
                <Td>{relTime(m.last_seen_at)}</Td>
                <Td>{m.revoked_at ? <Badge>revoked</Badge> : silent ? <Badge tone="warn">⚠ silent</Badge> : <Badge tone="good">active</Badge>}</Td>
              </tr>
            );
          })}
        </Table>
        {!machines.length && <p className="py-6 text-center text-sm text-muted">No machines enrolled.</p>}
      </Card>
      <p className="mt-4 text-xs text-muted">Session titles, projects and per-request details stay inside the workspace.</p>
    </main>
  );
}
