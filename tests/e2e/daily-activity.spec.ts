import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { DailyActivityResponse, TodayResponse } from '@lunch/contracts';

const date = '2026-10-21';
const alex = randomUUID();
const sam = randomUUID();
const morgan = randomUUID();
const sushi = randomUUID();
const pizza = randomUUID();
const sample: DailyActivityResponse = {
  localDate: date,
  timezone: 'Europe/Dublin',
  entries: [
    [alex, 'Alex', sushi, 'Sushi', 'boost', 5, '08:00'],
    [sam, 'Sam', sushi, 'Sushi', 'boost', 5, '09:00'],
    [morgan, 'Morgan', sushi, 'Sushi', 'reduce', 5, '10:00'],
    [morgan, 'Morgan', pizza, 'Pizza', 'boost', 5, '11:00'],
  ].map(
    ([
      participantId,
      participantName,
      placeId,
      placeName,
      kind,
      amount,
      time,
    ]) => ({
      id: randomUUID(),
      participantId: String(participantId),
      participantName: String(participantName),
      placeId: String(placeId),
      placeName: String(placeName),
      kind: String(kind),
      delta: -Number(amount),
      reason: null,
      createdAt: `${date}T${time}:00.000Z`,
      betId: null,
      betLocalDate: null,
    }),
  ),
  bets: [
    {
      id: randomUUID(),
      participantId: alex,
      participantName: 'Alex',
      localDate: date,
      placeId: sushi,
      placeName: 'Sushi',
      stake: 12,
      status: 'open',
      payout: null,
      probability: null,
      updatedAt: `${date}T10:30:00.000Z`,
      settledAt: null,
    },
  ],
};

test.beforeEach(async ({ page, request }) => {
  const people = await request.get('/api/v1/participants');
  const { participants } = await people.json();
  const participantId = participants[0].id as string;
  await page.addInitScript(
    (id) => localStorage.setItem('lunch-roller.participant-id', id),
    participantId,
  );
  await page.route('**/api/v1/today', async (route) => {
    const actual = await route.fetch();
    const body: TodayResponse = await actual.json();
    await route.fulfill({
      json: {
        ...body,
        localDate: date,
        result: null,
        status: 'pending',
        wheel: { mode: 'upcoming', localDate: date },
        schedule: { ...body.schedule, time: '11:30' },
      },
    });
  });
});

test('shows the schedule, charts, coalitions and bet board without changing identity', async ({
  page,
  request,
}) => {
  const people = await request.get('/api/v1/participants');
  const participantId = (await people.json()).participants[0].id as string;
  const real = await request.get(`/api/v1/activity?date=${date}`, {
    headers: { 'X-Participant-Id': participantId },
  });
  expect(real.ok()).toBe(true);
  expect(await real.json()).toMatchObject({
    localDate: date,
    entries: expect.any(Array),
    bets: expect.any(Array),
  });
  expect(
    (
      await request.get('/api/v1/activity?date=2026-02-30', {
        headers: { 'X-Participant-Id': participantId },
      })
    ).status(),
  ).toBe(400);
  expect((await request.get('/api/v1/activity')).status()).toBe(401);

  const mutations: string[] = [];
  await page.route('**/api/v1/activity?*', (route) =>
    route.fulfill({ json: sample }),
  );
  await page.goto('/');
  await expect(page.getByTestId('wheel-target')).toHaveText(
    'Scheduled for Wednesday, 21 October at 11:30',
  );
  await page.getByRole('tab', { name: 'Daily activity' }).click();
  page.on('request', (request) => {
    if (request.method() !== 'GET') mutations.push(request.url());
  });
  const panel = page.getByRole('tabpanel', { name: 'Daily activity' });
  await expect(
    panel.getByRole('heading', { name: 'Activity room' }),
  ).toBeVisible();
  await expect(
    panel.getByRole('img', {
      name: 'Cumulative boost and anti-boost tokens spent',
    }),
  ).toBeVisible();
  await expect(panel.locator('.activity-summary')).toContainText('15');
  await expect(panel.locator('.activity-summary')).toContainText('5');
  await expect(panel.locator('.bet-board')).toContainText('Sushi');
  await expect(panel.locator('.bet-board')).toContainText('12 tokens');
  await expect(panel.locator('.bet-board')).toContainText('Open');
  const coalition = panel.locator('.activity-coalition-panel');
  await expect(coalition).toContainText('Alex');
  await expect(coalition).toContainText('Sam');
  await expect(coalition).toContainText('Morgan');
  await expect(coalition).toContainText('Sushi');
  await panel.getByLabel('Person', { exact: true }).selectOption(morgan);
  await expect(panel.locator('.activity-timeline li')).toHaveCount(2);
  await panel.getByLabel('Restaurant', { exact: true }).selectOption(sushi);
  await expect(panel.locator('.activity-timeline li')).toHaveCount(1);
  await expect(panel.locator('.activity-timeline')).toContainText(
    'Anti-boosted',
  );
  await page.screenshot({
    path: 'test-results/daily-activity-desktop.png',
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'test-results/daily-activity-dark-mobile.png',
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('tab', { name: 'Daily activity' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'The wheel' })).toBeFocused();
  await expect(page.getByTestId('lunch-wheel')).toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem('lunch-roller.participant-id'),
    ),
  ).toBe(participantId);
  expect(mutations).toEqual([]);
});

test('retries failures and rejects a delayed response for a previous date', async ({
  page,
}) => {
  let fail = true;
  let release: (() => void) | undefined;
  let delay = false;
  await page.route('**/api/v1/activity?*', async (route) => {
    const selected = new URL(route.request().url()).searchParams.get('date')!;
    if (fail) return route.fulfill({ status: 503, json: {} });
    if (delay && selected === '2026-10-20')
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    await route
      .fulfill({
        json:
          selected === date
            ? sample
            : {
                localDate: selected,
                timezone: sample.timezone,
                entries: [],
                bets: [],
              },
      })
      .catch(() => {});
  });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Daily activity' }).click();
  const panel = page.getByRole('tabpanel', { name: 'Daily activity' });
  await expect(panel.getByRole('alert')).toBeVisible();
  fail = false;
  await panel.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(panel.locator('.bet-board')).toContainText('Sushi');
  delay = true;
  await panel.getByLabel('Activity date').fill('2026-10-20');
  await expect.poll(() => Boolean(release)).toBe(true);
  await panel.getByLabel('Activity date').fill('2026-10-19');
  await expect(
    panel.getByText('No bets are recorded for this draw date.'),
  ).toBeVisible();
  release?.();
  await expect(panel.getByLabel('Activity date')).toHaveValue('2026-10-19');
  await expect(panel.locator('.bet-board')).toHaveCount(0);
});
