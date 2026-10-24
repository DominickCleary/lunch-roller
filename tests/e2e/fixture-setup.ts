import { test } from '@playwright/test'
import { prepareGameFixtures } from '../fixtures'

test('load explicit fixtures for existing game browser scenarios', async () => {
	await prepareGameFixtures()
})
