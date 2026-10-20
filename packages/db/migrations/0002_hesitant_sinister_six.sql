ALTER TABLE "settings" ADD COLUMN "setup_completed" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "settings" SET "setup_completed" = true
WHERE EXISTS (SELECT 1 FROM "participants") OR EXISTS (SELECT 1 FROM "places");
