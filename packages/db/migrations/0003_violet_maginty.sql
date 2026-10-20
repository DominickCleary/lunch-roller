ALTER TABLE "settings" ADD COLUMN "wheel_switch_time" text DEFAULT '15:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "check_in_pledge" text DEFAULT 'I pledge that I actually obeyed the wheel' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_wheel_switch_time" CHECK ("settings"."wheel_switch_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_check_in_pledge" CHECK (length(btrim("settings"."check_in_pledge")) between 1 and 500);