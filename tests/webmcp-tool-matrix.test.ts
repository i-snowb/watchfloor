import assert from "node:assert/strict";
import test from "node:test";
import {
  createInvestigationReceiptView,
  type InvestigationReceiptView,
} from "../components/investigation-activity";
import {
  createInitialCaseState,
  executeCaseTool,
  type CaseToolName,
} from "../domain/operations";
import {
  cloudIdentityScenario,
  endpointLateralScenario,
} from "../domain/scenarios";
import type { CaseFixture, CaseState } from "../domain/types";
import { createCaseToolDefinitions } from "../webmcp/tools";

let invocation = 0;

function invoke(
  fixture: CaseFixture,
  state: CaseState,
  toolName: CaseToolName,
  input: Record<string, unknown>,
  surface: "webmcp_callback" | "analyst_control" = "webmcp_callback",
): CaseState {
  invocation += 1;
  const result = executeCaseTool(fixture, state, {
    requestId: `matrix-${String(invocation).padStart(4, "0")}-${toolName}`,
    toolName,
    reportedSurface: surface,
    input,
  });
  assert.equal(result.ok, true, result.ok ? undefined : result.error.message);
  return result.state;
}

function analystDecision(
  fixture: CaseFixture,
  state: CaseState,
  decision: "authorized_exception" | "confirmed_malicious",
): CaseState {
  return invoke(
    fixture,
    state,
    "record_evidence_decision",
    {
      expectedRevision: state.revision,
      decision,
      rationale: `Analyst records the fixture-defined ${decision} disposition.`,
    },
    "analyst_control",
  );
}

test("every WebMCP-exposed tool reaches a successful bounded operation", () => {
  const cloudExposed = new Set(
    createCaseToolDefinitions(cloudIdentityScenario, async () => ({})).map(
      (tool) => tool.name,
    ),
  );
  const endpointExposed = new Set(
    createCaseToolDefinitions(endpointLateralScenario, async () => ({})).map(
      (tool) => tool.name,
    ),
  );
  const exposed = new Set([...cloudExposed, ...endpointExposed]);
  const common = [
    "get_case_context",
    "get_case_delta",
    "inspect_event",
    "inspect_entity",
    "inspect_relationship",
    "focus_entity",
    "search_events",
    "find_first_occurrence",
    "compare_timepoints",
    "query_related_activity",
    "run_investigation_query",
    "run_investigation_plan",
    "propose_investigation_step",
    "generate_case_report",
  ] satisfies readonly CaseToolName[];
  const expectedCloud = new Set<CaseToolName>([
    ...common,
    "enrich_identity",
    "enrich_network_indicator",
    "enrich_cloud_role",
    "enrich_resource",
  ]);
  const expectedEndpoint = new Set<CaseToolName>([
    ...common,
    "enrich_identity",
    "enrich_network_indicator",
    "enrich_resource",
    "enrich_endpoint",
    "enrich_file",
    "calculate_reachability",
    "simulate_control",
    "request_next_observation",
    "propose_response_action",
    "simulate_response_action",
    "prepare_response_bundle",
  ]);
  assert.deepEqual(cloudExposed, expectedCloud);
  assert.deepEqual(endpointExposed, expectedEndpoint);
  assert.equal(cloudExposed.size, 18);
  assert.equal(endpointExposed.size, 25);
  assert.equal(exposed.size, 26);
  const successful = new Set<string>();
  const web = (
    fixture: CaseFixture,
    state: CaseState,
    toolName: CaseToolName,
    input: Record<string, unknown>,
  ): CaseState => {
    const fixtureTools =
      fixture.id === endpointLateralScenario.id
        ? endpointExposed
        : cloudExposed;
    assert.equal(
      fixtureTools.has(toolName),
      true,
      `${toolName} is not exposed for ${fixture.id}`,
    );
    successful.add(toolName);
    return invoke(fixture, state, toolName, input);
  };

  let queryProbe = createInitialCaseState(cloudIdentityScenario);
  queryProbe = web(
    cloudIdentityScenario,
    queryProbe,
    "run_investigation_query",
    {
      expectedRevision: queryProbe.revision,
      queryId: "QRY-CLOUD-IDENTITY-01",
    },
  );
  assert.deepEqual(queryProbe.attachedEnrichmentIds, ["ENR-CLOUD-IDENTITY-01"]);

  let planProbe = createInitialCaseState(cloudIdentityScenario);
  planProbe = web(cloudIdentityScenario, planProbe, "run_investigation_plan", {
    expectedRevision: planProbe.revision,
    planId: "tier1_initial",
  });
  assert.deepEqual(planProbe.attachedEnrichmentIds, ["ENR-CLOUD-IDENTITY-01"]);

  let requestProbe = createInitialCaseState(endpointLateralScenario);
  requestProbe = web(
    endpointLateralScenario,
    requestProbe,
    "request_next_observation",
    {
      expectedRevision: requestProbe.revision,
      stageId: "STREAM-LAT-01",
      rationale: "Request the next target-host prevention observation.",
    },
  );
  assert.equal(requestProbe.observationRequest?.status, "pending");

  let cloud = createInitialCaseState(cloudIdentityScenario);
  cloud = web(cloudIdentityScenario, cloud, "get_case_context", {});
  cloud = web(cloudIdentityScenario, cloud, "get_case_delta", {
    sinceCursor: 0,
  });
  cloud = web(cloudIdentityScenario, cloud, "inspect_event", {
    eventId: "EVT-OKTA-0001",
  });
  cloud = web(cloudIdentityScenario, cloud, "inspect_entity", {
    entityId: "identity:jdoe",
  });
  cloud = web(cloudIdentityScenario, cloud, "inspect_relationship", {
    relationshipId: "JOIN-CLOUD-01",
  });
  cloud = web(cloudIdentityScenario, cloud, "focus_entity", {
    entityId: "role:prod-admin",
  });
  cloud = web(cloudIdentityScenario, cloud, "search_events", {
    entityId: "identity:jdoe",
    limit: 10,
  });
  cloud = web(cloudIdentityScenario, cloud, "find_first_occurrence", {
    entityId: "identity:jdoe",
  });
  cloud = web(cloudIdentityScenario, cloud, "compare_timepoints", {
    fromEventId: "EVT-OKTA-0001",
    toEventId: "EVT-AWS-0007",
  });
  cloud = web(cloudIdentityScenario, cloud, "query_related_activity", {
    entityId: "identity:jdoe",
    beforeMinutes: 0,
    afterMinutes: 60,
  });
  cloud = web(cloudIdentityScenario, cloud, "propose_investigation_step", {
    expectedRevision: cloud.revision,
    phase: "inspect",
    objective: "Attach the bounded identity context before resolving the case.",
    recommendedTool: "enrich_identity",
    entityId: "identity:jdoe",
  });
  cloud = web(cloudIdentityScenario, cloud, "enrich_identity", {
    expectedRevision: cloud.revision,
    entityId: "identity:jdoe",
  });
  cloud = web(cloudIdentityScenario, cloud, "enrich_network_indicator", {
    expectedRevision: cloud.revision,
    entityId: "indicator:198.51.100.24",
  });
  cloud = web(cloudIdentityScenario, cloud, "enrich_cloud_role", {
    expectedRevision: cloud.revision,
    entityId: "role:prod-admin",
  });
  cloud = web(cloudIdentityScenario, cloud, "enrich_resource", {
    expectedRevision: cloud.revision,
    entityId: "object:customer-export",
  });
  cloud = analystDecision(cloudIdentityScenario, cloud, "authorized_exception");
  cloud = web(cloudIdentityScenario, cloud, "generate_case_report", {
    expectedRevision: cloud.revision,
  });
  assert.equal(cloud.report.status, "drafted");

  let endpoint = createInitialCaseState(endpointLateralScenario);
  endpoint = invoke(
    endpointLateralScenario,
    endpoint,
    "release_next_synthetic_signal",
    { expectedRevision: endpoint.revision },
    "analyst_control",
  );
  endpoint = web(endpointLateralScenario, endpoint, "enrich_file", {
    expectedRevision: endpoint.revision,
    entityId: "file:invoice-sync-helper",
  });
  endpoint = web(endpointLateralScenario, endpoint, "enrich_endpoint", {
    expectedRevision: endpoint.revision,
    entityId: "endpoint:fin-ws-044",
  });
  endpoint = web(endpointLateralScenario, endpoint, "enrich_identity", {
    expectedRevision: endpoint.revision,
    entityId: "identity:svc-fin-reports",
  });
  endpoint = web(endpointLateralScenario, endpoint, "enrich_endpoint", {
    expectedRevision: endpoint.revision,
    entityId: "endpoint:app-srv-021",
  });
  endpoint = analystDecision(
    endpointLateralScenario,
    endpoint,
    "confirmed_malicious",
  );
  endpoint = web(endpointLateralScenario, endpoint, "calculate_reachability", {
    expectedRevision: endpoint.revision,
    fromEntityId: "endpoint:fin-ws-044",
    maxDepth: 6,
  });
  endpoint = web(endpointLateralScenario, endpoint, "simulate_control", {
    expectedRevision: endpoint.revision,
    control: "isolate_compromised_path",
  });
  let bundleProbe = structuredClone(endpoint);
  bundleProbe = web(
    endpointLateralScenario,
    bundleProbe,
    "prepare_response_bundle",
    {
      expectedRevision: bundleProbe.revision,
      bundleId: "containment",
    },
  );
  assert.equal(bundleProbe.responseBundle?.bundleId, "containment");
  endpoint = web(endpointLateralScenario, endpoint, "propose_response_action", {
    expectedRevision: endpoint.revision,
    actionId: "contain_endpoint",
    reasoning: "Contain the observed endpoint in the synthetic fixture.",
  });
  endpoint = web(
    endpointLateralScenario,
    endpoint,
    "simulate_response_action",
    {
      expectedRevision: endpoint.revision,
      actionId: "contain_endpoint",
    },
  );
  assert.equal(endpoint.responseActions[0]?.status, "simulated");

  assert.deepEqual([...successful].sort(), [...exposed].sort());
  for (const analystOnly of [
    "release_next_synthetic_signal",
    "record_evidence_decision",
    "authorize_response_action",
    "authorize_response_bundle",
    "approve_case_report",
  ]) {
    assert.equal(exposed.has(analystOnly), false);
  }
});

test("WebMCP registration tracks current executable case state", () => {
  const namesFor = (state: CaseState) =>
    new Set(
      createCaseToolDefinitions(
        endpointLateralScenario,
        async () => ({}),
        state,
      ).map((tool) => tool.name),
    );
  let state = createInitialCaseState(endpointLateralScenario);
  const initial = namesFor(state);
  assert.equal(initial.has("run_investigation_query"), true);
  assert.equal(initial.has("run_investigation_plan"), true);
  assert.equal(initial.has("calculate_reachability"), false);
  assert.equal(initial.has("simulate_control"), false);
  assert.equal(initial.has("propose_response_action"), false);

  state = invoke(
    endpointLateralScenario,
    state,
    "release_next_synthetic_signal",
    { expectedRevision: state.revision },
    "analyst_control",
  );

  state = invoke(endpointLateralScenario, state, "enrich_file", {
    expectedRevision: state.revision,
    entityId: "file:invoice-sync-helper",
  });
  const queryDefinition = createCaseToolDefinitions(
    endpointLateralScenario,
    async () => ({}),
    state,
  ).find((tool) => tool.name === "run_investigation_query");
  const queryIds = (
    (queryDefinition?.inputSchema as { properties?: Record<string, unknown> })
      .properties?.queryId as {
      enum?: readonly string[];
    }
  ).enum;
  assert.equal(queryIds?.includes("QRY-ENDPOINT-FILE-01"), false);

  state = invoke(endpointLateralScenario, state, "enrich_endpoint", {
    expectedRevision: state.revision,
    entityId: "endpoint:fin-ws-044",
  });
  state = invoke(endpointLateralScenario, state, "enrich_identity", {
    expectedRevision: state.revision,
    entityId: "identity:svc-fin-reports",
  });
  state = invoke(endpointLateralScenario, state, "enrich_endpoint", {
    expectedRevision: state.revision,
    entityId: "endpoint:app-srv-021",
  });
  state = analystDecision(
    endpointLateralScenario,
    state,
    "confirmed_malicious",
  );
  assert.equal(namesFor(state).has("calculate_reachability"), true);
  assert.equal(namesFor(state).has("simulate_control"), false);

  state = invoke(endpointLateralScenario, state, "calculate_reachability", {
    expectedRevision: state.revision,
    fromEntityId: "endpoint:fin-ws-044",
    maxDepth: 6,
  });
  assert.equal(namesFor(state).has("calculate_reachability"), false);
  assert.equal(namesFor(state).has("simulate_control"), true);
});

test("investigation receipt summarizes executed query context", () => {
  const receipt: InvestigationReceiptView = createInvestigationReceiptView({
    actor: "agent",
    toolName: "run_investigation_query",
    targetEntityId: "file:invoice-sync-helper",
    baseRevision: 4,
    resultRevision: 5,
    durationMs: 1_250,
    summary: "11 matches from 69,660 bounded records",
    data: {
      execution: {
        syntheticRecordCount: 69_660,
        matchedRecordCount: 11,
        returnedRecordCount: 6,
      },
    },
  });
  assert.deepEqual(receipt, {
    actor: "agent",
    toolName: "run_investigation_query",
    targetEntityId: "file:invoice-sync-helper",
    baseRevision: 4,
    resultRevision: 5,
    durationMs: 1_250,
    summary: "11 matches from 69,660 bounded records",
    syntheticRecordCount: 69_660,
    matchedRecordCount: 11,
    returnedRecordCount: 6,
  });
});
