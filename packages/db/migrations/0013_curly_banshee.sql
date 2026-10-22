ALTER TABLE "settings" ALTER COLUMN "betting_close_minutes" SET DEFAULT 10;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "max_walk_minutes" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_max_walk_minutes" CHECK ("settings"."max_walk_minutes" between 1 and 120);