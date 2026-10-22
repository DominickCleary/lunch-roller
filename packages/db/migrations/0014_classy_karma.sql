CREATE TABLE "suggestion_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suggestion_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"value" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suggestion_vote_value" CHECK ("suggestion_votes"."value" in (-1,1))
);
--> statement-breakpoint
CREATE TABLE "suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suggestion_title_length" CHECK (length(btrim("suggestions"."title")) between 1 and 120),
	CONSTRAINT "suggestion_description_length" CHECK (length(btrim("suggestions"."description")) between 1 and 2000),
	CONSTRAINT "suggestion_status" CHECK ("suggestions"."status" in ('open','approved','denied'))
);
--> statement-breakpoint
ALTER TABLE "suggestion_votes" ADD CONSTRAINT "suggestion_votes_suggestion_id_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."suggestions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_votes" ADD CONSTRAINT "suggestion_votes_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "suggestion_vote_once" ON "suggestion_votes" USING btree ("suggestion_id","participant_id");--> statement-breakpoint
CREATE INDEX "suggestions_created" ON "suggestions" USING btree ("created_at");