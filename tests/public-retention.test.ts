import assert from "node:assert/strict";
import test from "node:test";

interface RecordedStatement {
  sql: string;
  bindings: unknown[];
}

test("scheduled public cleanup deletes a bounded expired-session set", async () => {
  const moduleUrl = new URL("../server/public-retention.mjs", import.meta.url)
    .href;
  const { deleteExpiredSandboxSessions } = (await import(moduleUrl)) as {
    deleteExpiredSandboxSessions: (
      database: unknown,
      nowMs: number,
    ) => Promise<void>;
  };
  const statements: RecordedStatement[] = [];
  const database = {
    prepare(sql: string) {
      const statement: RecordedStatement = { sql, bindings: [] };
      return {
        bind(...bindings: unknown[]) {
          statement.bindings = bindings;
          return statement;
        },
      };
    },
    async batch(batch: RecordedStatement[]) {
      statements.push(...batch);
      return [];
    },
  };

  await deleteExpiredSandboxSessions(database, 1_800_000_000_000);

  assert.equal(statements.length, 4);
  assert.deepEqual(
    statements.map(({ bindings }) => bindings),
    Array.from({ length: 4 }, () => [1_800_000_000_000]),
  );
  for (const { sql } of statements) {
    assert.match(sql, /expires_at_ms <= \?/);
    assert.match(sql, /ORDER BY expires_at_ms ASC/);
    assert.match(sql, /LIMIT 512/);
  }
  assert.match(statements[0]!.sql, /DELETE FROM operation_receipt/);
  assert.match(statements[1]!.sql, /DELETE FROM case_state/);
  assert.match(statements[2]!.sql, /DELETE FROM session_work_ledger/);
  assert.match(statements[3]!.sql, /DELETE FROM session_lease/);
});
