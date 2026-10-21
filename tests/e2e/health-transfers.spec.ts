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
const origin = new URL(process.env.APP_ORIGIN ?? 'http://localhost:3000')
  .origin;
let senderId = '';
let recipientId = '';
let balancedId = '';
let original: typeof schema.settings.$inferSelect;
const ownedPlaces: string[] = [];
const senderName = `Transfer sender ${suffix}`;
const recipientName = `Transfer recipient ${suffix}`;
const healthyName = `Healthy spot ${suffix}`;

test.beforeAll(async () => {
  [original] = await database.db.select().from(schema.settings);
  senderId = (await game.saveParticipant({ name: senderName })).id;
  recipientId = (await game.saveParticipant({ name: recipientName })).id;
  balancedId = (await game.savePlace({ name: `Balanced spot ${suffix}` })).id;
  ownedPlaces.push(balancedId);
  await game.completeSetup();
  await game.setTokenBalance(
    {
      participantId: senderId,
      balance: 100,
      reason: 'Browser transfer fixture',
    },
    randomUUID(),
  );
});

test.afterAll(async () => {
  try {
    // All records belong to this disposable test fixture. Retained production history is never deleted.
    await database.client`DELETE FROM token_ledger WHERE participant_id IN (${senderId}::uuid, ${recipientId}::uuid)`;
    if (ownedPlaces.length)
      await database.client`DELETE FROM places WHERE id IN ${database.client(ownedPlaces)}`;
    await database.client`DELETE FROM participants WHERE id IN (${senderId}::uuid, ${recipientId}::uuid)`;
    await database.db.update(schema.settings).set({
      setupCompleted: original.setupCompleted,
      healthBonusEnabled: original.healthBonusEnabled,
      healthBonusMultiplier: original.healthBonusMultiplier,
    });
  } finally {
    await database.close();
  }
});

test('reviews and sends tokens, persists both wallets and rejects invalid API sends', async ({
  page,
  browser,
  request,
}) => {
  await page.addInitScript(
    (id) => localStorage.setItem('lunch-roller.participant-id', id),
    senderId,
  );
  await page.goto(origin);
  await expect(page.locator('.member-status')).toContainText(senderName);
  await expect(page.locator('.balance')).toContainText('100');
  const transfer = page.locator('.token-transfer');
  await transfer.getByText('Send tokens', { exact: true }).click();
  await transfer
    .getByLabel('Recipient', { exact: true })
    .selectOption(recipientId);
  await transfer.getByLabel('Tokens to send').fill('25');
  await transfer.getByRole('button', { name: 'Review transfer' }).click();
  await expect(transfer).toContainText(`Send 25 tokens to ${recipientName}?`);
  expect((await game.wallet(senderId)).balance).toBe(100);
  await transfer.getByRole('button', { name: 'Back', exact: true }).click();
  expect((await game.wallet(senderId)).balance).toBe(100);
  await transfer.getByRole('button', { name: 'Review transfer' }).click();
  await transfer.getByRole('button', { name: 'Confirm transfer' }).click();
  await expect(transfer.getByRole('status')).toContainText(
    `Sent 25 tokens to ${recipientName}.`,
  );
  await expect(page.locator('.balance')).toContainText('75');
  await expect(
    page.getByText(`Sent to ${recipientName}`, { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator('.balance')).toContainText('75');
  const recipientPage = await browser.newPage();
  await recipientPage.addInitScript(
    (id) => localStorage.setItem('lunch-roller.participant-id', id),
    recipientId,
  );
  await recipientPage.goto(origin);
  await expect(recipientPage.locator('.balance')).toContainText('25');
  await expect(
    recipientPage.getByText(`Received from ${senderName}`, { exact: true }),
  ).toBeVisible();
  await recipientPage.close();
  const headers = {
    Origin: origin,
    'X-Participant-Id': senderId,
    'Idempotency-Key': randomUUID(),
  };
  expect(
    (
      await request.post('/api/v1/transfers', {
        data: { recipientId: senderId, amount: 1 },
        headers,
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post('/api/v1/transfers', {
        data: { recipientId, amount: 1000 },
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.post('/api/v1/transfers', {
        data: { recipientId, amount: 1 },
        headers: { ...headers, Origin: 'https://other.invalid' },
      })
    ).status(),
  ).toBe(403);
  await page.getByRole('tab', { name: 'Daily activity' }).click();
  await page.getByLabel('View', { exact: true }).selectOption('day');
  await expect(page.locator('.activity-timeline')).toContainText(
    `Sent to ${recipientName}`,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileTransfer = page.locator('.token-transfer');
  await mobileTransfer.getByText('Send tokens', { exact: true }).click();
  await mobileTransfer
    .getByLabel('Recipient', { exact: true })
    .selectOption(recipientId);
  await mobileTransfer.getByLabel('Tokens to send').fill('3');
  await mobileTransfer.getByRole('button', { name: 'Review transfer' }).focus();
  await page.keyboard.press('Enter');
  const confirm = mobileTransfer.getByRole('button', {
    name: 'Confirm transfer',
  });
  await expect(confirm).toBeFocused();
  await mobileTransfer
    .getByRole('button', { name: 'Back', exact: true })
    .click();
  await expect(
    mobileTransfer.getByLabel('Recipient', { exact: true }),
  ).toBeFocused();
  await mobileTransfer.getByRole('button', { name: 'Review transfer' }).click();
  await mobileTransfer
    .getByRole('button', { name: 'Confirm transfer' })
    .click();
  await expect(mobileTransfer.getByRole('status')).toContainText(
    `Sent 3 tokens to ${recipientName}.`,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test('creates rated places, edits ratings as admin and persists the health rule', async ({
  page,
  request,
}) => {
  await page.addInitScript(
    (id) => localStorage.setItem('lunch-roller.participant-id', id),
    senderId,
  );
  await page.goto(origin);
  const row = page
    .locator('.odds-row')
    .filter({ hasText: `Balanced spot ${suffix}` });
  await expect(row.locator('.health-badge')).toHaveText('Balanced');
  await page.getByLabel('New spot health level').selectOption('healthy');
  await page.getByPlaceholder(/Add a lunch place/).fill(healthyName);
  const addedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/places') &&
      response.request().method() === 'POST',
  );
  await page
    .locator('.add-place')
    .getByRole('button', { name: 'Add place' })
    .click();
  const added = await (await addedResponse).json();
  expect(added.place.healthLevel).toBe('healthy');
  ownedPlaces.push(added.place.id);
  await expect(
    page
      .locator('.odds-row')
      .filter({ hasText: healthyName })
      .locator('.health-badge'),
  ).toHaveText('Healthy');
  expect(
    (
      await request.put('/api/v1/admin/health-rule', {
        headers: { Origin: origin },
        data: { enabled: false, multiplier: 1.5 },
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
  await page
    .getByLabel(`Health level for ${healthyName}`, { exact: true })
    .selectOption('treat');
  await expect(
    page
      .locator('.odds-row')
      .filter({ hasText: healthyName })
      .locator('.health-badge'),
  ).toHaveText('Treat');
  const card = page.getByTestId('admin-health-rule');
  await card.getByLabel('Enable health balance bonus').uncheck();
  await card.getByLabel('Healthy place weight multiplier').fill('1.5');
  await card.getByRole('button', { name: 'Save health rule' }).click();
  await expect(
    page.getByText('Health balance rule saved.', { exact: true }),
  ).toBeVisible();
  expect(await game.getHealthRule()).toEqual({
    enabled: false,
    multiplier: 1.5,
  });
  await page.screenshot({
    path: '/tmp/lunch-health-transfers-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: '/tmp/lunch-health-transfers-mobile.png',
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
