CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"message" text NOT NULL,
	"delivered" boolean NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"type" text NOT NULL,
	"threshold" double precision NOT NULL,
	"channel" text NOT NULL,
	"target" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_requests" (
	"workspace_id" text NOT NULL,
	"request_id" text NOT NULL,
	"message_id" text,
	"session_id" text NOT NULL,
	"device_id" text,
	"ts" timestamp with time zone NOT NULL,
	"model" text NOT NULL,
	"is_subagent" boolean DEFAULT false NOT NULL,
	"agent_id" text,
	"agent_type" text,
	"skill" text,
	"plugin" text,
	"input" bigint DEFAULT 0 NOT NULL,
	"output" bigint DEFAULT 0 NOT NULL,
	"cache_read" bigint DEFAULT 0 NOT NULL,
	"cache_write_5m" bigint DEFAULT 0 NOT NULL,
	"cache_write_1h" bigint DEFAULT 0 NOT NULL,
	"thinking" bigint,
	"web_search" integer DEFAULT 0 NOT NULL,
	"web_fetch" integer DEFAULT 0 NOT NULL,
	"service_tier" text,
	"speed" text,
	"inference_geo" text,
	"effort" text,
	"entrypoint" text,
	"cc_version" text,
	"project" text,
	"git_branch" text,
	"value_usd" double precision DEFAULT 0 NOT NULL,
	"priced" boolean DEFAULT true NOT NULL,
	"duration_ms" integer,
	"query_source" text,
	"otel_cost_usd" double precision,
	"sources" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_requests_workspace_id_request_id_pk" PRIMARY KEY("workspace_id","request_id")
);
--> statement-breakpoint
CREATE TABLE "device_auth_requests" (
	"device_code_hash" text PRIMARY KEY NOT NULL,
	"user_code" text NOT NULL,
	"name" text NOT NULL,
	"os" text,
	"ip" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"workspace_id" text,
	"approved_by" text,
	"device_id" text,
	"pending_token" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_auth_requests_user_code_unique" UNIQUE("user_code")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"os" text,
	"token_hash" text NOT NULL,
	"enrolled_via" text NOT NULL,
	"cc_versions" text[] DEFAULT '{}'::text[] NOT NULL,
	"parser_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "devices_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "digests" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"body" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrollment_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"label" text,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "enrollment_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "error_events" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"session_id" text NOT NULL,
	"device_id" text,
	"ts" timestamp with time zone NOT NULL,
	"code" text,
	"reason_class" text NOT NULL,
	"source" text DEFAULT 'transcript' NOT NULL,
	CONSTRAINT "error_events_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "ingest_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"device_id" text,
	"source" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"records" integer NOT NULL,
	"accepted" integer NOT NULL,
	"deduplicated" integer NOT NULL,
	"parser_version" text,
	"unknown_types" jsonb,
	"malformed_lines" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "limit_events" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"session_id" text,
	"device_id" text,
	"ts" timestamp with time zone NOT NULL,
	"limit_kind" text NOT NULL,
	"resets_at" timestamp with time zone,
	"source" text DEFAULT 'transcript' NOT NULL,
	CONSTRAINT "limit_events_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "otel_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"device_id" text,
	"ts" timestamp with time zone NOT NULL,
	"metric" text NOT NULL,
	"kind" text,
	"session_id" text,
	"value" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"plan" text NOT NULL,
	"monthly_price_usd" double precision NOT NULL,
	"effective_from" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "session_events" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"session_id" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"event" text NOT NULL,
	"duration_ms" bigint,
	"pre_tokens" bigint,
	"trigger" text,
	CONSTRAINT "session_events_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "session_meta" (
	"workspace_id" text NOT NULL,
	"session_id" text NOT NULL,
	"title" text,
	"title_source" text,
	"agent_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_meta_workspace_id_session_id_pk" PRIMARY KEY("workspace_id","session_id")
);
--> statement-breakpoint
CREATE TABLE "session_snapshots" (
	"workspace_id" text NOT NULL,
	"session_id" text NOT NULL,
	"started_at" timestamp with time zone,
	"total_cost_usd" double precision NOT NULL,
	"api_ms" bigint NOT NULL,
	"tool_ms" bigint NOT NULL,
	"lines_added" integer NOT NULL,
	"lines_removed" integer NOT NULL,
	"model_usage" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_snapshots_workspace_id_session_id_pk" PRIMARY KEY("workspace_id","session_id")
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"label" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "share_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_id" text NOT NULL,
	"account_hash" text,
	"hash_salt" text NOT NULL,
	"plan" text DEFAULT 'max5x' NOT NULL,
	"plan_price_usd" double precision DEFAULT 100 NOT NULL,
	"detected_tier" text,
	"billing_day" integer DEFAULT 1 NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_requests" ADD CONSTRAINT "api_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digests" ADD CONSTRAINT "digests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_codes" ADD CONSTRAINT "enrollment_codes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_log" ADD CONSTRAINT "ingest_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "limit_events" ADD CONSTRAINT "limit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otel_metrics" ADD CONSTRAINT "otel_metrics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_periods" ADD CONSTRAINT "plan_periods_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_meta" ADD CONSTRAINT "session_meta_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_snapshots" ADD CONSTRAINT "session_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_events_rule_key" ON "alert_events" USING btree ("rule_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "api_requests_ws_ts" ON "api_requests" USING btree ("workspace_id","ts");--> statement-breakpoint
CREATE INDEX "api_requests_ws_session" ON "api_requests" USING btree ("workspace_id","session_id");--> statement-breakpoint
CREATE INDEX "devices_ws" ON "devices" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "error_events_ws_ts" ON "error_events" USING btree ("workspace_id","ts");--> statement-breakpoint
CREATE INDEX "ingest_log_ws_time" ON "ingest_log" USING btree ("workspace_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invites_ws_email" ON "invites" USING btree ("workspace_id","email");--> statement-breakpoint
CREATE INDEX "limit_events_ws_ts" ON "limit_events" USING btree ("workspace_id","ts");--> statement-breakpoint
CREATE INDEX "otel_metrics_ws_ts" ON "otel_metrics" USING btree ("workspace_id","ts");--> statement-breakpoint
CREATE INDEX "session_events_ws_session" ON "session_events" USING btree ("workspace_id","session_id");