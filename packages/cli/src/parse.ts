import type {
  ErrorRecord,
  LimitRecord,
  ReasonClass,
  SessionEventRecord,
  SessionMetaRecord,
  SessionSnapshotRecord,
  UsageRecord,
} from "@claude-obs/shared";
import { lineId } from "./account";

/**
 * Transcript parser. Every output record is built field-by-field from an
 * explicit allowlist: message content, thinking, tool inputs/outputs and full
 * paths are never copied. See docs/claude-obs.md §5.3.
 */

export interface FileContext {
  isSubagent: boolean;
  agentId: string | null;
  /** From the subagent's `.meta.json` (`agentType`), used when lines lack `attributionAgent`. */
  agentType: string | null;
  titles: boolean;
  projectOf: (cwd: unknown) => string | null;
}

/** Per-pass accumulator; `usage` is keyed by requestId and keeps the max output (streaming updates). */
export class Accumulator {
  usage = new Map<string, UsageRecord>();
  errors = new Map<string, ErrorRecord>();
  limits = new Map<string, LimitRecord>();
  meta = new Map<string, SessionMetaRecord>();
  snapshots = new Map<string, SessionSnapshotRecord>();
  events = new Map<string, SessionEventRecord>();
  unknownTypes: Record<string, number> = {};
  malformedLines = 0;
  ccVersions = new Set<string>();
  linesRead = 0;
  duplicateLines = 0;

  addUsage(r: UsageRecord): void {
    const prev = this.usage.get(r.requestId);
    if (prev) {
      this.duplicateLines++;
      if (r.output < prev.output) return; // keep the final (largest) streaming value; ties -> latest line
    }
    this.usage.set(r.requestId, r);
  }
}

/** Record types we understand but deliberately ignore (they carry content or nothing we need). */
const IGNORED_TYPES = new Set([
  "user",
  "attachment",
  "last-prompt",
  "mode",
  "permission-mode",
  "queue-operation",
  "file-history-snapshot",
  "file-history-delta",
  "atis-latch",
  "relocated",
  "summary",
  "progress",
]);
const IGNORED_SYSTEM_SUBTYPES = new Set(["stop_hook_summary", "away_summary", "local_command", "informational"]);

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
const str = (v: unknown, max = 200): string | null =>
  typeof v === "string" && v.length > 0 ? (v.length > max ? v.slice(0, max) : v) : null;

function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function parseLine(line: string, ctx: FileContext, acc: Accumulator): void {
  if (!line.trim()) return;
  acc.linesRead++;
  let d: Json;
  try {
    const parsed = JSON.parse(line) as unknown;
    const o = obj(parsed);
    if (!o) throw new Error("not an object");
    d = o;
  } catch {
    acc.malformedLines++;
    return;
  }
  const type = typeof d.type === "string" ? d.type : "(none)";
  const version = str(d.version, 50);
  if (version) acc.ccVersions.add(version);

  switch (type) {
    case "assistant":
      return parseAssistant(d, ctx, acc);
    case "cost-state":
      return parseCostState(d, acc);
    case "ai-title":
    case "custom-title":
      return parseTitle(d, type, ctx, acc);
    case "agent-name":
      return parseAgentName(d, ctx, acc);
    case "system":
      return parseSystem(d, acc);
    default:
      if (!IGNORED_TYPES.has(type)) acc.unknownTypes[type] = (acc.unknownTypes[type] ?? 0) + 1;
  }
}

function parseAssistant(d: Json, ctx: FileContext, acc: Accumulator): void {
  const m = obj(d.message);
  const sessionId = str(d.sessionId);
  const ts = isoOrNull(d.timestamp);
  if (!m || !sessionId || !ts) return;
  const model = str(m.model, 100);

  if (model === "<synthetic>" || d.isApiErrorMessage === true) {
    if (d.isApiErrorMessage === true) parseApiError(d, m, sessionId, ts, acc);
    return; // locally generated, not an API call
  }
  const requestId = str(d.requestId);
  if (!model || !requestId) return;

  const u = obj(m.usage) ?? {};
  const cc = obj(u.cache_creation);
  const totalWrite = num(u.cache_creation_input_tokens);
  let w5 = cc ? num(cc.ephemeral_5m_input_tokens) : 0;
  const w1h = cc ? num(cc.ephemeral_1h_input_tokens) : 0;
  // Older transcripts only have the total; any unattributed remainder is priced as a 5m write.
  if (w5 + w1h < totalWrite) w5 += totalWrite - (w5 + w1h);
  const stu = obj(u.server_tool_use);
  const otd = obj(u.output_tokens_details);
  const isSubagent = ctx.isSubagent || d.isSidechain === true;

  acc.addUsage({
    kind: "usage",
    requestId,
    messageId: str(m.id),
    sessionId,
    ts,
    model,
    isSubagent,
    agentId: isSubagent ? (str(d.agentId) ?? ctx.agentId) : null,
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheWrite5m: w5,
    cacheWrite1h: w1h,
    thinking: otd ? numOrNull(otd.thinking_tokens) : null,
    webSearch: stu ? num(stu.web_search_requests) : 0,
    webFetch: stu ? num(stu.web_fetch_requests) : 0,
    serviceTier: str(u.service_tier, 50),
    speed: str(u.speed, 50),
    inferenceGeo: str(u.inference_geo, 50),
    effort: str(d.perTurnEffort, 50) ?? str(d.effort, 50),
    agentType: str(d.attributionAgent, 100) ?? (isSubagent ? ctx.agentType : null),
    skill: str(d.attributionSkill, 100),
    plugin: str(d.attributionPlugin, 100),
    entrypoint: str(d.entrypoint, 50),
    ccVersion: str(d.version, 50),
    project: ctx.projectOf(d.cwd),
    gitBranch: str(d.gitBranch, 200),
  });
}

// ---------- API errors and usage limits (text is classified locally, never uploaded) ----------

const LIMIT_RE =
  /(usage|session|weekly|5[- ]hour|five[- ]hour|opus)\s+limit|limit\s+(reached|hit|exceeded)|hit your limit|out of (extra )?usage|claude ai usage limit/i;

export function classifyReason(code: string | null, text: string): ReasonClass {
  const c = (code ?? "").toLowerCase();
  if (/prompt is too long|context.{0,20}(too long|exceed)/i.test(text)) return "prompt_too_long";
  if (c.includes("auth") || /\/login|log ?in|authenticat|oauth|token (expired|revoked)/i.test(text)) return "auth";
  if (c.includes("overload") || /overloaded|\b529\b/i.test(text)) return "overloaded";
  if (c.includes("rate_limit") || /rate.?limit|\b429\b/i.test(text)) return "rate_limit";
  if (/socket|network|ECONN|ETIMEDOUT|ENOTFOUND|fetch failed|timed? ?out|closed unexpectedly|connection/i.test(text))
    return "network";
  return "other";
}

export function parseLimit(text: string, ts: string): { kind: LimitRecord["limitKind"]; resetsAt: string | null } | null {
  if (!LIMIT_RE.test(text)) return null;
  const kind: LimitRecord["limitKind"] = /week/i.test(text)
    ? "weekly"
    : /5[- ]hour|five[- ]hour|session limit|claude ai usage limit/i.test(text)
      ? "five_hour"
      : "unknown";
  return { kind, resetsAt: parseResetsAt(text, ts) };
}

/** Handles `…|1751234400` (epoch seconds) and `resets 3pm` / `resets at 10:30 am` (next occurrence, local time). */
export function parseResetsAt(text: string, ts: string): string | null {
  const epoch = /\|(\d{10})\b/.exec(text);
  if (epoch?.[1]) return new Date(Number(epoch[1]) * 1000).toISOString();
  const m = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (!m?.[1]) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  const base = new Date(ts);
  const r = new Date(base);
  r.setHours(h, min, 0, 0);
  if (r.getTime() <= base.getTime()) r.setDate(r.getDate() + 1);
  return r.toISOString();
}

function messageText(m: Json): string {
  const c = m.content;
  if (typeof c === "string") return c.slice(0, 500);
  if (Array.isArray(c)) {
    for (const b of c) {
      const o = obj(b);
      if (o && typeof o.text === "string") return o.text.slice(0, 500);
    }
  }
  return "";
}

function parseApiError(d: Json, m: Json, sessionId: string, ts: string, acc: Accumulator): void {
  const text = messageText(m);
  const code = str(d.error, 100);
  const id = lineId(sessionId, d.uuid, `${ts}:${code}`);
  const limit = parseLimit(text, ts);
  if (limit) {
    acc.limits.set(id, { kind: "limit", id, sessionId, ts, limitKind: limit.kind, resetsAt: limit.resetsAt });
    return;
  }
  acc.errors.set(id, { kind: "error", id, sessionId, ts, code, reasonClass: classifyReason(code, text) });
}

// ---------- session-level records ----------

function parseCostState(d: Json, acc: Accumulator): void {
  const sessionId = str(d.sessionId);
  if (!sessionId) return;
  const mu = obj(d.modelUsage) ?? {};
  const modelUsage: SessionSnapshotRecord["modelUsage"] = {};
  for (const [model, v] of Object.entries(mu).slice(0, 50)) {
    const e = obj(v);
    if (!e || model.length > 100) continue;
    modelUsage[model] = {
      inputTokens: num(e.inputTokens),
      outputTokens: num(e.outputTokens),
      thinkingTokens: num(e.thinkingTokens),
      cacheReadInputTokens: num(e.cacheReadInputTokens),
      cacheCreationInputTokens: num(e.cacheCreationInputTokens),
      webSearchRequests: num(e.webSearchRequests),
      costUSD: typeof e.costUSD === "number" && e.costUSD >= 0 ? e.costUSD : 0,
    };
  }
  const start = typeof d.startTime === "number" ? new Date(d.startTime).toISOString() : null;
  acc.snapshots.set(sessionId, {
    kind: "session_snapshot",
    sessionId,
    ts: start,
    totalCostUSD: typeof d.totalCostUSD === "number" && d.totalCostUSD >= 0 ? d.totalCostUSD : 0,
    apiMs: num(d.totalAPIDuration),
    toolMs: num(d.totalToolDuration),
    linesAdded: num(d.totalLinesAdded),
    linesRemoved: num(d.totalLinesRemoved),
    modelUsage,
  });
}

function metaFor(acc: Accumulator, sessionId: string): SessionMetaRecord {
  let r = acc.meta.get(sessionId);
  if (!r) {
    r = { kind: "session_meta", sessionId, title: null, titleSource: null, agentName: null };
    acc.meta.set(sessionId, r);
  }
  return r;
}

function parseTitle(d: Json, type: "ai-title" | "custom-title", ctx: FileContext, acc: Accumulator): void {
  const sessionId = str(d.sessionId);
  if (!sessionId || !ctx.titles || ctx.isSubagent) return;
  const title = type === "custom-title" ? str(d.customTitle, 300) : str(d.aiTitle, 300);
  if (!title) return;
  const r = metaFor(acc, sessionId);
  if (type === "ai-title" && r.titleSource === "custom") return; // a user-set title beats the generated one
  r.title = title;
  r.titleSource = type === "custom-title" ? "custom" : "ai";
}

function parseAgentName(d: Json, ctx: FileContext, acc: Accumulator): void {
  const sessionId = str(d.sessionId);
  if (!sessionId || !ctx.titles || ctx.isSubagent) return;
  const name = str(d.agentName, 200);
  if (name) metaFor(acc, sessionId).agentName = name;
}

function parseSystem(d: Json, acc: Accumulator): void {
  const sessionId = str(d.sessionId);
  const ts = isoOrNull(d.timestamp);
  const subtype = typeof d.subtype === "string" ? d.subtype : "(none)";
  if (!sessionId || !ts) return;
  if (subtype === "compact_boundary") {
    const cm = obj(d.compactMetadata) ?? {};
    const id = lineId(sessionId, d.uuid, `${ts}:compact`);
    acc.events.set(id, {
      kind: "session_event",
      id,
      sessionId,
      ts,
      event: "compaction",
      durationMs: numOrNull(cm.durationMs),
      preTokens: numOrNull(cm.preTokens),
      trigger: str(cm.trigger, 50),
    });
  } else if (subtype === "turn_duration") {
    const id = lineId(sessionId, d.uuid, `${ts}:turn`);
    acc.events.set(id, {
      kind: "session_event",
      id,
      sessionId,
      ts,
      event: "turn",
      durationMs: numOrNull(d.durationMs),
      preTokens: null,
      trigger: null,
    });
  } else if (!IGNORED_SYSTEM_SUBTYPES.has(subtype)) {
    const key = `system/${subtype}`;
    acc.unknownTypes[key] = (acc.unknownTypes[key] ?? 0) + 1;
  }
}
