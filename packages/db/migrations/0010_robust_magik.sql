DROP INDEX "notification_once";--> statement-breakpoint
ALTER TABLE "notification_outbox" ALTER COLUMN "draw_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "event_key" text;--> statement-breakpoint
UPDATE "notification_outbox" SET "event_key" = 'draw:' || "draw_id"::text;--> statement-breakpoint
ALTER TABLE "notification_outbox" ALTER COLUMN "event_key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_once" ON "notification_outbox" USING btree ("event_key","subscription_id");
