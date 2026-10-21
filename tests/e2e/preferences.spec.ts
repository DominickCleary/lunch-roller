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
const fixturePrefix = `LR-PREF-${randomUUID().slice(0, 8)}`;
const database = createDatabase(testDatabaseUrl);
const game = new GameService(database);
const memberName = `${fixturePrefix} Member`;
let memberId = '';
let originalSchedule: Awaited<ReturnType<GameService['getSchedule']>>;
let originalPreferences: Awaited<ReturnType<GameService['getPreferences']>>;
let originalWeights: Map<string, number>;
let ownedDrawId = '';

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
  originalSchedule = await game.getSchedule();
  originalPreferences = await game.getPreferences();
  originalWeights = new Map(
    (await game.listPlaces(true)).map((place) => [place.id, place.logWeight]),
  );
  await game.setSchedule({
    timezone: 'UTC',
    time: '00:00',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  });
  await game.setPreferences({
    ...originalPreferences,
    wheelSwitchTime: '15:00',
    checkInPledge: 'I pledge that I actually obeyed the wheel',
  });
  const member = await game.saveParticipant({ name: memberName });
  memberId = member.id;
  if (!(await game.today()).result) {
    const draw = await game.drawIfDue(new Date());
    if (draw) ownedDrawId = draw.id;
  }
});

test.afterAll(async () => {
  try {
    if (ownedDrawId) {
      await database.client`delete from notification_outbox where draw_id = ${ownedDrawId}::uuid`;
      await database.client`delete from token_ledger where participant_id = ${memberId}::uuid`;
      await database.client`delete from attendance where participant_id = ${memberId}::uuid`;
      await database.client`delete from draws where id = ${ownedDrawId}::uuid`;
    } else {
      await database.client`delete from token_ledger where participant_id = ${memberId}::uuid`;
      await database.client`delete from attendance where participant_id = ${memberId}::uuid`;
    }
    if (memberId)
      await database.client`delete from participants where id = ${memberId}::uuid`;
    for (const [id, logWeight] of originalWeights ?? [])
      await database.client`update places set log_weight = ${logWeight} where id = ${id}::uuid`;
    if (originalPreferences) await game.setPreferences(originalPreferences);
    if (originalSchedule) await game.setSchedule(originalSchedule);
  } finally {
    await database.close();
  }
});

test('admin preferences persist and participants see the pledge and completed check-in', async ({
  page,
  request,
}) => {
  await page.goto(appOrigin);
  await signIn(page);

  expect((await request.get('/api/v1/admin/preferences')).status()).toBe(401);

  const adminRequest = await request.post('/api/v1/admin/session', {
    data: { password: adminPassword },
    headers: { Origin: appOrigin },
  });
  expect(adminRequest.status()).toBe(204);
  const adminCookie = /lunch-roller-admin=[^;]+/.exec(
    adminRequest.headers()['set-cookie'] ?? '',
  )?.[0];
  expect(adminCookie).toBeTruthy();
  const missingOrigin = await request.put('/api/v1/admin/preferences', {
    data: { wheelSwitchTime: '12:34', checkInPledge: 'A pledge' },
    headers: { Cookie: adminCookie! },
  });
  expect(missingOrigin.status()).toBe(403);
  const invalidPreferences = await request.put('/api/v1/admin/preferences', {
    data: { wheelSwitchTime: '24:00', checkInPledge: '  ' },
    headers: { Cookie: adminCookie!, Origin: appOrigin },
  });
  expect(invalidPreferences.status()).toBe(400);

  const preferencesCard = page.getByTestId('admin-preferences');
  await preferencesCard.getByLabel('Wheel switch time').fill('12:34');
  await preferencesCard
    .getByLabel('Check-in pledge')
    .fill('I followed the wheel for lunch.');
  await preferencesCard
    .getByRole('button', { name: 'Save preferences' })
    .click();
  await expect(
    page.getByText('Wheel, check-in and betting preferences saved.'),
  ).toBeVisible();
  await page.reload();
  await signIn(page);
  await expect(preferencesCard.getByLabel('Wheel switch time')).toHaveValue(
    '12:34',
  );
  await expect(preferencesCard.getByLabel('Check-in pledge')).toHaveValue(
    'I followed the wheel for lunch.',
  );

  const saved = await request.get('/api/v1/admin/preferences', {
    headers: { Cookie: adminCookie! },
  });
  expect(saved.status()).toBe(200);
  expect(await saved.json()).toEqual({
    ...originalPreferences,
    wheelSwitchTime: '12:34',
    checkInPledge: 'I followed the wheel for lunch.',
  });
  const publicToday = await request.get('/api/v1/today');
  expect((await publicToday.json()).preferences).toEqual(await saved.json());

  await page.evaluate(
    (id) => localStorage.setItem('lunch-roller.participant-id', id),
    memberId,
  );
  await page.reload();
  const checkIn = page.getByTestId('check-in');
  await expect(checkIn).toBeEnabled();
  await checkIn.click();
  const checkInDialog = page.getByRole('dialog', {
    name: 'Swear your pledge to the Wheel',
  });
  await expect(checkInDialog).toBeVisible();
  await expect(checkInDialog.getByTestId('check-in-pledge')).toHaveText(
    'I followed the wheel for lunch.',
  );
  await checkInDialog.getByRole('button', { name: 'I decline' }).click();
  await expect(checkInDialog).toBeHidden();
  expect(
    (await game.wallet(memberId)).ledger.filter(
      (entry) => entry.kind === 'attendance',
    ),
  ).toHaveLength(0);

  await checkIn.click();
  await page
    .getByRole('dialog', { name: 'Swear your pledge to the Wheel' })
    .getByRole('button', { name: 'I swear it' })
    .click();
  await expect(page.getByTestId('check-in-confirmation')).toBeVisible();
  await expect(checkIn).toBeDisabled();
  await expect(checkIn).toHaveCSS('background-color', 'rgb(222, 216, 200)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(checkIn).toHaveCSS('background-color', 'rgb(48, 56, 57)');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  await expect(page.getByTestId('check-in-confirmation')).toBeVisible();
  await expect(page.getByTestId('check-in')).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'test-results/check-in-complete.png',
    fullPage: true,
  });

  const wallet = await game.wallet(memberId);
  expect(
    wallet.ledger.filter((entry) => entry.kind === 'attendance'),
  ).toHaveLength(1);
  expect(
    wallet.ledger.find((entry) => entry.kind === 'attendance')?.delta,
  ).toBe(10);
});
