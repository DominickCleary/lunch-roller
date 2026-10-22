import './env';
import { afterAll, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { createDatabase } from './index';
import { GameService } from './operations';
import {
  attendance,
  draws,
  participants,
  places,
  settings,
  tokenLedger,
} from './schema';

const database = createDatabase();
const service = new GameService(database);
const originalSchedule = await service.getSchedule();
const originalPreferences = await service.getPreferences();
const originalWeights = await service.listPlaces(true);
const fixturePrefix = `preferences-${crypto.randomUUID()}`;
const first = await service.saveParticipant({ name: `${fixturePrefix}-first` });
const second = await service.saveParticipant({
  name: `${fixturePrefix}-second`,
});
const participantIds = [first.id, second.id];
const drawIds: string[] = [];

function remember<T extends { id: string } | null>(draw: T): T {
  if (draw) drawIds.push(draw.id);
  return draw;
}

afterAll(async () => {
  try {
    for (const place of originalWeights)
      await database.db
        .update(places)
        .set({ logWeight: place.logWeight })
        .where(eq(places.id, place.id));
    await database.db
      .update(settings)
      .set({
        timezone: originalSchedule.timezone,
        spinTime: originalSchedule.time,
        weekdays: originalSchedule.weekdays,
        ...originalPreferences,
        checkInPledge: originalPreferences.checkInPledge,
      })
      .where(eq(settings.id, 1));
    await database.db
      .delete(tokenLedger)
      .where(inArray(tokenLedger.participantId, participantIds));
    await database.db
      .delete(attendance)
      .where(inArray(attendance.participantId, participantIds));
    if (drawIds.length)
      await database.db.delete(draws).where(inArray(draws.id, drawIds));
    await database.db
      .delete(participants)
      .where(inArray(participants.id, participantIds));
  } finally {
    await database.close();
  }
});

it('persists validated preferences and reports authoritative check-in status per person and draw', async () => {
  const schedule = {
    timezone: 'UTC',
    time: '00:00',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  };
  await service.setSchedule(schedule);

  const configured = await service.setPreferences({
    wheelSwitchTime: '23:59',
    checkInPledge: '  I followed the wheel today.  ',
    bettingCloseMinutes: 5,
  });
  expect(configured).toEqual({
    postDrawDelayMinutes: 0,
    wheelSpinSeconds: 20,
    wheelSwitchTime: '23:59',
    checkInPledge: 'I followed the wheel today.',
    bettingCloseMinutes: 5,
  });
  expect(await service.getPreferences()).toEqual(configured);
  expect(
    (await service.today(new Date('2199-07-22T15:00:00Z'))).preferences,
  ).toEqual(configured);
  await expect(
    service.setPreferences({
      wheelSwitchTime: '24:00',
      checkInPledge: 'valid pledge',
      bettingCloseMinutes: 5,
    }),
  ).rejects.toMatchObject({
    status: 400,
    code: 'INVALID_PREFERENCES',
  });
  await expect(
    service.setPreferences({
      wheelSwitchTime: '08:30',
      checkInPledge: '   ',
      bettingCloseMinutes: 5,
    }),
  ).rejects.toMatchObject({
    status: 400,
    code: 'INVALID_PREFERENCES',
  });
  expect(await service.getSchedule()).toEqual(schedule);

  const firstDrawAt = new Date('2199-07-22T12:00:00Z');
  const firstDraw = remember(await service.drawIfDue(firstDrawAt));
  expect(firstDraw).not.toBeNull();
  const firstDrawId = firstDraw!.id;
  expect(await service.attendanceStatus(first.id, firstDrawAt)).toEqual({
    drawId: firstDrawId,
    checkedIn: false,
    open: true,
  });
  expect(await service.attendanceStatus(second.id, firstDrawAt)).toEqual({
    drawId: firstDrawId,
    checkedIn: false,
    open: true,
  });

  const idempotencyKey = crypto.randomUUID();
  const initialReward = await service.attend(
    first.id,
    { drawId: firstDrawId },
    idempotencyKey,
    firstDrawAt,
  );
  expect(
    await service.attend(
      first.id,
      { drawId: firstDrawId },
      idempotencyKey,
      firstDrawAt,
    ),
  ).toEqual(initialReward);
  expect(await service.attendanceStatus(first.id, firstDrawAt)).toEqual({
    drawId: firstDrawId,
    checkedIn: true,
    open: true,
  });
  expect(await service.attendanceStatus(second.id, firstDrawAt)).toMatchObject({
    drawId: firstDrawId,
    checkedIn: false,
  });

  await service.setPreferences({
    wheelSwitchTime: '09:15',
    checkInPledge: '  Updated pledge  ',
    bettingCloseMinutes: 7,
  });
  expect(await service.getSchedule()).toEqual(schedule);
  const nextDrawAt = new Date('2199-07-23T12:00:00Z');
  expect(await service.attendanceStatus(first.id, nextDrawAt)).toEqual({
    drawId: null,
    checkedIn: false,
    open: false,
  });
  const nextDraw = remember(await service.drawIfDue(nextDrawAt));
  expect(nextDraw).not.toBeNull();
  expect(await service.attendanceStatus(first.id, nextDrawAt)).toEqual({
    drawId: nextDraw!.id,
    checkedIn: false,
    open: true,
  });

  const wallet = await service.wallet(first.id);
  expect(
    wallet.ledger.filter((entry) => entry.kind === 'attendance'),
  ).toHaveLength(1);
  expect(
    wallet.ledger.find((entry) => entry.kind === 'attendance')?.delta,
  ).toBe(10);
  expect(await service.today(firstDrawAt)).toMatchObject({
    result: {
      id: firstDrawId,
      placeId: firstDraw!.placeId,
      snapshot: firstDraw!.snapshot,
    },
  });
  const attendanceRows = await database.db
    .select()
    .from(attendance)
    .where(
      and(
        eq(attendance.participantId, first.id),
        eq(attendance.drawId, firstDrawId),
      ),
    );
  expect(attendanceRows).toHaveLength(1);
});
