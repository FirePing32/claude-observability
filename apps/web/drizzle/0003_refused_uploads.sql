ALTER TABLE "devices" ADD COLUMN "refused_uploads" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "last_refused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "last_refused_reason" text;