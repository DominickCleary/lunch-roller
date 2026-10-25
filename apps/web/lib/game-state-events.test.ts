import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@lunch/db', () => ({ startGameStateListener: vi.fn() }))

import { startGameStateListener } from '@lunch/db'
import { GET } from '../app/api/v1/events/route'

afterEach(() => vi.useRealTimers())

it('closes failed streams and starts a shared listener on reconnect', async () => {
	vi.useFakeTimers()
	const start = vi.mocked(startGameStateListener)
	start.mockRejectedValueOnce(new Error('temporary database outage'))
	const responses = await Promise.all([
		GET(new Request('http://localhost/api/v1/events')),
		GET(new Request('http://localhost/api/v1/events')),
	])
	for (const response of responses) {
		expect(await response.text()).toBe('retry: 3000\n\n')
	}
	expect(start).toHaveBeenCalledTimes(1)
	expect(vi.getTimerCount()).toBe(0)

	start.mockResolvedValue({ close: vi.fn() })
	const response = await GET(new Request('http://localhost/api/v1/events'))
	if (!response.body) throw new Error('Missing event stream')
	const reader = response.body.getReader()
	const decoder = new TextDecoder()
	expect(decoder.decode((await reader.read()).value)).toBe('retry: 3000\n\n')
	expect(start).toHaveBeenCalledTimes(2)
	const onChange = start.mock.calls[1]?.[0]
	if (!onChange) throw new Error('Missing listener callback')
	onChange()
	expect(decoder.decode((await reader.read()).value)).toBe(
		'event: game-state-changed\ndata: {}\n\n',
	)
	await reader.cancel()
	expect(vi.getTimerCount()).toBe(0)
})
