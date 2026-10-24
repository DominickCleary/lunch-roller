CREATE OR REPLACE FUNCTION notify_game_state_changed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	PERFORM pg_notify('lunch_roller_game_state', 'changed');
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER participants_game_state_changed
AFTER INSERT OR UPDATE OR DELETE ON participants
FOR EACH STATEMENT EXECUTE FUNCTION notify_game_state_changed();
--> statement-breakpoint
CREATE TRIGGER suggestions_game_state_changed
AFTER INSERT OR UPDATE OR DELETE ON suggestions
FOR EACH STATEMENT EXECUTE FUNCTION notify_game_state_changed();
--> statement-breakpoint
CREATE TRIGGER suggestion_votes_game_state_changed
AFTER INSERT OR UPDATE OR DELETE ON suggestion_votes
FOR EACH STATEMENT EXECUTE FUNCTION notify_game_state_changed();
--> statement-breakpoint
CREATE TRIGGER places_game_state_changed
AFTER INSERT OR UPDATE OR DELETE ON places
FOR EACH STATEMENT EXECUTE FUNCTION notify_game_state_changed();
--> statement-breakpoint
CREATE TRIGGER settings_game_state_changed
AFTER INSERT OR UPDATE OR DELETE ON settings
FOR EACH STATEMENT EXECUTE FUNCTION notify_game_state_changed();
--> statement-breakpoint
CREATE TRIGGER draws_game_state_changed
AFTER INSERT OR UPDATE OR DELETE ON draws
FOR EACH STATEMENT EXECUTE FUNCTION notify_game_state_changed();
--> statement-breakpoint
CREATE TRIGGER attendance_game_state_changed
AFTER INSERT OR UPDATE OR DELETE ON attendance
FOR EACH STATEMENT EXECUTE FUNCTION notify_game_state_changed();
--> statement-breakpoint
CREATE TRIGGER betting_markets_game_state_changed
AFTER INSERT OR UPDATE OR DELETE ON betting_markets
FOR EACH STATEMENT EXECUTE FUNCTION notify_game_state_changed();
--> statement-breakpoint
CREATE TRIGGER bets_game_state_changed
AFTER INSERT OR UPDATE OR DELETE ON bets
FOR EACH STATEMENT EXECUTE FUNCTION notify_game_state_changed();
--> statement-breakpoint
CREATE TRIGGER bet_requests_game_state_changed
AFTER INSERT OR UPDATE OR DELETE ON bet_requests
FOR EACH STATEMENT EXECUTE FUNCTION notify_game_state_changed();
--> statement-breakpoint
CREATE TRIGGER token_ledger_game_state_changed
AFTER INSERT OR UPDATE OR DELETE ON token_ledger
FOR EACH STATEMENT EXECUTE FUNCTION notify_game_state_changed();
--> statement-breakpoint
CREATE TRIGGER influence_lots_game_state_changed
AFTER INSERT OR UPDATE OR DELETE ON influence_lots
FOR EACH STATEMENT EXECUTE FUNCTION notify_game_state_changed();
