// DB-tests (integration) kører kun, når TEST_DATABASE_URL er sat (CI: Postgres-service; lokalt: en separat testdatabase).
// Koden under test bruger den globale Prisma-klient, så DATABASE_URL peges på testdatabasen, før noget importeres.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
