ALTER TABLE "draws" ADD COLUMN "spin_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "wheel_spin_seconds" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "draws" ADD CONSTRAINT "draw_spin_duration" CHECK ("draws"."spin_duration_ms" is null or "draws"."spin_duration_ms" between 5000 and 60000);--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_wheel_spin_seconds" CHECK ("settings"."wheel_spin_seconds" between 5 and 60);