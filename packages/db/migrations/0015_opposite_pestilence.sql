ALTER TABLE "settings" ALTER COLUMN "max_walk_minutes" SET DEFAULT 10;--> statement-breakpoint
UPDATE "settings" SET "max_walk_minutes" = 10 WHERE "max_walk_minutes" = 15;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "venue_eligibility_criteria" text DEFAULT 'Must serve food
Must offer a takeaway option
Must be open during lunchtime' NOT NULL;
