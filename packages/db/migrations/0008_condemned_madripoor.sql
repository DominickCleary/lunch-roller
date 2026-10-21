ALTER TABLE "token_ledger" DROP CONSTRAINT "ledger_kind";--> statement-breakpoint
ALTER TABLE "draws" ADD COLUMN "health_bonus" jsonb;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "health_level" text DEFAULT 'balanced' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "health_bonus_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "health_bonus_multiplier" double precision DEFAULT 1.25 NOT NULL;--> statement-breakpoint
ALTER TABLE "token_ledger" ADD COLUMN "transfer_id" uuid;--> statement-breakpoint
ALTER TABLE "token_ledger" ADD COLUMN "counterparty_id" uuid;--> statement-breakpoint
ALTER TABLE "token_ledger" ADD CONSTRAINT "token_ledger_counterparty_id_participants_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_transfer_direction" ON "token_ledger" USING btree ("transfer_id","kind");--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "place_health_level" CHECK ("places"."health_level" in ('treat','balanced','healthy'));--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_health_bonus_multiplier" CHECK ("settings"."health_bonus_multiplier" > 1 and "settings"."health_bonus_multiplier" <= 100);--> statement-breakpoint
ALTER TABLE "token_ledger" ADD CONSTRAINT "ledger_transfer_valid" CHECK (("token_ledger"."kind" in ('transfer-sent','transfer-received') and "token_ledger"."transfer_id" is not null and "token_ledger"."counterparty_id" is not null and "token_ledger"."counterparty_id" <> "token_ledger"."participant_id" and (("token_ledger"."kind" = 'transfer-sent' and "token_ledger"."delta" < 0) or ("token_ledger"."kind" = 'transfer-received' and "token_ledger"."delta" > 0))) or ("token_ledger"."kind" not in ('transfer-sent','transfer-received') and "token_ledger"."transfer_id" is null and "token_ledger"."counterparty_id" is null));--> statement-breakpoint
ALTER TABLE "token_ledger" ADD CONSTRAINT "ledger_kind" CHECK ("token_ledger"."kind" in ('attendance','boost','reduce','boost-refund','reduce-refund','add-place','remove-place','correction','bet-stake','bet-release','bet-payout','transfer-sent','transfer-received'));