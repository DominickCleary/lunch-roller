import './env';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, expect, it } from 'vitest';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { createDatabase, GameService } from './index';
import { participants } from './schema';

const database = createDatabase();
afterAll(() => database.close());

it('does not resurrect deleted or archived sample people when the development seed runs again', async () => {
  const names = ['Alex', 'Sam'];
  const original = await database.db
    .select()
    .from(participants)
    .where(inArray(participants.name, names));
  const alex = original.find((person) => person.name === 'Alex')!;
  const sam = original.find((person) => person.name === 'Sam')!;
  expect(alex).toBeDefined();
  expect(sam).toBeDefined();
  const game = new GameService(database);
  try {
    await game.saveParticipant({ active: false }, alex.id);
    expect((await game.removeParticipant(sam.id)).action).toBe('deleted');
    await promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', 'packages/db/src/seed.ts'],
      {
        cwd: new URL('../../../', import.meta.url),
        env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
        timeout: 10_000,
      },
    );
    const people = await game.listParticipants(true);
    expect(people.find((person) => person.id === alex.id)?.active).toBe(false);
    expect(people.some((person) => person.name === 'Sam')).toBe(false);
    expect(people.filter((person) => person.name === 'Alex')).toHaveLength(1);
  } finally {
    await database.db.delete(participants).where(
      and(
        inArray(participants.name, names),
        notInArray(
          participants.id,
          original.map((person) => person.id),
        ),
      ),
    );
    for (const person of original) {
      await database.db
        .insert(participants)
        .values(person)
        .onConflictDoUpdate({
          target: participants.id,
          set: { name: person.name, active: person.active },
        });
    }
  }
  expect(
    (
      await database.db
        .select()
        .from(participants)
        .where(eq(participants.id, sam.id))
    )[0],
  ).toEqual(sam);
});
