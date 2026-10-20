import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { createDatabase, GameService } from '../../packages/db/src/index';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl)
  throw new Error(
    'Set TEST_DATABASE_URL to a disposable migrated and seeded database before running E2E tests.',
  );

const database = createDatabase(testDatabaseUrl);
const game = new GameService(database);
const suffix = randomUUID();
const participantIds: string[] = [];
const placeIds: string[] = [];
const drawIds: string[] = [];
let originalSchedule: Awaited<ReturnType<GameService['getSchedule']>>;
let originalWeights = new Map<string, number>();
let fixturePerson: Awaited<ReturnType<GameService['saveParticipant']>>;
let fixturePlace: Awaited<ReturnType<GameService['savePlace']>>;
let comparisonPlace: Awaited<ReturnType<GameService['savePlace']>>;
let fixtureDraw: Awaited<ReturnType<GameService['drawIfDue']>>;
const fixtureDate = '2188-03-02';
const nextDate = '2188-03-03';

test.beforeAll(async () => {
  originalSchedule = await game.getSchedule();
  fixturePerson = await game.saveParticipant({ name: `rollover-${suffix}` });
  participantIds.push(fixturePerson.id);
  fixturePlace = await game.savePlace({ name: `rollover-${suffix}` });
  placeIds.push(fixturePlace.id);
  comparisonPlace = await game.savePlace({
    name: `rollover-other-${suffix}`,
  });
  placeIds.push(comparisonPlace.id);
  originalWeights = new Map(
    (await game.listPlaces()).map((place) => [place.id, place.logWeight]),
  );
  await game.setSchedule({
    timezone: 'UTC',
    time: '00:00',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  });
  await game.correctTokens(
    {
      participantId: fixturePerson.id,
      delta: 5,
      reason: 'wheel rollover browser fixture',
    },
    `rollover-grant-${suffix}`,
  );
  fixtureDraw = await game.drawIfDue(new Date(`${fixtureDate}T12:00:00Z`));
  if (!fixtureDraw)
    throw new Error('Could not create the rollover draw fixture.');
  drawIds.push(fixtureDraw.id);
});

test.afterAll(async () => {
  try {
    if (originalSchedule)
      await database.client`
        UPDATE settings
        SET timezone = ${originalSchedule.timezone},
            spin_time = ${originalSchedule.time},
            weekdays = ${`{${originalSchedule.weekdays.join(',')}}`}::integer[]
        WHERE id = 1
      `;
    for (const [id, logWeight] of originalWeights)
      await database.client`
        UPDATE places SET log_weight = ${logWeight} WHERE id = ${id}::uuid
      `;
    if (drawIds.length) {
      await database.client`
        UPDATE notification_outbox
        SET sent_at = now(), locked_until = null, lease_token = null,
            last_error = 'wheel-rollover-test-cleanup'
        WHERE draw_id IN ${database.client(drawIds)} AND sent_at IS NULL
      `;
    }
    if (participantIds.length) {
      await database.client`
        DELETE FROM token_ledger
        WHERE participant_id IN ${database.client(participantIds)}
      `;
      await database.client`
        DELETE FROM attendance
        WHERE participant_id IN ${database.client(participantIds)}
      `;
    }
    if (drawIds.length) {
      await database.client`
        DELETE FROM notification_outbox
        WHERE draw_id IN ${database.client(drawIds)}
      `;
      await database.client`
        DELETE FROM draws WHERE id IN ${database.client(drawIds)}
      `;
    }
    if (placeIds.length)
      await database.client`
        DELETE FROM places WHERE id IN ${database.client(placeIds)}
      `;
    if (participantIds.length)
      await database.client`
        DELETE FROM participants
        WHERE id IN ${database.client(participantIds)}
      `;
  } finally {
    await database.close();
  }
});

function gradientEnds(gradient: string): number[] {
  const stops = [...gradient.matchAll(/([\d.]+)deg/g)].map((match) =>
    Number(match[1]),
  );
  return stops.filter((_stop, index) => index % 2 === 1);
}

async function wheelGradient(page: Page): Promise<string> {
  return page.getByTestId('lunch-wheel').evaluate((element) => {
    return getComputedStyle(element).backgroundImage;
  });
}

function expectGradientMatches(
  gradient: string,
  probabilities: readonly number[],
) {
  const actualEnds = gradientEnds(gradient);
  expect(actualEnds).toHaveLength(probabilities.length);
  let expectedEnd = 0;
  for (const [index, probability] of probabilities.entries()) {
    expectedEnd += probability * 360;
    expect(actualEnds[index]).toBeCloseTo(expectedEnd, 1);
  }
}

test('rolls the displayed wheel, keeps current odds live, and replays the saved result', async ({
  page,
}) => {
  if (!fixtureDraw)
    throw new Error('The rollover draw fixture was not created.');
  await page.clock.install();

  let mode: 'result' | 'upcoming' = 'result';
  await page.route('**/api/v1/today', async (route) => {
    const response = await route.fetch();
    const today = await response.json();
    const upcomingDate = mode === 'result' ? fixtureDate : nextDate;
    await route.fulfill({
      response,
      json: {
        ...today,
        localDate: fixtureDate,
        status: 'drawn',
        result: fixtureDraw,
        wheel: { mode, localDate: upcomingDate },
        odds: today.odds,
      },
    });
  });

  await page.goto('/');
  await expect(page.getByTestId('name-picker')).toBeVisible();
  await page
    .getByLabel('Your name')
    .selectOption({ label: fixturePerson.name });
  await page.getByRole('button', { name: 'Enter lunch wheel' }).click();
  await expect(page.getByTestId('lunch-wheel')).toBeVisible();
  await expect(page.getByTestId('wheel-target')).toHaveAttribute(
    'data-target-date',
    fixtureDate,
  );
  await expect(page.getByTestId('today-result')).toContainText(
    fixtureDraw.placeName,
  );

  const snapshotProbabilities = fixtureDraw.snapshot.map(
    (option) => option.probability,
  );
  const initialLiveOdds = await game.today(
    new Date(`${fixtureDate}T14:00:00Z`),
  );
  expect(snapshotProbabilities).not.toEqual(
    initialLiveOdds.odds.map((option) => option.probability),
  );
  const snapshotGradient = await wheelGradient(page);
  expectGradientMatches(snapshotGradient, snapshotProbabilities);

  mode = 'upcoming';
  await page.clock.fastForward(30_000);
  await expect(page.getByTestId('wheel-target')).toHaveAttribute(
    'data-target-date',
    nextDate,
  );
  await expect(page.getByTestId('lunch-wheel')).not.toHaveClass(
    /wheel-spinning/,
  );
  // A fresh afternoon load also uses upcoming odds without replaying the old
  // result automatically.
  await page.reload();
  await expect(page.getByTestId('wheel-target')).toHaveAttribute(
    'data-target-date',
    nextDate,
  );
  await expect(page.getByTestId('lunch-wheel')).not.toHaveClass(
    /wheel-spinning/,
  );
  const liveOddsBeforeBoost = await game.today(
    new Date(`${fixtureDate}T15:00:00Z`),
  );
  const placeOddsBeforeBoost = liveOddsBeforeBoost.odds.find(
    (option) => option.placeId === fixturePlace.id,
  )!.probability;
  const upcomingGradient = await wheelGradient(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: 'test-results/wheel-rollover-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/wheel-rollover-mobile.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(upcomingGradient).not.toBe(snapshotGradient);
  const liveProbabilities = liveOddsBeforeBoost.odds.map(
    (option) => option.probability,
  );
  expectGradientMatches(upcomingGradient, liveProbabilities);

  const fixtureOddsRow = page
    .locator('.odds-row')
    .filter({ hasText: fixturePlace.name });
  await fixtureOddsRow.getByTitle('Boost place (5 tokens)').click();
  await expect(
    page.getByText('Place boosted for the next draw.'),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const today = await game.today(new Date(`${fixtureDate}T15:00:00Z`));
      return today.odds.find((option) => option.placeId === fixturePlace.id)!
        .probability;
    })
    .toBeGreaterThan(placeOddsBeforeBoost);
  await expect
    .poll(async () => gradientEnds(await wheelGradient(page)).join(','))
    .not.toBe(gradientEnds(upcomingGradient).join(','));
  const boostedToday = await game.today(new Date(`${fixtureDate}T15:00:00Z`));
  expectGradientMatches(
    await wheelGradient(page),
    boostedToday.odds.map((option) => option.probability),
  );

  const replay = page.getByRole('button', { name: "Replay today's result" });
  await replay.click();
  await expect.poll(() => wheelGradient(page)).toBe(snapshotGradient);
  await page.clock.fastForward(5_000);
  await expect(replay).toBeEnabled({ timeout: 8000 });
  await expect(page.getByTestId('wheel-target')).toHaveAttribute(
    'data-target-date',
    nextDate,
  );
  expectGradientMatches(
    await wheelGradient(page),
    boostedToday.odds.map((option) => option.probability),
  );

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await replay.click();
  await expect.poll(() => wheelGradient(page)).toBe(snapshotGradient);
  await page.clock.fastForward(1_500);
  await expect(replay).toBeEnabled();
  await expect(page.getByTestId('wheel-target')).toHaveAttribute(
    'data-target-date',
    nextDate,
  );
  expectGradientEndsAfterReplay(await wheelGradient(page), boostedToday.odds);
});

function expectGradientEndsAfterReplay(
  gradient: string,
  odds: readonly { probability: number }[],
) {
  expectGradientMatches(
    gradient,
    odds.map((option) => option.probability),
  );
}
