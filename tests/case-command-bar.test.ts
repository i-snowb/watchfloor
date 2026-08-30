import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CaseCommandBar } from "../components/case-command-bar";
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
    }),
  );
}

function attachIdentityEvidence(state: CaseState): CaseState {
  const queryId = "QRY-ENDPOINT-IDENTITY-03";
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

test("the command dock exposes the canonical next approved query without an entity selection", () => {
  const html = renderCommandBar(createInitialCaseState(fixture));

  assert.match(html, /<details[^>]+query-console[^>]+open=""/);
  assert.match(html, /Investigation skill/);
  assert.match(html, /Load approved query/);
  assert.match(html, /Service identity scope deviation/);
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
      entities: beforeCounts.entities + 1,
      events: beforeCounts.events + 2,
      joins: beforeCounts.joins + 2,
    },
  );
});
