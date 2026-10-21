CREATE TABLE "influence_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"place_id" uuid NOT NULL,
	"action" text NOT NULL,
	"token_cost" integer NOT NULL,
	"log_multiplier" double precision NOT NULL,
	"purchase_ledger_id" uuid NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "influence_action" CHECK ("influence_lots"."action" in ('boost','reduce')),
	CONSTRAINT "influence_cost" CHECK ("influence_lots"."token_cost" between 1 and 2147483647),
	CONSTRAINT "influence_multiplier" CHECK (("influence_lots"."action" = 'boost' and "influence_lots"."log_multiplier" > 0 and "influence_lots"."log_multiplier" <= ln(100.0)) or ("influence_lots"."action" = 'reduce' and "influence_lots"."log_multiplier" < 0 and "influence_lots"."log_multiplier" >= ln(0.01)))
);
--> statement-breakpoint
ALTER TABLE "token_ledger" DROP CONSTRAINT "ledger_kind";--> statement-breakpoint
ALTER TABLE "token_ledger" ADD COLUMN "influence_market_id" uuid;--> statement-breakpoint
ALTER TABLE "influence_lots" ADD CONSTRAINT "influence_lots_market_id_betting_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."betting_markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "influence_lots" ADD CONSTRAINT "influence_lots_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "influence_lots" ADD CONSTRAINT "influence_lots_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "influence_lots" ADD CONSTRAINT "influence_lots_purchase_ledger_id_token_ledger_id_fk" FOREIGN KEY ("purchase_ledger_id") REFERENCES "public"."token_ledger"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "influence_purchase_once" ON "influence_lots" USING btree ("purchase_ledger_id");--> statement-breakpoint
CREATE INDEX "influence_market_positions" ON "influence_lots" USING btree ("market_id","place_id","participant_id") WHERE "influence_lots"."withdrawn_at" is null;--> statement-breakpoint
ALTER TABLE "token_ledger" ADD CONSTRAINT "token_ledger_influence_market_id_betting_markets_id_fk" FOREIGN KEY ("influence_market_id") REFERENCES "public"."betting_markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_ledger" ADD CONSTRAINT "ledger_kind" CHECK ("token_ledger"."kind" in ('attendance','boost','reduce','boost-refund','reduce-refund','add-place','remove-place','correction','bet-stake','bet-release','bet-payout'));