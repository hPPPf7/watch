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

export function getDb() {
  if (cachedDb) return cachedDb;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL_MISSING");
  }
  const sql = neon(databaseUrl);
  cachedDb = drizzleHttp({ client: sql, schema });
  return cachedDb;
}

export async function runInTransaction<T>(
  callback: (tx: TransactionDb) => Promise<T>,
) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL_MISSING");
  }

  // neon-http 不支援 transaction，所以需要交易的路徑改走 per-request Pool。
  if (!neonConfig.webSocketConstructor) {
    const { default: WebSocket } = await import("ws");
    neonConfig.webSocketConstructor = WebSocket;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzleServerless({ client: pool, schema });

  try {
    return await db.transaction(callback);
  } finally {
    await pool.end();
  }
}

