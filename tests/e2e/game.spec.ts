import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
} from '@playwright/test';
import { createDatabase, GameService } from '../../packages/db/src/index';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error(
    'Set TEST_DATABASE_URL to a disposable migrated and seeded database before running E2E tests.',
  );
}

const appOrigin = process.env.APP_ORIGIN ?? 'http://localhost:3000';
const adminPassword = process.env.ADMIN_PASSWORD ?? 'integration-only-password';
const sessionSecret =
  process.env.SESSION_SECRET ??
  'integration-only-session-secret-at-least-32-characters';
const runId = randomUUID().slice(0, 8);
const fixturePrefix = `LR-E2E-${runId}`;
const database = createDatabase(testDatabaseUrl);
const game = new GameService(database);
let originalSchedule: Awaited<ReturnType<GameService['getSchedule']>>;
let apiParticipantId = '';

function validOrigin() {
  return { Origin: appOrigin };
}

function expiredSessionCookie() {
  const value = `1.${randomBytes(24).toString('base64url')}`;
  const signature = createHmac('sha256', sessionSecret)
    .update(value)
    .digest('base64url');
  return `lunch-roller-admin=${value}.${signature}`;
}

async function signIn(page: import('@playwright/test').Page) {
  const password = page.getByLabel('Administrator password');
  if (!(await password.isVisible())) {
    await page
      .locator('.top-actions')
      .getByText('Admin', { exact: true })
      .click();
  }
  await page.getByLabel('Administrator password').fill(adminPassword);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('Administrator tools unlocked.')).toBeVisible();
}

async function exerciseAdminUiAndGame(
  page: import('@playwright/test').Page,
  browser: Browser,
  request: APIRequestContext,
) {
  let memberName = `${fixturePrefix} Member`;
  const archivedName = `${fixturePrefix} Archived`;
  let placeName = `${fixturePrefix} Place`;
  const addPlaceName = `${fixturePrefix} Member Place`;
  const correctionReason = `${fixturePrefix} test grant`;

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(appOrigin);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Lunch Roller',
  );
  await signIn(page);

  const peopleCard = page
    .locator('.admin-tool-card')
    .filter({ has: page.getByRole('heading', { name: 'People' }) });
  await peopleCard.getByLabel('New team member name').fill(memberName);
  await peopleCard.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(peopleCard.getByText(memberName, { exact: true })).toBeVisible();
  await peopleCard
    .locator('.admin-row')
    .filter({ hasText: memberName })
    .getByRole('button', { name: 'Rename' })
    .click();
  const memberNameField = peopleCard.getByLabel(`Rename ${memberName}`);
  await memberNameField.fill(`${memberName} Edited`);
  await memberNameField
    .locator('..')
    .getByRole('button', { name: 'Save' })
    .click();
  memberName = `${memberName} Edited`;
  await expect(peopleCard.getByText(memberName, { exact: true })).toBeVisible();

  await peopleCard.getByLabel('New team member name').fill(archivedName);
  await peopleCard.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(
    peopleCard.getByText(archivedName, { exact: true }),
  ).toBeVisible();

  const memberSelect = page.getByLabel('Your name');
  await memberSelect.selectOption({ label: archivedName });
  await page.getByRole('button', { name: 'Enter lunch wheel' }).click();
  await expect(page.locator('.member-status')).toContainText(archivedName);
  await page.reload();
  await expect(page.locator('.member-status')).toContainText(archivedName);
  await signIn(page);

  await peopleCard
    .getByText(archivedName, { exact: true })
    .locator('..')
    .getByRole('button', { name: 'Archive', exact: true })
    .click();
  await expect(page.locator('.member-status')).toContainText('No one yet');
  await expect(page.getByLabel('Your name')).not.toContainText(archivedName);

  await page.getByLabel('Your name').selectOption({ label: memberName });
  await page.getByRole('button', { name: 'Enter lunch wheel' }).click();
  await expect(page.locator('.member-status')).toContainText(memberName);
  await page.reload();
  await expect(page.locator('.member-status')).toContainText(memberName);
  await signIn(page);

  const placesCard = page
    .locator('.admin-tool-card')
    .filter({ has: page.getByRole('heading', { name: 'Places' }) });
  await placesCard.getByLabel('New lunch place').fill(placeName);
  await placesCard.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(placesCard.getByText(placeName, { exact: false })).toBeVisible();
  await placesCard
    .locator('.admin-row')
    .filter({ hasText: placeName })
    .getByRole('button', { name: 'Rename' })
    .click();
  const placeNameField = placesCard.getByLabel(`Rename ${placeName}`);
  await placeNameField.fill(`${placeName} Edited`);
  await placeNameField
    .locator('..')
    .getByRole('button', { name: 'Save' })
    .click();
  placeName = `${placeName} Edited`;
  await expect(placesCard.getByText(placeName, { exact: false })).toBeVisible();
  await placesCard
    .locator('.admin-row')
    .filter({ hasText: placeName })
    .getByRole('button', { name: 'Archive', exact: true })
    .click();
  await expect(
    placesCard
      .locator('.admin-row')
      .filter({ hasText: placeName })
      .getByText('archived', { exact: true }),
  ).toBeVisible();

  const scheduleCard = page
    .locator('.admin-tool-card')
    .filter({ has: page.getByRole('heading', { name: 'Draw schedule' }) });
  await scheduleCard.getByLabel('Time', { exact: true }).fill('00:00');
  await scheduleCard.getByLabel('Timezone').fill('UTC');
  const weekdays = scheduleCard.locator('input[type="checkbox"]');
  for (const checkbox of await weekdays.all()) {
    if (await checkbox.isChecked()) await checkbox.uncheck();
  }
  for (const checkbox of await weekdays.all()) await checkbox.check();
  await scheduleCard.getByRole('button', { name: 'Save schedule' }).click();
  await expect(page.getByText('Schedule saved.')).toBeVisible();

  const result = await game.drawIfDue(new Date());
  expect(result).not.toBeNull();
  if (!result)
    throw new Error('The configured E2E schedule did not produce a draw.');
  await page.reload();
  await expect(page.locator('.wheel-footer strong')).toHaveText(
    result.placeName,
  );
  const winnerIndex = result.snapshot.findIndex(
    (option) => option.placeId === result.placeId,
  );
  expect(winnerIndex).toBeGreaterThanOrEqual(0);
  const snapshotTotal = result.snapshot.reduce(
    (sum, option) => sum + option.probability,
    0,
  );
  const probabilityBefore = result.snapshot
    .slice(0, winnerIndex)
    .reduce((sum, option) => sum + option.probability, 0);
  const winnerCenter =
    ((probabilityBefore + result.snapshot[winnerIndex]!.probability / 2) /
      (snapshotTotal || 1)) *
    360;
  const expectedPointerAngle = (90 - winnerCenter + 360) % 360;
  const wheel = page.locator('.wheel');
  const desktopWheelBounds = await page.locator('.wheel-wrap').boundingBox();
  expect(desktopWheelBounds).not.toBeNull();
  expect(desktopWheelBounds!.width).toBeGreaterThan(600);
  await expect(wheel).not.toHaveClass(/wheel-spinning/);
  const actualAngle = await wheel.evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
  });
  const normalizedAngle = (actualAngle + 360) % 360;
  const angleDifference = Math.min(
    Math.abs(normalizedAngle - expectedPointerAngle),
    360 - Math.abs(normalizedAngle - expectedPointerAngle),
  );
  expect(angleDifference).toBeLessThan(2);

  const replay = page.getByRole('button', { name: /Replay.*result/i });
  const selectedParticipantId = await page.evaluate(() =>
    localStorage.getItem('lunch-roller.participant-id'),
  );
  expect(selectedParticipantId).toBeTruthy();
  const beforeReplayWallet = await game.wallet(selectedParticipantId!);
  const drawRequests: string[] = [];
  const recordDrawRequest = (request: import('@playwright/test').Request) => {
    if (
      request.method() === 'POST' &&
      /\/api\/v1\/draw(?:\/|$|\?)/.test(request.url())
    )
      drawRequests.push(request.url());
  };
  page.on('request', recordDrawRequest);
  await replay.click();
  await expect(replay).toBeEnabled({ timeout: 8000 });
  page.off('request', recordDrawRequest);
  expect(drawRequests).toHaveLength(0);
  await expect(page.locator('.wheel-footer strong')).toHaveText(
    result.placeName,
  );
  const todayAfterReplay = await request.get('/api/v1/today');
  expect(todayAfterReplay.ok()).toBe(true);
  expect((await todayAfterReplay.json()).result.placeId).toBe(result.placeId);
  expect(await game.wallet(selectedParticipantId!)).toEqual(beforeReplayWallet);
  await signIn(page);

  const correctionCard = page
    .locator('.admin-tool-card')
    .filter({ has: page.getByRole('heading', { name: 'Token correction' }) });
  await correctionCard
    .getByLabel('Team member')
    .selectOption({ label: memberName });
  await correctionCard.getByLabel('Token change').fill('30');
  await correctionCard.getByLabel('Reason').fill(correctionReason);
  await correctionCard
    .getByRole('button', { name: 'Record correction' })
    .click();
  await expect(page.getByText('Token correction recorded.')).toBeVisible();

  await page.getByRole('button', { name: /Check in/ }).click();
  await expect(
    page.getByText('Check-in complete — 10 tokens added.'),
  ).toBeVisible();
  await page.getByTitle('Boost place (5 tokens)').first().click();
  await expect(
    page.getByText('Place boosted for the next draw.'),
  ).toBeVisible();
  await page.getByLabel('Have a new spot in mind?').fill(addPlaceName);
  await page.getByRole('button', { name: 'Add place' }).click();
  await expect(
    page.getByText('New lunch place added for 20 tokens.'),
  ).toBeVisible();

  const participantId = await page.evaluate(() =>
    localStorage.getItem('lunch-roller.participant-id'),
  );
  expect(participantId).toBeTruthy();
  const walletResponse = await request.get('/api/v1/wallet', {
    headers: { 'X-Participant-Id': participantId! },
  });
  expect(walletResponse.ok()).toBe(true);
  const wallet = (await walletResponse.json()) as {
    balance: number;
    ledger: Array<{ delta: number; reason: string | null }>;
  };
  expect(wallet.balance).toBe(15);
  expect(wallet.ledger.some((entry) => entry.delta === 10)).toBe(true);
  expect(wallet.ledger.some((entry) => entry.delta === -5)).toBe(true);
  expect(wallet.ledger.some((entry) => entry.delta === -20)).toBe(true);
  expect(wallet.ledger.some((entry) => entry.reason === correctionReason)).toBe(
    true,
  );

  const secondContext = await browser.newContext({
    baseURL: appOrigin,
    reducedMotion: 'reduce',
    viewport: { width: 390, height: 844 },
  });
  try {
    await secondContext.addInitScript(() => {
      Reflect.deleteProperty(window, 'Notification');
    });
    const secondPage = await secondContext.newPage();
    await secondPage.goto(appOrigin);
    await expect(secondPage.getByRole('heading', { level: 1 })).toHaveText(
      'Lunch Roller',
    );
    await expect(secondPage.getByTestId('name-picker')).toBeVisible();
    await expect(secondPage.getByLabel('Your name')).toBeVisible();
    await expect(
      secondPage.getByRole('button', { name: 'Enter lunch wheel' }),
    ).toBeVisible();
    await expect(
      secondPage.locator('.top-actions').getByText('Admin'),
    ).toBeVisible();
    expect(
      await secondPage.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      await secondPage.evaluate(
        () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      ),
    ).toBe(true);
    expect(await secondPage.evaluate(() => 'Notification' in window)).toBe(
      false,
    );
    await expect(
      secondPage.getByRole('button', { name: /Get lunch alerts/ }),
    ).toHaveCount(0);
    await secondPage
      .getByLabel('Your name')
      .selectOption({ label: memberName });
    await secondPage.getByRole('button', { name: 'Enter lunch wheel' }).click();
    await expect(secondPage.locator('.wheel-footer strong')).toHaveText(
      result.placeName,
    );
    const reducedTransition = await secondPage
      .locator('.wheel')
      .evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(Number.parseFloat(reducedTransition)).toBeLessThan(0.01);
  } finally {
    await secondContext.close();
  }

  await page.getByRole('button', { name: 'Lock admin tools' }).click();
  await expect(page.getByLabel('Administrator password')).toBeVisible();
}

test.beforeAll(async () => {
  if (Buffer.byteLength(sessionSecret) < 32) {
    throw new Error(
      'SESSION_SECRET must contain at least 32 bytes for E2E session checks.',
    );
  }
  originalSchedule = await game.getSchedule();
  const person = await game.saveParticipant({
    name: `${fixturePrefix} API Member`,
  });
  apiParticipantId = person.id;
});

test.afterAll(async () => {
  try {
    const participants = await game.listParticipants(true);
    for (const person of participants) {
      if (person.name.startsWith(fixturePrefix)) {
        await game.saveParticipant({ active: false }, person.id);
      }
    }
    const places = await game.listPlaces(true);
    for (const place of places) {
      if (place.name.startsWith(fixturePrefix)) {
        await game.savePlace({ active: false }, place.id);
      }
    }
    if (originalSchedule) await game.setSchedule(originalSchedule);
  } finally {
    await database.close();
  }
});

test('API rejects untrusted origins, bad input, impersonation, and invalid sessions', async ({
  request,
}) => {
  const noOrigin = await request.post('/api/v1/admin/session', {
    data: { password: adminPassword },
  });
  expect(noOrigin.status()).toBe(403);

  const crossOrigin = await request.post('/api/v1/admin/session', {
    data: { password: adminPassword },
    headers: { Origin: 'https://attacker.example' },
  });
  expect(crossOrigin.status()).toBe(403);

  const invalidSchema = await request.post('/api/v1/identity/select', {
    data: { participantId: 'not-a-uuid' },
    headers: validOrigin(),
  });
  expect(invalidSchema.status()).toBe(400);

  const impersonation = await request.get('/api/v1/admin/participants', {
    headers: { 'X-Participant-Id': apiParticipantId },
  });
  expect(impersonation.status()).toBe(401);

  const badCredentials = await request.post('/api/v1/admin/session', {
    data: { password: 'incorrect integration password' },
    headers: validOrigin(),
  });
  expect(badCredentials.status()).toBe(401);

  const login = await request.post('/api/v1/admin/session', {
    data: { password: adminPassword },
    headers: validOrigin(),
  });
  expect(login.status()).toBe(204);
  const setCookie = login.headers()['set-cookie'] ?? '';
  expect(setCookie).toMatch(/HttpOnly/i);
  expect(setCookie).toMatch(/SameSite=Strict/i);
  expect(setCookie).toMatch(/Max-Age=\d+/i);
  expect((await request.get('/api/v1/admin/participants')).status()).toBe(200);

  const issuedCookie = /lunch-roller-admin=[^;]+/.exec(setCookie)?.[0];
  expect(issuedCookie).toBeTruthy();
  const signatureStart = issuedCookie!.lastIndexOf('.') + 1;
  const signature = issuedCookie!.slice(signatureStart);
  const tamperedSignature = `${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`;
  const tamperedCookie = `${issuedCookie!.slice(0, signatureStart)}${tamperedSignature}`;
  const tampered = await request.get('/api/v1/admin/participants', {
    headers: { Cookie: tamperedCookie },
  });
  expect(tampered.status()).toBe(401);

  const expired = await request.get('/api/v1/admin/participants', {
    headers: { Cookie: expiredSessionCookie() },
  });
  expect(expired.status()).toBe(401);

  const logout = await request.delete('/api/v1/admin/session', {
    headers: validOrigin(),
  });
  expect(logout.status()).toBe(204);
  expect((await request.get('/api/v1/admin/participants')).status()).toBe(401);
});

test('admin forms manage the game and members see the same committed draw', async ({
  page,
  browser,
  request,
}) => {
  await exerciseAdminUiAndGame(page, browser, request);
});
