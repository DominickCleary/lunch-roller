import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createDatabase } from '../../packages/db/src/index';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error(
    'Set TEST_DATABASE_URL to a disposable migrated database before running first-run E2E tests.',
  );
}

const appOrigin = new URL(process.env.APP_ORIGIN ?? 'http://localhost:3000')
  .origin;
const adminPassword = process.env.ADMIN_PASSWORD ?? 'integration-only-password';
const fixtureTag = randomUUID().slice(0, 8);
const personName = `LR-SETUP-${fixtureTag} Person`;
const secondPersonName = `LR-SETUP-${fixtureTag} Second`;
const placeName = `LR-SETUP-${fixtureTag} Place`;
const database = createDatabase(testDatabaseUrl);
let ownsEmptyDatabase = false;

test.beforeAll(async () => {
  const [state] = await database.client`
    select
      settings.setup_completed,
      (select count(*)::integer from participants) as participants,
      (select count(*)::integer from places) as places
    from settings
    where settings.id = 1
  `;
  expect(state).toEqual({
    setup_completed: false,
    participants: 0,
    places: 0,
  });
  ownsEmptyDatabase = true;
});

test.afterAll(async () => {
  try {
    if (!ownsEmptyDatabase) return;
    await database.client.begin(async (transaction) => {
      await transaction`delete from places where name = ${placeName}`;
      await transaction`delete from participants where name in (${personName}, ${secondPersonName})`;
      await transaction`update settings set setup_completed = false where id = 1`;
    });
  } finally {
    await database.close();
  }
});

test('empty first run gates the wheel until an administrator configures it', async ({
  page,
  request,
}) => {
  const emptyStatus = await request.get('/api/v1/setup');
  expect(emptyStatus.status()).toBe(200);
  expect(await emptyStatus.json()).toEqual({
    completed: false,
    participantCount: 0,
    placeCount: 0,
  });

  for (const path of ['/api/v1/participants', '/api/v1/today']) {
    const blocked = await request.get(path);
    expect(blocked.status(), path).toBe(403);
    expect(await blocked.json()).toMatchObject({
      error: { code: 'SETUP_REQUIRED' },
    });
  }

  const unauthorizedCompletion = await request.post(
    '/api/v1/admin/setup/complete',
    { headers: { Origin: appOrigin } },
  );
  expect(unauthorizedCompletion.status()).toBe(401);

  const login = await request.post('/api/v1/admin/session', {
    data: { password: adminPassword },
    headers: { Origin: appOrigin },
  });
  expect(login.status()).toBe(204);

  const adminCookie = /lunch-roller-admin=[^;]+/.exec(
    login.headers()['set-cookie'] ?? '',
  )?.[0];
  expect(adminCookie).toBeTruthy();

  const badOrigin = await request.post('/api/v1/admin/setup/complete', {
    headers: { Cookie: adminCookie!, Origin: 'https://attacker.example' },
  });
  expect(badOrigin.status()).toBe(403);

  const incomplete = await request.post('/api/v1/admin/setup/complete', {
    headers: { Cookie: adminCookie!, Origin: appOrigin },
  });
  expect(incomplete.status()).toBe(409);
  expect(await incomplete.json()).toMatchObject({
    error: { code: 'SETUP_INCOMPLETE' },
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(appOrigin);
  await expect(page.getByTestId('setup-admin-login')).toBeVisible();
  await expect(page.locator('.wheel')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Set up your lunch wheel' }),
  ).toBeVisible();
  await page.getByLabel('Administrator password').fill(adminPassword);
  await page.getByRole('button', { name: 'Sign in as administrator' }).click();
  await expect(page.getByText('Build your lunch wheel')).toBeVisible();

  await page.getByLabel('New team member name').fill(personName);
  await page.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByText(personName, { exact: true })).toBeVisible();
  await page.getByLabel('New lunch place').fill(placeName);
  await page.getByRole('button', { name: 'Add place', exact: true }).click();
  await expect(page.getByText(placeName, { exact: true })).toBeVisible();
  await expect(page.getByTestId('setup-complete')).toBeEnabled();
  await page.getByTestId('setup-complete').click();
  expect(await (await request.get('/api/v1/setup')).json()).toEqual({
    completed: true,
    participantCount: 1,
    placeCount: 1,
  });

  await expect(page.getByTestId('name-picker')).toBeVisible();
  await expect(page.getByLabel('Your name')).toBeVisible();
  await page.getByLabel('Your name').selectOption({ label: personName });
  await page.getByRole('button', { name: 'Enter lunch wheel' }).click();
  await expect(page.locator('.member-status')).toContainText(personName);
  await expect(page.locator('.wheel')).toBeVisible();
  const savedId = await page.evaluate(() =>
    localStorage.getItem('lunch-roller.participant-id'),
  );
  expect(savedId).toMatch(/^[0-9a-f-]{36}$/i);

  await page.reload();
  await expect(page.locator('.member-status')).toContainText(personName);
  await expect(page.getByTestId('change-name')).toBeVisible();
  await page.getByTestId('change-name').click();
  await expect(page.getByTestId('name-picker')).toBeVisible();
  await page.getByLabel('Your name').selectOption({ label: personName });
  await page.getByRole('button', { name: 'Enter lunch wheel' }).click();
  await expect(page.locator('.member-status')).toContainText(personName);

  const addSecond = await request.post('/api/v1/admin/participants', {
    data: { name: secondPersonName },
    headers: { Cookie: adminCookie!, Origin: appOrigin },
  });
  expect(addSecond.status()).toBe(201);

  await page.evaluate(() => {
    localStorage.setItem(
      'lunch-roller.participant-id',
      '00000000-0000-4000-8000-000000000000',
    );
  });
  await page.reload();
  await expect(page.getByTestId('name-picker')).toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem('lunch-roller.participant-id'),
    ),
  ).toBeNull();
  await page.getByLabel('Your name').selectOption({ label: secondPersonName });
  await page.getByRole('button', { name: 'Enter lunch wheel' }).click();
  await expect(page.locator('.member-status')).toContainText(secondPersonName);
});
