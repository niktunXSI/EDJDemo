export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    // Loaded conditionally so the Edge runtime never evaluates Node-only modules (pg, PGlite, crypto).
    const { startInlineWorker } = await import("./lib/server/worker");
    startInlineWorker();
  }
}
