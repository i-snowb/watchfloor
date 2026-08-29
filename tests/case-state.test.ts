import assert from "node:assert/strict";
import test from "node:test";
import { parseCaseState } from "../domain/case-state";
import {
  createInitialCaseState,
  executeCaseTool,
  getInvestigationPlans,
} from "../domain/operations";
import {
  cloudIdentityScenario,
  endpointLateralScenario,
} from "../domain/scenarios";
import type { CaseFixture, CaseState } from "../domain/types";

function write(
  fixture: CaseFixture,
  state: CaseState,
  toolName: Parameters<typeof executeCaseTool>[2]["toolName"],
  input: Record<string, unknown>,
  surface: "webmcp_callback" | "analyst_control" = "webmcp_callback",
): CaseState {
  const result = executeCaseTool(fixture, state, {
    requestId: `state-${toolName}-${state.revision}`,
    toolName,
    reportedSurface: surface,
    input,
  });
  assert.equal(result.ok, true, result.ok ? undefined : result.error.message);
  return result.state;
}

function completeInvestigationPlan(
  fixture: CaseFixture,
  state: CaseState,
  planId: string,
): CaseState {
  let current = state;
  while (true) {
    const plan = getInvestigationPlans(fixture).find(
      (candidate) => candidate.id === planId,
    );
    const queryId = plan?.queryIds.find((candidateId) => {
      const query = fixture.investigationQueries.find(
        (candidate) => candidate.id === candidateId,
      );
      return (
        query !== undefined &&
        !current.attachedEnrichmentIds.includes(query.resultArtifactId)
      );
    });
    assert.ok(queryId, `No unresolved query exists for ${planId}`);
    current = write(fixture, current, "prepare_investigation_query", {
      expectedRevision: current.revision,
      queryId,
    });
    const result = executeCaseTool(fixture, current, {
      requestId: `state-plan-${planId}-${current.revision}`,
      toolName: "run_investigation_plan",
      reportedSurface: "webmcp_callback",
      input: { expectedRevision: current.revision, planId },
    });
    assert.equal(result.ok, true, result.ok ? undefined : result.error.message);
    if (!result.ok) return current;
    current = result.state;
    const data = result.data as { remainingCount: number };
    if (data.remainingCount === 0) return current;
  }
}

test("canonical initial states pass persisted-state validation", () => {
  for (const fixture of [cloudIdentityScenario, endpointLateralScenario]) {
    const initial = createInitialCaseState(fixture);
    assert.deepEqual(parseCaseState(JSON.stringify(initial), fixture), initial);
  }
});

test("legacy persisted state migrates to an empty prepared query", () => {
  const initial = createInitialCaseState(cloudIdentityScenario);
  const legacy = JSON.parse(JSON.stringify(initial)) as Record<string, unknown>;
  delete legacy.preparedQuery;
  const parsed = parseCaseState(JSON.stringify(legacy), cloudIdentityScenario);
  assert.equal(parsed.preparedQuery, null);
});

test("persisted state rejects unreleased enrichment visibility", () => {
  const invalid = createInitialCaseState(endpointLateralScenario);
  invalid.attachedEnrichmentIds = ["ENR-LAT-WORKLOAD-01"];
  assert.throws(
    () => parseCaseState(JSON.stringify(invalid), endpointLateralScenario),
    /Stored enrichment state/,
  );
});

test("persisted state rejects a response that bypasses model and simulation gates", () => {
  const invalid = createInitialCaseState(endpointLateralScenario);
  invalid.revision = 2;
  invalid.releasedStreamStageIds = ["STREAM-LAT-01"];
  invalid.responseActions[0] = {
    actionId: "contain_endpoint",
    status: "authorized_in_demo",
    proposalId: "RESP-ENDPOINT-0448-0001",
    simulatedAt: null,
    authorizedAt: "2026-08-28T14:05:30Z",
  };
  assert.throws(
    () => parseCaseState(JSON.stringify(invalid), endpointLateralScenario),
    /Stored response state/,
  );
});

test("persisted report requires the deterministic evidence inventory", () => {
  const fixture = cloudIdentityScenario;
  let state = createInitialCaseState(fixture);
  for (const [toolName, entityId] of [
    ["enrich_identity", "identity:jdoe"],
    ["enrich_network_indicator", "indicator:198.51.100.24"],
    ["enrich_cloud_role", "role:prod-admin"],
    ["enrich_resource", "object:customer-export"],
  ] as const) {
    state = write(fixture, state, toolName, {
      expectedRevision: state.revision,
      entityId,
    });
  }
  state = write(
    fixture,
    state,
    "record_evidence_decision",
    {
      expectedRevision: state.revision,
      decision: "authorized_exception",
      rationale:
        "The approved export is valid and the privileged role remains an exception.",
    },
    "analyst_control",
  );
  state = write(fixture, state, "generate_case_report", {
    expectedRevision: state.revision,
  });
  assert.deepEqual(parseCaseState(JSON.stringify(state), fixture), state);

  const invalid = structuredClone(state);
  if (!invalid.report.report) throw new Error("Expected a drafted report.");
  invalid.report.report = { ...invalid.report.report, evidenceIds: [] };
  assert.throws(
    () => parseCaseState(JSON.stringify(invalid), fixture),
    /Stored response state/,
  );

  const conflictingDecision = structuredClone(state);
  conflictingDecision.decision = {
    status: "keep_suspect",
    rationale: "Tampered decision after deterministic report generation.",
    decidedAt: "2026-08-27T09:44:00Z",
  };
  assert.throws(
    () => parseCaseState(JSON.stringify(conflictingDecision), fixture),
    /Stored response state/,
  );
});

test("persisted investigation proposals round-trip with visible or null targets", () => {
  for (const entityId of ["identity:jdoe", null] as const) {
    const initial = createInitialCaseState(cloudIdentityScenario);
    const result = executeCaseTool(cloudIdentityScenario, initial, {
      requestId: `proposal-${entityId ?? "no-target"}`,
      toolName: "propose_investigation_step",
      reportedSurface: "webmcp_callback",
      input: {
        expectedRevision: initial.revision,
        phase: "inspect",
        objective: "Inspect the selected identity and its related activity.",
        recommendedTool: "inspect_entity",
        ...(entityId ? { entityId } : {}),
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(
      parseCaseState(JSON.stringify(result.state), cloudIdentityScenario),
      result.state,
    );
  }
});

test("pending observations and prepared response bundles round-trip", () => {
  const fixture = endpointLateralScenario;
  let state = createInitialCaseState(fixture);
  state = write(fixture, state, "request_next_observation", {
    expectedRevision: state.revision,
    stageId: "STREAM-LAT-01",
    rationale: "Request the target-host prevention observation.",
  });
  assert.deepEqual(parseCaseState(JSON.stringify(state), fixture), state);

  state = completeInvestigationPlan(fixture, state, "tier1_initial");
  state = write(
    fixture,
    state,
    "release_next_synthetic_signal",
    { expectedRevision: state.revision },
    "analyst_control",
  );
  state = completeInvestigationPlan(fixture, state, "stage_1_verification");
  state = write(
    fixture,
    state,
    "record_evidence_decision",
    {
      expectedRevision: state.revision,
      decision: "confirmed_malicious",
      rationale:
        "The observed execution and blocked lateral attempt meet the synthetic threshold.",
    },
    "analyst_control",
  );
  state = write(fixture, state, "calculate_reachability", {
    expectedRevision: state.revision,
    fromEntityId: fixture.reachability.sourceEntityId,
    maxDepth: 6,
  });
  state = write(fixture, state, "simulate_control", {
    expectedRevision: state.revision,
    control: fixture.counterfactual.control,
  });
  state = write(fixture, state, "prepare_response_bundle", {
    expectedRevision: state.revision,
    bundleId: "containment",
  });
  assert.equal(state.responseBundle?.bundleId, "containment");
  assert.deepEqual(parseCaseState(JSON.stringify(state), fixture), state);

  const invalid = structuredClone(state);
  invalid.responseActions[0] = {
    ...invalid.responseActions[0]!,
    proposalId: "BUNDLE-TAMPERED-0001",
  };
  assert.throws(
    () => parseCaseState(JSON.stringify(invalid), fixture),
    /Stored response state/,
  );
});
