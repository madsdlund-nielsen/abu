import type pg from "pg";
import { contextKeyPads, DB_CONTEXT_DEV_SECRET, deriveContextKey } from "./db-context-sign";

/**
 * Installerer nøglen til den signerede databasekontekst i `rls.context_key` (kun HMAC-paddene). Kører som databasens
 * ejer (abu_owner) – app-rollerne har ingen rettigheder til tabellen. Idempotent. `prune` fjerner andre nøgler
 * (efter en rotation, når alle app-instanser bruger den nye hemmelighed).
 */
export async function installContextKey(client: pg.Client | pg.PoolClient, secret: string, opts: { prune?: boolean } = {}): Promise<{ kid: string; pruned: number }> {
  const k = deriveContextKey(secret);
  const { ipad, opad } = contextKeyPads(k);
  await client.query(
    `INSERT INTO rls.context_key (kid, ipad, opad) VALUES ($1, $2, $3) ON CONFLICT (kid) DO UPDATE SET ipad = EXCLUDED.ipad, opad = EXCLUDED.opad`,
    [k.kid, ipad, opad],
  );
  const pruned = opts.prune ? (await client.query(`DELETE FROM rls.context_key WHERE kid <> $1`, [k.kid])).rowCount ?? 0 : 0;
  return { kid: k.kid, pruned };
}

/** Hemmeligheden til installationen: DB_CONTEXT_SECRET, ellers (kun uden for produktion) udviklingsnøglen. */
export function contextSecretForInstall(env: NodeJS.ProcessEnv): { secret: string; dev: boolean } | { error: string } {
  const secret = env.DB_CONTEXT_SECRET ?? "";
  const production = env.APP_ENV ? env.APP_ENV === "production" : env.NODE_ENV === "production";
  if (secret) {
    if (production && (secret.length < 32 || secret === DB_CONTEXT_DEV_SECRET)) return { error: "DB_CONTEXT_SECRET skal være mindst 32 tilfældige tegn og ikke udviklingsnøglen (produktion)." };
    return { secret, dev: false };
  }
  if (production) return { error: "DB_CONTEXT_SECRET mangler (kræves i produktion). Generér med: openssl rand -base64 48" };
  return { secret: DB_CONTEXT_DEV_SECRET, dev: true };
}
