import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CaseCommandBar,
  getResultContinuation,
} from "../components/case-command-bar";
import {
  createInitialCaseState,
  executeCaseTool,
  getNextAgentAction,
  type CaseToolName,
  type ToolOutcome,
  type ToolSurface,
} from "../domain/operations";
import {
  getVisibleEntities,
  getVisibleEvents,
  getVisibleJoins,
} from "../domain/incident-stream";
import { getQueryConsoleContract } from "../domain/query-console";
import { endpointLateralScenario as fixture } from "../domain/scenarios";
import type { CaseState } from "../domain/types";

function execute(
  state: CaseState,
  toolName: CaseToolName,
  input: Record<string, unknown>,
  surface: ToolSurface = "analyst_control",
): ToolOutcome {
  return executeCaseTool(fixture, state, {
    requestId: `command-bar-${toolName}-${state.revision}-${surface}`,
    toolName,
    reportedSurface: surface,
    input,
  });
}

function succeed(outcome: ToolOutcome): CaseState {
  assert.equal(
    outcome.ok,
    true,
    outcome.ok ? undefined : outcome.error.message,
  );
  return outcome.state;
}

function renderCommandBar(state: CaseState): string {
  const eventId = fixture.primaryTraceEventIds[0];
  assert.ok(eventId);
  return renderToStaticMarkup(
    createElement(CaseCommandBar, {
      fixture,
      state,
      agentStatus: { state: "available", count: 21, total: 21 },
      busy: false,
      onExecute: async () => {},
      onReset: () => {},
      onSelect: () => {},
      selection: { kind: "event", id: eventId },
      showInvestigationControls: false,
      investigationActivity: { status: "idle" },
      onOpenReportReview: () => {},
      onReviewCompletedResult: () => {},
    }),
  );
}

function attachIdentityEvidence(state: CaseState): CaseState {
  return runQuery(state, "QRY-ENDPOINT-IDENTITY-03");
}

function runQuery(state: CaseState, queryId: string): CaseState {
  const contract = getQueryConsoleContract(queryId);
  assert.ok(contract);
  state = succeed(
    execute(state, "prepare_investigation_query", {
      expectedRevision: state.revision,
      queryId,
    }),
  );
  return succeed(
    execute(state, "run_investigation_query", {
      expectedRevision: state.revision,
      queryId,
      queryText: contract.text,
    }),
  );
}

test("the command dock keeps an unprepared query compact until an analyst or agent loads it", () => {
  const html = renderCommandBar(createInitialCaseState(fixture));

  assert.doesNotMatch(html, /<details[^>]+query-console[^>]+open=""/);
  assert.match(html, /Investigation skill/);
  assert.match(html, /Load approved query/);
  assert.match(html, /Service identity scope deviation/);
});

test("the mounted command bar gives the pending telemetry release to the analyst", () => {
  const state = structuredClone(createInitialCaseState(fixture));
  state.observationRequest = {
    stageId: "STREAM-LAT-02",
    rationale: "Release the bounded telemetry needed to verify recovery scope.",
    targetEntityIds: ["workload:billing-api"],
    basedOnRevision: state.revision,
    requestedAt: "2026-08-28T14:06:08.000Z",
    releasedAt: null,
    status: "pending",
  };

  const html = renderCommandBar(state);

  assert.match(html, /command-owner-analyst/);
  assert.match(html, /TRACE paused · analyst required/);
  assert.match(html, /Release requested telemetry: Recovery scope confirmed/);
  assert.match(
    html,
    /Release the bounded telemetry needed to verify recovery scope/,
  );
  assert.match(html, /Requested stage/);
  assert.match(html, /Target entities/);
  assert.match(html, /billing-api/);
  assert.match(html, />Release requested telemetry<\/button>/);
  assert.match(
    html,
    /Analyst release records synthetic telemetry only\. No external system is contacted/,
  );
});

test("reviewing the final query result clears its transient presentation and opens the analyst decision gate", () => {
  const continuation = getResultContinuation(null);
  assert.deepEqual(continuation, {
    label: "Review analyst decision",
    owner: "Analyst decision",
    kind: "analyst_gate",
  });

  let state = createInitialCaseState(fixture);
  state = succeed(
    execute(state, "enrich_file", {
      expectedRevision: state.revision,
      entityId: "file:invoice-sync-helper",
    }),
  );
  state = runQuery(state, "QRY-ENDPOINT-HASH-10");
  state = succeed(
    execute(state, "enrich_endpoint", {
      expectedRevision: state.revision,
      entityId: "endpoint:fin-ws-044",
    }),
  );
  state = succeed(
    execute(state, "enrich_identity", {
      expectedRevision: state.revision,
      entityId: "identity:svc-fin-reports",
    }),
  );
  state = attachIdentityEvidence(state);
  state = succeed(
    execute(state, "attach_discovery_stage", {
      expectedRevision: state.revision,
      stageId: "STREAM-LAT-01",
      rationale:
        "Required query evidence supports adding remote service start blocked to the shared case.",
    }),
  );
  state = runQuery(state, "QRY-ENDPOINT-APP-05");

  const html = renderCommandBar(state);
  assert.match(
    html,
    /Does the correlated activity meet the containment threshold/,
  );
  assert.match(html, /Confirm malicious · contain<\/button>/);
  assert.match(html, /Evidence insufficient<\/button>/);
  assert.doesNotMatch(html, /Review analyst decision/);
});

test("an evidence hold exposes both bounded deeper-forensics pivots and not reset", () => {
  let state = createInitialCaseState(fixture);
  state = succeed(
    execute(state, "enrich_file", {
      expectedRevision: state.revision,
      entityId: "file:invoice-sync-helper",
    }),
  );
  state = runQuery(state, "QRY-ENDPOINT-HASH-10");
  state = succeed(
    execute(state, "enrich_endpoint", {
      expectedRevision: state.revision,
      entityId: "endpoint:fin-ws-044",
    }),
  );
  state = succeed(
    execute(state, "enrich_identity", {
      expectedRevision: state.revision,
      entityId: "identity:svc-fin-reports",
    }),
  );
  state = attachIdentityEvidence(state);
  state = succeed(
    execute(state, "attach_discovery_stage", {
      expectedRevision: state.revision,
      stageId: "STREAM-LAT-01",
      rationale:
        "Required query evidence supports adding remote service start blocked to the shared case.",
    }),
  );
  state = succeed(
    execute(state, "enrich_endpoint", {
      expectedRevision: state.revision,
      entityId: "endpoint:app-srv-021",
    }),
  );
  state = succeed(
    execute(state, "record_evidence_decision", {
      expectedRevision: state.revision,
      decision: "insufficient_evidence",
      rationale:
        "The primary evidence warrants deeper file and behavior validation before containment.",
    }),
  );

  const html = renderCommandBar(state);
  assert.match(html, /Choose the next deeper-forensics skill/);
  assert.match(html, /QRY-ENDPOINT-STATIC-08|static/);
  assert.match(html, /QRY-ENDPOINT-SANDBOX-09|sandbox/);
  assert.doesNotMatch(html, />Reset case<\/button>/);
});

test("completed deeper forensics reopens a final evidence gate without another hold", () => {
  let state = createInitialCaseState(fixture);
  state = succeed(
    execute(state, "enrich_file", {
      expectedRevision: state.revision,
      entityId: "file:invoice-sync-helper",
    }),
  );
  state = runQuery(state, "QRY-ENDPOINT-HASH-10");
  state = succeed(
    execute(state, "enrich_endpoint", {
      expectedRevision: state.revision,
      entityId: "endpoint:fin-ws-044",
    }),
  );
  state = succeed(
    execute(state, "enrich_identity", {
      expectedRevision: state.revision,
      entityId: "identity:svc-fin-reports",
    }),
  );
  state = attachIdentityEvidence(state);
  state = succeed(
    execute(state, "attach_discovery_stage", {
      expectedRevision: state.revision,
      stageId: "STREAM-LAT-01",
      rationale:
        "Required query evidence supports adding remote service start blocked to the shared case.",
    }),
  );
  state = succeed(
    execute(state, "enrich_endpoint", {
      expectedRevision: state.revision,
      entityId: "endpoint:app-srv-021",
    }),
  );
  state = succeed(
    execute(state, "record_evidence_decision", {
      expectedRevision: state.revision,
      decision: "insufficient_evidence",
      rationale:
        "The primary evidence warrants deeper file and behavior validation before containment.",
    }),
  );
  state = runQuery(state, "QRY-ENDPOINT-STATIC-08");
  state = runQuery(state, "QRY-ENDPOINT-SANDBOX-09");

  const html = renderCommandBar(state);
  assert.match(
    html,
    /Do the deeper-forensics records support a final containment decision/,
  );
  assert.match(html, /Confirm malicious · contain/);
  assert.doesNotMatch(html, /insufficient evidence/i);
  assert.doesNotMatch(html, />Reset case<\/button>/);
});

test("eligible discovery is actionable and expands the graph through the canonical bounded input", () => {
  const ready = attachIdentityEvidence(createInitialCaseState(fixture));
  const action = getNextAgentAction(fixture, ready);
  assert.equal(action?.toolName, "attach_discovery_stage");
  assert.deepEqual(action?.input, {
    expectedRevision: ready.revision,
    stageId: "STREAM-LAT-01",
    rationale:
      "Required query evidence supports adding remote service start blocked to the shared case.",
  });

  const html = renderCommandBar(ready);
  assert.match(html, />Add to case graph<\/button>/);
  assert.match(html, /Add 1 entity, 2 events, and 2 relationships/);

  const beforeCounts = {
    entities: getVisibleEntities(fixture, ready).length,
    events: getVisibleEvents(fixture, ready).length,
    joins: getVisibleJoins(fixture, ready).length,
  };
  assert.ok(action);
  const manual = succeed(
    execute(ready, action.toolName, action.input, "analyst_control"),
  );
  const webMcp = succeed(
    execute(ready, action.toolName, action.input, "webmcp_callback"),
  );

  assert.deepEqual(manual.releasedStreamStageIds, ["STREAM-LAT-01"]);
  assert.deepEqual(
    webMcp.releasedStreamStageIds,
    manual.releasedStreamStageIds,
  );
  assert.deepEqual(
    {
      entities: getVisibleEntities(fixture, manual).length,
      events: getVisibleEvents(fixture, manual).length,
      joins: getVisibleJoins(fixture, manual).length,
    },
    {
      entities: beforeCounts.entities + 3,
      events: beforeCounts.events + 6,
      joins: beforeCounts.joins + 5,
    },
  );
});
