import { ensureSchema, getDb } from "@/db";
import type { StoredToolResponse, ToolApiResult } from "@/domain/api";
import { parseCaseState } from "@/domain/case-state";
import { deriveReceiptReferences } from "@/domain/receipt-lineage";
import {
  createInitialCaseState,
  deterministicTimestamp,
  executeCaseTool,
  type CaseToolRequest,
} from "@/domain/operations";
import type {
  CaseFixture,
  CaseSnapshot,
  OperationReceipt,
} from "@/domain/types";
import {
  classifyPublicSessionAdmission,
  MAX_ACTIVE_PUBLIC_SESSIONS,
  PUBLIC_SESSION_ADMISSION_LIMIT,
  PUBLIC_SESSION_ADMISSION_WINDOW_MS,
  PUBLIC_SESSION_TTL_MS,
} from "@/server/public-session-admission";

interface CaseStateRow {
  fixture_version: string;
  generation: number;
  revision: number;
  activity_sequence: number;
  state_json: string;
}

interface ReceiptRow {
  request_id: string;
  receipt_id: string;
  generation: number;
  logical_sequence: number;
  reported_surface: string;
  attribution_assurance: string;
  tool_name: string;
  title: string;
  target: string | null;
  result_summary: string;
  status: string;
  base_revision: number;
  result_revision: number;
  occurred_at: string;
  input_json: string;
  output_json: string;
  server_derived: number;
  principal_assurance: OperationReceipt["actorAssurance"];
}

interface PriorReceiptRow {
  reported_surface: string;
  tool_name: string;
  input_json: string;
  output_json: string;
}

interface SessionLeaseRow {
  expires_at_ms: number;
}

interface WorkLedgerRow {
  case_id: string;
  generation: number;
  work_kind: "mutation" | "reset";
}

const MAX_STATE_CHANGES_PER_GENERATION = 64;
// A full endpoint rehearsal uses 28 state changes and a cloud rehearsal uses
// about 20. This permits four endpoint rehearsals plus two cloud rehearsals in
// one 24-hour browser session, while the existing burst limits constrain abuse.
export const PUBLIC_SANDBOX_SESSION_MUTATION_BUDGET = 160;
export const PUBLIC_SANDBOX_SESSION_RESET_BUDGET = 12;
const CLEANUP_SESSION_BATCH = 4;

export async function loadCaseSnapshot(
  sessionId: string,
  fixture: CaseFixture,
): Promise<CaseSnapshot> {
  const db = getDb();
  await ensureSchema(db);
  if (sessionId.startsWith("anon_")) {
    const lease = await db
      .prepare("SELECT expires_at_ms FROM session_lease WHERE session_id = ?")
      .bind(sessionId)
      .first<SessionLeaseRow>();
    if (lease && lease.expires_at_ms <= Date.now()) {
      await deleteSessionData(db, sessionId);
      return { state: createInitialCaseState(fixture), receipts: [] };
    }
  }
  const row = await readStateRow(db, sessionId, fixture.id);
  if (!row || row.fixture_version !== fixture.fixtureVersion) {
    return { state: createInitialCaseState(fixture), receipts: [] };
  }
  try {
    parseCaseState(row.state_json, fixture);
  } catch {
    return { state: createInitialCaseState(fixture), receipts: [] };
  }
  return readSnapshot(db, sessionId, fixture);
}

export async function resetCase(
  sessionId: string,
  fixture: CaseFixture,
  requestId: string,
  expectedRevision: number,
  publicSandbox = false,
): Promise<CaseSnapshot> {
  const db = getDb();
  await ensureSchema(db);
  const nowMs = Date.now();
  if (publicSandbox) {
    await cleanupExpiredSessions(db, nowMs);
    await deleteExpiredSessionIfNeeded(db, sessionId, nowMs);
    const priorReset = await readPriorWork(
      db,
      sessionId,
      fixture.id,
      requestId,
    );
    if (priorReset) {
      if (priorReset.work_kind !== "reset") {
        throw new Error("REQUEST_ID_REUSE");
      }
      return readSnapshot(db, sessionId, fixture);
    }
  }
  const state = createInitialCaseState(fixture);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await readStateRow(db, sessionId, fixture.id);
    if (!row) {
      if (expectedRevision !== 1) throw new Error("RESET_REVISION_CONFLICT");
      if (!publicSandbox) {
        const insert = await db
          .prepare(
            `INSERT INTO case_state (
              session_id, case_id, fixture_version, generation, revision,
              activity_sequence, state_json, updated_at
            ) VALUES (?, ?, ?, 1, ?, 0, ?, ?)
            ON CONFLICT (session_id, case_id) DO NOTHING`,
          )
          .bind(
            sessionId,
            fixture.id,
            fixture.fixtureVersion,
            state.revision,
            JSON.stringify(state),
            deterministicTimestamp(0),
          )
          .run();
        if (insert.meta.changes === 1) return { state, receipts: [] };
        continue;
      }
      await ensureActiveSessionLease(db, sessionId, nowMs);
      const writes = await db.batch([
        db
          .prepare(
            `INSERT INTO case_state (
            session_id, case_id, fixture_version, generation, revision,
            activity_sequence, state_json, updated_at
          )
          SELECT ?, ?, ?, 1, ?, 0, ?, ?
          WHERE (
            SELECT COUNT(*) FROM session_work_ledger
            WHERE session_id = ? AND work_kind = 'reset'
              AND expires_at_ms > ?
          ) < ?
          ON CONFLICT (session_id, case_id) DO NOTHING`,
          )
          .bind(
            sessionId,
            fixture.id,
            fixture.fixtureVersion,
            state.revision,
            JSON.stringify(state),
            deterministicTimestamp(0),
            sessionId,
            nowMs,
            PUBLIC_SANDBOX_SESSION_RESET_BUDGET,
          ),
        db
          .prepare(
            `INSERT INTO session_work_ledger (
              session_id, request_id, case_id, generation, work_kind,
              created_at_ms, expires_at_ms
            )
            SELECT ?, ?, ?, 1, 'reset', ?, ?
            FROM case_state
            WHERE session_id = ? AND case_id = ? AND generation = 1
              AND revision = 1 AND activity_sequence = 0
              AND (
                SELECT COUNT(*) FROM session_work_ledger
                WHERE session_id = ? AND work_kind = 'reset'
                  AND expires_at_ms > ?
              ) < ?
            ON CONFLICT DO NOTHING`,
          )
          .bind(
            sessionId,
            requestId,
            fixture.id,
            nowMs,
            nowMs + PUBLIC_SESSION_TTL_MS,
            sessionId,
            fixture.id,
            sessionId,
            nowMs,
            PUBLIC_SANDBOX_SESSION_RESET_BUDGET,
          ),
      ]);
      if (writes[0]?.meta.changes === 1 && writes[1]?.meta.changes === 1) {
        return { state, receipts: [] };
      }
      if (
        (await countActiveWork(db, sessionId, "reset", nowMs)) >=
        PUBLIC_SANDBOX_SESSION_RESET_BUDGET
      ) {
        throw new Error("SESSION_RESET_LIMIT_REACHED");
      }
      continue;
    }

    if (row.revision !== expectedRevision) {
      throw new Error("RESET_REVISION_CONFLICT");
    }

    const nextGeneration = row.generation + 1;
    if (!publicSandbox) {
      const writes = await db.batch([
        db
          .prepare(
            `UPDATE case_state
            SET fixture_version = ?, generation = ?, revision = ?,
              activity_sequence = 0, state_json = ?, updated_at = ?
            WHERE session_id = ? AND case_id = ? AND generation = ?
              AND revision = ? AND activity_sequence = ?`,
          )
          .bind(
            fixture.fixtureVersion,
            nextGeneration,
            state.revision,
            JSON.stringify(state),
            deterministicTimestamp(0),
            sessionId,
            fixture.id,
            row.generation,
            row.revision,
            row.activity_sequence,
          ),
        db
          .prepare(
            `DELETE FROM operation_receipt
            WHERE session_id = ? AND case_id = ? AND generation = ?
              AND EXISTS (
                SELECT 1 FROM case_state
                WHERE session_id = ? AND case_id = ? AND generation = ?
              )`,
          )
          .bind(
            sessionId,
            fixture.id,
            row.generation,
            sessionId,
            fixture.id,
            nextGeneration,
          ),
      ]);
      if (writes[0]?.meta.changes === 1) return { state, receipts: [] };
      continue;
    }
    await ensureActiveSessionLease(db, sessionId, nowMs);
    const writes = await db.batch([
      db
        .prepare(
          `INSERT INTO session_work_ledger (
            session_id, request_id, case_id, generation, work_kind,
            created_at_ms, expires_at_ms
          )
          SELECT ?, ?, ?, ?, 'reset', ?, ?
          FROM case_state
          WHERE session_id = ? AND case_id = ? AND generation = ?
            AND revision = ? AND activity_sequence = ?
            AND (
              SELECT COUNT(*) FROM session_work_ledger
              WHERE session_id = ? AND work_kind = 'reset'
                AND expires_at_ms > ?
            ) < ?
          ON CONFLICT DO NOTHING`,
        )
        .bind(
          sessionId,
          requestId,
          fixture.id,
          nextGeneration,
          nowMs,
          nowMs + PUBLIC_SESSION_TTL_MS,
          sessionId,
          fixture.id,
          row.generation,
          row.revision,
          row.activity_sequence,
          sessionId,
          nowMs,
          PUBLIC_SANDBOX_SESSION_RESET_BUDGET,
        ),
      db
        .prepare(
          `UPDATE case_state
          SET fixture_version = ?, generation = ?, revision = ?,
            activity_sequence = 0, state_json = ?, updated_at = ?
          WHERE session_id = ? AND case_id = ? AND generation = ?
            AND revision = ? AND activity_sequence = ?
            AND EXISTS (
              SELECT 1 FROM session_work_ledger
              WHERE session_id = ? AND case_id = ? AND generation = ?
                AND request_id = ? AND work_kind = 'reset'
            )`,
        )
        .bind(
          fixture.fixtureVersion,
          nextGeneration,
          state.revision,
          JSON.stringify(state),
          deterministicTimestamp(0),
          sessionId,
          fixture.id,
          row.generation,
          row.revision,
          row.activity_sequence,
          sessionId,
          fixture.id,
          nextGeneration,
          requestId,
        ),
      db
        .prepare(
          `DELETE FROM operation_receipt
          WHERE session_id = ? AND case_id = ? AND generation = ?
            AND EXISTS (
              SELECT 1 FROM case_state
              WHERE session_id = ? AND case_id = ? AND generation = ?
            )
            AND EXISTS (
              SELECT 1 FROM session_work_ledger
              WHERE session_id = ? AND case_id = ? AND generation = ?
                AND request_id = ? AND work_kind = 'reset'
            )`,
        )
        .bind(
          sessionId,
          fixture.id,
          row.generation,
          sessionId,
          fixture.id,
          nextGeneration,
          sessionId,
          fixture.id,
          nextGeneration,
          requestId,
        ),
    ]);
    if (writes[0]?.meta.changes === 1 && writes[1]?.meta.changes === 1) {
      return { state, receipts: [] };
    }
    if (
      (await countActiveWork(db, sessionId, "reset", nowMs)) >=
      PUBLIC_SANDBOX_SESSION_RESET_BUDGET
    ) {
      throw new Error("SESSION_RESET_LIMIT_REACHED");
    }
  }
  throw new Error("Case reset conflicted with another operation.");
}

export async function executeStoredTool(
  sessionId: string,
  fixture: CaseFixture,
  request: CaseToolRequest,
  actorAssurance: OperationReceipt["actorAssurance"] = "local_development",
): Promise<StoredToolResponse> {
  const db = getDb();
  await ensureSchema(db);
  const nowMs = Date.now();
  const publicSandbox = actorAssurance === "anonymous_sandbox";
  if (publicSandbox) {
    await cleanupExpiredSessions(db, nowMs);
    const nonDurable = await executePublicNonDurableOperation(
      db,
      sessionId,
      fixture,
      request,
      nowMs,
    );
    if (nonDurable) return nonDurable;
    await ensureActiveSessionLease(db, sessionId, nowMs);
  }
  await ensureSeededCase(db, sessionId, fixture);
  const inputJson = stableJson(request.input);
  let requestGeneration: number | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await readStateRow(db, sessionId, fixture.id);
    if (!row) {
      await ensureSeededCase(db, sessionId, fixture);
      continue;
    }
    if (requestGeneration === null) {
      requestGeneration = row.generation;
    } else if (row.generation !== requestGeneration) {
      return resetOccurredResponse(
        request.requestId,
        fixture,
        await readSnapshot(db, sessionId, fixture),
      );
    }

    const prior = await readPriorReceipt(
      db,
      sessionId,
      fixture.id,
      row.generation,
      request.requestId,
    );
    if (prior) {
      const snapshot = await readSnapshot(db, sessionId, fixture);
      if (
        prior.reported_surface !== request.reportedSurface ||
        prior.tool_name !== request.toolName ||
        prior.input_json !== inputJson
      ) {
        return {
          result: {
            ok: false,
            requestId: request.requestId,
            caseId: fixture.id,
            revision: snapshot.state.revision,
            error: {
              code: "REQUEST_ID_REUSE",
              message: "requestId was already used with different input.",
              retryable: false,
            },
          },
          snapshot,
        };
      }
      return {
        result: parseStoredResult(prior.output_json),
        snapshot,
      };
    }

    // Lineage uses one current snapshot so released state and trusted receipt
    // history cannot come from different revisions.
    const lineageSnapshot =
      request.toolName === "trace_evidence_lineage"
        ? await readSnapshot(db, sessionId, fixture)
        : null;
    const state =
      lineageSnapshot?.state ?? parseCaseState(row.state_json, fixture);
    const outcome = executeCaseTool(fixture, state, request, {
      receipts: lineageSnapshot?.receipts ?? [],
    });
    if (
      outcome.ok &&
      outcome.mutatesState &&
      row.revision - 1 >= MAX_STATE_CHANGES_PER_GENERATION
    ) {
      return mutationLimitResponse(
        request.requestId,
        fixture,
        await readSnapshot(db, sessionId, fixture),
      );
    }
    const result: ToolApiResult = outcome.ok
      ? {
          ok: true,
          requestId: request.requestId,
          caseId: fixture.id,
          revision: outcome.state.revision,
          data: outcome.data,
        }
      : {
          ok: false,
          requestId: request.requestId,
          caseId: fixture.id,
          revision: outcome.state.revision,
          error: outcome.error,
        };
    if (publicSandbox && (!outcome.ok || !outcome.mutatesState)) {
      return {
        result,
        snapshot: await readSnapshot(db, sessionId, fixture),
      };
    }
    const nextSequence = row.activity_sequence + 1;
    const receiptPrefix = fixture.id
      .replace(/^case-/, "")
      .replace(/[^A-Za-z0-9]/g, "-")
      .toUpperCase();
    const receiptId = `RCP-${receiptPrefix}-${String(nextSequence).padStart(4, "0")}`;
    const status = outcome.ok ? "completed" : "rejected";
    const outputJson = JSON.stringify(result);
    const resultRevision = outcome.state.revision;
    const consumesMutationBudget =
      publicSandbox && outcome.ok && outcome.mutatesState;

    try {
      const statements: D1PreparedStatement[] = [];
      if (consumesMutationBudget) {
        statements.push(
          db
            .prepare(
              `INSERT INTO session_work_ledger (
                session_id, request_id, case_id, generation, work_kind,
                created_at_ms, expires_at_ms
              )
              SELECT ?, ?, ?, ?, 'mutation', ?, ?
              FROM case_state
              WHERE session_id = ? AND case_id = ? AND generation = ?
                AND activity_sequence = ? AND revision = ?
                AND (
                  SELECT COUNT(*) FROM session_work_ledger
                  WHERE session_id = ? AND work_kind = 'mutation'
                    AND expires_at_ms > ?
                ) < ?
              ON CONFLICT DO NOTHING`,
            )
            .bind(
              sessionId,
              request.requestId,
              fixture.id,
              row.generation,
              nowMs,
              nowMs + PUBLIC_SESSION_TTL_MS,
              sessionId,
              fixture.id,
              row.generation,
              row.activity_sequence,
              row.revision,
              sessionId,
              nowMs,
              PUBLIC_SANDBOX_SESSION_MUTATION_BUDGET,
            ),
        );
      }
      const budgetGuard = consumesMutationBudget
        ? `AND EXISTS (
            SELECT 1 FROM session_work_ledger
            WHERE session_id = ? AND case_id = ? AND generation = ?
              AND request_id = ? AND work_kind = 'mutation'
          )`
        : "";
      const budgetBindings = consumesMutationBudget
        ? [sessionId, fixture.id, row.generation, request.requestId]
        : [];
      statements.push(
        db
          .prepare(
            `INSERT INTO operation_receipt (
              session_id, case_id, request_id, receipt_id, generation,
              logical_sequence, reported_surface, attribution_assurance,
              tool_name, title, target, result_summary, status, base_revision,
              result_revision, occurred_at, input_json, output_json,
              server_derived, principal_assurance
            )
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?
            FROM case_state
            WHERE session_id = ? AND case_id = ? AND generation = ?
              AND activity_sequence = ? AND revision = ?
              ${budgetGuard}`,
          )
          .bind(
            sessionId,
            fixture.id,
            request.requestId,
            receiptId,
            row.generation,
            nextSequence,
            request.reportedSurface,
            "client_reported_unauthenticated",
            request.toolName,
            outcome.receipt.title,
            outcome.receipt.target,
            outcome.receipt.resultSummary,
            status,
            row.revision,
            resultRevision,
            deterministicTimestamp(nextSequence),
            inputJson,
            outputJson,
            actorAssurance,
            sessionId,
            fixture.id,
            row.generation,
            row.activity_sequence,
            row.revision,
            ...budgetBindings,
          ),
        db
          .prepare(
            `UPDATE case_state
            SET fixture_version = ?, revision = ?, activity_sequence = ?,
              state_json = ?, updated_at = ?
            WHERE session_id = ? AND case_id = ? AND generation = ?
              AND activity_sequence = ? AND revision = ?
              ${budgetGuard}`,
          )
          .bind(
            fixture.fixtureVersion,
            resultRevision,
            nextSequence,
            JSON.stringify(outcome.state),
            deterministicTimestamp(nextSequence),
            sessionId,
            fixture.id,
            row.generation,
            row.activity_sequence,
            row.revision,
            ...budgetBindings,
          ),
      );
      const writes = await db.batch(statements);
      const receiptWrite = writes[consumesMutationBudget ? 1 : 0];
      const stateWrite = writes[consumesMutationBudget ? 2 : 1];
      if (!receiptWrite || !stateWrite) {
        throw new Error("D1 did not return both operation write results.");
      }
      if (receiptWrite.meta.changes === 1 && stateWrite.meta.changes === 1) {
        return {
          result,
          snapshot: await readSnapshot(db, sessionId, fixture),
        };
      }
      if (
        consumesMutationBudget &&
        (await countActiveWork(db, sessionId, "mutation", nowMs)) >=
          PUBLIC_SANDBOX_SESSION_MUTATION_BUDGET
      ) {
        return sessionMutationLimitResponse(
          request.requestId,
          fixture,
          await readSnapshot(db, sessionId, fixture),
        );
      }
    } catch (error) {
      const raced = await readPriorReceipt(
        db,
        sessionId,
        fixture.id,
        row.generation,
        request.requestId,
      );
      if (!raced && attempt === 2) throw error;
    }
  }

  const finalRow = await readStateRow(db, sessionId, fixture.id);
  const snapshot = await readSnapshot(db, sessionId, fixture);
  if (
    requestGeneration !== null &&
    finalRow?.generation !== requestGeneration
  ) {
    return resetOccurredResponse(request.requestId, fixture, snapshot);
  }
  return {
    result: {
      ok: false,
      requestId: request.requestId,
      caseId: fixture.id,
      revision: snapshot.state.revision,
      error: {
        code: "CONCURRENT_UPDATE",
        message:
          "The case changed while the operation was running. Read context and retry.",
        retryable: true,
      },
    },
    snapshot,
  };
}

async function executePublicNonDurableOperation(
  db: D1Database,
  sessionId: string,
  fixture: CaseFixture,
  request: CaseToolRequest,
  nowMs: number,
): Promise<StoredToolResponse | null> {
  const expired = await deleteExpiredSessionIfNeeded(db, sessionId, nowMs);
  const lease = expired
    ? null
    : await db
        .prepare("SELECT expires_at_ms FROM session_lease WHERE session_id = ?")
        .bind(sessionId)
        .first<SessionLeaseRow>();
  const row = lease ? await readStateRow(db, sessionId, fixture.id) : null;
  let state = createInitialCaseState(fixture);
  let snapshot: CaseSnapshot = { state, receipts: [] };
  if (row?.fixture_version === fixture.fixtureVersion) {
    try {
      state = parseCaseState(row.state_json, fixture);
      snapshot = await readSnapshot(db, sessionId, fixture);
    } catch {
      state = createInitialCaseState(fixture);
      snapshot = { state, receipts: [] };
    }
  }

  if (row && snapshot.receipts.length > 0) {
    const prior = await readPriorReceipt(
      db,
      sessionId,
      fixture.id,
      row.generation,
      request.requestId,
    );
    if (prior) {
      if (
        prior.reported_surface !== request.reportedSurface ||
        prior.tool_name !== request.toolName ||
        prior.input_json !== stableJson(request.input)
      ) {
        return {
          result: {
            ok: false,
            requestId: request.requestId,
            caseId: fixture.id,
            revision: snapshot.state.revision,
            error: {
              code: "REQUEST_ID_REUSE",
              message: "requestId was already used with different input.",
              retryable: false,
            },
          },
          snapshot,
        };
      }
      return { result: parseStoredResult(prior.output_json), snapshot };
    }
  }

  const executionState =
    request.toolName === "trace_evidence_lineage" ? snapshot.state : state;
  const outcome = executeCaseTool(fixture, executionState, request, {
    receipts:
      request.toolName === "trace_evidence_lineage" ? snapshot.receipts : [],
  });
  if (outcome.ok && outcome.mutatesState) return null;
  const result: ToolApiResult = outcome.ok
    ? {
        ok: true,
        requestId: request.requestId,
        caseId: fixture.id,
        revision: outcome.state.revision,
        data: outcome.data,
      }
    : {
        ok: false,
        requestId: request.requestId,
        caseId: fixture.id,
        revision: outcome.state.revision,
        error: outcome.error,
      };
  return { result, snapshot };
}

async function ensureSeededCase(
  db: D1Database,
  sessionId: string,
  fixture: CaseFixture,
): Promise<void> {
  const state = createInitialCaseState(fixture);
  await db
    .prepare(
      `INSERT INTO case_state (
        session_id, case_id, fixture_version, generation, revision,
        activity_sequence, state_json, updated_at
      ) VALUES (?, ?, ?, 1, ?, 0, ?, ?)
      ON CONFLICT (session_id, case_id) DO NOTHING`,
    )
    .bind(
      sessionId,
      fixture.id,
      fixture.fixtureVersion,
      state.revision,
      JSON.stringify(state),
      deterministicTimestamp(0),
    )
    .run();

  const row = await readStateRow(db, sessionId, fixture.id);
  if (!row || row.fixture_version !== fixture.fixtureVersion) {
    await repairStoredCase(db, sessionId, fixture, row?.generation ?? 0);
    return;
  }

  try {
    parseCaseState(row.state_json, fixture);
  } catch {
    await repairStoredCase(db, sessionId, fixture, row.generation);
  }
}

async function repairStoredCase(
  db: D1Database,
  sessionId: string,
  fixture: CaseFixture,
  previousGeneration: number,
): Promise<void> {
  const state = createInitialCaseState(fixture);
  const generation = Math.max(1, previousGeneration + 1);
  await db.batch([
    db
      .prepare(
        "DELETE FROM operation_receipt WHERE session_id = ? AND case_id = ?",
      )
      .bind(sessionId, fixture.id),
    db
      .prepare(
        `INSERT INTO case_state (
          session_id, case_id, fixture_version, generation, revision,
          activity_sequence, state_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT (session_id, case_id) DO UPDATE SET
          fixture_version = excluded.fixture_version,
          generation = excluded.generation,
          revision = excluded.revision,
          activity_sequence = 0,
          state_json = excluded.state_json,
          updated_at = excluded.updated_at`,
      )
      .bind(
        sessionId,
        fixture.id,
        fixture.fixtureVersion,
        generation,
        state.revision,
        JSON.stringify(state),
        deterministicTimestamp(0),
      ),
  ]);
}

async function ensureActiveSessionLease(
  db: D1Database,
  sessionId: string,
  nowMs: number,
): Promise<void> {
  const lease = await db
    .prepare("SELECT expires_at_ms FROM session_lease WHERE session_id = ?")
    .bind(sessionId)
    .first<SessionLeaseRow>();
  if (lease && lease.expires_at_ms <= nowMs) {
    await deleteSessionData(db, sessionId);
  } else if (lease) {
    return;
  }
  const inserted = await db
    .prepare(
      `INSERT INTO session_lease (
        session_id, created_at_ms, last_activity_at_ms, expires_at_ms
      )
      SELECT ?, ?, ?, ?
      WHERE (
        SELECT COUNT(*) FROM session_lease WHERE expires_at_ms > ?
      ) < ?
      AND (
        SELECT COUNT(*) FROM session_lease WHERE created_at_ms > ?
      ) < ?
      ON CONFLICT (session_id) DO NOTHING`,
    )
    .bind(
      sessionId,
      nowMs,
      nowMs,
      nowMs + PUBLIC_SESSION_TTL_MS,
      nowMs,
      MAX_ACTIVE_PUBLIC_SESSIONS,
      nowMs - PUBLIC_SESSION_ADMISSION_WINDOW_MS,
      PUBLIC_SESSION_ADMISSION_LIMIT,
    )
    .run();
  if (inserted.meta.changes === 1) return;
  const raced = await db
    .prepare("SELECT expires_at_ms FROM session_lease WHERE session_id = ?")
    .bind(sessionId)
    .first<SessionLeaseRow>();
  if (raced && raced.expires_at_ms > nowMs) return;
  const admission = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM session_lease WHERE expires_at_ms > ?) AS active_count,
        (SELECT COUNT(*) FROM session_lease WHERE created_at_ms > ?) AS recent_count`,
    )
    .bind(nowMs, nowMs - PUBLIC_SESSION_ADMISSION_WINDOW_MS)
    .first<{ active_count: number; recent_count: number }>();
  const decision = classifyPublicSessionAdmission(
    admission?.active_count ?? 0,
    admission?.recent_count ?? 0,
  );
  if (decision === "rate_limited") {
    throw new Error("PUBLIC_SESSION_ADMISSION_RATE_LIMITED");
  }
  throw new Error("PUBLIC_SANDBOX_AT_CAPACITY");
}

async function deleteExpiredSessionIfNeeded(
  db: D1Database,
  sessionId: string,
  nowMs: number,
): Promise<boolean> {
  const lease = await db
    .prepare("SELECT expires_at_ms FROM session_lease WHERE session_id = ?")
    .bind(sessionId)
    .first<SessionLeaseRow>();
  if (!lease || lease.expires_at_ms > nowMs) return false;
  await deleteSessionData(db, sessionId);
  return true;
}

async function cleanupExpiredSessions(
  db: D1Database,
  nowMs: number,
): Promise<void> {
  const expired = await db
    .prepare(
      `SELECT session_id FROM session_lease
      WHERE expires_at_ms <= ?
      ORDER BY expires_at_ms ASC
      LIMIT ?`,
    )
    .bind(nowMs, CLEANUP_SESSION_BATCH)
    .all<{ session_id: string }>();
  for (const row of expired.results) {
    await deleteSessionData(db, row.session_id);
  }
  await db
    .prepare(
      `DELETE FROM session_work_ledger
      WHERE rowid IN (
        SELECT rowid FROM session_work_ledger
        WHERE expires_at_ms <= ?
        ORDER BY expires_at_ms ASC
        LIMIT 128
      )`,
    )
    .bind(nowMs)
    .run();
}

async function deleteSessionData(
  db: D1Database,
  sessionId: string,
): Promise<void> {
  await db.batch([
    db
      .prepare("DELETE FROM operation_receipt WHERE session_id = ?")
      .bind(sessionId),
    db.prepare("DELETE FROM case_state WHERE session_id = ?").bind(sessionId),
    db
      .prepare("DELETE FROM session_work_ledger WHERE session_id = ?")
      .bind(sessionId),
    db
      .prepare("DELETE FROM session_lease WHERE session_id = ?")
      .bind(sessionId),
  ]);
}

async function countActiveWork(
  db: D1Database,
  sessionId: string,
  workKind: "mutation" | "reset",
  nowMs: number,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM session_work_ledger
      WHERE session_id = ? AND work_kind = ? AND expires_at_ms > ?`,
    )
    .bind(sessionId, workKind, nowMs)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function readPriorWork(
  db: D1Database,
  sessionId: string,
  caseId: string,
  requestId: string,
): Promise<WorkLedgerRow | null> {
  return db
    .prepare(
      `SELECT case_id, generation, work_kind
      FROM session_work_ledger
      WHERE session_id = ? AND case_id = ? AND request_id = ?
      ORDER BY generation DESC LIMIT 1`,
    )
    .bind(sessionId, caseId, requestId)
    .first<WorkLedgerRow>();
}

async function readStateRow(
  db: D1Database,
  sessionId: string,
  caseId: string,
): Promise<CaseStateRow | null> {
  return db
    .prepare(
      `SELECT fixture_version, generation, revision, activity_sequence, state_json
      FROM case_state WHERE session_id = ? AND case_id = ?`,
    )
    .bind(sessionId, caseId)
    .first<CaseStateRow>();
}

async function readSnapshot(
  db: D1Database,
  sessionId: string,
  fixture: CaseFixture,
): Promise<CaseSnapshot> {
  const row = await readStateRow(db, sessionId, fixture.id);
  if (!row) {
    throw new Error(`Case state ${fixture.id} is unavailable.`);
  }
  const result = await db
    .prepare(
      `SELECT request_id, receipt_id, generation, logical_sequence,
        reported_surface, attribution_assurance, tool_name, title, target,
        result_summary, status, base_revision,
        result_revision, occurred_at, input_json, output_json, server_derived,
        principal_assurance
      FROM operation_receipt
      WHERE session_id = ? AND case_id = ? AND generation = ?
      ORDER BY logical_sequence ASC`,
    )
    .bind(sessionId, fixture.id, row.generation)
    .all<ReceiptRow>();
  return {
    state: parseCaseState(row.state_json, fixture),
    receipts: result.results.map(parseReceipt),
  };
}

async function readPriorReceipt(
  db: D1Database,
  sessionId: string,
  caseId: string,
  generation: number,
  requestId: string,
): Promise<PriorReceiptRow | null> {
  return db
    .prepare(
      `SELECT reported_surface, tool_name, input_json, output_json
      FROM operation_receipt
      WHERE session_id = ? AND case_id = ? AND generation = ?
        AND request_id = ?`,
    )
    .bind(sessionId, caseId, generation, requestId)
    .first<PriorReceiptRow>();
}

function parseReceipt(row: ReceiptRow): OperationReceipt {
  if (
    !["webmcp_callback", "analyst_control"].includes(row.reported_surface) ||
    row.attribution_assurance !== "client_reported_unauthenticated" ||
    ![0, 1].includes(row.server_derived) ||
    ![
      "anonymous_sandbox",
      "cloudflare_access_verified",
      "local_development",
      "openai_sites_authenticated",
      "legacy_unrecorded",
    ].includes(row.principal_assurance) ||
    !["completed", "rejected"].includes(row.status)
  ) {
    throw new Error(`Stored receipt ${row.receipt_id} is invalid.`);
  }
  const references = deriveReceiptReferences(row.input_json, row.output_json);
  return {
    id: row.receipt_id,
    requestId: row.request_id,
    sequence: row.logical_sequence,
    reportedSurface:
      row.reported_surface as OperationReceipt["reportedSurface"],
    attributionAssurance:
      row.server_derived === 1
        ? "server_channel_assigned"
        : "client_reported_unauthenticated",
    actorAssurance: row.principal_assurance,
    toolName: row.tool_name,
    title: row.title,
    target: row.target,
    resultSummary: row.result_summary,
    status: row.status as OperationReceipt["status"],
    baseRevision: row.base_revision,
    resultRevision: row.result_revision,
    occurredAt: row.occurred_at,
    ...(references ? { references } : {}),
  };
}

function resetOccurredResponse(
  requestId: string,
  fixture: CaseFixture,
  snapshot: CaseSnapshot,
): StoredToolResponse {
  return {
    result: {
      ok: false,
      requestId,
      caseId: fixture.id,
      revision: snapshot.state.revision,
      error: {
        code: "RESET_OCCURRED",
        message:
          "The case was reset while the operation was running. Read current context and submit a new request.",
        retryable: true,
      },
    },
    snapshot,
  };
}

function mutationLimitResponse(
  requestId: string,
  fixture: CaseFixture,
  snapshot: CaseSnapshot,
): StoredToolResponse {
  return {
    result: {
      ok: false,
      requestId,
      caseId: fixture.id,
      revision: snapshot.state.revision,
      error: {
        code: "STATE_CHANGE_LIMIT_REACHED",
        message:
          "This case generation reached its 64-state-change limit. Reset the case to continue.",
        retryable: false,
      },
    },
    snapshot,
  };
}

function sessionMutationLimitResponse(
  requestId: string,
  fixture: CaseFixture,
  snapshot: CaseSnapshot,
): StoredToolResponse {
  return {
    result: {
      ok: false,
      requestId,
      caseId: fixture.id,
      revision: snapshot.state.revision,
      error: {
        code: "SESSION_WORK_LIMIT_REACHED",
        message:
          "This sandbox session reached its 24-hour state-change limit. Start a fresh sandbox session from the case menu to continue; the prior session remains isolated.",
        retryable: false,
      },
    },
    snapshot,
  };
}

function parseStoredResult(value: string): ToolApiResult {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || typeof parsed.ok !== "boolean") {
    throw new Error("Stored operation output is invalid.");
  }
  return parsed as unknown as ToolApiResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
