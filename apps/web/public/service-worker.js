self.addEventListener('push', (event) => {
	let payload = {
		title: 'Lunch is decided',
		body: 'The lunch wheel has a result.',
		drawId: '',
		tag: '',
	}
	try {
		payload = { ...payload, ...(event.data?.json() ?? {}) }
	} catch {
		payload.body = event.data?.text() || payload.body
	}
	event.waitUntil(
		self.registration.showNotification(payload.title, {
			body: payload.body,
			tag:
				payload.tag ||
				(payload.drawId ? `lunch-draw-${payload.drawId}` : 'lunch-roller'),
			icon: '/android-chrome-192x192.png',
			data: { url: '/' },
		}),
	)
})

self.addEventListener('notificationclick', (event) => {
	event.notification.close()
	event.waitUntil(
		self.clients
			.matchAll({ type: 'window', includeUncontrolled: true })
			.then((clients) => {
				const open = clients.find((client) => 'focus' in client)
				return open
					? open.focus()
					: self.clients.openWindow(event.notification.data?.url || '/')
			}),
	)
})
