import postgres from 'postgres'

const GAME_STATE_CHANNEL = 'lunch_roller_game_state'
const GAME_STATE_PAYLOAD = 'changed'

/**
 * Opens a dedicated PostgreSQL connection that forwards committed game-state
 * notifications. The notification is only a signal; callers must reload the
 * authoritative state through the HTTP API.
 */
export async function startGameStateListener(
	onChange: () => void,
): Promise<{ close(): Promise<void> }> {
	const url = process.env.DATABASE_URL
	if (!url) throw new Error('DATABASE_URL is required')

	const client = postgres(url, {
		max: 1,
		connect_timeout: 3,
		idle_timeout: 0,
	})
	try {
		const subscription = await client.listen(GAME_STATE_CHANNEL, (payload) => {
			if (payload === GAME_STATE_PAYLOAD) onChange()
		})
		let closed = false
		return {
			close: async () => {
				if (closed) return
				closed = true
				await subscription.unlisten()
				await client.end({ timeout: 5 })
			},
		}
	} catch (error) {
		await client.end({ timeout: 5 })
		throw error
	}
}
