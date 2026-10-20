CREATE TABLE "attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"draw_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draws" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"local_date" date NOT NULL,
	"timezone" text NOT NULL,
	"place_id" uuid NOT NULL,
	"place_name" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"sample" double precision NOT NULL,
	"drawn_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draws_local_date_unique" UNIQUE("local_date"),
	CONSTRAINT "draw_sample_range" CHECK ("draws"."sample" >= 0 and "draws"."sample" < 1)
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draw_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participant_name_nonempty" CHECK (length(btrim("participants"."name")) between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"log_weight" double precision DEFAULT 0 NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "place_name_nonempty" CHECK (length(btrim("places"."name")) between 1 and 100),
	CONSTRAINT "place_weight_finite" CHECK ("places"."log_weight" > '-Infinity'::float8 and "places"."log_weight" < 'Infinity'::float8)
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"timezone" text DEFAULT 'Europe/Dublin' NOT NULL,
	"spin_time" text DEFAULT '11:30' NOT NULL,
	"weekdays" integer[] DEFAULT ARRAY[1,2,3,4,5] NOT NULL,
	CONSTRAINT "settings_singleton" CHECK ("settings"."id" = 1),
	CONSTRAINT "settings_time" CHECK ("settings"."spin_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "settings_weekdays" CHECK (cardinality("settings"."weekdays") between 1 and 7 and "settings"."weekdays" <@ ARRAY[1,2,3,4,5,6,7])
);
--> statement-breakpoint
CREATE TABLE "token_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"attendance_id" uuid,
	"place_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_nonzero" CHECK ("token_ledger"."delta" <> 0),
	CONSTRAINT "ledger_kind" CHECK ("token_ledger"."kind" in ('attendance','boost','reduce','add-place','correction')),
	CONSTRAINT "correction_reason" CHECK ("token_ledger"."kind" <> 'correction' or length(btrim("token_ledger"."reason")) > 0 and "token_ledger"."reason" is not null)
);
--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_draw_id_draws_id_fk" FOREIGN KEY ("draw_id") REFERENCES "public"."draws"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draws" ADD CONSTRAINT "draws_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_draw_id_draws_id_fk" FOREIGN KEY ("draw_id") REFERENCES "public"."draws"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_subscription_id_push_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."push_subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_added_by_participants_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_ledger" ADD CONSTRAINT "token_ledger_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_ledger" ADD CONSTRAINT "token_ledger_attendance_id_attendance_id_fk" FOREIGN KEY ("attendance_id") REFERENCES "public"."attendance"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_ledger" ADD CONSTRAINT "token_ledger_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_once" ON "attendance" USING btree ("participant_id","draw_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_once" ON "notification_outbox" USING btree ("draw_id","subscription_id");--> statement-breakpoint
CREATE INDEX "notification_due" ON "notification_outbox" USING btree ("available_at") WHERE "notification_outbox"."sent_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "participant_active_name" ON "participants" USING btree (lower(btrim("name"))) WHERE "participants"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "place_active_name" ON "places" USING btree (lower(btrim("name"))) WHERE "places"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_request_once" ON "token_ledger" USING btree ("participant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_attendance_once" ON "token_ledger" USING btree ("attendance_id");--> statement-breakpoint
CREATE INDEX "ledger_balance" ON "token_ledger" USING btree ("participant_id");