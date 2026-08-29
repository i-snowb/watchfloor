import { ensureSchema, getDb } from "@/db";
import type { ToolApiResponse, ToolApiResult } from "@/domain/api";
import { parseCaseState } from "@/domain/case-state";
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
}

interface PriorReceiptRow {
  reported_surface: string;
  tool_name: string;
  input_json: string;
  output_json: string;
}

const MAX_RECEIPTS_PER_GENERATION = 64;

export async function loadCaseSnapshot(
  sessionId: string,
  fixture: CaseFixture,
): Promise<CaseSnapshot> {
  const db = getDb();
  await ensureSchema(db);
  await ensureSeededCase(db, sessionId, fixture);
  return readSnapshot(db, sessionId, fixture);
}

export async function resetCase(
  sessionId: string,
  fixture: CaseFixture,
): Promise<CaseSnapshot> {
  const db = getDb();
  await ensureSchema(db);
  const state = createInitialCaseState(fixture);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await readStateRow(db, sessionId, fixture.id);
    if (!row) {
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

    const nextGeneration = row.generation + 1;
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
  }
  throw new Error("Case reset conflicted with another operation.");
}

export async function executeStoredTool(
  sessionId: string,
  fixture: CaseFixture,
  request: CaseToolRequest,
): Promise<ToolApiResponse> {
  const db = getDb();
  await ensureSchema(db);
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

    if (row.activity_sequence >= MAX_RECEIPTS_PER_GENERATION) {
      return receiptLimitResponse(
        request.requestId,
        fixture,
        await readSnapshot(db, sessionId, fixture),
      );
    }
    const state = parseCaseState(row.state_json, fixture);
    const outcome = executeCaseTool(fixture, state, request);
    const nextSequence = row.activity_sequence + 1;
    const receiptPrefix = fixture.id
      .replace(/^case-/, "")
      .replace(/[^A-Za-z0-9]/g, "-")
      .toUpperCase();
    const receiptId = `RCP-${receiptPrefix}-${String(nextSequence).padStart(4, "0")}`;
    const status = outcome.ok ? "completed" : "rejected";
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
    const outputJson = JSON.stringify(result);
    const resultRevision = outcome.state.revision;

    try {
      const statements = [
        db
          .prepare(
            `INSERT INTO operation_receipt (
              session_id, case_id, request_id, receipt_id, generation,
              logical_sequence, reported_surface, attribution_assurance,
              tool_name, title, target, result_summary, status, base_revision,
              result_revision, occurred_at, input_json, output_json
            )
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            FROM case_state
            WHERE session_id = ? AND case_id = ? AND generation = ?
              AND activity_sequence = ? AND revision = ?
              AND activity_sequence < ?`,
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
            sessionId,
            fixture.id,
            row.generation,
            row.activity_sequence,
            row.revision,
            MAX_RECEIPTS_PER_GENERATION,
          ),
        db
          .prepare(
            `UPDATE case_state
            SET fixture_version = ?, revision = ?, activity_sequence = ?,
              state_json = ?, updated_at = ?
            WHERE session_id = ? AND case_id = ? AND generation = ?
              AND activity_sequence = ? AND revision = ?
              AND activity_sequence < ?`,
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
            MAX_RECEIPTS_PER_GENERATION,
          ),
      ];
      const writes = await db.batch(statements);
      const receiptWrite = writes[0];
      const stateWrite = writes[1];
      if (!receiptWrite || !stateWrite) {
        throw new Error("D1 did not return both operation write results.");
      }
      if (receiptWrite.meta.changes === 1 && stateWrite.meta.changes === 1) {
        return {
          result,
          snapshot: await readSnapshot(db, sessionId, fixture),
        };
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
    await resetCase(sessionId, fixture);
    return;
  }

  try {
    parseCaseState(row.state_json, fixture);
  } catch {
    await resetCase(sessionId, fixture);
  }
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
        result_revision, occurred_at
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
    !["completed", "rejected"].includes(row.status)
  ) {
    throw new Error(`Stored receipt ${row.receipt_id} is invalid.`);
  }
  return {
    id: row.receipt_id,
    requestId: row.request_id,
    sequence: row.logical_sequence,
    reportedSurface:
      row.reported_surface as OperationReceipt["reportedSurface"],
    attributionAssurance:
      row.attribution_assurance as OperationReceipt["attributionAssurance"],
    toolName: row.tool_name,
    title: row.title,
    target: row.target,
    resultSummary: row.result_summary,
    status: row.status as OperationReceipt["status"],
    baseRevision: row.base_revision,
    resultRevision: row.result_revision,
    occurredAt: row.occurred_at,
  };
}

function resetOccurredResponse(
  requestId: string,
  fixture: CaseFixture,
  snapshot: CaseSnapshot,
): ToolApiResponse {
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

function receiptLimitResponse(
  requestId: string,
  fixture: CaseFixture,
  snapshot: CaseSnapshot,
): ToolApiResponse {
  return {
    result: {
      ok: false,
      requestId,
      caseId: fixture.id,
      revision: snapshot.state.revision,
      error: {
        code: "RECEIPT_LIMIT_REACHED",
        message:
          "This case session reached its 64-operation activity limit. Reset the case to continue.",
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
