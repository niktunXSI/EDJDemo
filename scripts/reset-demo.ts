// Resets and reseeds the demo database. Usage: npm run db:reset -- --confirm
// With local PGlite, stop the dev server first (only one process may open the data directory),
// or use "Reset demo data" in the app's account menu instead.
import { closeDatabase, databaseKind, withTransaction } from "../src/lib/server/db";
import { resetDemoData } from "../src/lib/server/seed";

async function main() {
  if ((process.env.DEMO_MODE ?? "true").toLowerCase() === "false") {
    console.error("Refusing to reset: DEMO_MODE=false for this environment.");
    process.exit(1);
  }
  if (!process.argv.includes("--confirm")) {
    console.error("This deletes all requests, notes, activity, and deliveries, then reseeds synthetic data.");
    console.error("Re-run with --confirm to proceed:  npm run db:reset -- --confirm");
    process.exit(1);
  }
  console.log(`Resetting demo data (${databaseKind()})…`);
  await withTransaction((tx) => resetDemoData(tx));
  await closeDatabase();
  console.log("Demo data reset complete. Integration settings and credentials were preserved.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
