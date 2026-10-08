import { z } from "zod";

/** Wire format between the claude-obs collector and the ingest endpoint. See docs/claude-obs.md §6. */
export const SCHEMA_VERSION = 1;

const count = z.number().int().nonnegative();
const isoTs = z.iso.datetime({ offset: true });
const id = z.string().min(1).max(200);
const shortText = z.string().max(200);

export const usageRecord = z.object({
  kind: z.literal("usage"),
  requestId: id,
  messageId: id.nullable(),
  sessionId: id,
  ts: isoTs,
  model: z.string().min(1).max(100),
  isSubagent: z.boolean(),
  agentId: id.nullable(),
  input: count,
  output: count,
  cacheRead: count,
  cacheWrite5m: count,
  cacheWrite1h: count,
  /** Subset of `output` spent on thinking, when Claude Code reports it. */
  thinking: count.nullable(),
  webSearch: count,
  webFetch: count,
  serviceTier: shortText.nullable(),
  speed: shortText.nullable(),
  inferenceGeo: shortText.nullable(),
  effort: shortText.nullable(),
  /** Subagent type (e.g. "general-purpose", "Plan") that issued the request, if any. */
  agentType: shortText.nullable(),
  skill: shortText.nullable(),
  plugin: shortText.nullable(),
  entrypoint: shortText.nullable(),
  ccVersion: shortText.nullable(),
  project: shortText.nullable(),
  gitBranch: shortText.nullable(),
});
export type UsageRecord = z.infer<typeof usageRecord>;

export const reasonClass = z.enum([
  "prompt_too_long",
  "auth",
  "network",
  "rate_limit",
  "overloaded",
  "other",
]);
export type ReasonClass = z.infer<typeof reasonClass>;

export const errorRecord = z.object({
  kind: z.literal("error"),
  /** Stable opaque id derived from the transcript line, for idempotent upserts. */
  id,
  sessionId: id,
  ts: isoTs,
  code: shortText.nullable(),
  reasonClass,
});
export type ErrorRecord = z.infer<typeof errorRecord>;

export const limitRecord = z.object({
  kind: z.literal("limit"),
  id,
  sessionId: id,
  ts: isoTs,
  limitKind: z.enum(["five_hour", "weekly", "unknown"]),
  resetsAt: isoTs.nullable(),
});
export type LimitRecord = z.infer<typeof limitRecord>;

export const sessionMetaRecord = z.object({
  kind: z.literal("session_meta"),
  sessionId: id,
  title: z.string().max(300).nullable(),
  titleSource: z.enum(["ai", "custom"]).nullable(),
  agentName: shortText.nullable(),
});
export type SessionMetaRecord = z.infer<typeof sessionMetaRecord>;

const modelUsageEntry = z.object({
  inputTokens: count,
  outputTokens: count,
  thinkingTokens: count,
  cacheReadInputTokens: count,
  cacheCreationInputTokens: count,
  webSearchRequests: count,
  costUSD: z.number().nonnegative(),
});

export const sessionSnapshotRecord = z.object({
  kind: z.literal("session_snapshot"),
  sessionId: id,
  ts: isoTs.nullable(),
  totalCostUSD: z.number().nonnegative(),
  apiMs: count,
  toolMs: count,
  linesAdded: count,
  linesRemoved: count,
  modelUsage: z.record(z.string().max(100), modelUsageEntry),
});
export type SessionSnapshotRecord = z.infer<typeof sessionSnapshotRecord>;

export const sessionEventRecord = z.object({
  kind: z.literal("session_event"),
  id,
  sessionId: id,
  ts: isoTs,
  event: z.enum(["compaction", "turn"]),
  durationMs: count.nullable(),
  /** compaction only: context size before compacting, and manual/auto trigger */
  preTokens: count.nullable(),
  trigger: shortText.nullable(),
});
export type SessionEventRecord = z.infer<typeof sessionEventRecord>;

export const ingestRecord = z.discriminatedUnion("kind", [
  usageRecord,
  errorRecord,
  limitRecord,
  sessionMetaRecord,
  sessionSnapshotRecord,
  sessionEventRecord,
]);
export type IngestRecord = z.infer<typeof ingestRecord>;

export const MAX_RECORDS_PER_BATCH = 500;

export const ingestBatch = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  accountHash: z.string().regex(/^[a-f0-9]{64}$/),
  plan: z
    .object({
      rateLimitTier: shortText.nullable(),
      seatTier: shortText.nullable(),
      billingType: shortText.nullable(),
    })
    .nullable(),
  device: z.object({ os: shortText, ccVersions: z.array(shortText).max(50) }),
  parser: z.object({
    version: shortText,
    unknownTypes: z.record(shortText, count),
    malformedLines: count,
  }),
  records: z.array(ingestRecord).max(MAX_RECORDS_PER_BATCH),
});
export type IngestBatch = z.infer<typeof ingestBatch>;

export const ingestResponse = z.object({
  accepted: count,
  deduplicated: count,
  rejected: count,
  minCliVersion: z.string(),
  serverTime: z.string(),
});
export type IngestResponse = z.infer<typeof ingestResponse>;

export const apiError = z.object({
  error: z.enum([
    "unauthorized",
    "account_mismatch",
    "schema",
    "upgrade_required",
    "rate_limited",
    "payload_too_large",
    "invalid_code",
    "expired",
    "internal",
  ]),
  message: z.string(),
});
export type ApiError = z.infer<typeof apiError>;

// ---- enrollment ----
export const enrollRequest = z.object({
  code: z.string().min(4).max(64),
  name: z.string().min(1).max(100),
  os: shortText,
  configDir: z.string().max(300).nullable(),
});
export const enrollResponse = z.object({
  deviceId: z.string(),
  token: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  /** Per-workspace salt, so every machine on the same Claude account produces the same account/project hashes. */
  hashSalt: z.string(),
});
export type EnrollResponse = z.infer<typeof enrollResponse>;

export const whoamiResponse = z.object({
  deviceId: z.string(),
  deviceName: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  hashSalt: z.string(),
  minCliVersion: z.string(),
});
export type WhoamiResponse = z.infer<typeof whoamiResponse>;

export const deviceStartRequest = z.object({ name: z.string().min(1).max(100), os: shortText });
export const deviceStartResponse = z.object({
  userCode: z.string(),
  deviceCode: z.string(),
  verificationUrl: z.string(),
  interval: z.number().int().positive(),
  expiresIn: z.number().int().positive(),
});
export const devicePollRequest = z.object({ deviceCode: z.string() });
export const devicePollResponse = z.union([
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("denied") }),
  z.object({ status: z.literal("expired") }),
  z.object({ status: z.literal("approved") }).extend(enrollResponse.shape),
]);
