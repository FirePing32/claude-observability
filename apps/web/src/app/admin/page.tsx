import { modelLabel, PLANS, type PlanKey } from "@claude-obs/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Button, Card, PageHeader, Stat, Table, Td } from "@/components/ui";
import { BarList } from "@/components/viz";
import { adminEnabled, isAdmin } from "@/lib/admin";
import { adminOverview, type Family } from "@/lib/admin-queries";
import { modelColor } from "@/lib/colors";
import { compact, int, pct, relTime, usd } from "@/lib/format";
import { adminLogout } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · Claude Observability", robots: { index: false, follow: false } };

const RANGES = { "7": "7 days", "30": "30 days", "90": "90 days" } as const;

const FAMILY: Record<Family, { label: string; color: string }> = {
  opus: { label: "Opus", color: "var(--series-1)" },
  sonnet: { label: "Sonnet", color: "var(--series-3)" },
  haiku: { label: "Haiku", color: "var(--series-6)" },
  fable: { label: "Fable", color: "var(--series-7)" },
  mythos: { label: "Mythos", color: "var(--series-5)" },
  other: { label: "Other", color: "var(--series-other)" },
};

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  if (!adminEnabled()) notFound();
  if (!(await isAdmin())) redirect("/admin/login");
  const { days: d } = await searchParams;
  const days = d && d in RANGES ? Number(d) : 30;
  const { workspaces, models, totals } = await adminOverview(days);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader title="Admin" sub={`All workspaces · aggregate usage over the last ${days} days · API-equivalent values`}>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-line bg-surface p-0.5">
            {Object.entries(RANGES).map(([k, label]) => (
              <Link
                key={k}
                href={`/admin?days=${k}`}
                className={`rounded-md px-2 py-1 text-xs font-medium ${Number(k) === days ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink"}`}
              >
                {label}
              </Link>
            ))}
          </div>
          <form action={adminLogout}>
            <Button variant="ghost">Sign out</Button>
          </form>
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Workspaces" value={int(totals.workspaces)} note={`${totals.activeWorkspaces} active in range`} />
        <Stat label="People joined" value={int(totals.members)} />
        <Stat label="Machines" value={int(totals.machines)} />
        <Stat label="API-equivalent value" value={usd(totals.value)} />
        <Stat label="Requests" value={compact(totals.requests)} />
      </div>

      <Card className="mt-4" title="Workspaces" sub="One workspace per Claude account. Usage columns cover the selected range. Click a workspace for its model chart, people and machines.">
        <Table head={["Workspace", "Owner", "Plan", "People", "Machines", "Last upload", "Sessions", "Requests", "Value", "Model mix"]}>
          {workspaces.map((w) => (
            <tr key={w.id} className="hover:bg-surface-2">
              <Td right={false}>
                <Link href={`/admin/w/${w.id}?days=${days}`} className="font-medium hover:underline">
                  {w.name}
                </Link>
                <div className="text-xs text-muted">created {relTime(w.created_at)}</div>
              </Td>
              <Td>{w.owner_email ?? "-"}</Td>
              <Td>
                {PLANS[w.plan as PlanKey]?.label ?? w.plan} <span className="text-muted">{usd(w.plan_price_usd, 0)}</span>
              </Td>
              <Td>{int(w.members)}</Td>
              <Td>
                {int(w.machines)}
                {w.machines > w.machines_reporting_7d && (
                  <span className="ml-1">
                    <Badge tone="warn">{w.machines - w.machines_reporting_7d} silent</Badge>
                  </span>
                )}
              </Td>
              <Td>{relTime(w.last_upload)}</Td>
              <Td>{int(w.sessions)}</Td>
              <Td>{compact(w.requests)}</Td>
              <Td className="font-medium">{usd(w.value)}</Td>
              <Td>
                {w.value > 0 ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="flex h-2 w-24 overflow-hidden rounded-full bg-surface-2">
                      {w.families.map((f) => (
                        <span key={f.family} style={{ width: `${(f.value / w.value) * 100}%`, background: FAMILY[f.family].color }} />
                      ))}
                    </span>
                    <span className="text-xs text-ink-2">
                      {w.families
                        .filter((f) => f.value / w.value >= 0.05)
                        .map((f) => `${FAMILY[f.family].label} ${pct(f.value / w.value)}`)
                        .join(" · ")}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted">no usage</span>
                )}
              </Td>
            </tr>
          ))}
        </Table>
        {!workspaces.length && <p className="py-6 text-center text-sm text-muted">No workspaces yet.</p>}
      </Card>

      <Card className="mt-4" title="Model usage across all workspaces" sub="Share of API-equivalent value">
        <BarList
          items={models.map((m) => ({ key: m.model, label: modelLabel(m.model), value: m.value, color: modelColor(m.model), sub: `${compact(m.requests)} req` }))}
          format={(v) => `${usd(v)} · ${pct(totals.value ? v / totals.value : 0)}`}
        />
      </Card>
      <p className="mt-4 text-xs text-muted">Aggregates only. Session titles, projects and per-machine usage stay inside each workspace.</p>
    </main>
  );
}
