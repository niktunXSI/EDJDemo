import { databaseKind, sql } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";

export const GET = route(async () => {
  await sql("select 1");
  return json({ status: "ok", database: databaseKind(), time: new Date().toISOString() });
});
