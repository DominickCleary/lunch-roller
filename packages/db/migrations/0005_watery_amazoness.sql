ALTER TABLE "settings" DROP CONSTRAINT "settings_token_amounts";--> statement-breakpoint
ALTER TABLE "token_ledger" DROP CONSTRAINT "ledger_kind";--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "remove_place_cost" integer DEFAULT 40 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "new_place_multiplier" double precision DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_new_place_multiplier" CHECK ("settings"."new_place_multiplier" >= 0.01 and "settings"."new_place_multiplier" <= 100);--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_token_amounts" CHECK ("settings"."attendance_reward" > 0 and "settings"."add_place_cost" > 0 and "settings"."remove_place_cost" > 0 and "settings"."boost_cost" > 0 and "settings"."reduce_cost" > 0);--> statement-breakpoint
ALTER TABLE "token_ledger" ADD CONSTRAINT "ledger_kind" CHECK ("token_ledger"."kind" in ('attendance','boost','reduce','add-place','remove-place','correction'));