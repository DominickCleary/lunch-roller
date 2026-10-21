import './env';
import { afterAll, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { createDatabase } from './index';
import { GameService } from './operations';
import {
  betRequests,
  bettingMarkets,
  bets,
  draws,
  notificationOutbox,
  participants,
  places,
  pushSubscriptions,
  settings,
  tokenLedger,
} from './schema';

const database = createDatabase();
const service = new GameService(database);
const [originalSettings] = await database.db
  .select()
  .from(settings)
  .where(eq(settings.id, 1));
const originalPlaces = await database.db.select().from(places);
const suffix = crypto.randomUUID();
const person = await service.saveParticipant({ name: `bet-${suffix}` });
const restaurant = await service.savePlace({ name: `bet-place-${suffix}` });
const betIds: string[] = [];
const marketIds: string[] = [];
const drawIds: string[] = [];
const subscriptionIds: string[] = [];

afterAll(async () => {
  try {
    await database.db
      .delete(tokenLedger)
      .where(eq(tokenLedger.participantId, person.id));
    await database.db
      .delete(betRequests)
      .where(eq(betRequests.participantId, person.id));
    if (betIds.length)
      await database.db.delete(bets).where(inArray(bets.id, betIds));
    if (marketIds.length)
      await database.db
        .delete(bettingMarkets)
        .where(inArray(bettingMarkets.id, marketIds));
    if (drawIds.length)
      await database.db
        .delete(notificationOutbox)
        .where(inArray(notificationOutbox.drawId, drawIds));
    if (subscriptionIds.length) {
      await database.db
        .delete(notificationOutbox)
        .where(inArray(notificationOutbox.subscriptionId, subscriptionIds));
      await database.db
        .delete(pushSubscriptions)
        .where(inArray(pushSubscriptions.id, subscriptionIds));
    }
    if (drawIds.length)
      await database.db.delete(draws).where(inArray(draws.id, drawIds));
    await database.db.delete(places).where(eq(places.id, restaurant.id));
    await database.db
      .delete(participants)
      .where(eq(participants.id, person.id));
    for (const place of originalPlaces)
      await database.db
        .update(places)
        .set({ active: place.active, logWeight: place.logWeight })
        .where(eq(places.id, place.id));
    if (originalSettings)
      await database.db
        .update(settings)
        .set({
          timezone: originalSettings.timezone,
          spinTime: originalSettings.spinTime,
          weekdays: originalSettings.weekdays,
          wheelSwitchTime: originalSettings.wheelSwitchTime,
          checkInPledge: originalSettings.checkInPledge,
          bettingCloseMinutes: originalSettings.bettingCloseMinutes,
          setupCompleted: originalSettings.setupCompleted,
          skipDrawDate: originalSettings.skipDrawDate,
        })
        .where(eq(settings.id, 1));
  } finally {
    await database.close();
  }
});

it('reserves, edits, cancels and settles a bet atomically at its saved cutoff and draw odds', async () => {
  await database.db
    .update(settings)
    .set({ setupCompleted: true })
    .where(eq(settings.id, 1));
  await service.setSchedule({
    timezone: 'UTC',
    time: '13:00',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  });
  await service.setPreferences({
    wheelSwitchTime: '15:00',
    checkInPledge: 'I followed the wheel',
    bettingCloseMinutes: 5,
  });
  for (const place of originalPlaces)
    await database.db
      .update(places)
      .set({ logWeight: -10000 })
      .where(eq(places.id, place.id));
  await database.db
    .update(places)
    .set({ logWeight: 0 })
    .where(eq(places.id, restaurant.id));
  const drawAt = new Date('2199-10-21T13:00:00.000Z');
  const beforeCutoff = new Date('2199-10-21T12:54:00.000Z');
  const market = await service.currentBets(person.id, beforeCutoff);
  expect(market.window).toMatchObject({
    localDate: '2199-10-21',
    cutoffLocalTime: '12:55',
    open: true,
  });
  const createdMarkets = await database.db
    .select()
    .from(bettingMarkets)
    .where(eq(bettingMarkets.localDate, market.window.localDate));
  marketIds.push(...createdMarkets.map((row) => row.id));
  const fundingKey = crypto.randomUUID();
  await service.correctTokens(
    {
      participantId: person.id,
      delta: 100,
      reason: 'fund bet integration test',
    },
    fundingKey,
  );

  const initialKey = crypto.randomUUID();
  const placed = await service.setBet(
    person.id,
    { localDate: market.window.localDate, placeId: restaurant.id, stake: 10 },
    initialKey,
    beforeCutoff,
  );
  betIds.push(placed.bet!.id);
  expect(placed.balance).toBe(90);
  expect(
    await service.setBet(
      person.id,
      { localDate: market.window.localDate, placeId: restaurant.id, stake: 10 },
      initialKey,
      beforeCutoff,
    ),
  ).toEqual(placed);

  const adjusted = await service.setBet(
    person.id,
    { localDate: market.window.localDate, placeId: restaurant.id, stake: 15 },
    crypto.randomUUID(),
    beforeCutoff,
  );
  expect(adjusted.balance).toBe(85);
  const cancelled = await service.cancelBet(
    person.id,
    { localDate: market.window.localDate },
    crypto.randomUUID(),
    beforeCutoff,
  );
  expect(cancelled).toMatchObject({ bet: null, balance: 100 });
  const replacement = await service.setBet(
    person.id,
    { localDate: market.window.localDate, placeId: restaurant.id, stake: 12 },
    crypto.randomUUID(),
    beforeCutoff,
  );
  expect(replacement.balance).toBe(88);
  const subscription = await service.subscribe(person.id, {
    endpoint: `https://fcm.googleapis.com/fcm/send/bet-win-${suffix}`,
    keys: { p256dh: 'E'.repeat(87), auth: 'F'.repeat(22) },
  });
  subscriptionIds.push(subscription.id);

  await expect(
    service.setBet(
      person.id,
      { localDate: market.window.localDate, placeId: restaurant.id, stake: 12 },
      crypto.randomUUID(),
      new Date('2199-10-21T12:55:00.000Z'),
    ),
  ).rejects.toMatchObject({ code: 'BETTING_CLOSED' });
  const draw = await service.drawIfDue(drawAt);
  if (draw) drawIds.push(draw.id);
  expect(draw?.placeId).toBe(restaurant.id);
  const settled = await database.db
    .select()
    .from(bets)
    .where(eq(bets.id, replacement.bet!.id));
  expect(settled[0]).toMatchObject({
    status: 'won',
    payout: 12,
    probability: 1,
  });
  const payoutNotifications = await database.db
    .select()
    .from(notificationOutbox)
    .where(
      eq(notificationOutbox.eventKey, `bet-payout:${replacement.bet!.id}`),
    );
  expect(payoutNotifications).toHaveLength(1);
  expect(payoutNotifications[0]).toMatchObject({
    subscriptionId: subscription.id,
    drawId: draw!.id,
    payload: {
      title: 'Your lunch bet won',
      body: `Your bet on ${restaurant.name} paid 12 tokens.`,
      tag: `lunch-bet-${replacement.bet!.id}`,
    },
  });
  expect((await service.wallet(person.id)).balance).toBe(100);
});

it('refunds unsettled stakes when the draw schedule changes or a participant is disabled', async () => {
  const schedule = {
    timezone: 'UTC',
    time: '13:00',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  };
  await service.setSchedule(schedule);
  const scheduleMarket = await service.currentBets(
    person.id,
    new Date('2199-10-22T12:54:00.000Z'),
  );
  const scheduleRows = await database.db
    .select()
    .from(bettingMarkets)
    .where(eq(bettingMarkets.localDate, scheduleMarket.window.localDate));
  marketIds.push(...scheduleRows.map((row) => row.id));
  const scheduleBet = await service.setBet(
    person.id,
    {
      localDate: scheduleMarket.window.localDate,
      placeId: restaurant.id,
      stake: 5,
    },
    crypto.randomUUID(),
    new Date('2199-10-22T12:54:00.000Z'),
  );
  betIds.push(scheduleBet.bet!.id);
  await service.setSchedule({ ...schedule, time: '13:30' });
  const refundedForSchedule = await database.db
    .select()
    .from(bets)
    .where(eq(bets.id, scheduleBet.bet!.id));
  expect(refundedForSchedule[0]?.status).toBe('refunded');
  expect((await service.wallet(person.id)).balance).toBe(100);

  const disabledMarket = await service.currentBets(
    person.id,
    new Date('2199-10-23T13:20:00.000Z'),
  );
  const disabledRows = await database.db
    .select()
    .from(bettingMarkets)
    .where(eq(bettingMarkets.localDate, disabledMarket.window.localDate));
  marketIds.push(...disabledRows.map((row) => row.id));
  const disabledBet = await service.setBet(
    person.id,
    {
      localDate: disabledMarket.window.localDate,
      placeId: restaurant.id,
      stake: 7,
    },
    crypto.randomUUID(),
    new Date('2199-10-23T13:20:00.000Z'),
  );
  betIds.push(disabledBet.bet!.id);
  await service.saveParticipant({ active: false }, person.id);
  await service.saveParticipant({ active: true }, person.id);
  const refundedForDisable = await database.db
    .select()
    .from(bets)
    .where(eq(bets.id, disabledBet.bet!.id));
  expect(refundedForDisable[0]?.status).toBe('refunded');
  expect((await service.wallet(person.id)).balance).toBe(100);
});

it('skips the selected roll once, refunds its market, and resumes the next roll', async () => {
  await service.setSchedule({
    timezone: 'UTC',
    time: '13:00',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  });
  const beforeDraw = new Date('2200-01-03T12:00:00.000Z');
  const current = await service.currentBets(person.id, beforeDraw);
  expect(current.window.localDate).toBe('2200-01-03');
  const marketRows = await database.db
    .select()
    .from(bettingMarkets)
    .where(eq(bettingMarkets.localDate, current.window.localDate));
  marketIds.push(...marketRows.map((row) => row.id));
  const bet = await service.setBet(
    person.id,
    {
      localDate: current.window.localDate,
      placeId: restaurant.id,
      stake: 7,
    },
    crypto.randomUUID(),
    beforeDraw,
  );
  betIds.push(bet.bet!.id);

  expect(await service.setDrawSkip(true, beforeDraw)).toEqual({
    localDate: '2200-01-03',
    cancellable: true,
  });
  const refunded = await database.db
    .select()
    .from(bets)
    .where(eq(bets.id, bet.bet!.id));
  expect(refunded[0]?.status).toBe('refunded');
  expect((await service.wallet(person.id)).balance).toBe(100);
  const nextMarket = await service.currentBets(person.id, beforeDraw);
  expect(nextMarket.window.localDate).toBe('2200-01-04');
  const nextMarketRows = await database.db
    .select()
    .from(bettingMarkets)
    .where(eq(bettingMarkets.localDate, nextMarket.window.localDate));
  marketIds.push(...nextMarketRows.map((row) => row.id));

  const skippedAt = new Date('2200-01-03T13:00:00.000Z');
  expect(await service.drawIfDue(skippedAt)).toBeNull();
  expect((await service.today(skippedAt)).status).toBe('skipped');
  expect((await service.today(skippedAt)).wheel.localDate).toBe('2200-01-04');
  await expect(service.setDrawSkip(false, skippedAt)).rejects.toMatchObject({
    code: 'DRAW_SKIP_NOT_CANCELLABLE',
  });

  const next = await service.drawIfDue(new Date('2200-01-04T13:00:00.000Z'));
  if (next) drawIds.push(next.id);
  expect(next?.localDate).toBe('2200-01-04');
});
