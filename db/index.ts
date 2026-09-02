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
  const columns = await db
    .prepare("PRAGMA table_info(operation_receipt)")
    .all<{ name: string }>();
  if (!columns.results.some((column) => column.name === "server_derived")) {
    await db
      .prepare(
        "ALTER TABLE operation_receipt ADD COLUMN server_derived INTEGER NOT NULL DEFAULT 0",
      )
      .run();
  }
  if (
    !columns.results.some((column) => column.name === "principal_assurance")
  ) {
    await db
      .prepare(
        "ALTER TABLE operation_receipt ADD COLUMN principal_assurance TEXT NOT NULL DEFAULT 'legacy_unrecorded'",
      )
      .run();
  }
}
