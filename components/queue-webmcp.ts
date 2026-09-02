import { getCaseQueueItems } from "@/domain/case-queue";
import {
  createInitialCaseState,
  getCaseCoordination,
} from "@/domain/operations";
import { getReferenceCase } from "@/domain/reference-cases";
import type { CaseFixture, CaseSnapshot } from "@/domain/types";
import { loadCase } from "@/lib/client-api";

export type QueueToolFailure = {
  ok: false;
  error: { code: string; message: string; retryable: boolean };
};

export type QueueToolSuccess = { ok: true; data: Record<string, unknown> };
export type QueueToolResult = QueueToolFailure | QueueToolSuccess;

export function createAlertToolDefinitions(
  fixtures: readonly CaseFixture[],
  openCase: (caseId: string) => void,
  readSnapshot: (
    caseId: string,
    signal: AbortSignal,
  ) => Promise<CaseSnapshot> = async (caseId, signal) =>
    (await loadCase(caseId, signal)).snapshot,
): WebMcpToolDefinition[] {
  const routableCaseIds = getCaseQueueItems(
    fixtures.map((fixture) => ({
      fixture,
      state: createInitialCaseState(fixture),
    })),
  ).flatMap((item) => (item.caseId ? [item.caseId] : []));
  return [
    {
      name: "list_case_queue",
      title: "Start security queue review",
      description:
        "Required first tool when the user asks to review, prioritize, triage, or investigate the queue and no case is open. Return the current case queue and Tier 1 investigation states.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input, context) => {
        const signal = context?.signal ?? new AbortController().signal;
        if (signal.aborted) throw createAbortError();
        if (Object.keys(input).length > 0) {
          return queueFailure(
            "INVALID_INPUT",
            "list_case_queue does not accept input fields.",
          );
        }
        try {
          const responses = await Promise.all(
            fixtures.map(async (fixture) => ({
              fixture,
              state: (await readSnapshot(fixture.id, signal)).state,
            })),
          );
          const cases = getCaseQueueItems(responses);
          return queueSuccess({ cases, count: cases.length });
        } catch (error) {
          if (signal.aborted) throw createAbortError();
          return queueFailure(
            "QUEUE_UNAVAILABLE",
            error instanceof Error
              ? error.message
              : "The case queue is temporarily unavailable.",
            true,
          );
        }
      },
    },
    {
      name: "open_case",
      title: "Open escalated case",
      description:
        "Call only with a caseId returned by list_case_queue. Open the selected Tier 1 escalation in the shared investigation workbench. Wait for the new case tool surface, then call get_case_context before any case investigation tool.",
      inputSchema: {
        type: "object",
        properties: {
          caseId: { type: "string", enum: routableCaseIds },
        },
        required: ["caseId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input, context) => {
        const signal = context?.signal ?? new AbortController().signal;
        if (signal.aborted) throw createAbortError();
        if (Object.keys(input).length !== 1) {
          return queueFailure(
            "INVALID_INPUT",
            "open_case requires exactly one string field: caseId.",
          );
        }
        const caseId = input.caseId;
        if (typeof caseId !== "string" || !routableCaseIds.includes(caseId)) {
          return queueFailure(
            "INVALID_CASE_ID",
            "caseId is not an openable case in this queue.",
          );
        }
        const fixture = fixtures.find((candidate) => candidate.id === caseId);
        const reference = fixture ? null : getReferenceCase(caseId);
        if (!fixture && !reference) {
          return queueFailure(
            "CASE_NOT_FOUND",
            "Case metadata is unavailable.",
            true,
          );
        }
        let data: Record<string, unknown>;
        if (fixture) {
          try {
            const snapshot = await readSnapshot(caseId, signal);
            data = {
              caseId,
              route: `/cases/${caseId}`,
              caseKind: "shared_investigation",
              revision: snapshot.state.revision,
              coordination: getCaseCoordination(fixture, snapshot.state),
              agentContinuation: {
                waitFor: "case_tools_registered",
                firstTool: "get_case_context",
                input: {},
                stopAt: "analystGate",
              },
            };
          } catch (error) {
            if (signal.aborted) throw createAbortError();
            return queueFailure(
              "CASE_UNAVAILABLE",
              error instanceof Error
                ? error.message
                : "The selected shared case is temporarily unavailable.",
              true,
            );
          }
        } else if (reference) {
          data = {
            caseId,
            route: `/cases/${caseId}`,
            caseKind: "reference_brief",
            revision: null,
            coordination: {
              scope: "reference_brief",
              persistence: "session_local",
              nextOwner: "agent",
              nextTool: "run_reference_query",
              analystGate: null,
            },
            availableQueryIds: reference.queries.map((query) => query.id),
            agentContinuation: {
              waitFor: "reference_tools_registered",
              firstTool: "get_reference_case",
              input: {},
              stopAt: "reference_only",
              note: "This is a reference-only brief, not the shared case workflow.",
            },
          };
        } else {
          return queueFailure(
            "CASE_NOT_FOUND",
            "Case metadata is unavailable.",
            true,
          );
        }
        queueMicrotask(() => {
          if (!signal.aborted) openCase(caseId);
        });
        return queueSuccess(data);
      },
    },
  ];
}

function queueSuccess(data: Record<string, unknown>): QueueToolSuccess {
  return { ok: true, data };
}

function queueFailure(
  code: string,
  message: string,
  retryable = false,
): QueueToolFailure {
  return { ok: false, error: { code, message, retryable } };
}

function createAbortError(): Error {
  const error = new Error("Tool invocation aborted.");
  error.name = "AbortError";
  return error;
}
