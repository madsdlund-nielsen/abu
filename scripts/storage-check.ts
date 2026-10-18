/*
 * Tjekker objektlageret med appens egen konfiguration (STORAGE_PROVIDER, S3_*):
 *   npm run storage:check
 *   docker compose run --rm migrate npm run storage:check      # på serveren, med .env fra compose
 * Skriver, læser og sletter et lille testobjekt (healthcheck/…). Med S3 tjekkes også, at bucketten er privat, og at
 * CORS tillader direkte upload fra APP_URL. Afslutter med kode 1, hvis noget fejler. Udskriver aldrig nøgler.
 */
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

async function main() {
  const { getEnv } = await import("../src/lib/env");
  const { getStorage, directUploadOrigin } = await import("../src/lib/storage");
  const { runStorageCheck } = await import("../src/lib/storage/check");
  const env = getEnv();
  const storage = getStorage();
  console.log(
    storage.name === "s3"
      ? `Lager: S3 · endpoint ${env.S3_ENDPOINT} · region ${env.S3_REGION} · bucket ${env.S3_BUCKET} · ${env.S3_FORCE_PATH_STYLE ? "path-style" : "virtual-hosted"} · nøgle ${env.S3_ACCESS_KEY_ID ? "sat" : "MANGLER"}`
      : `Lager: lokal mappe ${env.UPLOAD_DIR} (kun udvikling – produktion kræver STORAGE_PROVIDER=s3)`,
  );
  let s3;
  if (storage.name === "s3") {
    const origin = directUploadOrigin({ endpoint: env.S3_ENDPOINT, bucket: env.S3_BUCKET, forcePathStyle: env.S3_FORCE_PATH_STYLE });
    const base = env.S3_FORCE_PATH_STYLE ? `${origin}/${env.S3_BUCKET}` : `${origin}`;
    s3 = { objectUrl: (key: string) => `${base}/${key}`, uploadUrl: base, appOrigin: new URL(env.APP_URL).origin };
  }
  const lines = await runStorageCheck(storage, s3);
  for (const l of lines) console.log(`${l.ok ? (l.warn ? "ADVARSEL" : "OK      ") : "FEJL    "} ${l.text}`);
  const failed = lines.some((l) => !l.ok);
  console.log(failed ? "\nLageret virker IKKE korrekt – se FEJL ovenfor." : "\nLageret virker.");
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error("storage:check fejlede:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
