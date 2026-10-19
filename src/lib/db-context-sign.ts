import { createHmac, randomBytes } from "node:crypto";

/**
 * Signeret databasekontekst (hærdning af «forfalsket kontekst under SQL-injektion», docs/SECURITY-AUDIT-MFA-RLS.md).
 *
 * Appen sætter pr. transaktion `app.user_id`, `app.role`, `app.session_id`, `app.onboarding_token` – og `app.ctx`:
 * `<kid>.<udstedt ms>.<nonce>.<HMAC-SHA256>` over netop de fire værdier. Politikkernes kontekstfunktioner (`rls.app_role()`
 * m.fl.) stoler kun på værdierne, hvis `rls.ctx_ok()` (SECURITY DEFINER, ejet af abu_owner) kan verificere signaturen med
 * nøglen i `rls.context_key` – en tabel, som abu_app slet ikke kan læse. En SQL-injektion i appens forbindelse kan derfor
 * stadig kalde `set_config('app.role', 'system', …)`, men uden nøglen giver det ingen adgang (ingen rolle = ingen rækker).
 *
 * Nøglen: `DB_CONTEXT_SECRET` (kræves i produktion, mindst 32 tegn). HMAC-nøglen afledes som
 * HMAC-SHA256(DB_CONTEXT_SECRET, "abu-db-context-v1"); databasen får kun HMAC-paddene (`npm run db:context-key`).
 * Uden for produktion bruges en fast, offentlig udviklingsnøgle (afvises i produktion – env.ts og db-guard.ts).
 */

/** Offentlig – kun til lokal udvikling og tests. Produktions-guarden afviser den. */
export const DB_CONTEXT_DEV_SECRET = "abu-dev-db-context-secret-ONLY-for-local-development";

/** Signaturens format (version 1). Ændres formatet, skal rls.ctx_ok() ændres i en ny migration. */
export const CONTEXT_SIGNATURE_VERSION = "abu-ctx-v1";

/** Feltadskiller i den signerede besked; må ikke forekomme i værdierne. */
const SEP = "|";

export interface ContextKey {
  /** 16 hex-tegn – identificerer nøglen i rls.context_key (rotation: flere nøgler kan være installeret samtidig). */
  kid: string;
  key: Buffer;
}

const keyCache = new Map<string, ContextKey>();

/** HMAC-nøglen og dens id, afledt af hemmeligheden. */
export function deriveContextKey(secret: string): ContextKey {
  const hit = keyCache.get(secret);
  if (hit) return hit;
  const key = createHmac("sha256", secret).update("abu-db-context-v1").digest();
  const kid = createHmac("sha256", key).update("kid").digest("hex").slice(0, 16);
  const k = { kid, key };
  keyCache.set(secret, k);
  return k;
}

/** HMAC-paddene (RFC 2104, blokstørrelse 64), som databasen gemmer i rls.context_key. Kun til db:context-key og tests. */
export function contextKeyPads(k: ContextKey): { ipad: Buffer; opad: Buffer } {
  const block = Buffer.alloc(64, 0);
  k.key.copy(block);
  return { ipad: Buffer.from(block.map((b) => b ^ 0x36)), opad: Buffer.from(block.map((b) => b ^ 0x5c)) };
}

export class ContextSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextSignatureError";
  }
}

/**
 * `app.ctx` for de fire kontekstværdier (samme rækkefølge som SET_CONTEXT_SQL i db.ts). Billigt: én HMAC pr.
 * transaktion. `now`/`nonce` kun til tests.
 */
export function signContext(values: readonly [userId: string, role: string, sessionId: string, onboardingToken: string], k: ContextKey, now = Date.now(), nonce = randomBytes(12).toString("hex")): string {
  for (const v of values) if (v.includes(SEP)) throw new ContextSignatureError("Databasekonteksten må ikke indeholde «|».");
  const issued = String(Math.floor(now));
  const msg = [CONTEXT_SIGNATURE_VERSION, k.kid, values[1], values[0], values[2], values[3], issued, nonce].join(SEP);
  const sig = createHmac("sha256", k.key).update(msg, "utf8").digest("hex");
  return `${k.kid}.${issued}.${nonce}.${sig}`;
}
