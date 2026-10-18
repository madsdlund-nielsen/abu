import { describe, expect, it } from "vitest";
import { assertBootConfig, EnvConfigError, parseEnv, productionConfigProblems, resolveAppEnv } from "./env";

/** En komplet, gyldig produktionskonfiguration (falske værdier). */
const PROD = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://abu_app:0123456789abcdef0123456789abcdef@db.internal:5432/abu?sslmode=verify-full",
  APP_URL: "https://abu.example.com",
  APP_SECRET: "a".repeat(48),
  CRON_SECRET: "c".repeat(48),
  MFA_ENCRYPTION_KEY: "m".repeat(48),
  PAYMENT_PROVIDER: "frisbii",
  FRISBII_PRIVATE_KEY: "priv_x",
  FRISBII_WEBHOOK_SECRET: "whsec_x",
  VIDEO_PROVIDER: "whereby",
  WHEREBY_API_KEY: "wb",
  WHEREBY_WEBHOOK_SECRET: "wbsec",
  TRANSCRIPTION_PROVIDER: "mistral",
  MISTRAL_API_KEY: "m",
  EMAIL_PROVIDER: "inmobile",
  SMS_PROVIDER: "inmobile",
  INMOBILE_API_KEY: "im",
  INMOBILE_WEBHOOK_SECRET: "imsec",
  EMAIL_FROM: "ABU <noreply@abu.example.com>",
  STORAGE_PROVIDER: "s3",
  S3_ENDPOINT: "https://fsn1.your-objectstorage.com",
  S3_BUCKET: "abu",
  S3_ACCESS_KEY_ID: "k",
  S3_SECRET_ACCESS_KEY: "s",
  CVR_PROVIDER: "cvrapi",
  CVR_USER_AGENT: "ABU onboarding (kontakt: it@abu.example.com)",
  TRUSTED_PROXY_HOPS: "1",
};
const silent = () => {};

describe("produktions-guard (C-1)", () => {
  it("accepterer en komplet produktionskonfiguration", () => {
    expect(productionConfigProblems(parseEnv(PROD), PROD)).toEqual([]);
    expect(() => assertBootConfig(PROD, silent)).not.toThrow();
  });

  it("afviser mock-udbydere i produktion", () => {
    const raw = { ...PROD, PAYMENT_PROVIDER: "mock", VIDEO_PROVIDER: "mock", TRANSCRIPTION_PROVIDER: "mock", CVR_PROVIDER: "mock" };
    const problems = productionConfigProblems(parseEnv(raw), raw);
    expect(problems.join("\n")).toMatch(/PAYMENT_PROVIDER=mock/);
    expect(problems.join("\n")).toMatch(/VIDEO_PROVIDER=mock/);
    expect(problems.join("\n")).toMatch(/TRANSCRIPTION_PROVIDER=mock/);
    expect(problems.join("\n")).toMatch(/CVR_PROVIDER=mock/);
    expect(() => assertBootConfig(raw, silent)).toThrow(EnvConfigError);
  });

  it("afviser console-adaptere og lokalt lager", () => {
    const raw = { ...PROD, EMAIL_PROVIDER: "console", SMS_PROVIDER: "console", STORAGE_PROVIDER: "local" };
    const text = productionConfigProblems(parseEnv(raw), raw).join("\n");
    expect(text).toMatch(/EMAIL_PROVIDER=console/);
    expect(text).toMatch(/SMS_PROVIDER=console/);
    expect(text).toMatch(/STORAGE_PROVIDER=local/);
  });

  it("afviser manglende provider-variabler (standard = mock) i produktion", () => {
    const raw = { NODE_ENV: "production" };
    expect(() => assertBootConfig(raw, silent)).toThrow(/PAYMENT_PROVIDER=mock/);
  });

  it("kræver hemmeligheder, https og eksplicit DATABASE_URL", () => {
    const raw = { ...PROD, APP_SECRET: "", CRON_SECRET: "kort", APP_URL: "http://abu.example.com", FRISBII_WEBHOOK_SECRET: "", DATABASE_URL: "" };
    const text = productionConfigProblems(parseEnv(raw), raw).join("\n");
    expect(text).toMatch(/APP_SECRET skal være mindst 32/);
    expect(text).toMatch(/CRON_SECRET skal være mindst 32/);
    expect(text).toMatch(/APP_URL skal være en offentlig https/);
    expect(text).toMatch(/FRISBII_WEBHOOK_SECRET mangler/);
    expect(text).toMatch(/DATABASE_URL skal sættes eksplicit/);
  });

  it("kræver MFA_ENCRYPTION_KEY (mindst 32 tegn, forskellig fra APP_SECRET)", () => {
    for (const raw of [{ ...PROD, MFA_ENCRYPTION_KEY: "" }, { ...PROD, MFA_ENCRYPTION_KEY: "kort" }]) {
      expect(productionConfigProblems(parseEnv(raw), raw).join("\n")).toMatch(/MFA_ENCRYPTION_KEY skal være mindst 32/);
    }
    const same = { ...PROD, MFA_ENCRYPTION_KEY: PROD.APP_SECRET };
    expect(productionConfigProblems(parseEnv(same), same).join("\n")).toMatch(/forskellig fra APP_SECRET/);
    expect(() => assertBootConfig({ ...PROD, MFA_ENCRYPTION_KEY: "" }, silent)).toThrow(EnvConfigError);
  });

  it("afviser localhost og COOKIE_SECURE=false", () => {
    const raw = { ...PROD, APP_URL: "https://localhost:3000", COOKIE_SECURE: "false" };
    const text = productionConfigProblems(parseEnv(raw), raw).join("\n");
    expect(text).toMatch(/APP_URL/);
    expect(text).toMatch(/COOKIE_SECURE=false/);
  });

  it("RLS fase 0: DATABASE_URL skal bruge TLS til andre værter end socket/loopback/compose-«postgres»", () => {
    const pw = "0123456789abcdef0123456789abcdef";
    const problems = (url: string) => productionConfigProblems(parseEnv({ ...PROD, DATABASE_URL: url }), { ...PROD, DATABASE_URL: url }).join("\n");
    expect(problems(`postgresql://abu_app:${pw}@db.internal:5432/abu`)).toMatch(/skal bruge TLS/);
    expect(problems(`postgresql://abu_app:${pw}@db.internal:5432/abu?sslmode=disable`)).toMatch(/skal bruge TLS/);
    for (const mode of ["require", "verify-ca", "verify-full"]) expect(problems(`postgresql://abu_app:${pw}@10.0.0.5/abu?sslmode=${mode}`)).toBe("");
    // Undtagelsen (dokumenteret i README): compose-databasen på det interne netværk, loopback og Unix-socket
    for (const url of [`postgresql://abu_app:${pw}@postgres:5432/abu`, `postgresql://abu_app:${pw}@127.0.0.1/abu`, "postgresql://abu_app@localhost/abu?host=/var/run/postgresql"]) {
      expect(problems(url)).toBe("");
    }
    expect(problems(`postgresql://abu_app:${pw}@db/abu?sslmode=prefer`)).toMatch(/sslmode=prefer understøttes ikke/);
  });

  it("RLS fase 0: app-rollen, lang adgangskode og ingen ejer-/superbrugeradgang i app-processen", () => {
    const pw = "0123456789abcdef0123456789abcdef";
    const check = (extra: Record<string, string>) => productionConfigProblems(parseEnv({ ...PROD, ...extra }), { ...PROD, ...extra }).join("\n");
    expect(check({ DATABASE_URL: `postgresql://abu_owner:${pw}@postgres/abu` })).toMatch(/app-rollen abu_app, ikke «abu_owner»/);
    expect(check({ DATABASE_URL: `postgresql://postgres:${pw}@postgres/abu` })).toMatch(/ikke «postgres»/);
    expect(check({ DATABASE_URL: "postgresql://abu_app:abu@postgres/abu" })).toMatch(/mindst 24 tegn/);
    for (const key of ["DATABASE_URL_MIGRATE", "DATABASE_URL_PROVISION", "ABU_OWNER_PASSWORD", "POSTGRES_PASSWORD"]) {
      expect(check({ [key]: "noget" })).toMatch(new RegExp(`${key} må ikke være sat i app-processen`));
      expect(check({ [key]: "" })).toBe(""); // compose tømmer dem i app-servicen
    }
  });

  it("ukendte værdier er en fejl, ikke et stille fald tilbage til standard", () => {
    expect(() => parseEnv({ PAYMENT_PROVIDER: "frisbi" })).toThrow(/PAYMENT_PROVIDER: ugyldig værdi "frisbi" \(tilladt: mock, frisbii\)/);
    expect(() => parseEnv({ IN_PROCESS_SCHEDULER: "ja" })).toThrow(/IN_PROCESS_SCHEDULER/);
    expect(() => parseEnv({ APP_ENV: "prod" })).toThrow(/APP_ENV/);
    // tom streng = ikke sat
    expect(parseEnv({ PAYMENT_PROVIDER: "" }).PAYMENT_PROVIDER).toBe("mock");
  });

  it("NODE_ENV=production er altid produktion, medmindre APP_ENV eksplicit siger andet", () => {
    expect(resolveAppEnv({}, "production")).toBe("production");
    expect(resolveAppEnv({}, "development")).toBe("development");
    expect(resolveAppEnv({}, undefined)).toBe("development");
    expect(resolveAppEnv({ APP_ENV: "staging" }, "production")).toBe("staging");
    const logs: string[] = [];
    expect(() => assertBootConfig({ NODE_ENV: "production", APP_ENV: "development" }, (m) => logs.push(m))).not.toThrow();
    expect(logs.join("\n")).toMatch(/ADVARSEL/);
  });

  it("logger udbydere, men aldrig hemmeligheder", () => {
    const logs: string[] = [];
    assertBootConfig(PROD, (m) => logs.push(m));
    const line = logs.join("\n");
    expect(line).toMatch(/betaling=frisbii/);
    expect(line).toMatch(/APP_SECRET=sat/);
    expect(line).not.toContain(PROD.APP_SECRET);
    expect(line).toMatch(/MFA_ENCRYPTION_KEY=sat/);
    expect(line).not.toContain(PROD.MFA_ENCRYPTION_KEY);
    expect(line).not.toContain(PROD.FRISBII_PRIVATE_KEY);
    expect(line).not.toContain("0123456789abcdef");
    expect(line).toMatch(/db=abu_app@db\.internal \(sslmode=verify-full, pool=10\)/);
  });
});
