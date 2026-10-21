import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  createDatabase,
  GameService,
  schema,
} from '../../packages/db/src/index';
const database = createDatabase(process.env.TEST_DATABASE_URL!);
const game = new GameService(database);
const suffix = randomUUID().slice(0, 8);
const placeName = `UI controls ${suffix}`;
const personName = `UI controls person ${suffix}`;
let personId = '';
let placeId = '';
let originalPreferences: Awaited<ReturnType<GameService['getPreferences']>>;
let originalWeights: (typeof schema.places.$inferSelect)[];
test.beforeAll(async () => {
  originalPreferences = await game.getPreferences();
  originalWeights = await database.db.select().from(schema.places);
  personId = (await game.saveParticipant({ name: personName })).id;
  placeId = (await game.savePlace({ name: placeName, healthLevel: 'healthy' }))
    .id;
});
test.afterAll(async () => {
  try {
    await game.setPreferences(originalPreferences);
    for (const place of originalWeights)
      await database.client`UPDATE places SET log_weight = ${place.logWeight} WHERE id = ${place.id}::uuid`;
    await database.client`DELETE FROM places WHERE id = ${placeId}::uuid`;
    await database.client`DELETE FROM participants WHERE id = ${personId}::uuid`;
  } finally {
    await database.close();
  }
});
test('unifies place management, odds and direct weights; persists spin duration and reviews mobile controls', async ({
  page,
  request,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(
    (id) => localStorage.setItem('lunch-roller.participant-id', id),
    personId,
  );
  await page.goto('/');
  const spot = page.locator('.odds-row').filter({ hasText: placeName });
  await expect(spot.locator('.health-badge')).toHaveCSS(
    'color',
    'rgb(45, 106, 79)',
  );
  await expect(spot.locator('.influence-position-buttons button')).toHaveCount(
    3,
  );
  await expect(spot.locator('.influence-net-value')).toHaveText('0');
  await expect(spot).not.toContainText('Staged');
  await expect(spot).not.toContainText('editable until');
  expect((await spot.boundingBox())!.height).toBeLessThanOrEqual(48);
  expect(
    (
      await request.put('/api/v1/admin/place-weights', {
        headers: { Origin: process.env.APP_ORIGIN! },
        data: { placeId, weight: 4 },
      })
    ).status(),
  ).toBe(401);
  await page
    .locator('.top-actions')
    .getByText('Admin', { exact: true })
    .click();
  await page
    .getByLabel('Administrator password')
    .fill(process.env.ADMIN_PASSWORD ?? 'integration-only-password');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  const combined = page.getByTestId('admin-restaurant-odds');
  await expect(
    combined.getByRole('heading', { name: 'Places and odds' }),
  ).toBeVisible();
  const row = combined.getByRole('row').filter({ hasText: placeName });
  await row.getByLabel(`${placeName} weight`, { exact: true }).fill('3.25');
  await row.getByRole('button', { name: 'Save weight' }).click();
  await expect(
    page.getByText('Restaurant weight saved.', { exact: true }),
  ).toBeVisible();
  expect(
    (await game.listPlaces()).find((place) => place.id === placeId)!.logWeight,
  ).toBeCloseTo(Math.log(3.25));
  await row.getByLabel(`${placeName} percentage`, { exact: true }).fill('20');
  await combined.getByRole('button', { name: 'Save percentages' }).click();
  await expect(
    page.getByText('Restaurant odds saved.', { exact: true }),
  ).toBeVisible();
  expect(
    (await game.listRestaurantOdds()).places.find(
      (place) => place.placeId === placeId,
    )!.percent,
  ).toBeCloseTo(20);
  await page.getByRole('button', { name: 'Odds', exact: true }).click();
  await expect(spot.locator(':scope > strong')).toHaveText('4/1');
  await expect(spot.locator(':scope > strong')).toHaveAttribute(
    'title',
    /20.*% chance/,
  );
  await row
    .getByLabel(`Health level for ${placeName}`, { exact: true })
    .selectOption('treat');
  await expect(spot.locator('.health-badge')).toHaveCSS(
    'color',
    'rgb(158, 62, 53)',
  );
  const preferences = page.getByTestId('admin-preferences');
  await preferences.getByLabel('Wheel spin duration (seconds)').fill('7');
  await preferences.getByRole('button', { name: 'Save preferences' }).click();
  await expect(
    page.getByText('Wheel, check-in and betting preferences saved.', {
      exact: true,
    }),
  ).toBeVisible();
  expect((await game.getPreferences()).wheelSpinSeconds).toBe(7);
  await page.reload();
  await page
    .locator('.top-actions')
    .getByText('Admin', { exact: true })
    .click();
  await page
    .getByLabel('Administrator password')
    .fill(process.env.ADMIN_PASSWORD ?? 'integration-only-password');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(
    preferences.getByLabel('Wheel spin duration (seconds)'),
  ).toHaveValue('7');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: '/tmp/lunch-ui-controls-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: '/tmp/lunch-ui-controls-mobile.png',
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await spot.boundingBox())!.height).toBeLessThanOrEqual(48);
  const add = await page
    .locator('.add-place')
    .getByRole('button', { name: 'Add place' })
    .boundingBox();
  const health = await page.getByLabel('New spot health level').boundingBox();
  expect(Math.abs(add!.y - health!.y)).toBeLessThan(5);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(spot.locator('.health-badge')).toHaveCSS(
    'color',
    'rgb(233, 148, 131)',
  );
});
