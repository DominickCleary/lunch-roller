import './env';
import { createDatabase } from './index';
import { participants, places, settings } from './schema';

const database = createDatabase();
try {
  await database.db.transaction(async (tx) => {
    const initialized = await tx
      .insert(settings)
      .values({ id: 1 })
      .onConflictDoNothing()
      .returning({ id: settings.id });
    // Bootstrap once: restarting a development stack must not resurrect removed members or places.
    if (!initialized.length) return;
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
