import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleServerless } from "drizzle-orm/neon-serverless";
import type { NeonTransaction } from "drizzle-orm/neon-serverless/session";
import { neon, neonConfig, Pool } from "@neondatabase/serverless";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import * as schema from "@/server/db/schema";

type HttpDb = ReturnType<typeof drizzleHttp<typeof schema>>;
type TransactionDb = NeonTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

let cachedDb: HttpDb | null = null;
let cachedAuthDb: HttpDb | null = null;

function getRequiredDatabaseUrl(key: "DATABASE_URL" | "AUTH_DATABASE_URL") {
  const databaseUrl =
    process.env[key] ?? (key === "AUTH_DATABASE_URL" ? process.env.DATABASE_URL : undefined);
  if (!databaseUrl) {
    throw new Error(`${key}_MISSING`);
  }
  return databaseUrl;
}

function createHttpDb(databaseUrl: string) {
  const sql = neon(databaseUrl);
  return drizzleHttp({ client: sql, schema });
}

async function withWebSocketPool<T>(
  databaseUrl: string,
  callback: (db: ReturnType<typeof drizzleServerless<typeof schema>>) => Promise<T>,
) {
  if (!neonConfig.webSocketConstructor) {
    const { default: WebSocket } = await import("ws");
    neonConfig.webSocketConstructor = WebSocket;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzleServerless({ client: pool, schema });

  try {
    return await callback(db);
  } finally {
    await pool.end();
  }
}

export function getDb() {
  if (cachedDb) return cachedDb;
  cachedDb = createHttpDb(getRequiredDatabaseUrl("DATABASE_URL"));
  return cachedDb;
}

export function getAuthDb() {
  if (cachedAuthDb) return cachedAuthDb;
  cachedAuthDb = createHttpDb(getRequiredDatabaseUrl("AUTH_DATABASE_URL"));
  return cachedAuthDb;
}

export async function runInTransaction<T>(
  callback: (tx: TransactionDb) => Promise<T>,
) {
  return withWebSocketPool(getRequiredDatabaseUrl("DATABASE_URL"), (db) =>
    db.transaction(callback),
  );
}

export async function runInAuthTransaction<T>(
  callback: (tx: TransactionDb) => Promise<T>,
) {
  return withWebSocketPool(getRequiredDatabaseUrl("AUTH_DATABASE_URL"), (db) =>
    db.transaction(callback),
  );
}
