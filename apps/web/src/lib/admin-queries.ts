import "server-only";
import { modelFamily } from "@claude-obs/shared";
import { sql } from "drizzle-orm";
import { db } from "./db";

/** Aggregate-only figures across all workspaces, for the super-admin page. No sessions, titles, projects or machines' usage. */

async function rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(q)) as unknown as T[];
}

export type Family = ReturnType<typeof modelFamily>;

export interface AdminWorkspace {
  id: string;
  name: string;
  plan: string;
  plan_price_usd: number;
  created_at: Date;
  owner_email: string | null;
  members: number;
  machines: number;
  machines_reporting_7d: number;
  last_upload: Date | null;
  value: number;
  requests: number;
  sessions: number;
  families: { family: Family; value: number }[];
}

export async function adminOverview(days: number) {
  const since = sql`now() - make_interval(days => ${days})`;
  const ws = await rows<Omit<AdminWorkspace, "families">>(sql`
    select w.id, w.name, w.plan, w.plan_price_usd, w.created_at, u.email as owner_email,
      (select count(*) from memberships m where m.workspace_id = w.id)::int as members,
      (select count(*) from devices d where d.workspace_id = w.id and d.revoked_at is null)::int as machines,
      (select count(*) from devices d where d.workspace_id = w.id and d.revoked_at is null and d.last_seen_at > now() - interval '7 days')::int as machines_reporting_7d,
      (select max(d.last_seen_at) from devices d where d.workspace_id = w.id) as last_upload,
      coalesce(a.value, 0)::float8 as value, coalesce(a.requests, 0)::int as requests, coalesce(a.sessions, 0)::int as sessions
    from workspaces w
    left join "user" u on u.id = w.owner_id
    left join (
      select workspace_id, sum(value_usd) as value, count(*) as requests, count(distinct session_id) as sessions
      from api_requests where ts > ${since} group by workspace_id
    ) a on a.workspace_id = w.id
    order by coalesce(a.value, 0) desc, w.created_at`);

  const mix = await rows<{ workspace_id: string; model: string; value: number; requests: number }>(sql`
    select workspace_id, model, sum(value_usd)::float8 as value, count(*)::int as requests
    from api_requests where ts > ${since} group by 1, 2`);

  const byWs = new Map<string, Map<Family, number>>();
  const overall = new Map<string, { value: number; requests: number }>();
  for (const m of mix) {
    const fam = modelFamily(m.model);
    const w = byWs.get(m.workspace_id) ?? new Map<Family, number>();
    w.set(fam, (w.get(fam) ?? 0) + m.value);
    byWs.set(m.workspace_id, w);
    const o = overall.get(m.model) ?? { value: 0, requests: 0 };
    o.value += m.value;
    o.requests += m.requests;
    overall.set(m.model, o);
  }

  const workspaces: AdminWorkspace[] = ws.map((w) => ({
    ...w,
    families: [...(byWs.get(w.id) ?? new Map<Family, number>())].map(([family, value]) => ({ family, value })).sort((a, b) => b.value - a.value),
  }));
  const models = [...overall].map(([model, v]) => ({ model, ...v })).sort((a, b) => b.value - a.value);
  return {
    workspaces,
    models,
    totals: {
      workspaces: workspaces.length,
      activeWorkspaces: workspaces.filter((w) => w.requests > 0).length,
      members: workspaces.reduce((s, w) => s + w.members, 0),
      machines: workspaces.reduce((s, w) => s + w.machines, 0),
      value: workspaces.reduce((s, w) => s + w.value, 0),
      requests: workspaces.reduce((s, w) => s + w.requests, 0),
    },
  };
}
