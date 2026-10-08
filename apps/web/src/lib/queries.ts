import "server-only";
import { cacheSavingsUsd, modelFamily } from "@claude-obs/shared";
import { sql, type SQL } from "drizzle-orm";
import { buildBlocks, learnCeiling, type Block, type Ceiling } from "./blocks";
import { db } from "./db";

/** All dashboard reads. Every query is scoped by workspace id; sums are cast to float8. */

/** Drizzle's postgres-js driver doesn't serialize Date params in raw SQL; pass ISO strings. */
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

async function rows<T>(q: SQL): Promise<T[]> {
  return (await db.execute(q)) as unknown as T[];
}

export interface Filters {
  model?: string | null;
  project?: string | null;
  device?: string | null;
}

function filterSql(f: Filters = {}): SQL {
  const parts: SQL[] = [];
  if (f.model) parts.push(sql`and r.model = ${f.model}`);
  if (f.project) parts.push(sql`and r.project = ${f.project}`);
  if (f.device) parts.push(sql`and r.device_id = ${f.device}`);
  return sql.join(parts, sql` `);
}

export interface Totals {
  requests: number;
  sessions: number;
  value: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  thinking: number;
  subagentValue: number;
  opusValue: number;
  activeDays: number;
  cacheSavings: number;
  cacheHitRate: number | null;
  unpriced: number;
}

export async function totals(ws: string, from: Date, to: Date, tz: string, f: Filters = {}): Promise<Totals> {
  const byModel = await rows<{
    model: string;
    requests: number;
    sessions: number;
    value: number;
    input: number;
    output: number;
    cache_read: number;
    cache_write: number;
    thinking: number;
    subagent_value: number;
    unpriced: number;
  }>(sql`
    select r.model, count(*)::int requests, count(distinct r.session_id)::int sessions,
      sum(r.value_usd)::float8 value, sum(r.input)::float8 input, sum(r.output)::float8 output,
      sum(r.cache_read)::float8 cache_read, sum(r.cache_write_5m + r.cache_write_1h)::float8 cache_write,
      coalesce(sum(r.thinking), 0)::float8 thinking,
      sum(case when r.is_subagent then r.value_usd else 0 end)::float8 subagent_value,
      sum(case when r.priced then 0 else 1 end)::int unpriced
    from api_requests r
    where r.workspace_id = ${ws} and r.ts >= ${ts(from)} and r.ts < ${ts(to)} ${filterSql(f)}
    group by r.model`);
  const [agg] = await rows<{ sessions: number; active_days: number }>(sql`
    select count(distinct r.session_id)::int sessions,
      count(distinct (r.ts at time zone ${tz})::date)::int active_days
    from api_requests r
    where r.workspace_id = ${ws} and r.ts >= ${ts(from)} and r.ts < ${ts(to)} ${filterSql(f)}`);
  const t: Totals = {
    requests: 0,
    sessions: agg?.sessions ?? 0,
    value: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    thinking: 0,
    subagentValue: 0,
    opusValue: 0,
    activeDays: agg?.active_days ?? 0,
    cacheSavings: 0,
    cacheHitRate: null,
    unpriced: 0,
  };
  for (const m of byModel) {
    t.requests += m.requests;
    t.value += m.value;
    t.input += m.input;
    t.output += m.output;
    t.cacheRead += m.cache_read;
    t.cacheWrite += m.cache_write;
    t.thinking += m.thinking;
    t.subagentValue += m.subagent_value;
    t.unpriced += m.unpriced;
    if (modelFamily(m.model) === "opus") t.opusValue += m.value;
    t.cacheSavings += cacheSavingsUsd(m.model, m.cache_read);
  }
  const prompt = t.input + t.cacheRead + t.cacheWrite;
  t.cacheHitRate = prompt ? t.cacheRead / prompt : null;
  return t;
}

export interface DailyModelRow {
  day: string;
  model: string;
  value: number;
  requests: number;
  tokens: number;
}

export async function dailyByModel(ws: string, from: Date, to: Date, tz: string, f: Filters = {}) {
  return rows<DailyModelRow>(sql`
    select to_char((r.ts at time zone ${tz})::date, 'YYYY-MM-DD') as day, r.model,
      sum(r.value_usd)::float8 value, count(*)::int requests,
      sum(r.input + r.output + r.cache_read + r.cache_write_5m + r.cache_write_1h)::float8 tokens
    from api_requests r
    where r.workspace_id = ${ws} and r.ts >= ${ts(from)} and r.ts < ${ts(to)} ${filterSql(f)}
    group by 1, 2 order by 1`);
}

export interface ModelRow {
  model: string;
  requests: number;
  sessions: number;
  value: number;
  input: number;
  output: number;
  cache_read: number;
  cache_write_5m: number;
  cache_write_1h: number;
  thinking: number;
  avg_duration_ms: number | null;
  fast: number;
}

export async function byModel(ws: string, from: Date, to: Date, f: Filters = {}) {
  return rows<ModelRow>(sql`
    select r.model, count(*)::int requests, count(distinct r.session_id)::int sessions, sum(r.value_usd)::float8 value,
      sum(r.input)::float8 input, sum(r.output)::float8 output, sum(r.cache_read)::float8 cache_read,
      sum(r.cache_write_5m)::float8 cache_write_5m, sum(r.cache_write_1h)::float8 cache_write_1h,
      coalesce(sum(r.thinking), 0)::float8 thinking, avg(r.duration_ms)::float8 avg_duration_ms,
      sum(case when r.speed = 'fast' then 1 else 0 end)::int fast
    from api_requests r
    where r.workspace_id = ${ws} and r.ts >= ${ts(from)} and r.ts < ${ts(to)} ${filterSql(f)}
    group by r.model order by value desc`);
}

export async function effortMix(ws: string, from: Date, to: Date) {
  return rows<{ effort: string; requests: number; value: number }>(sql`
    select coalesce(r.effort, 'default') effort, count(*)::int requests, sum(r.value_usd)::float8 value
    from api_requests r where r.workspace_id = ${ws} and r.ts >= ${ts(from)} and r.ts < ${ts(to)}
    group by 1 order by value desc`);
}

export interface SessionRow {
  session_id: string;
  title: string | null;
  started: Date;
  ended: Date;
  requests: number;
  value: number;
  subagent_value: number;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  models: string[];
  project: string | null;
  entrypoint: string | null;
  git_branch: string | null;
  compactions: number;
  errors: number;
  device_id: string | null;
  device_name: string | null;
}

export async function sessions(
  ws: string,
  from: Date,
  to: Date,
  opts: Filters & { sort?: "value" | "recent" | "requests"; limit?: number; q?: string | null } = {},
) {
  const order =
    opts.sort === "recent" ? sql`ended desc` : opts.sort === "requests" ? sql`requests desc` : sql`value desc`;
  const search = opts.q ? sql`and (m.title ilike ${"%" + opts.q + "%"} or r.project ilike ${"%" + opts.q + "%"})` : sql``;
  return rows<SessionRow>(sql`
    select r.session_id, coalesce(m.title, m.agent_name) title,
      min(r.ts) started, max(r.ts) ended, count(*)::int requests,
      sum(r.value_usd)::float8 value, sum(case when r.is_subagent then r.value_usd else 0 end)::float8 subagent_value,
      sum(r.input)::float8 input, sum(r.output)::float8 output, sum(r.cache_read)::float8 cache_read,
      sum(r.cache_write_5m + r.cache_write_1h)::float8 cache_write,
      array_agg(distinct r.model) models,
      mode() within group (order by r.project) project,
      mode() within group (order by r.entrypoint) entrypoint,
      mode() within group (order by r.git_branch) git_branch,
      mode() within group (order by r.device_id) device_id,
      (select d.name from devices d where d.id = mode() within group (order by r.device_id)) device_name,
      (select count(*) from session_events e where e.workspace_id = r.workspace_id and e.session_id = r.session_id and e.event = 'compaction')::int compactions,
      (select count(*) from error_events x where x.workspace_id = r.workspace_id and x.session_id = r.session_id)::int errors
    from api_requests r
    left join session_meta m on m.workspace_id = r.workspace_id and m.session_id = r.session_id
    where r.workspace_id = ${ws} and r.ts >= ${ts(from)} and r.ts < ${ts(to)} ${filterSql(opts)} ${search}
    group by r.workspace_id, r.session_id, m.title, m.agent_name
    order by ${order}
    limit ${opts.limit ?? 200}`);
}

export async function sessionSummaryStats(ws: string, from: Date, to: Date) {
  const [r] = await rows<{ median: number | null; p95: number | null; n: number }>(sql`
    select percentile_cont(0.5) within group (order by v)::float8 median,
      percentile_cont(0.95) within group (order by v)::float8 p95, count(*)::int n
    from (select sum(value_usd) v from api_requests
          where workspace_id = ${ws} and ts >= ${ts(from)} and ts < ${ts(to)} group by session_id) s`);
  return r ?? { median: null, p95: null, n: 0 };
}

export async function sessionDetail(ws: string, sessionId: string) {
  const reqs = await rows<{
    request_id: string;
    ts: Date;
    model: string;
    is_subagent: boolean;
    agent_type: string | null;
    skill: string | null;
    input: number;
    output: number;
    cache_read: number;
    cache_write_5m: number;
    cache_write_1h: number;
    thinking: number | null;
    value_usd: number;
    effort: string | null;
    speed: string | null;
    duration_ms: number | null;
    query_source: string | null;
    project: string | null;
    git_branch: string | null;
    entrypoint: string | null;
    cc_version: string | null;
    sources: string[];
  }>(sql`
    select request_id, ts, model, is_subagent, agent_type, skill, input::float8 input, output::float8 output,
      cache_read::float8 cache_read, cache_write_5m::float8 cache_write_5m, cache_write_1h::float8 cache_write_1h,
      thinking::float8 thinking, value_usd, effort, speed, duration_ms, query_source, project, git_branch, entrypoint,
      cc_version, sources
    from api_requests where workspace_id = ${ws} and session_id = ${sessionId} order by ts, request_id`);
  const machines = await rows<{ name: string; requests: number }>(sql`
    select coalesce(d.name, 'Unknown machine') as name, count(*)::int requests
    from api_requests r left join devices d on d.id = r.device_id
    where r.workspace_id = ${ws} and r.session_id = ${sessionId}
    group by 1 order by 2 desc`);
  const [meta] = await rows<{ title: string | null; title_source: string | null; agent_name: string | null }>(
    sql`select title, title_source, agent_name from session_meta where workspace_id = ${ws} and session_id = ${sessionId}`,
  );
  const events = await rows<{ ts: Date; event: string; duration_ms: number | null; pre_tokens: number | null; trigger: string | null }>(
    sql`select ts, event, duration_ms::float8 duration_ms, pre_tokens::float8 pre_tokens, trigger from session_events
        where workspace_id = ${ws} and session_id = ${sessionId} order by ts`,
  );
  const errors = await rows<{ ts: Date; reason_class: string; code: string | null }>(
    sql`select ts, reason_class, code from error_events where workspace_id = ${ws} and session_id = ${sessionId} order by ts`,
  );
  const limits = await rows<{ ts: Date; limit_kind: string }>(
    sql`select ts, limit_kind from limit_events where workspace_id = ${ws} and session_id = ${sessionId} order by ts`,
  );
  const [snapshot] = await rows<{ total_cost_usd: number; lines_added: number; lines_removed: number; api_ms: number; tool_ms: number; started_at: Date | null }>(
    sql`select total_cost_usd, lines_added, lines_removed, api_ms::float8 api_ms, tool_ms::float8 tool_ms, started_at
        from session_snapshots where workspace_id = ${ws} and session_id = ${sessionId}`,
  );
  return { reqs, meta: meta ?? null, events, errors, limits, snapshot: snapshot ?? null, machines };
}

export async function projects(ws: string, from: Date, to: Date) {
  return rows<{ project: string | null; sessions: number; requests: number; value: number; last: Date; branches: number; opus_value: number }>(sql`
    select r.project, count(distinct r.session_id)::int sessions, count(*)::int requests, sum(r.value_usd)::float8 value,
      max(r.ts) as "last", count(distinct r.git_branch)::int branches,
      sum(case when r.model like 'claude-opus%' then r.value_usd else 0 end)::float8 opus_value
    from api_requests r where r.workspace_id = ${ws} and r.ts >= ${ts(from)} and r.ts < ${ts(to)}
    group by r.project order by value desc`);
}

export async function filterOptions(ws: string) {
  const models = await rows<{ v: string }>(sql`select distinct model v from api_requests where workspace_id = ${ws} order by 1`);
  const projs = await rows<{ v: string }>(
    sql`select distinct project v from api_requests where workspace_id = ${ws} and project is not null order by 1 limit 200`,
  );
  const devices = await rows<{ id: string; name: string }>(
    sql`select id, name from devices where workspace_id = ${ws} order by created_at`,
  );
  return { models: models.map((m) => m.v), projects: projs.map((p) => p.v), devices };
}

/** Hour-of-week heatmap in the workspace timezone (dow 0 = Sunday). */
export async function heatmap(ws: string, from: Date, to: Date, tz: string) {
  return rows<{ dow: number; hour: number; value: number; requests: number }>(sql`
    select extract(dow from r.ts at time zone ${tz})::int as dow, extract(hour from r.ts at time zone ${tz})::int as "hour",
      sum(r.value_usd)::float8 value, count(*)::int requests
    from api_requests r where r.workspace_id = ${ws} and r.ts >= ${ts(from)} and r.ts < ${ts(to)}
    group by 1, 2`);
}

export interface BlockData {
  blocks: Block[];
  ceiling: Ceiling | null;
}

/** Blocks over [from, to); reads 5 h before `from` so a block straddling the edge is whole. */
export async function blockData(ws: string, from: Date, to: Date): Promise<BlockData> {
  const start = new Date(from.getTime() - 5 * 3600_000);
  const reqs = await rows<{ t: number; value: number; model: string }>(sql`
    select extract(epoch from ts)::float8 * 1000 t, value_usd value, model
    from api_requests where workspace_id = ${ws} and ts >= ${ts(start)} and ts < ${ts(to)} order by ts`);
  const lims = await rows<{ t: number; kind: string; resets: number | null }>(sql`
    select extract(epoch from ts)::float8 * 1000 t, limit_kind kind, extract(epoch from resets_at)::float8 * 1000 resets
    from limit_events where workspace_id = ${ws} and ts >= ${ts(start)} and ts < ${ts(to)} order by ts`);
  const blocks = buildBlocks(
    reqs.map((r) => ({ ts: r.t, value: r.value, opus: modelFamily(r.model) === "opus" })),
    lims.map((l) => ({ ts: l.t, kind: l.kind, resetsAt: l.resets })),
  ).filter((b) => b.end > from.getTime());
  // ceilings are learned from all history, not just the visible range
  const allReqs = await rows<{ t: number; value: number }>(sql`
    select extract(epoch from ts)::float8 * 1000 t, value_usd value from api_requests
    where workspace_id = ${ws} and ts >= now() - interval '120 days'
      and exists (select 1 from limit_events l where l.workspace_id = ${ws})
    order by ts`);
  const allLims = await rows<{ t: number; kind: string }>(sql`
    select extract(epoch from ts)::float8 * 1000 t, limit_kind kind from limit_events
    where workspace_id = ${ws} and ts >= now() - interval '120 days' order by ts`);
  const ceiling = allLims.length
    ? learnCeiling(buildBlocks(allReqs.map((r) => ({ ts: r.t, value: r.value, opus: false })), allLims.map((l) => ({ ts: l.t, kind: l.kind, resetsAt: null }))))
    : null;
  return { blocks, ceiling };
}

export async function weeklyValue(ws: string, now = new Date()) {
  const [r] = await rows<{ value: number; requests: number }>(sql`
    select coalesce(sum(value_usd), 0)::float8 value, count(*)::int requests from api_requests
    where workspace_id = ${ws} and ts >= ${ts(new Date(now.getTime() - 7 * 86400_000))} and ts < ${ts(now)}`);
  return r ?? { value: 0, requests: 0 };
}

export async function errorSummary(ws: string, from: Date, to: Date) {
  return rows<{ reason_class: string; n: number }>(sql`
    select reason_class, count(*)::int n from error_events
    where workspace_id = ${ws} and ts >= ${ts(from)} and ts < ${ts(to)} group by 1 order by 2 desc`);
}

export async function limitHits(ws: string, from: Date, to: Date) {
  return rows<{ ts: Date; limit_kind: string; resets_at: Date | null; source: string }>(sql`
    select ts, limit_kind, resets_at, source from limit_events
    where workspace_id = ${ws} and ts >= ${ts(from)} and ts < ${ts(to)} order by ts desc`);
}

export async function devicesWithStats(ws: string) {
  return rows<{
    id: string;
    name: string;
    os: string | null;
    enrolled_via: string;
    created_at: Date;
    last_seen_at: Date | null;
    revoked_at: Date | null;
    cc_versions: string[];
    parser_version: string | null;
    requests_7d: number;
    value_7d: number;
  }>(sql`
    select d.id, d.name, d.os, d.enrolled_via, d.created_at, d.last_seen_at, d.revoked_at, d.cc_versions, d.parser_version,
      (select count(*) from api_requests r where r.workspace_id = d.workspace_id and r.device_id = d.id and r.ts > now() - interval '7 days')::int requests_7d,
      (select coalesce(sum(value_usd), 0) from api_requests r where r.workspace_id = d.workspace_id and r.device_id = d.id and r.ts > now() - interval '7 days')::float8 value_7d
    from devices d where d.workspace_id = ${ws} order by d.revoked_at nulls first, d.last_seen_at desc nulls last`);
}

export async function dataQuality(ws: string) {
  const [r] = await rows<{ both: number; transcript_only: number; otel_only: number; last_ingest: Date | null; unpriced: number }>(sql`
    select
      count(*) filter (where 'transcript' = any(sources) and 'otel' = any(sources))::int as "both",
      count(*) filter (where sources = array['transcript'])::int transcript_only,
      count(*) filter (where sources = array['otel'])::int otel_only,
      (select max(received_at) from ingest_log where workspace_id = ${ws}) last_ingest,
      count(*) filter (where not priced)::int unpriced
    from api_requests where workspace_id = ${ws} and ts > now() - interval '30 days'`);
  const unknown = await rows<{ k: string; n: number }>(sql`
    select k, sum(v::int)::int n from ingest_log, jsonb_each_text(unknown_types) as t(k, v)
    where workspace_id = ${ws} and received_at > now() - interval '30 days' group by k order by n desc limit 10`);
  return { ...(r ?? { both: 0, transcript_only: 0, otel_only: 0, last_ingest: null, unpriced: 0 }), unknown };
}

/** Value per billing cycle, for the plan-value page. */
export async function valueByCycle(ws: string, billingDay: number, tz: string) {
  return rows<{ cycle: string; value: number; requests: number; sessions: number }>(sql`
    with c as (
      select r.*, ((r.ts at time zone ${tz}) - make_interval(days => ${billingDay - 1}))::date d from api_requests r where r.workspace_id = ${ws}
    )
    select to_char(date_trunc('month', d), 'YYYY-MM') as "cycle", sum(value_usd)::float8 value, count(*)::int requests,
      count(distinct session_id)::int sessions
    from c group by 1 order by 1`);
}

export async function cumulativeDaily(ws: string, from: Date, to: Date, tz: string) {
  return rows<{ day: string; value: number }>(sql`
    select to_char((ts at time zone ${tz})::date, 'YYYY-MM-DD') as day, sum(value_usd)::float8 value
    from api_requests where workspace_id = ${ws} and ts >= ${ts(from)} and ts < ${ts(to)} group by 1 order by 1`);
}

export async function subagentBreakdown(ws: string, from: Date, to: Date) {
  return rows<{ agent: string; requests: number; value: number }>(sql`
    select coalesce(agent_type, 'unknown') agent, count(*)::int requests, sum(value_usd)::float8 value
    from api_requests where workspace_id = ${ws} and ts >= ${ts(from)} and ts < ${ts(to)} and is_subagent
    group by 1 order by value desc limit 12`);
}

export async function skillBreakdown(ws: string, from: Date, to: Date) {
  return rows<{ skill: string; requests: number; value: number }>(sql`
    select coalesce(skill, plugin) skill, count(*)::int requests, sum(value_usd)::float8 value
    from api_requests where workspace_id = ${ws} and ts >= ${ts(from)} and ts < ${ts(to)} and (skill is not null or plugin is not null)
    group by 1 order by value desc limit 12`);
}

export async function entrypointSplit(ws: string, from: Date, to: Date) {
  return rows<{ entrypoint: string; requests: number; value: number }>(sql`
    select coalesce(entrypoint, 'unknown') entrypoint, count(*)::int requests, sum(value_usd)::float8 value
    from api_requests where workspace_id = ${ws} and ts >= ${ts(from)} and ts < ${ts(to)} group by 1 order by value desc`);
}

export async function productivity(ws: string, from: Date, to: Date) {
  const [snap] = await rows<{ added: number; removed: number }>(sql`
    select coalesce(sum(lines_added), 0)::float8 added, coalesce(sum(lines_removed), 0)::float8 removed
    from session_snapshots where workspace_id = ${ws} and coalesce(started_at, updated_at) >= ${ts(from)} and coalesce(started_at, updated_at) < ${ts(to)}`);
  const otel = await rows<{ metric: string; kind: string | null; value: number }>(sql`
    select metric, kind, sum(value)::float8 value from otel_metrics
    where workspace_id = ${ws} and ts >= ${ts(from)} and ts < ${ts(to)} group by 1, 2`);
  const get = (m: string, k?: string) => otel.filter((o) => o.metric === m && (!k || o.kind === k)).reduce((s, o) => s + o.value, 0);
  return {
    linesAdded: get("lines_of_code.count", "added") || snap?.added || 0,
    linesRemoved: get("lines_of_code.count", "removed") || snap?.removed || 0,
    commits: get("commit.count"),
    prs: get("pull_request.count"),
    activeSeconds: get("active_time.total"),
    fromOtel: otel.length > 0,
  };
}

export interface MachineRow {
  device_id: string | null;
  requests: number;
  sessions: number;
  value: number;
  opus_value: number;
  first_ts: Date | null;
  last_ts: Date | null;
}

/** Usage per reporting machine over a range. device_id is null for requests no machine claimed. */
export async function byMachine(ws: string, from: Date, to: Date) {
  return rows<MachineRow>(sql`
    select r.device_id, count(*)::int requests, count(distinct r.session_id)::int sessions,
      sum(r.value_usd)::float8 value,
      sum(case when r.model like 'claude-opus%' then r.value_usd else 0 end)::float8 opus_value,
      min(r.ts) first_ts, max(r.ts) last_ts
    from api_requests r
    where r.workspace_id = ${ws} and r.ts >= ${ts(from)} and r.ts < ${ts(to)}
    group by r.device_id order by value desc`);
}

export async function machineModelMix(ws: string, from: Date, to: Date) {
  return rows<{ device_id: string | null; model: string; value: number }>(sql`
    select r.device_id, r.model, sum(r.value_usd)::float8 value
    from api_requests r
    where r.workspace_id = ${ws} and r.ts >= ${ts(from)} and r.ts < ${ts(to)}
    group by 1, 2`);
}

export async function dailyByMachine(ws: string, from: Date, to: Date, tz: string) {
  return rows<{ day: string; device_id: string | null; value: number }>(sql`
    select to_char((r.ts at time zone ${tz})::date, 'YYYY-MM-DD') as day, r.device_id, sum(r.value_usd)::float8 value
    from api_requests r
    where r.workspace_id = ${ws} and r.ts >= ${ts(from)} and r.ts < ${ts(to)}
    group by 1, 2 order by 1`);
}
