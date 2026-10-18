export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Fail-closed opstartstjek (C-1): ugyldig eller ikke-produktionsklar konfiguration stopper processen, før den tager imod trafik.
    const { assertBootConfig, EnvConfigError, resolveAppEnv } = await import("./lib/env");
    try {
      const env = assertBootConfig();
      // RLS fase 0: appen må ikke køre som superbruger/ejer/BYPASSRLS (én forespørgsel; rollenavnet logges, aldrig URL'en)
      const { assertDbRuntimeRole } = await import("./lib/db-guard");
      await assertDbRuntimeRole(env.DATABASE_URL, resolveAppEnv(env, process.env.NODE_ENV));
    } catch (e) {
      if (e instanceof EnvConfigError) {
        console.error(`[config] Appen starter ikke. ${e.message}\n[config] Se README («Deployment») og .env.example.`);
        process.exit(1);
      }
      throw e;
    }
    const { startScheduler } = await import("./instrumentation-node");
    startScheduler();
  }
}
