ALTER TABLE "settings" ADD COLUMN "attendance_reward" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "add_place_cost" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "boost_cost" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "reduce_cost" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "boost_multiplier" double precision DEFAULT 1.25 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "reduce_multiplier" double precision DEFAULT 0.8 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_token_amounts" CHECK ("settings"."attendance_reward" > 0 and "settings"."add_place_cost" > 0 and "settings"."boost_cost" > 0 and "settings"."reduce_cost" > 0);--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_boost_multiplier" CHECK ("settings"."boost_multiplier" > 1 and "settings"."boost_multiplier" <= 100);--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_reduce_multiplier" CHECK ("settings"."reduce_multiplier" >= 0.01 and "settings"."reduce_multiplier" < 1);