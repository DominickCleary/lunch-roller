import { createDatabase } from '../packages/db/src/index';
import { prepareGameFixtures } from './fixtures';

export default async function setup() {
  const fixtures = await prepareGameFixtures();
  return async () => {
    const database = createDatabase(process.env.TEST_DATABASE_URL!);
    try {
      // Test suites restore their own effects first; FK failures expose leaked history.
      if (fixtures.places.length)
        await database.client`DELETE FROM places WHERE id IN ${database.client(fixtures.places)}`;
      if (fixtures.people.length)
        await database.client`DELETE FROM participants WHERE id IN ${database.client(fixtures.people)}`;
      await database.client`UPDATE settings SET setup_completed = ${fixtures.original.setupCompleted} WHERE id = 1`;
    } finally {
      await database.close();
    }
  };
}
