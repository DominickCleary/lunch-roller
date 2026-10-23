import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type {
  DailyActivityResponse,
  TodayResponse,
  TokenOverviewResponse,
} from '@lunch/contracts';

const date = '2026-10-21';
const alex = randomUUID();
const sam = randomUUID();
const morgan = randomUUID();
const sushi = randomUUID();
const pizza = randomUUID();
const sample: DailyActivityResponse = {
  localDate: date,
  timezone: 'Europe/Dublin',
  healthBonuses: [
    {
      drawId: randomUUID(),
      placeName: 'Pizza',
      drawnAt: `${date}T11:30:00.000Z`,
      bonus: {
        multiplier: 1.25,
        places: [
          {
            placeId: sushi,
            name: 'Sushi',
            probabilityBefore: 0.4,
            probabilityAfter: 0.454545,
          },
        ],
      },
    },
  ],
  entries: [
    [alex, 'Alex', sushi, 'Sushi', 'boost', 5, '08:00'],
    [sam, 'Sam', sushi, 'Sushi', 'boost', 5, '09:00'],
    [morgan, 'Morgan', sushi, 'Sushi', 'reduce', 5, '10:00'],
    [morgan, 'Morgan', pizza, 'Pizza', 'boost', 5, '11:00'],
    [alex, 'Alex', pizza, 'Pizza', 'boost', 5, '11:30'],
    [alex, 'Alex', pizza, 'Pizza', 'boost-refund', 5, '11:45'],
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
      currentProbability: 0.25,
      estimatedWinPayout: 48,
      updatedAt: `${date}T10:30:00.000Z`,
      settledAt: null,
    },
  ],
  positions: [
    {
      participantId: alex,
      participantName: 'Alex',
      placeId: sushi,
      placeName: 'Sushi',
      boosts: 1,
      reductions: 0,
      boostTokens: 5,
      reductionTokens: 0,
      status: 'staged',
    },
    {
      participantId: sam,
      participantName: 'Sam',
      placeId: sushi,
      placeName: 'Sushi',
      boosts: 1,
      reductions: 0,
      boostTokens: 5,
      reductionTokens: 0,
      status: 'staged',
    },
    {
      participantId: morgan,
      participantName: 'Morgan',
      placeId: sushi,
      placeName: 'Sushi',
      boosts: 0,
      reductions: 1,
      boostTokens: 0,
      reductionTokens: 5,
      status: 'staged',
    },
    {
      participantId: morgan,
      participantName: 'Morgan',
      placeId: pizza,
      placeName: 'Pizza',
      boosts: 1,
      reductions: 0,
      boostTokens: 5,
      reductionTokens: 0,
      status: 'staged',
    },
  ],
};
const tokenOverview: TokenOverviewResponse = {
  localDate: date,
  spinLocalDate: date,
  timezone: 'Europe/Dublin',
  rows: [
    {
      participantId: alex,
      participantName: 'Alex',
      balance: 40,
      totalBalance: 50,
      rank: 1,
      todayDelta: 10,
      spinDelta: 5,
    },
    {
      participantId: sam,
      participantName: 'Sam',
      balance: 26,
      totalBalance: 50,
      rank: 1,
      todayDelta: -2,
      spinDelta: -2,
    },
    {
      participantId: morgan,
      participantName: 'Morgan',
      balance: 20,
      totalBalance: 20,
      rank: 3,
      todayDelta: 0,
      spinDelta: 0,
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
  await page.route('**/api/v1/token-overview', (route) =>
    route.fulfill({ json: tokenOverview }),
  );
  await page.route('**/api/v1/bets/current', async (route) => {
    const actual = await route.fetch();
    const body = await actual.json();
    await route.fulfill({
      json: { ...body, window: { ...body.window, localDate: date } },
    });
  });
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

test('groups activity by spin date including earlier purchases', async ({
  page,
}) => {
  const nextDate = '2026-10-22';
  const morningPurchase = {
    ...sample.entries[0]!,
    id: randomUUID(),
    createdAt: `${date}T13:26:14Z`,
    influenceLocalDate: undefined,
    inferredDrawLocalDate: nextDate,
  };
  await page.route('**/api/v1/bets/current', async (route) => {
    const actual = await route.fetch();
    const body = await actual.json();
    await route.fulfill({
      json: { ...body, window: { ...body.window, localDate: nextDate } },
    });
  });
  await page.route('**/api/v1/activity?*', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const selected = params.get('date')!;
    const scope = params.get('scope');
    const actions = sample.entries.map((entry, index) => ({
      ...entry,
      influenceLocalDate: nextDate,
      createdAt: index < 2 ? `${date}T20:00:00Z` : `${nextDate}T08:00:00Z`,
    }));
    await route.fulfill({
      json: {
        ...sample,
        localDate: selected,
        entries:
          scope === 'draw'
            ? selected === nextDate
              ? [...actions, morningPurchase]
              : []
            : [...actions, morningPurchase].filter((entry) =>
                entry.createdAt.startsWith(selected),
              ),
        healthBonuses: selected === date ? sample.healthBonuses : [],
        positions: selected === nextDate ? sample.positions : [],
        bets:
          selected === nextDate
            ? sample.bets.map((bet) => ({ ...bet, localDate: nextDate }))
            : [],
      },
    });
  });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Activity' }).click();
  const panel = page.getByRole('tabpanel', { name: 'Activity' });
  await expect(panel.getByLabel('View', { exact: true })).toHaveCount(0);
  await expect(panel.getByLabel('Spin date')).toHaveValue(nextDate);
  await expect(
    panel.getByRole('heading', { name: /Activity for spin dated/ }),
  ).toBeVisible();
  const board = panel.locator('.bet-board-panel');
  await expect(board).toContainText(`draw dated ${nextDate}`);
  await expect(board.locator('.bet-board')).toContainText('12 tokens');
  await expect(board.locator('.bet-board')).toContainText('Open');
  await expect(board.locator('.bet-board')).toContainText('3/1 · 25.0%');
  await expect(board.locator('.bet-board')).toContainText('48 tokens');
  await expect(panel.locator('.activity-timeline li')).toHaveCount(5);
  await expect(panel.locator('.activity-trend-chart')).toContainText('21 Oct');
  await expect(panel.locator('.activity-trend-chart')).toContainText('22 Oct');
  await panel
    .getByRole('button', { name: 'Today’s spin', exact: true })
    .click();
  await expect(panel.getByLabel('Spin date')).toHaveValue(date);
  await expect(board).toContainText(`draw dated ${date}`);
  await expect(board.locator('.bet-board')).toHaveCount(0);
  await expect(panel.locator('.activity-timeline li')).toHaveCount(0);
  await panel
    .getByRole('button', { name: `Next spin · ${nextDate}`, exact: true })
    .click();
  await expect(panel.getByLabel('Spin date')).toHaveValue(nextDate);
  await expect(board.locator('.bet-board')).toContainText('12 tokens');
});

test('labels historical boosts without inventing draw positions', async ({
  page,
}) => {
  await page.route('**/api/v1/activity?*', (route) =>
    route.fulfill({
      json: { ...sample, positions: [], bets: [], healthBonuses: [] },
    }),
  );
  await page.goto('/');
  await page.getByRole('tab', { name: 'Activity' }).click();
  const panel = page.getByRole('tabpanel', { name: 'Activity' });
  await expect(panel.locator('.activity-timeline li')).toHaveCount(4);
  await expect(
    panel.getByText('Historical purchase · draw date not recorded', {
      exact: true,
    }),
  ).toHaveCount(4);
  await expect(
    panel.getByText('date is inferred from draw timing', { exact: false }),
  ).toBeVisible();
  await expect(
    panel.getByRole('region', { name: 'Draw influence positions' }),
  ).not.toContainText('↑ 2');
  await expect(
    panel.getByText('Historical purchase · draw date not recorded', {
      exact: true,
    }),
  ).toHaveCount(4);
});

test('pauses wheel purchases and bets after the roll and reopens after the configured delay', async ({
  page,
  request,
}) => {
  const opensAt = `${date}T14:00:00.000Z`;
  let reopened = false;
  const body: TodayResponse = await (await request.get('/api/v1/today')).json();
  const roster = await (await request.get('/api/v1/participants')).json();
  const auditHeaders = { 'X-Participant-Id': roster.participants[0].id };
  const drawId = randomUUID();
  await page.clock.install({ time: new Date(`${date}T13:59:59Z`) });
  await page.route('**/api/v1/today', async (route) => {
    const winner = body.odds[0]!;
    await route.fulfill({
      json: {
        ...body,
        serverTime: reopened ? opensAt : `${date}T13:59:59.000Z`,
        localDate: date,
        preferences: {
          ...body.preferences,
          wheelSwitchTime: '18:00',
          postDrawDelayMinutes: 210,
        },
        status: 'drawn',
        wheel: {
          mode: 'result',
          localDate: date,
        },
        result: {
          id: drawId,
          localDate: date,
          placeId: winner.placeId,
          placeName: winner.name,
          drawnAt: `${date}T10:30:00Z`,
          timezone: 'Europe/Dublin',
          snapshot: body.odds.map((row) => ({ ...row, logWeight: 0 })),
        },
      },
    });
  });
  for (const path of ['bets/current', 'influence/current']) {
    const marketBody = await (
      await request.get(`/api/v1/${path}`, { headers: auditHeaders })
    ).json();
    await page.route(`**/api/v1/${path}`, async (route) => {
      await route.fulfill({
        json: {
          ...marketBody,
          window: {
            ...marketBody.window,
            localDate: '2026-10-22',
            opensAt,
            open: reopened,
            cutoffLocalDate: '2026-10-22',
            cutoffAt: '2026-10-22T10:25:00Z',
          },
        },
      });
    });
  }
  await page.goto('/');
  await expect(
    page
      .getByText('Wheel activity reopens at 15:00 (Europe/Dublin).', {
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^Boost / }).first(),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: /^Reduce / }).first(),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: /^Banish / }).first(),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Add place', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Place bet', exact: true }),
  ).toBeDisabled();
  reopened = true;
  await page.clock.fastForward(1000);
  await expect(
    page.getByRole('button', { name: /^Banish / }).first(),
  ).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Add place', exact: true }),
  ).toBeEnabled();
  // A zero wallet may still prevent boosting, but its timing lock has lifted.
  await expect(
    page.getByRole('button', { name: /^Boost / }).first(),
  ).not.toHaveAttribute('title', /Opens at/);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
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
  const overview = await request.get('/api/v1/token-overview', {
    headers: { 'X-Participant-Id': participantId },
  });
  expect(overview.ok()).toBe(true);
  expect(await overview.json()).toMatchObject({
    localDate: expect.any(String),
    rows: expect.arrayContaining([
      expect.objectContaining({
        participantId,
        participantName: expect.any(String),
        balance: expect.any(Number),
        todayDelta: expect.any(Number),
        spinDelta: expect.any(Number),
      }),
    ]),
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
  await page.getByRole('tab', { name: 'Activity' }).click();
  page.on('request', (request) => {
    if (request.method() !== 'GET') mutations.push(request.url());
  });
  const panel = page.getByRole('tabpanel', { name: 'Activity' });
  await page.getByRole('tab', { name: 'Token standings' }).click();
  const standings = page.getByRole('tabpanel', { name: 'Token standings' });
  await expect(
    standings.getByRole('heading', { name: 'Token standings' }),
  ).toBeVisible();
  await expect(standings.locator('.token-overview-table tbody tr')).toHaveCount(
    3,
  );
  await expect(
    standings.getByRole('columnheader', { name: 'Total', exact: true }),
  ).toBeVisible();
  await expect(
    standings.getByRole('columnheader', { name: 'Uncommitted', exact: true }),
  ).toBeVisible();
  await expect(
    standings.getByRole('columnheader', { name: 'This spin', exact: true }),
  ).toBeVisible();
  await expect(
    standings.getByRole('columnheader', { name: 'Today', exact: true }),
  ).toBeVisible();
  await expect(standings).toContainText(`Spin dated ${date}`);
  const standingsRows = standings.locator('.token-overview-table tbody tr');
  await expect(standingsRows.locator('th')).toHaveText(['1', '1', '3']);
  await expect(standings.getByLabel('Gained 10 tokens today')).toBeVisible();
  await expect(standingsRows.nth(0).locator('td')).toHaveText([
    'Alex',
    '50',
    '40',
    '↑ +10',
    '↑ +5',
  ]);
  await expect(standings.getByLabel('Lost 2 tokens today')).toBeVisible();
  await expect(standingsRows.nth(1).locator('td')).toHaveText([
    'Sam',
    '50',
    '26',
    '↓ −2',
    '↓ −2',
  ]);
  await expect(standings.locator('.token-overview-table')).toContainText(
    '↑ +5',
  );
  await expect(standings.locator('.token-overview-table')).toContainText(
    '↓ −2',
  );
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(
    panel.getByRole('heading', { name: /Activity for spin dated/ }),
  ).toBeVisible();
  await expect(
    panel.getByRole('img', {
      name: 'Cumulative boost and anti-boost tokens spent',
    }),
  ).toBeVisible();
  await expect(panel.locator('.activity-summary')).toContainText('20');
  await expect(panel.locator('.activity-summary')).toContainText('5');
  const healthBonus = panel.getByRole('region', {
    name: 'Automatic health bonus',
  });
  await expect(healthBonus).toContainText('Pizza was a Treat place');
  await expect(healthBonus).toContainText('×1.25');
  await expect(healthBonus).toContainText('40.0% → 45.5%');
  await expect(healthBonus).toContainText('No tokens spent.');
  const positions = panel.getByRole('region', {
    name: 'Draw influence positions',
  });
  await expect(positions).toContainText('Staged · editable');
  await expect(positions).toContainText('↑ 2');
  await expect(positions).toContainText('↓ 1');
  await positions.getByText('Who holds these positions?').click();
  await expect(positions).toContainText('Alex');
  await expect(positions).toContainText('Morgan');
  await expect(panel.locator('.bet-board-panel .bet-board')).toContainText(
    'Sushi',
  );
  await expect(panel.locator('.bet-board-panel .bet-board')).toContainText(
    '12 tokens',
  );
  await expect(panel.locator('.bet-board-panel .bet-board')).toContainText(
    'Open',
  );
  const coalition = panel.locator('.activity-coalition-panel');
  await expect(coalition).toContainText('Alex');
  await expect(coalition).toContainText('Sam');
  await expect(coalition).toContainText('Morgan');
  await expect(coalition).toContainText('Sushi');
  await expect(
    coalition.getByRole('cell', {
      name: 'Morgan at Sushi: 0 boost tokens, 5 anti-boost tokens',
    }),
  ).toBeVisible();
  await expect(
    coalition.getByRole('cell', {
      name: 'Alex at Pizza: no active position',
    }),
  ).toBeVisible();
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
  await page.getByRole('tab', { name: 'Activity' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByRole('tab', { name: 'Token standings' }),
  ).toBeFocused();
  await expect(
    page.getByRole('tabpanel', { name: 'Token standings' }),
  ).toBeVisible();
  await page.keyboard.press('ArrowRight');
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
  await page.getByRole('tab', { name: 'Activity' }).click();
  const panel = page.getByRole('tabpanel', { name: 'Activity' });
  await expect(panel.getByRole('alert')).toBeVisible();
  fail = false;
  await panel.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(panel.locator('.bet-board-panel .bet-board')).toContainText(
    'Sushi',
  );
  delay = true;
  await panel.getByLabel('Spin date').fill('2026-10-20');
  await expect.poll(() => Boolean(release)).toBe(true);
  await panel.getByLabel('Spin date').fill('2026-10-19');
  await expect(
    panel.getByText('No bets are recorded for this draw date.'),
  ).toBeVisible();
  release?.();
  await expect(panel.getByLabel('Spin date')).toHaveValue('2026-10-19');
  await expect(panel.locator('.bet-board-panel .bet-board')).toHaveCount(0);
});

test('standings refresh their spin date and change when the target advances', async ({
  page,
  request,
}) => {
  const today = await (await request.get('/api/v1/today')).json();
  const { participants } = await (
    await request.get('/api/v1/participants')
  ).json();
  const currentBets = await (
    await request.get('/api/v1/bets/current', {
      headers: { 'X-Participant-Id': participants[0].id },
    })
  ).json();
  // Keep unrelated polls immediate while advancing the standings polling clock.
  await page.route('**/api/v1/today', (route) =>
    route.fulfill({
      json: {
        ...today,
        localDate: date,
        result: null,
        status: 'pending',
        wheel: { mode: 'upcoming', localDate: date },
      },
    }),
  );
  await page.route('**/api/v1/bets/current', (route) =>
    route.fulfill({ json: currentBets }),
  );
  await page.clock.install();
  let advanced = false;
  await page.route('**/api/v1/token-overview', (route) =>
    route.fulfill({
      json: {
        ...tokenOverview,
        spinLocalDate: advanced ? '2026-10-22' : date,
        rows: tokenOverview.rows.map((row) => ({
          ...row,
          spinDelta: advanced ? 0 : row.spinDelta,
        })),
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('tab', { name: 'Token standings' }).click();
  const standings = page.getByRole('tabpanel', { name: 'Token standings' });
  await expect(standings).toContainText(`Spin dated ${date}`);
  await expect(
    standings.getByLabel('Gained 5 tokens for this spin'),
  ).toBeVisible();
  advanced = true;
  await page.clock.fastForward(30_000);
  await expect(standings).toContainText('Spin dated 2026-10-22');
  await expect(
    standings.getByLabel('No net token change for this spin'),
  ).toHaveCount(3);
  await expect(
    standings.locator('.token-overview-table tbody tr').nth(0).locator('td'),
  ).toHaveText(['Alex', '50', '40', '↑ +10', '—']);
  await page.unrouteAll({ behavior: 'wait' });
});
