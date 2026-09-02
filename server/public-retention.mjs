const cleanupBatchSize = 512;

export async function deleteExpiredSandboxSessions(
  database,
  nowMs = Date.now(),
) {
  if (!database || !Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error("Public sandbox retention is not configured.");
  }
  const expiredSessions = `(SELECT session_id FROM session_lease
    WHERE expires_at_ms <= ?
    ORDER BY expires_at_ms ASC
    LIMIT ${cleanupBatchSize})`;
  await database.batch([
    database
      .prepare(
        `DELETE FROM operation_receipt
        WHERE session_id IN ${expiredSessions}`,
      )
      .bind(nowMs),
    database
      .prepare(`DELETE FROM case_state WHERE session_id IN ${expiredSessions}`)
      .bind(nowMs),
    database
      .prepare(
        `DELETE FROM session_work_ledger
        WHERE session_id IN ${expiredSessions}`,
      )
      .bind(nowMs),
    database
      .prepare(
        `DELETE FROM session_lease WHERE session_id IN ${expiredSessions}`,
      )
      .bind(nowMs),
  ]);
}
