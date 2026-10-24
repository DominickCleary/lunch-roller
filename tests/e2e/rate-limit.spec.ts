import { expect, test } from '@playwright/test'

const appOrigin = new URL(process.env.APP_ORIGIN ?? 'http://localhost:3000')
	.origin

test('admin login rate limiting blocks the ninth failed attempt', async ({
	request,
}) => {
	for (let attempt = 0; attempt < 8; attempt++) {
		const response = await request.post('/api/v1/admin/session', {
			data: { password: 'incorrect integration password' },
			headers: { Origin: appOrigin },
		})
		expect(response.status()).toBe(401)
	}
	const limited = await request.post('/api/v1/admin/session', {
		data: { password: 'incorrect integration password' },
		headers: { Origin: appOrigin },
	})
	expect(limited.status()).toBe(429)
})
