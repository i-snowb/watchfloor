import assert from "node:assert/strict";
import test from "node:test";
import {
  getInvestigationResultPresentation,
  investigationResultKey,
} from "../components/investigation-result-presentation";

test("result presentation distinguishes proven graph growth from evidence and model updates", () => {
  assert.deepEqual(
    getInvestigationResultPresentation("attach_discovery_stage", {
      added: { entityIds: ["entity-1"], relationshipIds: [] },
    }),
    {
      summary: null,
      title: "Observed graph expanded",
      stateLabel: "Observed graph expanded",
      tone: "observed",
    },
  );
  assert.match(
    getInvestigationResultPresentation("run_investigation_query", {})
      .stateLabel,
    /evidence updated · graph unchanged/i,
  );
  assert.match(
    getInvestigationResultPresentation("calculate_reachability", {}).stateLabel,
    /impact model updated · no new observed telemetry/i,
  );
  assert.equal(
    getInvestigationResultPresentation("prepare_response_bundle", {}).title,
    "Response package prepared",
  );
  assert.equal(
    getInvestigationResultPresentation("generate_case_report", {}).title,
    "Report drafted",
  );
});

test("unproven discovery results do not claim observed graph growth", () => {
  assert.deepEqual(
    getInvestigationResultPresentation("release_next_synthetic_signal", {}),
    {
      summary: null,
      title: "Evidence updated",
      stateLabel: "Evidence updated · graph unchanged",
      tone: "evidence",
    },
  );
});

test("presentation deltas report visibility releases that are not raw stage additions", () => {
  assert.deepEqual(
    getInvestigationResultPresentation("run_investigation_query", {
      presentationDelta: {
        visibleEntityIdsAdded: ["identity:svc-fin-reports"],
        visibleEventIdsAdded: ["EVT-EDR-0448-06"],
        visibleRelationshipIdsAdded: [],
        observedGraphChanged: true,
      },
    }),
    {
      summary: "1 entity · 1 observation now visible",
      title: "Query result attached",
      stateLabel: "Observed graph expanded",
      tone: "evidence",
    },
  );
  assert.match(
    getInvestigationResultPresentation("release_next_synthetic_signal", {
      added: {
        entityIds: [],
        relationshipIds: ["JOIN-RAW-STAGE"],
      },
      presentationDelta: {
        visibleEntityIdsAdded: [],
        visibleEventIdsAdded: ["EVENT-VISIBLE"],
        visibleRelationshipIdsAdded: [],
        observedGraphChanged: false,
      },
    }).stateLabel,
    /evidence updated · graph unchanged/i,
  );
});

test("presentation summaries match the complete analyst-visible graph delta", () => {
  const presentation = getInvestigationResultPresentation(
    "attach_discovery_stage",
    {
      added: {
        entityIds: ["raw-stage-entity"],
        relationshipIds: ["raw-stage-join"],
      },
      presentationDelta: {
        visibleEntityIdsAdded: ["entity-1", "entity-2", "entity-3"],
        visibleEventIdsAdded: ["event-1", "event-2", "event-3", "event-4"],
        visibleRelationshipIdsAdded: ["join-1", "join-2"],
        observedGraphChanged: true,
      },
    },
  );

  assert.equal(
    presentation.summary,
    "3 entities · 2 relationships · 4 observations now visible",
  );
});

test("query results claim graph growth only when their returned data proves it", () => {
  assert.equal(
    getInvestigationResultPresentation("run_investigation_query", {})
      .stateLabel,
    "Evidence updated · graph unchanged",
  );
  assert.equal(
    getInvestigationResultPresentation("run_investigation_query", {
      added: { entityIds: [], relationshipIds: ["join-1"] },
    }).stateLabel,
    "Observed graph expanded",
  );
});

test("result keys retain revision, operation, and query identity", () => {
  assert.equal(
    investigationResultKey({
      toolName: "run_investigation_query",
      queryId: "query-01",
      resultRevision: 12,
    }),
    "12:run_investigation_query:query-01",
  );
});
