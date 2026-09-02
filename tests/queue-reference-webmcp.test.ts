import assert from "node:assert/strict";
import test from "node:test";
import {
  createAlertToolDefinitions,
  type QueueToolResult,
} from "../components/queue-webmcp";
import {
  createReferenceToolDefinitions,
  validateReferenceToolInput,
  type ReferenceToolResult,
} from "../components/reference-webmcp";
import { getReferenceCases } from "../domain/reference-cases";
import { createInitialCaseState } from "../domain/operations";
import { getAllFixtures } from "../domain/scenarios";
import type { CaseSnapshot } from "../domain/types";

function outcome(value: unknown): QueueToolResult | ReferenceToolResult {
  assert.ok(value !== null && typeof value === "object");
  assert.ok("ok" in value);
  return value as QueueToolResult | ReferenceToolResult;
}

test("queue tools enumerate all five routes and distinguish shared from session-local cases", async () => {
  const fixtures = getAllFixtures();
  const opened: string[] = [];
  const snapshots = new Map<string, CaseSnapshot>(
    fixtures.map((fixture) => [
      fixture.id,
      { state: createInitialCaseState(fixture), receipts: [] },
    ]),
  );
  const definitions = createAlertToolDefinitions(
    fixtures,
    (caseId) => opened.push(caseId),
    async (caseId) => {
      const snapshot = snapshots.get(caseId);
      if (!snapshot) throw new Error("Missing fixture snapshot.");
      return snapshot;
    },
  );
  const openCase = definitions.find(
    (definition) => definition.name === "open_case",
  );
  const listQueue = definitions.find(
    (definition) => definition.name === "list_case_queue",
  );
  assert.ok(openCase);
  assert.ok(listQueue);
  assert.equal(listQueue.title, "Start security queue review");
  assert.equal(listQueue.annotations.untrustedContentHint, true);
  assert.equal(openCase.annotations.untrustedContentHint, false);
  assert.match(listQueue.description, /Required first tool/);
  assert.match(
    listQueue.description,
    /review, prioritize, triage, or investigate/,
  );
  assert.match(openCase.description, /caseId returned by list_case_queue/);
  assert.match(openCase.description, /Wait for the new case tool surface/);
  assert.match(openCase.description, /get_case_context/);
  const caseIds = (
    openCase.inputSchema as { properties: { caseId: { enum: string[] } } }
  ).properties.caseId.enum;
  assert.deepEqual(caseIds, [
    "case-cloud-0421",
    "case-endpoint-0448",
    "case-oauth-0437",
    "case-k8s-0414",
    "case-cicd-0392",
  ]);

  const openedResults = new Map<
    string,
    QueueToolResult | ReferenceToolResult
  >();
  for (const caseId of caseIds) {
    openedResults.set(caseId, outcome(await openCase.execute({ caseId })));
  }
  const shared = openedResults.get("case-cloud-0421");
  assert.ok(shared);
  assert.equal(shared.ok, true);
  if (shared.ok) {
    assert.equal(shared.data.caseKind, "shared_investigation");
    assert.equal(shared.data.revision, 1);
    assert.ok(shared.data.coordination);
    assert.deepEqual(shared.data.agentContinuation, {
      waitFor: "case_tools_registered",
      firstTool: "get_case_context",
      input: {},
      stopAt: "analystGate",
    });
  }
  const reference = openedResults.get("case-oauth-0437");
  assert.ok(reference);
  assert.equal(reference.ok, true);
  if (reference.ok) {
    assert.equal(reference.data.caseKind, "reference_brief");
    assert.equal(reference.data.revision, null);
    assert.deepEqual(reference.data.coordination, {
      scope: "reference_brief",
      persistence: "session_local",
      nextOwner: "agent",
      nextTool: "run_reference_query",
      analystGate: null,
    });
    assert.deepEqual(reference.data.agentContinuation, {
      waitFor: "reference_tools_registered",
      firstTool: "get_reference_case",
      input: {},
      stopAt: "reference_only",
      note: "This is a reference-only brief, not the shared case workflow.",
    });
  }
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  assert.deepEqual(opened, caseIds);

  const invalid = outcome(await openCase.execute({ caseId: "case-missing" }));
  assert.deepEqual(invalid, {
    ok: false,
    error: {
      code: "INVALID_CASE_ID",
      message: "caseId is not an openable case in this queue.",
      retryable: false,
    },
  });
});

test("reference tools mark dossier-derived content untrusted and reject malformed inputs structurally", async () => {
  const dossier = getReferenceCases()[0];
  assert.ok(dossier);
  const definitions = createReferenceToolDefinitions(dossier, async () => ({
    ok: true,
    data: { accepted: true },
  }));
  assert.equal(definitions.length, 7);
  assert.equal(
    definitions.every(
      (definition) => definition.annotations.untrustedContentHint === true,
    ),
    true,
  );
  const query = definitions.find(
    (definition) => definition.name === "run_reference_query",
  );
  const read = definitions.find(
    (definition) => definition.name === "get_reference_case",
  );
  assert.ok(query);
  assert.ok(read);
  assert.deepEqual(outcome(await query.execute({})), {
    ok: false,
    error: {
      code: "INVALID_INPUT",
      message:
        "run_reference_query requires exactly one string field: queryId.",
      retryable: false,
    },
  });
  assert.deepEqual(outcome(await read.execute({ unexpected: true })), {
    ok: false,
    error: {
      code: "INVALID_INPUT",
      message: "get_reference_case does not accept input fields.",
      retryable: false,
    },
  });
  assert.deepEqual(validateReferenceToolInput("inspect_reference_event", {}), {
    ok: false,
    error: {
      code: "INVALID_INPUT",
      message:
        "inspect_reference_event requires exactly one string field: eventId.",
      retryable: false,
    },
  });
});
