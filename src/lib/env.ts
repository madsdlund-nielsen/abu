import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  DATABASE_URL: z.string().min(1).default("postgresql://abu:abu@localhost:5432/abu"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  COOKIE_SECURE: z.enum(["true", "false", ""]).optional(),
  CRON_SECRET: z.string().default(""),
  /** Hemmelighed til signerede links (afmelding). Tom = afledt af DATABASE_URL + CRON_SECRET. Sæt en lang, tilfældig værdi i produktion. */
  APP_SECRET: z.string().default(""),
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
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (!cached) {
    // tom streng i .env behandles som "ikke sat"
    const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
    cached = schema.parse(raw);
  }
  return cached;
}

export function cookieSecure(): boolean {
  const env = getEnv();
  if (env.COOKIE_SECURE === "true") return true;
  if (env.COOKIE_SECURE === "false") return false;
  return env.APP_URL.startsWith("https://");
}
