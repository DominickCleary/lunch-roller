import './env';
import { createDatabase } from './index';
import { participants, places, settings } from './schema';

const database = createDatabase();
try {
  await database.db.transaction(async (tx) => {
    await tx.insert(settings).values({ id: 1 }).onConflictDoNothing();
    await tx
      .insert(participants)
      .values([{ name: 'Alex' }, { name: 'Sam' }])
      .onConflictDoNothing();
    await tx
      .insert(places)
      .values([
        { name: 'Sandwich Bar' },
        { name: 'Noodle House' },
        { name: 'Pizza Place' },
      ])
      .onConflictDoNothing();
  });
  console.log('Development seed complete (existing rows preserved)');
} finally {
  await database.close();
}
