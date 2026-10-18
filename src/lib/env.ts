import { z } from "zod";
import { DbUrlError, DEV_DATABASE_URL, parseDbUrl, tlsExemptDbHost, type DbUrlInfo } from "./db-config";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  /**
   * Miljø: production (fail-closed: mock/console/local er forbudt, hemmeligheder kræves), staging, development eller test.
   * Tom = production, når NODE_ENV=production (også `next start` og Docker), ellers development.
   */
  APP_ENV: z.enum(["production", "staging", "development", "test"]).optional(),
  /** Appens forbindelse – rollen abu_app (kun DML). Migrationer/seed/create-admin bruger DATABASE_URL_MIGRATE (ejeren). */
  DATABASE_URL: z.string().min(1).default(DEV_DATABASE_URL),
  /** Sti til CA-certifikatet (PEM) for TLS til databasen (sslmode=verify-full/verify-ca i DATABASE_URL). */
  DATABASE_SSL_CA: z.string().default(""),
  /** Højst så mange databaseforbindelser pr. app-proces. */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  APP_URL: z.string().url().default("http://localhost:3000"),
  COOKIE_SECURE: z.enum(["true", "false", ""]).optional(),
  /**
   * Antal betroede reverse proxies foran appen (fx 1 for Caddy). Klient-IP tages fra X-Forwarded-For talt fra højre,
   * så klienten ikke kan forfalske den. 0 = ingen proxy: X-Forwarded-For ignoreres helt. Kræves ≥ 1 i produktion.
   */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  CRON_SECRET: z.string().default(""),
  /** Hemmelighed til signerede links (afmelding). Kræves i produktion (mindst 32 tegn). */
  APP_SECRET: z.string().default(""),
  /**
   * Nøglemateriale til kryptering af TOTP-hemmeligheder (AES-256-GCM, HKDF-afledt). Kræves i produktion (mindst 32 tegn).
   * Tom uden for produktion = en fast udviklingsnøgle. Rotation: ny værdi her, den gamle i MFA_ENCRYPTION_KEY_PREVIOUS.
   */
  MFA_ENCRYPTION_KEY: z.string().default(""),
  MFA_ENCRYPTION_KEY_PREVIOUS: z.string().default(""),
  /** Kør jobkøen og notifikationer hvert minut i selve app-processen. Slå fra, hvis en ekstern cron kalder /api/cron/process-jobs. */
  IN_PROCESS_SCHEDULER: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  /** "Deltag i mødet" åbner så mange minutter før mødets start. */
  MEETING_JOIN_EARLY_MINUTES: z.coerce.number().int().min(0).max(180).default(15),

  MEETING_DURATION_MINUTES: z.coerce.number().int().min(15).max(480).default(120),
  DELETE_RECORDINGS_AFTER_TRANSCRIPTION: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  PAYMENT_PROVIDER: z.enum(["mock", "frisbii"]).default("mock"),
  FRISBII_PRIVATE_KEY: z.string().default(""),
  FRISBII_WEBHOOK_SECRET: z.string().default(""),
  FRISBII_API_URL: z.string().default("https://api.reepay.com"),
  FRISBII_CHECKOUT_API_URL: z.string().default("https://checkout-api.reepay.com"),

  CVR_PROVIDER: z.enum(["mock", "virk", "cvrapi"]).default("mock"),
  CVR_VIRK_USERNAME: z.string().default(""),
  CVR_VIRK_PASSWORD: z.string().default(""),
  CVR_VIRK_URL: z.string().default("http://distribution.virk.dk/cvr-permanent/virksomhed/_search"),
  CVR_USER_AGENT: z.string().default("Advisory Board Unlimited - onboarding (kontakt: support@example.dk)"),
  /** Højst så mange eksterne CVR-opslag pr. døgn i alt (beskytter den fælles gratis kvote). Derefter manuel indtastning. */
  CVR_DAILY_BUDGET: z.coerce.number().int().min(1).max(100000).default(300),

  VIDEO_PROVIDER: z.enum(["mock", "whereby"]).default("mock"),
  WHEREBY_API_KEY: z.string().default(""),
  WHEREBY_WEBHOOK_SECRET: z.string().default(""),
  WHEREBY_API_URL: z.string().default("https://api.whereby.dev/v1"),
  WHEREBY_RECORDING_BUCKET: z.string().default(""),
  WHEREBY_RECORDING_ACCESS_KEY_ID: z.string().default(""),
  WHEREBY_RECORDING_SECRET_ACCESS_KEY: z.string().default(""),

  TRANSCRIPTION_PROVIDER: z.enum(["mock", "mistral"]).default("mock"),
  MISTRAL_API_KEY: z.string().default(""),
  MISTRAL_API_URL: z.string().default("https://api.mistral.ai/v1"),
  MISTRAL_TRANSCRIPTION_MODEL: z.string().default("voxtral-mini-latest"),
  MISTRAL_SUMMARY_MODEL: z.string().default("mistral-small-latest"),

  EMAIL_PROVIDER: z.enum(["console", "smtp", "inmobile"]).default("console"),
  EMAIL_FROM: z.string().default("Advisory Board Unlimited <noreply@abu.local>"),
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().default(""),
  SMTP_PASSWORD: z.string().default(""),
  SMTP_SECURE: bool,

  SMS_PROVIDER: z.enum(["console", "inmobile"]).default("console"),
  /** SMS-afsendernavn: 3-11 tegn (bogstaver/tal), eller et telefonnummer. Kan overstyres i CMS'et. */
  SMS_SENDER: z.string().default("ABUnlimited"),
  /** Stille timer for SMS, "fra-til" i hele timer (København-tid), fx 21-08. Tom/"off" = ingen. Kan overstyres i CMS'et. */
  SMS_QUIET_HOURS: z.string().default("21-08"),
  INMOBILE_API_KEY: z.string().default(""),
  INMOBILE_API_URL: z.string().default("https://api.inmobile.com"),
  /** Delt hemmelighed i webhook-URL'en (?secret=...) til /api/webhooks/inmobile. */
  INMOBILE_WEBHOOK_SECRET: z.string().default(""),
  /** Forrige hemmelighed under rotation (accepteres også, indtil inMobile er opdateret). Tom = ingen. */
  INMOBILE_WEBHOOK_SECRET_PREVIOUS: z.string().default(""),
  /** Hvor længe notifikationsloggen gemmes (måneder). Kan overstyres i CMS'et. */
  NOTIFICATION_LOG_RETENTION_MONTHS: z.coerce.number().int().min(1).max(60).default(12),

  /** Hvor længe leads med samtykke gemmes efter seneste aktivitet (måneder). Kan overstyres i CMS'et. */
  LEAD_RETENTION_MONTHS: z.coerce.number().int().min(1).max(60).default(24),

  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  UPLOAD_DIR: z.string().default("./uploads"),
  S3_ENDPOINT: z.string().default(""),
  S3_REGION: z.string().default("eu-central"),
  S3_BUCKET: z.string().default(""),
  S3_ACCESS_KEY_ID: z.string().default(""),
  S3_SECRET_ACCESS_KEY: z.string().default(""),
  /** true (standard) = path-style-URL'er (endpoint/bucket/nøgle). false = virtual-hosted (bucket.endpoint/nøgle). */
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
});

export type Env = z.infer<typeof schema>;
export type AppEnv = NonNullable<Env["APP_ENV"]>;
type RawEnv = Record<string, string | undefined>;

export class EnvConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Ugyldig konfiguration:\n - ${problems.join("\n - ")}`);
    this.name = "EnvConfigError";
  }
}

/**
 * Parser miljøvariablerne. Tomme strenge behandles som "ikke sat" (standardværdien bruges), men en ukendt værdi
 * (fx PAYMENT_PROVIDER=frisbi) er altid en fejl – der faldes aldrig stille tilbage til en standard.
 */
export function parseEnv(raw: RawEnv): Env {
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== "" && v !== undefined));
  const r = schema.safeParse(cleaned);
  if (r.success) return r.data;
  throw new EnvConfigError(
    r.error.issues.map((i) => {
      const key = String(i.path[0] ?? "?");
      const allowed = "values" in i && Array.isArray(i.values) ? ` (tilladt: ${i.values.join(", ")})` : "";
      return `${key}: ugyldig værdi ${JSON.stringify(cleaned[key] ?? "")}${allowed}`;
    }),
  );
}

/** Miljøet appen kører i. Uden APP_ENV er NODE_ENV=production altid production (fail-closed). */
export function resolveAppEnv(env: Pick<Env, "APP_ENV">, nodeEnv: string | undefined): AppEnv {
  if (env.APP_ENV) return env.APP_ENV;
  if (nodeEnv === "production") return "production";
  return nodeEnv === "test" ? "test" : "development";
}

const MIN_SECRET_LENGTH = 32;

function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local");
  } catch {
    return true;
  }
}

/** Variabler med ejer-/superbrugeradgang til databasen. Må ikke findes i app-processen i produktion. */
export const OWNER_ONLY_VARS = ["DATABASE_URL_MIGRATE", "DATABASE_URL_PROVISION", "ABU_OWNER_PASSWORD", "POSTGRES_PASSWORD"] as const;
const MIN_DB_PASSWORD_LENGTH = 24;

/**
 * DATABASE_URL i produktion: gyldig URL, TLS (sslmode=require/verify-ca/verify-full) undtagen for en lokal socket/loopback
 * eller compose-databasen «postgres» på det interne netværk, ikke ejer-/superbrugerrollen ved navn (selve rollen tjekkes
 * også mod databasen ved opstart, se db-guard.ts) og en lang adgangskode.
 */
export function databaseUrlProblems(url: string): string[] {
  let db: DbUrlInfo;
  try {
    db = parseDbUrl(url);
  } catch (e) {
    return [e instanceof DbUrlError ? e.message : "DATABASE_URL er ugyldig."];
  }
  const p: string[] = [];
  if (!tlsExemptDbHost(db.host) && (db.sslmode === null || db.sslmode === "disable")) {
    p.push(
      `DATABASE_URL til værten «${db.host}» skal bruge TLS: tilføj ?sslmode=verify-full (anbefalet; CA-fil i DATABASE_SSL_CA) eller ?sslmode=require. ` +
        `Kun en lokal socket/loopback og compose-databasen «postgres» er undtaget.`,
    );
  }
  if (db.user === "abu_owner" || db.user === "postgres") p.push(`DATABASE_URL skal bruge app-rollen abu_app, ikke «${db.user}».`);
  if (!db.socket && db.password.length < MIN_DB_PASSWORD_LENGTH) {
    p.push(`Databaseadgangskoden i DATABASE_URL skal være mindst ${MIN_DB_PASSWORD_LENGTH} tegn (generér med: openssl rand -hex 32).`);
  }
  return p;
}

/**
 * Produktions-guard (ren funktion): hvad mangler, før appen må køre i produktion? Tom liste = OK.
 * Mock/console/local-udbydere, manglende hemmeligheder og http-adresser afvises. Værdier logges aldrig, kun navne.
 */
export function productionConfigProblems(env: Env, raw: RawEnv): string[] {
  const p: string[] = [];
  const need = (key: keyof Env & string, why: string) => {
    if (!String(env[key] ?? "").trim()) p.push(`${key} mangler (${why}).`);
  };
  const secret = (key: "APP_SECRET" | "CRON_SECRET" | "MFA_ENCRYPTION_KEY", why: string) => {
    if (env[key].length < MIN_SECRET_LENGTH) p.push(`${key} skal være mindst ${MIN_SECRET_LENGTH} tilfældige tegn (${why}). Generér med: openssl rand -base64 48`);
  };

  if (!raw.DATABASE_URL) p.push("DATABASE_URL skal sættes eksplicit.");
  else p.push(...databaseUrlProblems(env.DATABASE_URL));
  // Ejer- og superbrugeradgang hører kun til migrate/provisionering – aldrig i den kørende app (RLS fase 0)
  for (const key of OWNER_ONLY_VARS) if (raw[key]) p.push(`${key} må ikke være sat i app-processen (kun til migrationer/provisionering).`);
  if (!env.APP_URL.startsWith("https://") || isLocalUrl(env.APP_URL)) p.push("APP_URL skal være en offentlig https://-adresse.");
  if (env.COOKIE_SECURE === "false") p.push("COOKIE_SECURE=false er ikke tilladt i produktion.");
  if (env.TRUSTED_PROXY_HOPS < 1) p.push("TRUSTED_PROXY_HOPS skal være mindst 1 (antal reverse proxies foran appen, fx Caddy = 1).");
  secret("APP_SECRET", "signerer afmeldingslinks");
  secret("CRON_SECRET", "beskytter /api/cron/process-jobs");
  secret("MFA_ENCRYPTION_KEY", "krypterer hemmeligheder til totrinsbekræftelse");
  if (env.MFA_ENCRYPTION_KEY && env.MFA_ENCRYPTION_KEY === env.APP_SECRET) p.push("MFA_ENCRYPTION_KEY skal være forskellig fra APP_SECRET.");

  if (env.PAYMENT_PROVIDER === "mock") p.push("PAYMENT_PROVIDER=mock er ikke tilladt i produktion (giver gratis abonnementer).");
  else {
    need("FRISBII_PRIVATE_KEY", "betaling");
    need("FRISBII_WEBHOOK_SECRET", "signatur på betalingswebhooks");
  }
  if (env.VIDEO_PROVIDER === "mock") p.push("VIDEO_PROVIDER=mock er ikke tilladt i produktion.");
  else {
    need("WHEREBY_API_KEY", "videomøder");
    need("WHEREBY_WEBHOOK_SECRET", "signatur på videowebhooks");
  }
  if (env.TRANSCRIPTION_PROVIDER === "mock") p.push("TRANSCRIPTION_PROVIDER=mock er ikke tilladt i produktion.");
  else need("MISTRAL_API_KEY", "transskription");

  if (env.EMAIL_PROVIDER === "console") p.push("EMAIL_PROVIDER=console er ikke tilladt i produktion (mails ville kun stå i loggen).");
  if (env.EMAIL_PROVIDER === "smtp") need("SMTP_HOST", "e-mail via SMTP");
  if (env.SMS_PROVIDER === "console") p.push("SMS_PROVIDER=console er ikke tilladt i produktion.");
  if (env.EMAIL_PROVIDER === "inmobile" || env.SMS_PROVIDER === "inmobile") {
    need("INMOBILE_API_KEY", "inMobile");
    need("INMOBILE_WEBHOOK_SECRET", "inMobile-statuswebhook");
  }
  if (/@abu\.local>?$/.test(env.EMAIL_FROM.trim())) p.push("EMAIL_FROM skal være en rigtig afsenderadresse.");

  if (env.STORAGE_PROVIDER === "local") p.push("STORAGE_PROVIDER=local er ikke tilladt i produktion (brug s3 / Object Storage).");
  else {
    need("S3_ENDPOINT", "objektlager");
    need("S3_BUCKET", "objektlager");
    need("S3_ACCESS_KEY_ID", "objektlager");
    need("S3_SECRET_ACCESS_KEY", "objektlager");
    if (env.S3_ENDPOINT && !env.S3_ENDPOINT.startsWith("https://")) p.push("S3_ENDPOINT skal være https://.");
  }

  if (env.CVR_PROVIDER === "mock") p.push("CVR_PROVIDER=mock er ikke tilladt i produktion.");
  if (env.CVR_PROVIDER === "virk") {
    need("CVR_VIRK_USERNAME", "CVR-opslag");
    need("CVR_VIRK_PASSWORD", "CVR-opslag");
  }
  if (env.CVR_PROVIDER === "cvrapi" && /example\.dk/.test(env.CVR_USER_AGENT)) p.push("CVR_USER_AGENT skal indeholde jeres rigtige kontaktadresse (kræves af cvrapi.dk).");
  return p;
}

/** Rolle, vært, TLS-tilstand og poolstørrelse – aldrig adgangskoden. */
function describeDb(env: Env): string {
  try {
    const db = parseDbUrl(env.DATABASE_URL);
    return `${db.user || "?"}@${db.host} (sslmode=${db.sslmode ?? "disable"}, pool=${env.DATABASE_POOL_MAX})`;
  } catch {
    return "ugyldig URL";
  }
}

/** Én linje til opstartsloggen: hvilke udbydere er valgt, og hvilke hemmeligheder er sat. Aldrig værdier. */
export function describeConfig(env: Env, appEnv: AppEnv): string {
  const set = (v: string) => (v ? "sat" : "mangler");
  return [
    `APP_ENV=${appEnv}`,
    `betaling=${env.PAYMENT_PROVIDER}`,
    `video=${env.VIDEO_PROVIDER}`,
    `transskription=${env.TRANSCRIPTION_PROVIDER}`,
    `email=${env.EMAIL_PROVIDER}`,
    `sms=${env.SMS_PROVIDER}`,
    `lager=${env.STORAGE_PROVIDER}`,
    `cvr=${env.CVR_PROVIDER}`,
    `APP_URL=${env.APP_URL}`,
    `db=${describeDb(env)}`,
    `proxy-hop=${env.TRUSTED_PROXY_HOPS}`,
    `APP_SECRET=${set(env.APP_SECRET)}`,
    `CRON_SECRET=${set(env.CRON_SECRET)}`,
    `MFA_ENCRYPTION_KEY=${set(env.MFA_ENCRYPTION_KEY)}${env.MFA_ENCRYPTION_KEY_PREVIOUS ? " (+forrige)" : ""}`,
    `scheduler=${env.IN_PROCESS_SCHEDULER ? "i processen" : "ekstern cron"}`,
  ].join(" · ");
}

let cached: Env | null = null;

export function getEnv(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}

export function appEnv(): AppEnv {
  return resolveAppEnv(getEnv(), process.env.NODE_ENV);
}

export function isProductionEnv(): boolean {
  return appEnv() === "production";
}

export function cookieSecure(): boolean {
  // I produktion altid Secure, uanset APP_URL/COOKIE_SECURE (M-6)
  if (isProductionEnv()) return true;
  const env = getEnv();
  if (env.COOKIE_SECURE === "true") return true;
  if (env.COOKIE_SECURE === "false") return false;
  return env.APP_URL.startsWith("https://");
}

/**
 * Kaldes én gang ved opstart (instrumentation). Kaster EnvConfigError med alle problemer, hvis konfigurationen er ugyldig,
 * eller hvis den ikke er klar til produktion, når APP_ENV=production. Logger den valgte opsætning (uden hemmeligheder).
 */
export function assertBootConfig(raw: RawEnv = process.env, log: (msg: string) => void = console.log): Env {
  const env = parseEnv(raw);
  const mode = resolveAppEnv(env, raw.NODE_ENV);
  log(`[config] ${describeConfig(env, mode)}`);
  if (mode === "production") {
    const problems = productionConfigProblems(env, raw);
    if (problems.length) throw new EnvConfigError(problems);
  } else if (raw.NODE_ENV === "production") {
    log(`[config] ADVARSEL: APP_ENV=${mode} med et produktionsbuild. Mock-udbydere er tilladt – må aldrig bruges til rigtige kunder.`);
  }
  return env;
}
