import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

export function createDatabase(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is required');
  const client = postgres(url, {
    max: 5,
    connect_timeout: 3,
    idle_timeout: 20,
    connection: {
      statement_timeout: 10_000,
      idle_in_transaction_session_timeout: 15_000,
    },
  });
  const db = drizzle(client, { schema });
  return { db, client, close: () => client.end({ timeout: 5 }) };
}

export async function checkDatabase(
  url = process.env.DATABASE_URL,
): Promise<boolean> {
  const database = createDatabase(url);
  try {
    await database.client`select id from settings where id = 1`.then((rows) => {
      if (rows.length !== 1) throw new Error('Database not seeded');
    });
    return true;
  } finally {
    await database.close();
  }
}

export { schema };
