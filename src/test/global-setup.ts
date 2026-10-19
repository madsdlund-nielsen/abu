/**
 * Én gang før DB-testene: installerer nøglen til den signerede databasekontekst (rls.context_key) i testdatabasen – som
 * ejeren (TEST_DATABASE_URL_OWNER), ligesom `npm run db:context-key` gør efter migrationerne. Idempotent.
 * Uden TEST_DATABASE_URL_OWNER skal nøglen være installeret i forvejen (README «Test»).
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL_OWNER;
  if (!process.env.TEST_DATABASE_URL || !url) return;
  const [{ default: pg }, { pgClientConfig }, { installContextKey }, { DB_CONTEXT_DEV_SECRET }] = await Promise.all([
    import("pg"),
    import("../lib/db-config"),
    import("../lib/db-context-key"),
    import("../lib/db-context-sign"),
  ]);
  const client = new pg.Client(pgClientConfig(url));
  await client.connect();
  try {
    await installContextKey(client, process.env.DB_CONTEXT_SECRET || DB_CONTEXT_DEV_SECRET);
  } finally {
    await client.end();
  }
}
