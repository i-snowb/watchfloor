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
import { getQueryConsoleContract } from "../domain/query-console";
import { createCaseToolDefinitions, registerCaseTools } from "../webmcp/tools";

let invocation = 0;

test("every WebMCP tool marks returned case content as untrusted", () => {
  for (const fixture of [cloudIdentityScenario, endpointLateralScenario]) {
    const definitions = createCaseToolDefinitions(fixture, async () => ({}));
    assert.ok(definitions.length > 0);
    for (const definition of definitions) {
      assert.equal(definition.annotations.untrustedContentHint, true);
    }
  }
});

function invoke(
  fixture: CaseFixture,
  state: CaseState,
  toolName: CaseToolName,
  input: Record<string, unknown>,
  surface: "webmcp_callback" | "analyst_control" = "webmcp_callback",
): CaseState {
  invocation += 1;
  const normalizedInput =
    toolName === "run_investigation_query" &&
    typeof input.queryId === "string" &&
    input.queryText === undefined
      ? {
          ...input,
          queryText: getQueryConsoleContract(input.queryId)?.text ?? "",
        }
      : input;
  const result = executeCaseTool(fixture, state, {
    requestId: `matrix-${String(invocation).padStart(4, "0")}-${toolName}`,
    toolName,
    reportedSurface: surface,
    input: normalizedInput,
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
    "list_investigation_skills",
    "prepare_investigation_query",
    "run_investigation_query",
    "run_investigation_plan",
    "propose_investigation_step",
    "attach_discovery_stage",
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
    "propose_response_action",
    "simulate_response_action",
    "prepare_response_bundle",
  ]);
  assert.deepEqual(cloudExposed, expectedCloud);
  assert.deepEqual(endpointExposed, expectedEndpoint);
  assert.equal(cloudExposed.size, 21);
  assert.equal(endpointExposed.size, 27);
  assert.equal(exposed.size, 28);
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
    "prepare_investigation_query",
    {
      expectedRevision: queryProbe.revision,
      queryId: "QRY-CLOUD-IDENTITY-01",
    },
  );
  assert.equal(queryProbe.revision, 2);
  assert.deepEqual(queryProbe.attachedEnrichmentIds, []);
  assert.equal(queryProbe.preparedQuery?.queryId, "QRY-CLOUD-IDENTITY-01");
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
  assert.equal(queryProbe.preparedQuery, null);

  let planProbe = createInitialCaseState(cloudIdentityScenario);
  planProbe = web(
    cloudIdentityScenario,
    planProbe,
    "prepare_investigation_query",
    {
      expectedRevision: planProbe.revision,
      queryId: "QRY-CLOUD-IDENTITY-01",
    },
  );
  planProbe = web(cloudIdentityScenario, planProbe, "run_investigation_plan", {
    expectedRevision: planProbe.revision,
    planId: "tier1_initial",
  });
  assert.deepEqual(planProbe.attachedEnrichmentIds, ["ENR-CLOUD-IDENTITY-01"]);

  let cloud = createInitialCaseState(cloudIdentityScenario);
  cloud = web(cloudIdentityScenario, cloud, "get_case_context", {});
  cloud = web(cloudIdentityScenario, cloud, "list_investigation_skills", {});
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
  for (const queryId of [
    "QRY-CLOUD-IDENTITY-01",
    "QRY-CLOUD-EGRESS-02",
    "QRY-CLOUD-ROLE-03",
    "QRY-CLOUD-EXPORT-04",
  ]) {
    cloud = web(cloudIdentityScenario, cloud, "prepare_investigation_query", {
      expectedRevision: cloud.revision,
      queryId,
    });
    cloud = web(cloudIdentityScenario, cloud, "run_investigation_query", {
      expectedRevision: cloud.revision,
      queryId,
    });
  }
  cloud = web(cloudIdentityScenario, cloud, "attach_discovery_stage", {
    expectedRevision: cloud.revision,
    stageId: "DISCOVERY-CLOUD-01",
    rationale:
      "Attach the managed endpoint after the identity query established session continuity.",
  });
  cloud = web(cloudIdentityScenario, cloud, "attach_discovery_stage", {
    expectedRevision: cloud.revision,
    stageId: "DISCOVERY-CLOUD-02",
    rationale:
      "Attach the approved export role after role and object evidence were corroborated.",
  });
  cloud = analystDecision(cloudIdentityScenario, cloud, "authorized_exception");
  cloud = web(cloudIdentityScenario, cloud, "generate_case_report", {
    expectedRevision: cloud.revision,
  });
  assert.equal(cloud.report.status, "drafted");

  let endpoint = createInitialCaseState(endpointLateralScenario);
  endpoint = web(
    endpointLateralScenario,
    endpoint,
    "prepare_investigation_query",
    {
      expectedRevision: endpoint.revision,
      queryId: "QRY-ENDPOINT-HASH-10",
    },
  );
  endpoint = web(endpointLateralScenario, endpoint, "run_investigation_query", {
    expectedRevision: endpoint.revision,
    queryId: "QRY-ENDPOINT-HASH-10",
  });
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
  endpoint = web(
    endpointLateralScenario,
    endpoint,
    "enrich_network_indicator",
    {
      expectedRevision: endpoint.revision,
      entityId: "indicator:203.0.113.91",
    },
  );
  endpoint = web(
    endpointLateralScenario,
    endpoint,
    "prepare_investigation_query",
    {
      expectedRevision: endpoint.revision,
      queryId: "QRY-ENDPOINT-IDENTITY-03",
    },
  );
  endpoint = web(endpointLateralScenario, endpoint, "run_investigation_query", {
    expectedRevision: endpoint.revision,
    queryId: "QRY-ENDPOINT-IDENTITY-03",
  });
  endpoint = web(endpointLateralScenario, endpoint, "attach_discovery_stage", {
    expectedRevision: endpoint.revision,
    stageId: "STREAM-LAT-01",
    rationale:
      "Attach the verified host-boundary discovery after service identity evidence was returned.",
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
    actionId: "collect_endpoint_forensics",
    reasoning: "Preserve the bounded endpoint evidence before containment.",
  });
  endpoint = web(
    endpointLateralScenario,
    endpoint,
    "simulate_response_action",
    {
      expectedRevision: endpoint.revision,
      actionId: "collect_endpoint_forensics",
    },
  );
  assert.equal(
    endpoint.responseActions.find(
      (action) => action.actionId === "collect_endpoint_forensics",
    )?.status,
    "simulated",
  );

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

test("WebMCP keeps one stable case-scoped registration across revisions", async () => {
  const handler = async () => ({});
  let state = createInitialCaseState(endpointLateralScenario);
  const initialDefinitions = createCaseToolDefinitions(
    endpointLateralScenario,
    handler,
  );
  const initial = new Set(initialDefinitions.map((tool) => tool.name));
  assert.equal(initial.has("run_investigation_query"), true);
  assert.equal(initial.has("run_investigation_plan"), true);
  assert.equal(initial.has("calculate_reachability"), true);
  assert.equal(initial.has("simulate_control"), true);
  assert.equal(initial.has("propose_response_action"), true);

  state = invoke(
    endpointLateralScenario,
    state,
    "prepare_investigation_query",
    {
      expectedRevision: state.revision,
      queryId: "QRY-ENDPOINT-HASH-10",
    },
  );
  state = invoke(endpointLateralScenario, state, "run_investigation_query", {
    expectedRevision: state.revision,
    queryId: "QRY-ENDPOINT-HASH-10",
  });
  state = invoke(endpointLateralScenario, state, "enrich_file", {
    expectedRevision: state.revision,
    entityId: "file:invoice-sync-helper",
  });
  const revisedDefinitions = createCaseToolDefinitions(
    endpointLateralScenario,
    handler,
  );
  const queryDefinition = revisedDefinitions.find(
    (tool) => tool.name === "run_investigation_query",
  );
  const querySchema = (
    queryDefinition?.inputSchema as { properties?: Record<string, unknown> }
  ).properties?.queryId as {
    type?: string;
    enum?: readonly string[];
  };
  assert.equal(querySchema.type, "string");
  assert.equal(querySchema.enum, undefined);
  const queryRequired = (
    queryDefinition?.inputSchema as { required?: readonly string[] }
  ).required;
  assert.equal(queryRequired?.includes("queryText"), true);
  assert.deepEqual(
    revisedDefinitions.map((tool) => ({
      name: tool.name,
      inputSchema: tool.inputSchema,
    })),
    initialDefinitions.map((tool) => ({
      name: tool.name,
      inputSchema: tool.inputSchema,
    })),
  );

  state = invoke(endpointLateralScenario, state, "enrich_endpoint", {
    expectedRevision: state.revision,
    entityId: "endpoint:fin-ws-044",
  });
  state = invoke(endpointLateralScenario, state, "enrich_identity", {
    expectedRevision: state.revision,
    entityId: "identity:svc-fin-reports",
  });
  state = invoke(
    endpointLateralScenario,
    state,
    "prepare_investigation_query",
    {
      expectedRevision: state.revision,
      queryId: "QRY-ENDPOINT-IDENTITY-03",
    },
  );
  state = invoke(endpointLateralScenario, state, "run_investigation_query", {
    expectedRevision: state.revision,
    queryId: "QRY-ENDPOINT-IDENTITY-03",
  });
  state = invoke(endpointLateralScenario, state, "attach_discovery_stage", {
    expectedRevision: state.revision,
    stageId: "STREAM-LAT-01",
    rationale:
      "Attach the verified host-boundary discovery after service identity evidence was returned.",
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
  const afterDecisionDefinitions = createCaseToolDefinitions(
    endpointLateralScenario,
    handler,
  );
  assert.deepEqual(
    afterDecisionDefinitions.map((tool) => ({
      name: tool.name,
      inputSchema: tool.inputSchema,
    })),
    initialDefinitions.map((tool) => ({
      name: tool.name,
      inputSchema: tool.inputSchema,
    })),
  );

  const modeledState = invoke(
    endpointLateralScenario,
    state,
    "calculate_reachability",
    {
      expectedRevision: state.revision,
      fromEntityId: "endpoint:fin-ws-044",
      maxDepth: 6,
    },
  );
  assert.equal(modeledState.revision, state.revision + 1);
  const afterModelDefinitions = createCaseToolDefinitions(
    endpointLateralScenario,
    handler,
  );
  assert.deepEqual(
    afterModelDefinitions.map((tool) => ({
      name: tool.name,
      inputSchema: tool.inputSchema,
    })),
    initialDefinitions.map((tool) => ({
      name: tool.name,
      inputSchema: tool.inputSchema,
    })),
  );

  const registeredNames = new Set<string>();
  let registerCalls = 0;
  const registry: DocumentModelContext = {
    async registerTool(definition) {
      registerCalls += 1;
      if (registeredNames.has(definition.name)) {
        throw new DOMException("Duplicate tool name", "InvalidStateError");
      }
      registeredNames.add(definition.name);
    },
  };
  const registration = await registerCaseTools(
    initialDefinitions,
    new AbortController(),
    registry,
  );
  assert.equal(registration.registered, initialDefinitions.length);
  assert.equal(registerCalls, initialDefinitions.length);
  assert.equal(registeredNames.size, initialDefinitions.length);
});

test("WebMCP schemas expose only investigation-relevant inputs", () => {
  const definitions = createCaseToolDefinitions(
    endpointLateralScenario,
    async () => ({}),
  );
  for (const definition of definitions) {
    const schema = definition.inputSchema as {
      properties?: Record<string, unknown>;
      required?: readonly string[];
    };
    assert.equal(
      Object.hasOwn(schema.properties ?? {}, "requestId"),
      false,
      `${definition.name} must not require the agent to create receipt IDs`,
    );
    assert.equal(schema.required?.includes("requestId") ?? false, false);
  }
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
