CREATE TABLE "bet_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"participant_id" uuid NOT NULL,
	"place_id" uuid NOT NULL,
	"place_name" text NOT NULL,
	"stake" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"payout" integer,
	"probability" double precision,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "bet_status" CHECK ("bets"."status" in ('open','won','lost','cancelled','refunded')),
	CONSTRAINT "bet_stake_positive" CHECK ("bets"."stake" between 1 and 2147483647),
	CONSTRAINT "bet_payout_valid" CHECK ("bets"."payout" is null or "bets"."payout" between 0 and 2147483647),
	CONSTRAINT "bet_probability_valid" CHECK ("bets"."probability" is null or "bets"."probability" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "betting_markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"local_date" date NOT NULL,
	"timezone" text NOT NULL,
	"scheduled_time" text NOT NULL,
	"cutoff_minutes" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"draw_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "betting_market_status" CHECK ("betting_markets"."status" in ('open','settled','void')),
	CONSTRAINT "betting_market_cutoff" CHECK ("betting_markets"."cutoff_minutes" between 0 and 1440),
	CONSTRAINT "betting_market_time" CHECK ("betting_markets"."scheduled_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
ALTER TABLE "token_ledger" DROP CONSTRAINT "ledger_kind";--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "betting_close_minutes" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "token_ledger" ADD COLUMN "bet_id" uuid;--> statement-breakpoint
ALTER TABLE "bet_requests" ADD CONSTRAINT "bet_requests_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_market_id_betting_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."betting_markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "betting_markets" ADD CONSTRAINT "betting_markets_draw_id_draws_id_fk" FOREIGN KEY ("draw_id") REFERENCES "public"."draws"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bet_request_once" ON "bet_requests" USING btree ("participant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "bet_once_per_market" ON "bets" USING btree ("market_id","participant_id");--> statement-breakpoint
CREATE INDEX "bet_participant_recent" ON "bets" USING btree ("participant_id","updated_at");--> statement-breakpoint
CREATE INDEX "bet_place_open" ON "bets" USING btree ("place_id") WHERE "bets"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "betting_market_open_date" ON "betting_markets" USING btree ("local_date") WHERE "betting_markets"."status" = 'open';--> statement-breakpoint
ALTER TABLE "token_ledger" ADD CONSTRAINT "token_ledger_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_betting_close_minutes" CHECK ("settings"."betting_close_minutes" between 0 and 1440);--> statement-breakpoint
ALTER TABLE "token_ledger" ADD CONSTRAINT "ledger_kind" CHECK ("token_ledger"."kind" in ('attendance','boost','reduce','add-place','remove-place','correction','bet-stake','bet-release','bet-payout'));