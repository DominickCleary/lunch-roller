'use client'

import { useEffect, useRef } from 'react'

/** Refreshes authoritative API data when the server signals a game-state change. */
export function useGameStateEvents(
	active: boolean,
	refresh: () => Promise<unknown>,
) {
	const refreshRef = useRef(refresh)
	useEffect(() => {
		refreshRef.current = refresh
	}, [refresh])

	useEffect(() => {
		if (!active) return

		let disposed = false
		let refreshing = false
		let refreshQueued = false
		const requestRefresh = () => {
			if (disposed) return
			if (refreshing) {
				refreshQueued = true
				return
			}
			refreshing = true
			void (async () => {
				try {
					do {
						refreshQueued = false
						try {
							await refreshRef.current()
						} catch {
							// The page displays refresh failures and the fallback retries later.
						}
					} while (refreshQueued && !disposed)
				} finally {
					refreshing = false
				}
			})()
		}

		const source = new EventSource('/api/v1/events')
		source.addEventListener('game-state-changed', requestRefresh)
		// EventSource fires open after its initial connection and each reconnect.
		source.onopen = requestRefresh
		const fallback = window.setInterval(requestRefresh, 120_000)
		const onVisibilityChange = () => {
			if (!document.hidden) requestRefresh()
		}
		document.addEventListener('visibilitychange', onVisibilityChange)

		return () => {
			disposed = true
			source.removeEventListener('game-state-changed', requestRefresh)
			source.close()
			window.clearInterval(fallback)
			document.removeEventListener('visibilitychange', onVisibilityChange)
		}
	}, [active])
}
