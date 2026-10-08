ALTER TABLE "device_auth_requests" ADD COLUMN "account_email_proof" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "require_email_match" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "extra_claude_emails" text[] DEFAULT '{}'::text[] NOT NULL;