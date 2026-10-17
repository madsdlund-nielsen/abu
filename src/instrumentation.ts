export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Fail-closed opstartstjek (C-1): ugyldig eller ikke-produktionsklar konfiguration stopper processen, før den tager imod trafik.
    const { assertBootConfig, EnvConfigError } = await import("./lib/env");
    try {
      assertBootConfig();
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
