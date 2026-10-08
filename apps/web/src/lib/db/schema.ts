import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const tokens = (name: string) => bigint(name, { mode: "number" }).notNull().default(0);

// ---------------------------------------------------------------- Better Auth
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: ts("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: ts("access_token_expires_at"),
  refreshTokenExpiresAt: ts("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------- tenancy
/** One workspace = one Claude account (the subscription whose limits are shared). */
export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id),
  /** HMAC of the Claude accountUuid; pinned by the first upload, then enforced. */
  accountHash: text("account_hash"),
  /** Per-workspace salt handed to collectors so every machine hashes identically. */
  hashSalt: text("hash_salt").notNull(),
  plan: text("plan").notNull().default("max5x"),
  planPriceUsd: doublePrecision("plan_price_usd").notNull().default(100),
  detectedTier: text("detected_tier"),
  billingDay: integer("billing_day").notNull().default(1),
  timezone: text("timezone").notNull().default("UTC"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "viewer"] }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

export const invites = pgTable(
  "invites",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: ["owner", "viewer"] }).notNull().default("viewer"),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    acceptedAt: ts("accepted_at"),
  },
  (t) => [uniqueIndex("invites_ws_email").on(t.workspaceId, t.email)],
);

export const planPeriods = pgTable("plan_periods", {
  id: serial("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  plan: text("plan").notNull(),
  monthlyPriceUsd: doublePrecision("monthly_price_usd").notNull(),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
});

// ---------------------------------------------------------------- machines
export const devices = pgTable(
  "devices",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    os: text("os"),
    tokenHash: text("token_hash").notNull().unique(),
    enrolledVia: text("enrolled_via", { enum: ["code", "browser"] }).notNull(),
    ccVersions: text("cc_versions").array().notNull().default(sql`'{}'::text[]`),
    parserVersion: text("parser_version"),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("devices_ws").on(t.workspaceId)],
);

export const enrollmentCodes = pgTable("enrollment_codes", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull().unique(),
  label: text("label"),
  maxUses: integer("max_uses").notNull().default(1),
  uses: integer("uses").notNull().default(0),
  expiresAt: ts("expires_at").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  revokedAt: ts("revoked_at"),
});

export const deviceAuthRequests = pgTable("device_auth_requests", {
  deviceCodeHash: text("device_code_hash").primaryKey(),
  userCode: text("user_code").notNull().unique(),
  name: text("name").notNull(),
  os: text("os"),
  ip: text("ip"),
  status: text("status", { enum: ["pending", "approved", "denied", "delivered"] }).notNull().default("pending"),
  workspaceId: text("workspace_id"),
  approvedBy: text("approved_by"),
  deviceId: text("device_id"),
  /** Plain device token held only between approval and the CLI's next poll. */
  pendingToken: text("pending_token"),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------- facts
export const apiRequests = pgTable(
  "api_requests",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull(),
    messageId: text("message_id"),
    sessionId: text("session_id").notNull(),
    deviceId: text("device_id"),
    ts: ts("ts").notNull(),
    model: text("model").notNull(),
    isSubagent: boolean("is_subagent").notNull().default(false),
    agentId: text("agent_id"),
    agentType: text("agent_type"),
    skill: text("skill"),
    plugin: text("plugin"),
    input: tokens("input"),
    output: tokens("output"),
    cacheRead: tokens("cache_read"),
    cacheWrite5m: tokens("cache_write_5m"),
    cacheWrite1h: tokens("cache_write_1h"),
    thinking: bigint("thinking", { mode: "number" }),
    webSearch: integer("web_search").notNull().default(0),
    webFetch: integer("web_fetch").notNull().default(0),
    serviceTier: text("service_tier"),
    speed: text("speed"),
    inferenceGeo: text("inference_geo"),
    effort: text("effort"),
    entrypoint: text("entrypoint"),
    ccVersion: text("cc_version"),
    project: text("project"),
    gitBranch: text("git_branch"),
    /** API-equivalent value computed from the price book (canonical). */
    valueUsd: doublePrecision("value_usd").notNull().default(0),
    priced: boolean("priced").notNull().default(true),
    /** From OpenTelemetry only. */
    durationMs: integer("duration_ms"),
    querySource: text("query_source"),
    otelCostUsd: doublePrecision("otel_cost_usd"),
    sources: text("sources").array().notNull().default(sql`'{}'::text[]`),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.requestId] }),
    index("api_requests_ws_ts").on(t.workspaceId, t.ts),
    index("api_requests_ws_session").on(t.workspaceId, t.sessionId),
  ],
);

export const sessionMeta = pgTable(
  "session_meta",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    title: text("title"),
    titleSource: text("title_source"),
    agentName: text("agent_name"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.sessionId] })],
);

export const sessionSnapshots = pgTable(
  "session_snapshots",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    startedAt: ts("started_at"),
    totalCostUsd: doublePrecision("total_cost_usd").notNull(),
    apiMs: bigint("api_ms", { mode: "number" }).notNull(),
    toolMs: bigint("tool_ms", { mode: "number" }).notNull(),
    linesAdded: integer("lines_added").notNull(),
    linesRemoved: integer("lines_removed").notNull(),
    modelUsage: jsonb("model_usage").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.sessionId] })],
);

export const sessionEvents = pgTable(
  "session_events",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    sessionId: text("session_id").notNull(),
    ts: ts("ts").notNull(),
    event: text("event").notNull(),
    durationMs: bigint("duration_ms", { mode: "number" }),
    preTokens: bigint("pre_tokens", { mode: "number" }),
    trigger: text("trigger"),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.id] }), index("session_events_ws_session").on(t.workspaceId, t.sessionId)],
);

export const errorEvents = pgTable(
  "error_events",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    sessionId: text("session_id").notNull(),
    deviceId: text("device_id"),
    ts: ts("ts").notNull(),
    code: text("code"),
    reasonClass: text("reason_class").notNull(),
    source: text("source").notNull().default("transcript"),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.id] }), index("error_events_ws_ts").on(t.workspaceId, t.ts)],
);

export const limitEvents = pgTable(
  "limit_events",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    sessionId: text("session_id"),
    deviceId: text("device_id"),
    ts: ts("ts").notNull(),
    limitKind: text("limit_kind").notNull(),
    resetsAt: ts("resets_at"),
    source: text("source", { enum: ["transcript", "manual"] }).notNull().default("transcript"),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.id] }), index("limit_events_ws_ts").on(t.workspaceId, t.ts)],
);

export const otelMetrics = pgTable(
  "otel_metrics",
  {
    id: serial("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    deviceId: text("device_id"),
    ts: ts("ts").notNull(),
    metric: text("metric").notNull(),
    kind: text("kind"),
    sessionId: text("session_id"),
    value: doublePrecision("value").notNull(),
  },
  (t) => [index("otel_metrics_ws_ts").on(t.workspaceId, t.ts)],
);

export const ingestLog = pgTable(
  "ingest_log",
  {
    id: serial("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    deviceId: text("device_id"),
    source: text("source").notNull(),
    receivedAt: ts("received_at").notNull().defaultNow(),
    records: integer("records").notNull(),
    accepted: integer("accepted").notNull(),
    deduplicated: integer("deduplicated").notNull(),
    parserVersion: text("parser_version"),
    unknownTypes: jsonb("unknown_types"),
    malformedLines: integer("malformed_lines").notNull().default(0),
  },
  (t) => [index("ingest_log_ws_time").on(t.workspaceId, t.receivedAt)],
);

// ---------------------------------------------------------------- product
export const alertRules = pgTable("alert_rules", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["block_pct", "limit_hit", "daily_value", "weekly_value", "device_silent"] }).notNull(),
  threshold: doublePrecision("threshold").notNull(),
  channel: text("channel", { enum: ["email", "slack", "webhook"] }).notNull(),
  target: text("target").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const alertEvents = pgTable(
  "alert_events",
  {
    id: serial("id").primaryKey(),
    ruleId: text("rule_id")
      .notNull()
      .references(() => alertRules.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    firedAt: ts("fired_at").notNull().defaultNow(),
    message: text("message").notNull(),
    delivered: boolean("delivered").notNull(),
    error: text("error"),
  },
  (t) => [uniqueIndex("alert_events_rule_key").on(t.ruleId, t.dedupeKey)],
);

export const digests = pgTable("digests", {
  id: serial("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  periodStart: ts("period_start").notNull(),
  periodEnd: ts("period_end").notNull(),
  body: text("body").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const shareLinks = pgTable("share_links", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  label: text("label"),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at"),
  revokedAt: ts("revoked_at"),
});
