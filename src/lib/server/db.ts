import "server-only";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { initialiseData } from "./seed";

export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

type Backend =
  | { kind: "postgres"; pool: pg.Pool }
  | { kind: "pglite"; db: PGlite };

interface DbState {
  backend?: Promise<Backend>;
  ready?: Promise<void>;
}

// Next.js can evaluate this module in more than one module graph inside the
// same process; keep a single connection (and a single PGlite instance, which
// must never open the same data directory twice) on globalThis.
const globalState = globalThis as unknown as { __cpiDb?: DbState };
const state: DbState = (globalState.__cpiDb ??= {});

const INT8 = 20;
const NUMERIC = 1700;
pg.types.setTypeParser(INT8, (v) => Number(v));
pg.types.setTypeParser(NUMERIC, (v) => Number(v));

export function databaseKind(): "postgres" | "pglite" {
  return (process.env.DATABASE_URL?.trim() ?? "") !== "" ? "postgres" : "pglite";
}

function migrationsDir() {
  return path.join(process.cwd(), "migrations");
}

async function createBackend(): Promise<Backend> {
  const url = process.env.DATABASE_URL?.trim() ?? "";
  if (url !== "") {
    const pool = new pg.Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX ?? 5) });
    return { kind: "postgres", pool };
  }
  const dataDir = process.env.PGLITE_DATA_DIR?.trim() || ".data/pglite";
  const parsers = { [INT8]: (v: string) => Number(v), [NUMERIC]: (v: string) => Number(v) };
  if (dataDir === "memory") {
    return { kind: "pglite", db: new PGlite({ parsers }) };
  }
  await mkdir(dataDir, { recursive: true });
  return { kind: "pglite", db: new PGlite(dataDir, { parsers }) };
}

function backend(): Promise<Backend> {
  state.backend ??= createBackend().catch((error: unknown) => {
    state.backend = undefined;
    throw error;
  });
  return state.backend;
}

function executor(b: Backend): Queryable {
  if (b.kind === "postgres") {
    return {
      async query<T>(text: string, params: unknown[] = []) {
        return (await b.pool.query(text, params)).rows as T[];
      },
    };
  }
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await b.db.query<T>(text, params)).rows;
    },
  };
}

/** Applies pending migrations. Used for local PGlite and by scripts/migrate.mjs semantics. */
async function applyMigrations(b: Backend) {
  const q = executor(b);
  await q.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const done = new Set((await q.query<{ name: string }>("select name from schema_migrations")).map((r) => r.name));
  const files = (await readdir(migrationsDir()).catch(() => [] as string[])).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files.filter((f) => !done.has(f))) {
    const text = await readFile(path.join(migrationsDir(), file), "utf8");
    if (b.kind === "pglite") {
      await b.db.transaction(async (t) => {
        await t.exec(text);
        await t.query("insert into schema_migrations (name) values ($1)", [file]);
      });
    } else {
      await transactionOn(b, async (tx) => {
        await tx.query(text);
        await tx.query("insert into schema_migrations (name) values ($1)", [file]);
      });
    }
  }
}

async function transactionOn<T>(b: Backend, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  if (b.kind === "pglite") {
    return b.db.transaction(async (t) =>
      fn({
        async query<R>(text: string, params: unknown[] = []) {
          return (await t.query<R>(text, params)).rows;
        },
      }),
    );
  }
  const client = await b.pool.connect();
  try {
    await client.query("begin");
    const result = await fn({
      async query<R>(text: string, params: unknown[] = []) {
        return (await client.query(text, params)).rows as R[];
      },
    });
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function initialise() {
  const b = await backend();
  // Postgres deployments migrate during the build (scripts/migrate.mjs);
  // local PGlite (and any env that opts in) migrates on first use.
  if (b.kind === "pglite" || process.env.MIGRATE_ON_START === "true") {
    await applyMigrations(b);
  }
  await initialiseData(executor(b), (fn) => transactionOn(b, fn));
}

async function ready(): Promise<Backend> {
  state.ready ??= initialise().catch((error: unknown) => {
    state.ready = undefined;
    throw error;
  });
  await state.ready;
  return backend();
}

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return executor(await ready()).query<T>(text, params);
}

export async function withTransaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  return transactionOn(await ready(), fn);
}

export const db: Queryable = { query: sql };

/** Test helper: close and forget the current connection. */
export async function closeDatabase() {
  const current = state.backend;
  state.backend = undefined;
  state.ready = undefined;
  if (!current) return;
  const b = await current.catch(() => undefined);
  if (!b) return;
  if (b.kind === "postgres") await b.pool.end();
  else await b.db.close();
}
