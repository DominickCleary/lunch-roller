import { createECDH, randomBytes } from 'node:crypto'
import { expect, it } from 'vitest'
import webPush from 'web-push'
import { configurePush } from './scheduler'

it('uses the installed push transport to sign and encrypt a real browser request', () => {
	const vapid = webPush.generateVAPIDKeys()
	const enabled = configurePush(
		{ ...vapid, subject: 'mailto:integration@example.com' },
		(subject, publicKey, privateKey) =>
			webPush.setVapidDetails(subject, publicKey, privateKey),
		() => undefined,
	)
	expect(enabled).toBe(true)
	const browserKey = createECDH('prime256v1')
	browserKey.generateKeys()
	const request = webPush.generateRequestDetails(
		{
			endpoint: 'https://fcm.googleapis.com/fcm/send/integration',
			keys: {
				p256dh: browserKey.getPublicKey().toString('base64url'),
				auth: randomBytes(16).toString('base64url'),
			},
		},
		JSON.stringify({
			title: 'Lunch',
			body: 'Committed result',
			drawId: 'test',
		}),
	)
	expect(request.method).toBe('POST')
	expect(request.headers.Authorization).toMatch(/^vapid /)
	expect(request.headers['Content-Encoding']).toBe('aes128gcm')
	expect(request.body?.length).toBeGreaterThan(0)
})
