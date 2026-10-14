ALTER TABLE "workspaces" ADD COLUMN "ceiling_cache" jsonb;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "alerts_checked_at" timestamp with time zone;