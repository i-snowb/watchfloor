import { env } from "cloudflare:workers";
import { schemaStatements } from "./schema";

let schemaReady: Promise<void> | null = null;

export function getDb(): D1Database {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding DB is unavailable.");
  }
  return env.DB;
}

export async function ensureSchema(db: D1Database): Promise<void> {
  schemaReady ??= initializeSchema(db).catch((error: unknown) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

async function initializeSchema(db: D1Database): Promise<void> {
  for (const statement of schemaStatements) {
    await db.prepare(statement).run();
  }
}
