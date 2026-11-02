DROP INDEX "bet_once_per_market";--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "max_bets_per_player" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "bet_participant_market" ON "bets" USING btree ("market_id","participant_id");--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_max_bets_per_player" CHECK ("settings"."max_bets_per_player" between 1 and 100);