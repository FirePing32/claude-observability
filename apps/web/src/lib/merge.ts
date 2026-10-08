import { computeValueUsd, findPrice, type UsageRecord } from "@claude-obs/shared";
import type { schema } from "./db";

export type RequestRow = typeof schema.apiRequests.$inferInsert;

/** A request as reported by Claude Code's OpenTelemetry `api_request` event. */
export interface OtelRequest {
  requestId: string;
  sessionId: string;
  ts: Date;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  /** OTel reports only the total; it is priced as 5m writes until a transcript supplies the split. */
  cacheCreation: number;
  costUsd: number | null;
  durationMs: number | null;
  speed: string | null;
  effort: string | null;
  querySource: string | null;
  agentType: string | null;
  skill: string | null;
  plugin: string | null;
  ccVersion: string | null;
}

function priced(row: RequestRow): RequestRow {
  const v = computeValueUsd(row.model, {
    input: row.input ?? 0,
    output: row.output ?? 0,
    cacheRead: row.cacheRead ?? 0,
    cacheWrite5m: row.cacheWrite5m ?? 0,
    cacheWrite1h: row.cacheWrite1h ?? 0,
    webSearch: row.webSearch ?? 0,
    speed: row.speed,
    inferenceGeo: row.inferenceGeo,
  });
  return { ...row, valueUsd: v ?? 0, priced: v !== null };
}

const maxOrNull = (a: number | null | undefined, b: number | null | undefined) =>
  a == null && b == null ? null : Math.max(a ?? 0, b ?? 0);

const union = (a: string[] | undefined, b: string) => [...new Set([...(a ?? []), b])].sort();

/**
 * Merge a transcript usage record into whatever is already stored for the same
 * request. Transcript token counts are authoritative (they carry the 5m/1h cache
 * split); `output` only ever grows (streaming lines); OTel-only fields survive.
 * Returns `changed: false` when the incoming record adds nothing (a duplicate).
 */
export function mergeTranscript(
  existing: RequestRow | undefined,
  u: UsageRecord,
  workspaceId: string,
  deviceId: string | null,
): { row: RequestRow; changed: boolean } {
  const fromTranscript: RequestRow = {
    workspaceId,
    requestId: u.requestId,
    messageId: u.messageId,
    sessionId: u.sessionId,
    deviceId,
    ts: new Date(u.ts),
    model: u.model,
    isSubagent: u.isSubagent,
    agentId: u.agentId,
    agentType: u.agentType,
    skill: u.skill,
    plugin: u.plugin,
    input: u.input,
    output: u.output,
    cacheRead: u.cacheRead,
    cacheWrite5m: u.cacheWrite5m,
    cacheWrite1h: u.cacheWrite1h,
    thinking: u.thinking,
    webSearch: u.webSearch,
    webFetch: u.webFetch,
    serviceTier: u.serviceTier,
    speed: u.speed,
    inferenceGeo: u.inferenceGeo,
    effort: u.effort,
    entrypoint: u.entrypoint,
    ccVersion: u.ccVersion,
    project: u.project,
    gitBranch: u.gitBranch,
    sources: ["transcript"],
  };
  if (!existing) return { row: priced(fromTranscript), changed: true };

  const hadTranscript = existing.sources?.includes("transcript") ?? false;
  const output = Math.max(existing.output ?? 0, u.output);
  if (hadTranscript && output === existing.output && (u.thinking ?? 0) <= (existing.thinking ?? 0)) {
    return { row: existing, changed: false };
  }
  const row: RequestRow = {
    ...fromTranscript,
    output,
    thinking: maxOrNull(existing.thinking, u.thinking),
    // keep the first device that reported it, and OTel-only fields
    deviceId: existing.deviceId ?? deviceId,
    durationMs: existing.durationMs,
    querySource: existing.querySource,
    otelCostUsd: existing.otelCostUsd,
    sources: union(existing.sources, "transcript"),
  };
  return { row: priced(row), changed: true };
}

/** Merge an OTel api_request event. Adds latency/source fields; fills tokens only if no transcript has. */
export function mergeOtel(
  existing: RequestRow | undefined,
  o: OtelRequest,
  workspaceId: string,
  deviceId: string | null,
): { row: RequestRow; changed: boolean } {
  if (existing?.sources?.includes("transcript")) {
    const row: RequestRow = {
      ...existing,
      output: Math.max(existing.output ?? 0, o.output),
      durationMs: o.durationMs ?? existing.durationMs,
      querySource: o.querySource ?? existing.querySource,
      otelCostUsd: o.costUsd ?? existing.otelCostUsd,
      sources: union(existing.sources, "otel"),
    };
    return { row: row.output !== existing.output ? priced(row) : row, changed: true };
  }
  const row: RequestRow = {
    ...(existing ?? {}),
    workspaceId,
    requestId: o.requestId,
    sessionId: o.sessionId,
    deviceId: existing?.deviceId ?? deviceId,
    ts: o.ts,
    model: o.model,
    isSubagent: existing?.isSubagent ?? Boolean(o.agentType),
    agentType: o.agentType,
    skill: o.skill,
    plugin: o.plugin,
    input: o.input,
    output: Math.max(existing?.output ?? 0, o.output),
    cacheRead: o.cacheRead,
    cacheWrite5m: o.cacheCreation,
    cacheWrite1h: 0,
    speed: o.speed,
    effort: o.effort,
    ccVersion: o.ccVersion,
    durationMs: o.durationMs,
    querySource: o.querySource,
    otelCostUsd: o.costUsd,
    sources: union(existing?.sources, "otel"),
  };
  return { row: priced(row), changed: true };
}

export const isKnownModel = (m: string) => findPrice(m) !== null;
