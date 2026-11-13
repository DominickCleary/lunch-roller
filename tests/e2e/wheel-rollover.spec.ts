import { randomUUID } from 'node:crypto'
import { expect, type Page, test } from '@playwright/test'
import { createDatabase, GameService } from '../../packages/db/src/index'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
if (!testDatabaseUrl)
  throw new Error(
    'Set TEST_DATABASE_URL to a disposable migrated and seeded database before running E2E tests.',
  )

const database = createDatabase(testDatabaseUrl)
const game = new GameService(database)
const suffix = randomUUID()
const participantIds: string[] = []
const placeIds: string[] = []
const drawIds: string[] = []
let originalSchedule: Awaited<ReturnType<GameService['getSchedule']>>
let originalWeights = new Map<string, number>()
let fixturePerson: Awaited<ReturnType<GameService['saveParticipant']>>
let fixturePlace: Awaited<ReturnType<GameService['savePlace']>>
let comparisonPlace: Awaited<ReturnType<GameService['savePlace']>>
let fixtureDraw: Awaited<ReturnType<GameService['drawIfDue']>>
const fixtureDate = '2188-03-02'
const nextDate = '2188-03-03'

test.beforeAll(async () => {
  originalSchedule = await game.getSchedule()
  fixturePerson = await game.saveParticipant({ name: `rollover-${suffix}` })
  participantIds.push(fixturePerson.id)
  fixturePlace = await game.savePlace({ name: `rollover-${suffix}` })
  placeIds.push(fixturePlace.id)
  comparisonPlace = await game.savePlace({
    name: `rollover-other-${suffix}`,
  })
  placeIds.push(comparisonPlace.id)
  originalWeights = new Map(
    (await game.listPlaces()).map((place) => [place.id, place.logWeight]),
  )
  await game.setSchedule({
    timezone: 'UTC',
    time: '00:00',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  })
  await game.correctTokens(
    {
      participantId: fixturePerson.id,
      delta: 5,
      reason: 'wheel rollover browser fixture',
    },
    `rollover-grant-${suffix}`,
  )
  fixtureDraw = await game.drawIfDue(new Date(`${fixtureDate}T12:00:00Z`))
  if (!fixtureDraw)
    throw new Error('Could not create the rollover draw fixture.')
  drawIds.push(fixtureDraw.id)
  // Purchases now share the betting cutoff. Keep the live browser market open
  // independently of the historical draw used for the replay fixture.
  await game.setSchedule({
    timezone: 'UTC',
    time: '23:59',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  })
})

test.afterAll(async () => {
  try {
    if (originalSchedule)
      await database.client`
        UPDATE settings
        SET timezone = ${originalSchedule.timezone},
            spin_time = ${originalSchedule.time},
            weekdays = ${`{${originalSchedule.weekdays.join(',')}}`}::integer[]
        WHERE id = 1
      `
    for (const [id, logWeight] of originalWeights)
      await database.client`
        UPDATE places SET log_weight = ${logWeight}, active = true WHERE id = ${id}::uuid
      `
    if (drawIds.length) {
      await database.client`
        UPDATE notification_outbox
        SET sent_at = now(), locked_until = null, lease_token = null,
            last_error = 'wheel-rollover-test-cleanup'
        WHERE draw_id IN ${database.client(drawIds)} AND sent_at IS NULL
      `
    }
    if (participantIds.length) {
      await database.client`
        DELETE FROM influence_lots
        WHERE participant_id IN ${database.client(participantIds)}
      `
      await database.client`
        DELETE FROM token_ledger
        WHERE participant_id IN ${database.client(participantIds)}
      `
      await database.client`
        DELETE FROM attendance
        WHERE participant_id IN ${database.client(participantIds)}
      `
    }
    if (drawIds.length) {
      await database.client`
        DELETE FROM notification_outbox
        WHERE draw_id IN ${database.client(drawIds)}
      `
      await database.client`
        DELETE FROM draws WHERE id IN ${database.client(drawIds)}
      `
    }
    if (placeIds.length)
      await database.client`
        DELETE FROM places WHERE id IN ${database.client(placeIds)}
      `
    if (participantIds.length)
      await database.client`
        DELETE FROM participants
        WHERE id IN ${database.client(participantIds)}
      `
  } finally {
    await database.close()
  }
})

function gradientEnds(gradient: string): number[] {
  const stops = [...gradient.matchAll(/([\d.]+)deg/g)].map((match) =>
    Number(match[1]),
  )
  return stops.filter((_stop, index) => index % 2 === 1)
}

async function wheelGradient(page: Page): Promise<string> {
  return page.getByTestId('lunch-wheel').evaluate((element) => {
    return getComputedStyle(element).backgroundImage
  })
}

function expectGradientMatches(
  gradient: string,
  probabilities: readonly number[],
) {
  const actualEnds = gradientEnds(gradient)
  expect(actualEnds).toHaveLength(probabilities.length)
  let expectedEnd = 0
  for (const [index, probability] of probabilities.entries()) {
    expectedEnd += probability * 360
    expect(actualEnds[index]).toBeCloseTo(expectedEnd, 1)
  }
}

async function expectLiveWheel(
  page: Page,
  odds: readonly { placeId: string; probability: number }[],
  winnerId?: string,
) {
  await expect
    .poll(async () =>
      gradientEnds(await wheelGradient(page)).map((n) => n.toFixed(1)),
    )
    .toEqual(
      odds.map((_, index) =>
        (
          odds
            .slice(0, index + 1)
            .reduce((sum, option) => sum + option.probability, 0) * 360
        ).toFixed(1),
      ),
    )
  const winnerIndex = odds.findIndex((option) => option.placeId === winnerId)
  let expectedRotation = 0
  const winner = odds[winnerIndex]
  if (winner) {
    const before = odds
      .slice(0, winnerIndex)
      .reduce((sum, option) => sum + option.probability, 0)
    expectedRotation =
      (((90 - (before + winner.probability / 2) * 360) % 360) + 360) % 360
  }
  await expect
    .poll(() =>
      page
        .getByTestId('lunch-wheel')
        .evaluate((element) =>
          Number.parseFloat((element as HTMLElement).style.transform.slice(7)),
        ),
    )
    .toBeCloseTo(expectedRotation, 2)
}

test('keeps live slices updated with the current winner under the arrow and replays the saved result', async ({
  page,
}) => {
  if (!fixtureDraw)
    throw new Error('The rollover draw fixture was not created.')
  await page.clock.install()

  let mode: 'result' | 'upcoming' = 'result'
  let displayDate = fixtureDate
  await page.route('**/api/v1/today', async (route) => {
    const response = await route.fetch()
    const today = await response.json()
    await route.fulfill({
      response,
      json: {
        ...today,
        localDate: displayDate,
        status: mode === 'result' ? 'drawn' : 'pending',
        result: mode === 'result' ? fixtureDraw : null,
        wheel: { mode, localDate: displayDate },
        odds: today.odds,
      },
    })
  })

  await page.goto('/')
  await expect(page.getByTestId('name-picker')).toBeVisible()
  await page.getByLabel('Your name').selectOption({ label: fixturePerson.name })
  await page.getByRole('button', { name: 'Enter lunch wheel' }).click()
  await expect(page.getByTestId('lunch-wheel')).toBeVisible()
  await expect(page.getByTestId('wheel-target')).toHaveAttribute(
    'data-target-date',
    fixtureDate,
  )
  await expect(page.getByTestId('today-result')).toHaveCount(0)

  const snapshotProbabilities = fixtureDraw.snapshot.map(
    (option) => option.probability,
  )
  const initialLiveOdds = await game.today(new Date(`${fixtureDate}T14:00:00Z`))
  expect(snapshotProbabilities).not.toEqual(
    initialLiveOdds.odds.map((option) => option.probability),
  )
  const initialGradient = await wheelGradient(page)
  expectGradientMatches(
    initialGradient,
    initialLiveOdds.odds.map((option) => option.probability),
  )
  await expectLiveWheel(page, initialLiveOdds.odds, fixtureDraw.placeId)

  await page.clock.fastForward(30_000)
  await expect(page.getByTestId('wheel-target')).toHaveAttribute(
    'data-target-date',
    fixtureDate,
  )
  await expect(page.getByTestId('lunch-wheel')).not.toHaveClass(
    /wheel-spinning/,
  )
  // Reload retains live sizes and the winner under the arrow without replaying.
  await page.reload()
  await expect(page.getByTestId('wheel-target')).toHaveAttribute(
    'data-target-date',
    fixtureDate,
  )
  await expect(page.getByTestId('lunch-wheel')).not.toHaveClass(
    /wheel-spinning/,
  )
  const liveOddsBeforeBoost = await game.today(
    new Date(`${fixtureDate}T15:00:00Z`),
  )
  const placeOddsBeforeBoost = liveOddsBeforeBoost.odds.find(
    (option) => option.placeId === fixturePlace.id,
  )!.probability
  const savedResultGradient = await wheelGradient(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({
    path: 'test-results/wheel-rollover-desktop.png',
    fullPage: true,
  })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: 'test-results/wheel-rollover-mobile.png',
    fullPage: true,
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  expect(savedResultGradient).toBe(initialGradient)
  await expectLiveWheel(page, liveOddsBeforeBoost.odds, fixtureDraw.placeId)

  const fixtureOddsRow = page
    .locator('.odds-row')
    .filter({ hasText: fixturePlace.name })
  await fixtureOddsRow
    .getByRole('button', { name: `Boost ${fixturePlace.name}` })
    .click()
  await expect(page.getByText('Boost staged for the next draw.')).toBeVisible()
  await expect
    .poll(async () => {
      const today = await game.today(new Date(`${fixtureDate}T15:00:00Z`))
      return today.odds.find((option) => option.placeId === fixturePlace.id)!
        .probability
    })
    .toBeGreaterThan(placeOddsBeforeBoost)
  const boostedToday = await game.today(new Date(`${fixtureDate}T15:00:00Z`))
  await expectLiveWheel(page, boostedToday.odds, fixtureDraw.placeId)
  expect(boostedToday.odds.map((option) => option.probability)).not.toEqual(
    snapshotProbabilities,
  )

  const replay = page.getByRole('button', { name: "Replay today's result" })
  await replay.click()
  await expect
    .poll(async () =>
      gradientEnds(await wheelGradient(page)).map((n) => n.toFixed(1)),
    )
    .toEqual(
      snapshotProbabilities.map((_, index) =>
        (
          snapshotProbabilities
            .slice(0, index + 1)
            .reduce((sum, p) => sum + p, 0) * 360
        ).toFixed(1),
      ),
    )
  await page.clock.fastForward(25_000)
  const celebration = page.getByRole('dialog', {
    name: 'The Wheel has spoken',
  })
  await expect(celebration).toBeVisible()
  await expect(celebration).toContainText(fixtureDraw.placeName)
  await expect(celebration).toHaveAccessibleDescription(
    `${fixtureDraw.placeName} has been chosen.`,
  )
  expectGradientMatches(await wheelGradient(page), snapshotProbabilities)
  await expect(replay).toBeDisabled()
  await expect(
    celebration.getByRole('button', { name: 'Praise the Wheel' }),
  ).toBeFocused()
  const desktopModal = (await celebration.boundingBox())!
  expect(Math.abs(desktopModal.x + desktopModal.width / 2 - 720)).toBeLessThan(
    2,
  )
  expect(Math.abs(desktopModal.y + desktopModal.height / 2 - 500)).toBeLessThan(
    2,
  )
  await expect(page.locator('.winner-confetti i')).toHaveCount(60)
  await expect(page.locator('.winner-confetti i').first()).toHaveCSS(
    'animation-name',
    'winner-confetti-fall',
  )
  await page.clock.runFor(700)
  await page.screenshot({ path: '/tmp/lunch-winner-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  const mobileModal = (await celebration.boundingBox())!
  expect(Math.abs(mobileModal.x + mobileModal.width / 2 - 195)).toBeLessThan(2)
  expect(Math.abs(mobileModal.y + mobileModal.height / 2 - 422)).toBeLessThan(2)
  await page.screenshot({ path: '/tmp/lunch-winner-mobile.png' })
  // Polling and elapsed time must keep the saved result behind the modal.
  await page.clock.fastForward(30_000)
  expectGradientMatches(await wheelGradient(page), snapshotProbabilities)
  await celebration.getByRole('button', { name: 'Praise the Wheel' }).click()
  await expect(replay).toBeEnabled({ timeout: 8000 })
  await expect(page.getByTestId('wheel-target')).toHaveAttribute(
    'data-target-date',
    fixtureDate,
  )
  await expectLiveWheel(page, boostedToday.odds, fixtureDraw.placeId)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await replay.click()
  await expect
    .poll(async () =>
      gradientEnds(await wheelGradient(page)).map((n) => n.toFixed(1)),
    )
    .toEqual(
      snapshotProbabilities.map((_, index) =>
        (
          snapshotProbabilities
            .slice(0, index + 1)
            .reduce((sum, p) => sum + p, 0) * 360
        ).toFixed(1),
      ),
    )
  await page.clock.fastForward(1_500)
  await expect(celebration).toBeVisible()
  expectGradientMatches(await wheelGradient(page), snapshotProbabilities)
  await page.keyboard.press('Escape')
  await expect(replay).toBeEnabled()
  await expect(page.getByTestId('wheel-target')).toHaveAttribute(
    'data-target-date',
    fixtureDate,
  )
  await expectLiveWheel(page, boostedToday.odds, fixtureDraw.placeId)

  const added = await game.savePlace({ name: `rollover-new-${suffix}` })
  placeIds.push(added.id)
  await page.reload()
  const afterAddition = await game.today(new Date(`${fixtureDate}T15:00:00Z`))
  await expectLiveWheel(page, afterAddition.odds, fixtureDraw.placeId)
  await expect(
    page
      .getByTestId('lunch-wheel')
      .locator('.wheel-label', { hasText: added.name.slice(0, 13) }),
  ).toBeVisible()

  // Removed winners must leave the live wheel rather than freezing its snapshot.
  await game.savePlace({ active: false }, fixtureDraw.placeId)
  await page.reload()
  const afterRemoval = await game.today(new Date(`${fixtureDate}T15:00:00Z`))
  expect(afterRemoval.odds.map((option) => option.placeId)).not.toContain(
    fixtureDraw.placeId,
  )
  await expectLiveWheel(page, afterRemoval.odds)

  await game.savePlace({ active: true }, fixtureDraw.placeId)
  await page.reload()
  const afterRestore = await game.today(new Date(`${fixtureDate}T15:00:00Z`))
  await expectLiveWheel(page, afterRestore.odds, fixtureDraw.placeId)

  // The next local day continues showing live odds at the neutral angle.
  mode = 'upcoming'
  displayDate = nextDate
  await page.reload()
  await expect(page.getByTestId('wheel-target')).toHaveAttribute(
    'data-target-date',
    nextDate,
  )
  await expectLiveWheel(page, afterRestore.odds)
})
