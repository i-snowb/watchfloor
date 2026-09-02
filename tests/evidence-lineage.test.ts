import assert from "node:assert/strict";
import test from "node:test";
import { traceEvidenceLineage } from "../domain/evidence-lineage";
import {
  createInitialCaseState,
  executeCaseTool,
  type ToolOutcome,
} from "../domain/operations";
import { getQueryConsoleContract } from "../domain/query-console";
import { endpointLateralScenario } from "../domain/scenarios";
import type { CaseFixture, CaseState, OperationReceipt } from "../domain/types";

const fixture = endpointLateralScenario satisfies CaseFixture;

function succeeded(outcome: ToolOutcome): CaseState {
  assert.equal(
    outcome.ok,
    true,
    outcome.ok ? undefined : outcome.error.message,
  );
  return outcome.state;
}

function runQuery(state: CaseState, queryId: string): CaseState {
  const prepared = succeeded(
    executeCaseTool(fixture, state, {
      requestId: `prepare-${queryId}-${state.revision}`,
      toolName: "prepare_investigation_query",
      reportedSurface: "webmcp_callback",
      input: { expectedRevision: state.revision, queryId },
    }),
  );
  return succeeded(
    executeCaseTool(fixture, prepared, {
      requestId: `run-${queryId}-${prepared.revision}`,
      toolName: "run_investigation_query",
      reportedSurface: "webmcp_callback",
      input: {
        expectedRevision: prepared.revision,
        queryId,
        queryText: getQueryConsoleContract(queryId)?.text,
      },
    }),
  );
}

function receipt(
  references?: OperationReceipt["references"],
): OperationReceipt {
  return {
    id: "receipt-001",
    requestId: "request-001",
    sequence: 1,
    reportedSurface: "webmcp_callback",
    attributionAssurance: "server_channel_assigned",
    actorAssurance: "anonymous_sandbox",
    toolName: "run_investigation_query",
    title: "Query completed",
    target: null,
    resultSummary: "Synthetic query completed.",
    status: "completed",
    baseRevision: 1,
    resultRevision: 2,
    occurredAt: "2026-08-28T14:05:20Z",
    ...(references === undefined ? {} : { references }),
  };
}

test("initial visible evidence has no invented origin receipt", () => {
  const state = createInitialCaseState(fixture);
  const lineage = traceEvidenceLineage(fixture, state, [receipt()], {
    targetType: "event",
    targetId: "EVT-EDR-0448-01",
  });

  assert.ok(lineage);
  assert.equal(lineage.availability.kind, "initial");
  assert.deepEqual(lineage.receipts, []);
  assert.deepEqual(lineage.queries, []);
  assert.deepEqual(lineage.records, []);
  assert.equal(
    traceEvidenceLineage(fixture, state, [], {
      targetType: "event",
      targetId: "EVT-CLOUD-0448-11",
    }),
    null,
  );
  assert.equal(
    traceEvidenceLineage(fixture, state, [], {
      targetType: "relationship",
      targetId: "EVT-EDR-0448-01",
    }),
    null,
  );
});

test("attached query evidence exposes only executed immutable query and records", () => {
  const state = runQuery(
    createInitialCaseState(fixture),
    "QRY-ENDPOINT-FILE-01",
  );
  const lineage = traceEvidenceLineage(
    fixture,
    state,
    [
      receipt({
        eventIds: [],
        entityIds: ["endpoint:fin-ws-044"],
        relationshipIds: [],
        enrichmentIds: ["ENR-LAT-FILE-01"],
        queryIds: ["QRY-ENDPOINT-FILE-01"],
        recordIds: ["QRR-ENDPOINT-FILE-01"],
        discoveryIds: [],
        reportIds: [],
        actionIds: [],
      }),
      {
        ...receipt({
          eventIds: [],
          entityIds: ["file:invoice-sync-helper"],
          relationshipIds: [],
          enrichmentIds: [],
          queryIds: ["QRY-ENDPOINT-SECRET-06"],
          recordIds: ["QRR-ENDPOINT-SECRET-01"],
          discoveryIds: [],
          reportIds: [],
          actionIds: [],
        }),
        id: "receipt-unexecuted-query",
        requestId: "request-unexecuted-query",
      },
    ],
    { targetType: "enrichment", targetId: "ENR-LAT-FILE-01" },
  );

  assert.ok(lineage);
  assert.equal(lineage.availability.kind, "attached");
  assert.deepEqual(
    lineage.queries.map((query) => query.definition.id),
    ["QRY-ENDPOINT-FILE-01"],
  );
  assert.equal(
    lineage.queries[0]?.queryText,
    getQueryConsoleContract("QRY-ENDPOINT-FILE-01")?.text,
  );
  assert.deepEqual(
    lineage.records.map((record) => record.id),
    fixture.investigationQueries
      .find((query) => query.id === "QRY-ENDPOINT-FILE-01")
      ?.returnedRecords.map((record) => record.id),
  );
  assert.deepEqual(
    lineage.skills.map((skill) => skill.queryId),
    ["QRY-ENDPOINT-FILE-01"],
  );
  assert.deepEqual(
    lineage.receipts.map((item) => item.id),
    ["receipt-001"],
  );

  const rejected = traceEvidenceLineage(
    fixture,
    state,
    [
      {
        ...receipt({
          eventIds: [],
          entityIds: ["endpoint:fin-ws-044"],
          relationshipIds: [],
          enrichmentIds: ["ENR-LAT-FILE-01"],
          queryIds: ["QRY-ENDPOINT-FILE-01"],
          recordIds: ["QRR-ENDPOINT-FILE-01"],
          discoveryIds: [],
          reportIds: [],
          actionIds: [],
        }),
        status: "rejected",
      },
    ],
    { targetType: "enrichment", targetId: "ENR-LAT-FILE-01" },
  );
  assert.ok(rejected);
  assert.deepEqual(rejected.receipts, []);

  const futureReceipt = traceEvidenceLineage(
    fixture,
    state,
    [
      {
        ...receipt({
          eventIds: [],
          entityIds: ["endpoint:fin-ws-044"],
          relationshipIds: [],
          enrichmentIds: ["ENR-LAT-FILE-01"],
          queryIds: ["QRY-ENDPOINT-FILE-01"],
          recordIds: ["QRR-ENDPOINT-FILE-01"],
          discoveryIds: [],
          reportIds: [],
          actionIds: [],
        }),
        baseRevision: state.revision,
        resultRevision: state.revision + 1,
      },
    ],
    { targetType: "enrichment", targetId: "ENR-LAT-FILE-01" },
  );
  assert.ok(futureReceipt);
  assert.deepEqual(futureReceipt.receipts, []);
});

test("entity lineage returns every visible event cited by its relationships", () => {
  const state = createInitialCaseState(fixture);
  const lineage = traceEvidenceLineage(fixture, state, [], {
    targetType: "entity",
    targetId: "file:invoice-sync-helper",
  });

  assert.ok(lineage);
  const eventIds = new Set(lineage.events.map((event) => event.id));
  for (const relationship of lineage.relationships) {
    for (const evidenceId of relationship.evidenceIds) {
      assert.equal(
        eventIds.has(evidenceId),
        true,
        `${relationship.id} cites ${evidenceId} outside the returned events`,
      );
    }
  }
});

test("relationship lineage returns only its eligible executed query context", () => {
  const queried = runQuery(
    createInitialCaseState(fixture),
    "QRY-ENDPOINT-FILE-01",
  );
  const state: CaseState = {
    ...queried,
    executedInvestigationQueryIds: [
      ...queried.executedInvestigationQueryIds,
      "QRY-ENDPOINT-EGRESS-04",
    ],
  };
  const relevantReceipt = receipt({
    eventIds: [],
    entityIds: ["file:invoice-sync-helper"],
    relationshipIds: ["JOIN-LAT-01"],
    enrichmentIds: ["ENR-LAT-FILE-01"],
    queryIds: ["QRY-ENDPOINT-FILE-01"],
    recordIds: ["QRR-ENDPOINT-FILE-01"],
    discoveryIds: [],
    reportIds: [],
    actionIds: [],
  });
  const unrelatedReceipt: OperationReceipt = {
    ...receipt({
      eventIds: [],
      entityIds: ["endpoint:fin-ws-044"],
      relationshipIds: [],
      enrichmentIds: [],
      queryIds: ["QRY-ENDPOINT-EGRESS-04"],
      recordIds: ["QRR-ENDPOINT-EGRESS-01"],
      discoveryIds: [],
      reportIds: [],
      actionIds: [],
    }),
    id: "receipt-002",
    requestId: "request-002",
  };
  const lineage = traceEvidenceLineage(
    fixture,
    state,
    [relevantReceipt, unrelatedReceipt],
    {
      targetType: "relationship",
      targetId: "JOIN-LAT-01",
    },
  );

  assert.ok(lineage);
  assert.deepEqual(
    lineage.queries.map((query) => query.definition.id),
    ["QRY-ENDPOINT-FILE-01"],
  );
  assert.equal(
    lineage.queries[0]?.queryText,
    getQueryConsoleContract("QRY-ENDPOINT-FILE-01")?.text,
  );
  assert.deepEqual(
    lineage.records.map((record) => record.id),
    ["QRR-ENDPOINT-FILE-01"],
  );
  assert.deepEqual(
    lineage.skills.map((skill) => skill.queryId),
    ["QRY-ENDPOINT-FILE-01"],
  );
  assert.deepEqual(
    lineage.receipts.map((item) => item.id),
    ["receipt-001"],
  );
});

test("reported findings require an attached enrichment included by the current report", () => {
  const queried = runQuery(
    createInitialCaseState(fixture),
    "QRY-ENDPOINT-FILE-01",
  );
  const state: CaseState = {
    ...queried,
    report: {
      status: "drafted",
      approvedAt: null,
      analystClosureNote: null,
      report: {
        id: fixture.conclusion.reportId,
        version: fixture.conclusion.reportVersion,
        title: fixture.conclusion.title,
        disposition: fixture.conclusion.disposition,
        executiveSummary: fixture.conclusion.executiveSummary,
        confirmedFindings: fixture.conclusion.confirmedFindings,
        limitations: fixture.conclusion.limitations,
        residualRisk: fixture.conclusion.residualRisk,
        evidenceIds: ["ENR-LAT-FILE-01"],
        actionIds: [],
        generatedAt: "2026-08-28T14:07:00Z",
      },
    },
  };

  const lineage = traceEvidenceLineage(fixture, state, [], {
    targetType: "report_finding",
    targetId: "ENR-LAT-FILE-01",
  });
  assert.ok(lineage);
  assert.equal(lineage.availability.kind, "reported");
  assert.deepEqual(lineage.reportConsumers, [
    {
      reportId: fixture.conclusion.reportId,
      version: fixture.conclusion.reportVersion,
      status: "drafted",
      evidenceId: "ENR-LAT-FILE-01",
    },
  ]);
  assert.equal(
    traceEvidenceLineage(fixture, state, [], {
      targetType: "report_finding",
      targetId: "F-01",
    }),
    null,
  );
});

test("released discovery returns its executed admission query and cited records", () => {
  const initial = createInitialCaseState(fixture);
  const state: CaseState = {
    ...initial,
    releasedStreamStageIds: ["STREAM-LAT-01"],
    executedInvestigationQueryIds: ["QRY-ENDPOINT-IDENTITY-03"],
  };

  const lineage = traceEvidenceLineage(fixture, state, [], {
    targetType: "discovery",
    targetId: "STREAM-LAT-01",
  });

  assert.ok(lineage);
  assert.deepEqual(lineage.availability, {
    kind: "released",
    releaseStageId: "STREAM-LAT-01",
  });
  assert.deepEqual(
    lineage.queries.map((query) => query.definition.id),
    ["QRY-ENDPOINT-IDENTITY-03"],
  );
  assert.deepEqual(
    lineage.records.map((record) => record.id),
    [
      "QRR-ENDPOINT-IDENTITY-01",
      "QRR-ENDPOINT-IDENTITY-02",
      "QRR-ENDPOINT-IDENTITY-03",
    ],
  );
});
