import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createDatabase, GameService } from '../../packages/db/src/index';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl)
  throw new Error(
    'Set TEST_DATABASE_URL to a disposable migrated and seeded database before running E2E tests.',
  );

const appOrigin = new URL(process.env.APP_ORIGIN ?? 'http://localhost:3000')
  .origin;
const adminPassword = process.env.ADMIN_PASSWORD ?? 'integration-only-password';
const fixtureName = `LR-ECON-${randomUUID().slice(0, 8)} Member`;
const database = createDatabase(testDatabaseUrl);
const game = new GameService(database);
let originalEconomy: Awaited<ReturnType<GameService['getEconomy']>>;
let memberId = '';

async function signIn(page: import('@playwright/test').Page) {
  const password = page.getByLabel('Administrator password');
  if (!(await password.isVisible()))
    await page
      .locator('.top-actions')
      .getByText('Admin', { exact: true })
      .click();
  await password.fill(adminPassword);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('Administrator tools unlocked.')).toBeVisible();
}

test.beforeAll(async () => {
  originalEconomy = await game.getEconomy();
  const member = await game.saveParticipant({ name: fixtureName });
  memberId = member.id;
});

test.afterAll(async () => {
  try {
    if (originalEconomy) await game.setEconomy(originalEconomy);
    if (memberId)
      await database.client`delete from participants where id = ${memberId}::uuid`;
  } finally {
    await database.close();
  }
});

test('admin economy is guarded, persists, and updates participant prices', async ({
  page,
  request,
}) => {
  await page.goto(appOrigin);
  await signIn(page);

  expect((await request.get('/api/v1/admin/economy')).status()).toBe(401);
  const login = await request.post('/api/v1/admin/session', {
    data: { password: adminPassword },
    headers: { Origin: appOrigin },
  });
  expect(login.status()).toBe(204);
  const adminCookie = /lunch-roller-admin=[^;]+/.exec(
    login.headers()['set-cookie'] ?? '',
  )?.[0];
  expect(adminCookie).toBeTruthy();
  const missingOrigin = await request.put('/api/v1/admin/economy', {
    data: {
      attendanceReward: 14,
      addPlaceCost: 22,
      boostCost: 6,
      reduceCost: 7,
      boostMultiplier: 1.4,
      reduceMultiplier: 0.7,
    },
    headers: { Cookie: adminCookie! },
  });
  expect(missingOrigin.status()).toBe(403);

  const card = page
    .getByRole('heading', { name: 'Tokens and odds' })
    .locator('..');
  await card.getByLabel('Attendance reward (tokens)').fill('14');
  await card.getByLabel('Add place cost (tokens)').fill('22');
  await card.getByLabel('Boost cost (tokens)').fill('6');
  await card.getByLabel('Reduce cost (tokens)').fill('7');
  await card.getByLabel('Boost relative-weight multiplier').fill('1.4');
  await card.getByLabel('Reduce relative-weight multiplier').fill('0.7');
  await card.getByRole('button', { name: 'Save token settings' }).click();
  await expect(
    page.getByText('Token settings saved.', { exact: true }),
  ).toBeVisible();

  const configured = {
    ...originalEconomy,
    attendanceReward: 14,
    addPlaceCost: 22,
    boostCost: 6,
    reduceCost: 7,
    boostMultiplier: 1.4,
    reduceMultiplier: 0.7,
  };
  const saved = await request.get('/api/v1/admin/economy', {
    headers: { Cookie: adminCookie! },
  });
  expect(saved.status()).toBe(200);
  expect(await saved.json()).toEqual(configured);
  expect((await (await request.get('/api/v1/today')).json()).economy).toEqual(
    configured,
  );

  await page.evaluate(
    (id) => localStorage.setItem('lunch-roller.participant-id', id),
    memberId,
  );
  await page.reload();
  await expect(
    page.getByTitle(/^Boost .+ for 6 tokens$/).first(),
  ).toBeVisible();
  await expect(
    page.getByTitle(/^Reduce .+ for 7 tokens$/).first(),
  ).toBeVisible();
  await expect(
    page.getByPlaceholder('Add a lunch place · 22 tokens'),
  ).toBeVisible();

  await page.reload();
  await signIn(page);
  await expect(card.getByLabel('Attendance reward (tokens)')).toHaveValue('14');
  await expect(card.getByLabel('Add place cost (tokens)')).toHaveValue('22');
  await expect(card.getByLabel('Boost cost (tokens)')).toHaveValue('6');
  await expect(card.getByLabel('Reduce cost (tokens)')).toHaveValue('7');
  await expect(card.getByLabel('Boost relative-weight multiplier')).toHaveValue(
    '1.4',
  );
  await expect(
    card.getByLabel('Reduce relative-weight multiplier'),
  ).toHaveValue('0.7');
});
