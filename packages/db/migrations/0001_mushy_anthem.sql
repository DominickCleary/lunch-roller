ALTER TABLE "notification_outbox" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "token_ledger" ADD COLUMN "response" jsonb;