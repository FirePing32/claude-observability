import { createHmac } from "node:crypto";
import { classifyReasonLite } from "./reasons";
import type { OtelRequest } from "./merge";

/**
 * Minimal OTLP/HTTP JSON decoding for Claude Code's telemetry.
 * Content attributes (prompts, responses, tool input/output, raw bodies) are
 * never read, even if a user enabled OTEL_LOG_USER_PROMPTS and friends.
 */

type AnyValue = {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
};
type KeyValue = { key: string; value?: AnyValue };
type Attrs = Map<string, string | number | boolean>;

function toAttrs(list: KeyValue[] | undefined, into: Attrs = new Map()): Attrs {
  for (const kv of list ?? []) {
    const v = kv.value;
    if (!v) continue;
    if (v.stringValue !== undefined) into.set(kv.key, v.stringValue);
    else if (v.intValue !== undefined) into.set(kv.key, Number(v.intValue));
    else if (v.doubleValue !== undefined) into.set(kv.key, v.doubleValue);
    else if (v.boolValue !== undefined) into.set(kv.key, v.boolValue);
  }
  return into;
}

const s = (a: Attrs, k: string, max = 200): string | null => {
  const v = a.get(k);
  if (v === undefined || v === null || v === "") return null;
  return String(v).slice(0, max);
};
const n = (a: Attrs, k: string): number | null => {
  const v = a.get(k);
  const x = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(x) && x >= 0 ? x : null;
};
const nanosToDate = (v: unknown): Date | null => {
  if (v === undefined || v === null) return null;
  try {
    const ms = Number(BigInt(String(v)) / 1_000_000n);
    return Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
  } catch {
    return null;
  }
};

export interface OtelError {
  id: string;
  sessionId: string;
  ts: Date;
  code: string | null;
  reasonClass: string;
}

export interface DecodedLogs {
  requests: OtelRequest[];
  errors: OtelError[];
  accountUuids: Set<string>;
  /** user.email attributes, used only for the e-mail check and never stored. */
  emails: Set<string>;
  ignored: number;
}

export function decodeLogs(body: unknown): DecodedLogs {
  const out: DecodedLogs = { requests: [], errors: [], accountUuids: new Set(), emails: new Set(), ignored: 0 };
  const resourceLogs = (body as { resourceLogs?: unknown[] })?.resourceLogs;
  if (!Array.isArray(resourceLogs)) return out;
  for (const rl of resourceLogs as { resource?: { attributes?: KeyValue[] }; scopeLogs?: { logRecords?: unknown[] }[] }[]) {
    const resAttrs = toAttrs(rl.resource?.attributes);
    const resEmail = s(resAttrs, "user.email", 320);
    if (resEmail) out.emails.add(resEmail);
    for (const sl of rl.scopeLogs ?? []) {
      for (const rec of (sl.logRecords ?? []) as { timeUnixNano?: string; observedTimeUnixNano?: string; body?: AnyValue; attributes?: KeyValue[] }[]) {
        const a = toAttrs(rec.attributes, new Map(resAttrs));
        const rawName = s(a, "event.name") ?? rec.body?.stringValue ?? "";
        const name = rawName.replace(/^claude_code\./, "");
        const acct = s(a, "user.account_uuid");
        if (acct) out.accountUuids.add(acct);
        const email = s(a, "user.email", 320);
        if (email) out.emails.add(email);
        const ts = nanosToDate(rec.timeUnixNano) ?? nanosToDate(rec.observedTimeUnixNano) ?? (s(a, "event.timestamp") ? new Date(s(a, "event.timestamp")!) : new Date());
        const sessionId = s(a, "session.id") ?? "unknown";

        if (name === "api_request") {
          const requestId = s(a, "request_id") ?? s(a, "client_request_id");
          const model = s(a, "model", 100);
          if (!requestId || !model) {
            out.ignored++;
            continue;
          }
          out.requests.push({
            requestId,
            sessionId,
            ts,
            model,
            input: n(a, "input_tokens") ?? 0,
            output: n(a, "output_tokens") ?? 0,
            cacheRead: n(a, "cache_read_tokens") ?? 0,
            cacheCreation: n(a, "cache_creation_tokens") ?? 0,
            costUsd: n(a, "cost_usd"),
            durationMs: n(a, "duration_ms"),
            speed: s(a, "speed", 50),
            effort: s(a, "effort", 50),
            querySource: s(a, "query_source", 100),
            agentType: s(a, "agent.name", 100),
            skill: s(a, "skill.name", 100),
            plugin: s(a, "plugin.name", 100),
            ccVersion: s(a, "app.version", 50) ?? s(a, "service.version", 50),
          });
        } else if (name === "api_error" || name === "api_retries_exhausted") {
          const status = s(a, "status_code", 10);
          const id = createHmac("sha256", "otel-error")
            .update(`${sessionId}:${s(a, "request_id") ?? s(a, "client_request_id") ?? ts.toISOString()}:${name}`)
            .digest("hex")
            .slice(0, 32);
          out.errors.push({ id, sessionId, ts, code: status, reasonClass: classifyReasonLite(status, s(a, "error", 300) ?? "") });
        } else {
          out.ignored++;
        }
      }
    }
  }
  return out;
}

export interface MetricPoint {
  ts: Date;
  metric: string;
  kind: string | null;
  sessionId: string | null;
  value: number;
}

const KEPT_METRICS = new Set([
  "claude_code.lines_of_code.count",
  "claude_code.commit.count",
  "claude_code.pull_request.count",
  "claude_code.active_time.total",
  "claude_code.session.count",
  "claude_code.code_edit_tool.decision",
]);

/** Keeps delta-temporality sums for the productivity metrics; cumulative points are counted and skipped. */
export function decodeMetrics(body: unknown): { points: MetricPoint[]; cumulativeSkipped: number; accountUuids: Set<string>; emails: Set<string> } {
  const out = { points: [] as MetricPoint[], cumulativeSkipped: 0, accountUuids: new Set<string>(), emails: new Set<string>() };
  const rms = (body as { resourceMetrics?: unknown[] })?.resourceMetrics;
  if (!Array.isArray(rms)) return out;
  for (const rm of rms as { resource?: { attributes?: KeyValue[] }; scopeMetrics?: { metrics?: unknown[] }[] }[]) {
    const resAttrs = toAttrs(rm.resource?.attributes);
    const resEmail = s(resAttrs, "user.email", 320);
    if (resEmail) out.emails.add(resEmail);
    for (const sm of rm.scopeMetrics ?? []) {
      for (const m of (sm.metrics ?? []) as { name?: string; sum?: { aggregationTemporality?: number | string; dataPoints?: unknown[] } }[]) {
        if (!m.name || !KEPT_METRICS.has(m.name) || !m.sum) continue;
        const temporality = m.sum.aggregationTemporality;
        if (temporality === 2 || temporality === "AGGREGATION_TEMPORALITY_CUMULATIVE") {
          out.cumulativeSkipped += m.sum.dataPoints?.length ?? 0;
          continue;
        }
        for (const dp of (m.sum.dataPoints ?? []) as { asDouble?: number; asInt?: string | number; timeUnixNano?: string; attributes?: KeyValue[] }[]) {
          const a = toAttrs(dp.attributes, new Map(resAttrs));
          const acct = s(a, "user.account_uuid");
          if (acct) out.accountUuids.add(acct);
          const email = s(a, "user.email", 320);
          if (email) out.emails.add(email);
          const value = dp.asDouble ?? Number(dp.asInt ?? NaN);
          if (!Number.isFinite(value)) continue;
          out.points.push({
            ts: nanosToDate(dp.timeUnixNano) ?? new Date(),
            metric: m.name.replace(/^claude_code\./, ""),
            kind: s(a, "type", 50) ?? s(a, "decision", 50),
            sessionId: s(a, "session.id"),
            value,
          });
        }
      }
    }
  }
  return out;
}

export const hashAccountUuid = (salt: string, uuid: string) => createHmac("sha256", salt).update(`account:${uuid}`).digest("hex");
