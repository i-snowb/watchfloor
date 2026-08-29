import assert from "node:assert/strict";
import test from "node:test";
import {
  caseToolNames,
  createInitialCaseState,
  executeCaseTool,
  getDerivedNextStep,
  type CaseToolName,
  type ToolOutcome,
  type ToolSurface,
} from "../domain/operations";
import {
  cloudIdentityScenario,
  endpointLateralScenario,
  validateCaseFixture,
} from "../domain/scenarios";
import type { CaseFixture, CaseState } from "../domain/types";
import { createCaseToolDefinitions, registerCaseTools } from "../webmcp/tools";

function execute(
  fixture: CaseFixture,
  state: CaseState,
  toolName: CaseToolName,
  input: Record<string, unknown>,
  reportedSurface: ToolSurface = "analyst_control",
): ToolOutcome {
  return executeCaseTool(fixture, state, {
    requestId: `test-${fixture.scenarioId}-${toolName}-${state.revision}`,
    toolName,
    reportedSurface,
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

function enrich(
  fixture: CaseFixture,
  state: CaseState,
  toolName: CaseToolName,
  entityId: string,
): CaseState {
  return succeed(
    execute(
      fixture,
      state,
      toolName,
      { expectedRevision: state.revision, entityId },
      "webmcp_callback",
    ),
  );
}

function completeInvestigationPlan(
  fixture: CaseFixture,
  state: CaseState,
  planId: string,
): CaseState {
  let current = state;
  while (true) {
    const outcome = execute(
      fixture,
      current,
      "run_investigation_plan",
      { expectedRevision: current.revision, planId },
      "webmcp_callback",
    );
    assert.equal(
      outcome.ok,
      true,
      outcome.ok ? undefined : outcome.error.message,
    );
    if (!outcome.ok) return current;
    current = outcome.state;
    const data = outcome.data as { remainingCount: number };
    if (data.remainingCount === 0) return current;
  }
}

function completeResponse(
  fixture: CaseFixture,
  state: CaseState,
  actionId: CaseState["responseActions"][number]["actionId"],
): CaseState {
  const definition = fixture.responseActions.find(
    (action) => action.id === actionId,
  );
  assert.ok(definition);
  const proposed = succeed(
    execute(
      fixture,
      state,
      "propose_response_action",
      {
        expectedRevision: state.revision,
        actionId,
        reasoning: definition.proposalReasoning,
      },
      "webmcp_callback",
    ),
  );
  const simulated = succeed(
    execute(
      fixture,
      proposed,
      "simulate_response_action",
      { expectedRevision: proposed.revision, actionId },
      "webmcp_callback",
    ),
  );
  const proposalId = simulated.responseProposal?.id;
  assert.equal(typeof proposalId, "string");
  return succeed(
    execute(fixture, simulated, "authorize_response_action", {
      expectedRevision: simulated.revision,
      actionId,
      proposalId,
      acknowledgement: "AUTHORIZE_SYNTHETIC_RESPONSE",
    }),
  );
}

test("both fixtures satisfy the shared deterministic scenario contract", () => {
  for (const fixture of [cloudIdentityScenario, endpointLateralScenario]) {
    assert.doesNotThrow(() => validateCaseFixture(fixture));
    assert.equal(fixture.classification, "synthetic_demo_data");
    assert.equal(
      fixture.presentation.nodes.length >= fixture.entities.length,
      true,
    );
    assert.equal(fixture.tier1Escalation.observations.length >= 2, true);
    assert.equal(fixture.tier1Escalation.recommendedSteps.length >= 4, true);
    assert.equal(fixture.investigationQueries.length >= 4, true);
  }
  assert.equal(cloudIdentityScenario.events.length, 7);
  assert.equal(cloudIdentityScenario.stream.stages.length, 0);
  assert.equal(cloudIdentityScenario.responseActions.length, 0);
  assert.equal(endpointLateralScenario.events.length, 9);
  assert.equal(endpointLateralScenario.joins.length, 5);
  assert.equal(endpointLateralScenario.stream.stages.length, 2);
  assert.equal(endpointLateralScenario.responseActions.length, 4);
});

test("human and agent run the same deterministic investigation query", () => {
  const initial = createInitialCaseState(cloudIdentityScenario);
  const input = {
    expectedRevision: initial.revision,
    queryId: "QRY-CLOUD-IDENTITY-01",
  };
  const human = execute(
    cloudIdentityScenario,
    initial,
    "run_investigation_query",
    input,
    "analyst_control",
  );
  const agent = execute(
    cloudIdentityScenario,
    initial,
    "run_investigation_query",
    input,
    "webmcp_callback",
  );
  assert.equal(human.ok, true);
  assert.equal(agent.ok, true);
  if (!human.ok || !agent.ok) return;
  assert.deepEqual(human.data, agent.data);
  assert.deepEqual(human.state.attachedEnrichmentIds, [
    "ENR-CLOUD-IDENTITY-01",
  ]);
  const execution = human.data as {
    execution: {
      synthetic: boolean;
      syntheticRecordCount: number;
      matchedRecordCount: number;
      returnedRecordCount: number;
    };
  };
  assert.equal(execution.execution.synthetic, true);
  assert.equal(execution.execution.syntheticRecordCount, 1600);
  assert.equal(execution.execution.matchedRecordCount, 3);
  assert.equal(execution.execution.returnedRecordCount, 2);

  const duplicate = execute(
    cloudIdentityScenario,
    human.state,
    "run_investigation_query",
    {
      expectedRevision: human.state.revision,
      queryId: "QRY-CLOUD-IDENTITY-01",
    },
  );
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.error.code, "ALREADY_ATTACHED");
});

test("every catalog query executes through the shared WebMCP operation", () => {
  for (const fixture of [cloudIdentityScenario, endpointLateralScenario]) {
    let state = createInitialCaseState(fixture);
    for (let index = 0; index < fixture.stream.stages.length; index += 1) {
      state = succeed(
        execute(fixture, state, "release_next_synthetic_signal", {
          expectedRevision: state.revision,
        }),
      );
    }

    for (const query of fixture.investigationQueries) {
      const outcome = execute(
        fixture,
        state,
        "run_investigation_query",
        { expectedRevision: state.revision, queryId: query.id },
        "webmcp_callback",
      );
      assert.equal(
        outcome.ok,
        true,
        outcome.ok ? undefined : `${query.id}: ${outcome.error.message}`,
      );
      if (!outcome.ok) continue;
      state = outcome.state;
      assert.equal(
        state.attachedEnrichmentIds.includes(query.resultArtifactId),
        true,
      );
      const data = outcome.data as {
        execution: {
          synthetic: boolean;
          matchedRecordCount: number;
          returnedRecordCount: number;
        };
      };
      assert.equal(data.execution.synthetic, true);
      assert.equal(data.execution.matchedRecordCount, query.matchedRecordCount);
      assert.equal(
        data.execution.returnedRecordCount,
        query.returnedRecordCount,
      );
    }
  }
});

test("query workset withholds unreleased results and fails closed", () => {
  const initial = createInitialCaseState(endpointLateralScenario);
  const blocked = execute(
    endpointLateralScenario,
    initial,
    "run_investigation_query",
    {
      expectedRevision: initial.revision,
      queryId: "QRY-ENDPOINT-APP-05",
    },
    "webmcp_callback",
  );
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.error.code, "QUERY_NOT_AVAILABLE");
    assert.equal(blocked.state.revision, 1);
  }

  const context = execute(
    endpointLateralScenario,
    initial,
    "get_case_context",
    {},
    "webmcp_callback",
  );
  assert.equal(context.ok, true);
  if (!context.ok) return;
  const data = context.data as {
    queryWorkset: {
      available: readonly {
        id: string;
        matchedRecordCount?: number;
        returnedRecordCount?: number;
      }[];
      blockedCount: number;
    };
  };
  assert.equal(data.queryWorkset.available.length, 6);
  assert.equal(data.queryWorkset.blockedCount, 3);
  assert.equal(
    data.queryWorkset.available.some(
      (query) => query.id === "QRY-ENDPOINT-APP-05",
    ),
    false,
  );
  assert.equal(
    data.queryWorkset.available.some(
      (query) =>
        query.matchedRecordCount !== undefined ||
        query.returnedRecordCount !== undefined,
    ),
    false,
  );
});

test("investigation plans attach one available finding in deterministic order", () => {
  const fixture = endpointLateralScenario;
  const initial = createInitialCaseState(fixture);
  const first = execute(
    fixture,
    initial,
    "run_investigation_plan",
    {
      expectedRevision: initial.revision,
      planId: "tier1_initial",
    },
    "webmcp_callback",
  );
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.state.revision, initial.revision + 1);
  assert.deepEqual(first.state.attachedEnrichmentIds, ["ENR-LAT-FILE-01"]);
  const firstData = first.data as {
    planId: string;
    queryId: string;
    targetEntityId: string;
    completedCount: number;
    totalCount: number;
    remainingCount: number;
    nextQueryId: string | null;
    artifact: { id: string };
    execution: { syntheticRecordCount: number; matchedRecordCount: number };
  };
  assert.equal(firstData.planId, "tier1_initial");
  assert.equal(firstData.queryId, "QRY-ENDPOINT-FILE-01");
  assert.equal(firstData.targetEntityId, "file:invoice-sync-helper");
  assert.equal(firstData.completedCount, 1);
  assert.equal(firstData.totalCount, 4);
  assert.equal(firstData.remainingCount, 3);
  assert.equal(firstData.nextQueryId, "QRY-ENDPOINT-HOST-02");
  assert.equal(firstData.artifact.id, "ENR-LAT-FILE-01");
  assert.equal(firstData.execution.syntheticRecordCount, 2496);
  assert.equal(firstData.execution.matchedRecordCount, 11);
  assert.equal(first.receipt.title, "Helper behavior and prevalence");
  assert.equal(first.receipt.target, "invoice-sync-helper.exe");
  assert.match(first.receipt.resultSummary, /^1\/4 findings attached/);

  let state = first.state;
  const expected = [
    ["QRY-ENDPOINT-HOST-02", "ENR-LAT-ENDPOINT-01"],
    ["QRY-ENDPOINT-IDENTITY-03", "ENR-LAT-IDENTITY-01"],
    ["QRY-ENDPOINT-EGRESS-04", "ENR-LAT-DEST-01"],
  ] as const;
  for (const [queryId, artifactId] of expected) {
    const outcome = execute(
      fixture,
      state,
      "run_investigation_plan",
      { expectedRevision: state.revision, planId: "tier1_initial" },
      "webmcp_callback",
    );
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    const data = outcome.data as {
      queryId: string;
      artifact: { id: string };
    };
    assert.equal(data.queryId, queryId);
    assert.equal(data.artifact.id, artifactId);
    state = outcome.state;
  }
  assert.deepEqual(state.attachedEnrichmentIds, [
    "ENR-LAT-FILE-01",
    "ENR-LAT-ENDPOINT-01",
    "ENR-LAT-IDENTITY-01",
    "ENR-LAT-DEST-01",
  ]);

  const nextStep = getDerivedNextStep(fixture, state);
  assert.equal(nextStep.recommendedTool, "run_investigation_query");
  assert.equal(nextStep.objective, "Static-analysis fixture");

  const repeated = execute(
    fixture,
    state,
    "run_investigation_plan",
    {
      expectedRevision: state.revision,
      planId: "tier1_initial",
    },
    "webmcp_callback",
  );
  assert.equal(repeated.ok, false);
  if (!repeated.ok) assert.equal(repeated.error.code, "ALREADY_ATTACHED");

  const futurePlan = execute(
    fixture,
    initial,
    "run_investigation_plan",
    {
      expectedRevision: initial.revision,
      planId: "stage_1_verification",
    },
    "webmcp_callback",
  );
  assert.equal(futurePlan.ok, false);
  if (!futurePlan.ok) assert.equal(futurePlan.error.code, "PLAN_NOT_AVAILABLE");
});

test("investigation plans skip findings already attached by an analyst query", () => {
  const fixture = endpointLateralScenario;
  const initial = createInitialCaseState(fixture);
  const direct = execute(
    fixture,
    initial,
    "run_investigation_query",
    {
      expectedRevision: initial.revision,
      queryId: "QRY-ENDPOINT-FILE-01",
    },
    "analyst_control",
  );
  assert.equal(direct.ok, true);
  if (!direct.ok) return;
  const planned = execute(
    fixture,
    direct.state,
    "run_investigation_plan",
    { expectedRevision: direct.state.revision, planId: "tier1_initial" },
    "webmcp_callback",
  );
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  const data = planned.data as {
    queryId: string;
    completedCount: number;
    remainingCount: number;
  };
  assert.equal(data.queryId, "QRY-ENDPOINT-HOST-02");
  assert.equal(data.completedCount, 2);
  assert.equal(data.remainingCount, 2);
});

test("endpoint forensic pivot attaches bounded static and sandbox fixtures", () => {
  const fixture = endpointLateralScenario;
  let state = createInitialCaseState(fixture);
  state = succeed(
    execute(
      fixture,
      state,
      "run_investigation_query",
      {
        expectedRevision: state.revision,
        queryId: "QRY-ENDPOINT-FILE-01",
      },
      "webmcp_callback",
    ),
  );
  state = succeed(
    execute(
      fixture,
      state,
      "run_investigation_query",
      {
        expectedRevision: state.revision,
        queryId: "QRY-ENDPOINT-STATIC-08",
      },
      "webmcp_callback",
    ),
  );
  const sandbox = execute(
    fixture,
    state,
    "run_investigation_query",
    {
      expectedRevision: state.revision,
      queryId: "QRY-ENDPOINT-SANDBOX-09",
    },
    "webmcp_callback",
  );
  assert.equal(sandbox.ok, true);
  if (!sandbox.ok) return;
  state = sandbox.state;
  assert.equal(state.revision, 4);
  assert.deepEqual(state.attachedEnrichmentIds, [
    "ENR-LAT-FILE-01",
    "ENR-LAT-STATIC-02",
    "ENR-LAT-SANDBOX-03",
  ]);
  assert.equal(state.reachabilityAttached, false);
  assert.equal(state.counterfactualAttached, false);
  const result = sandbox.data as {
    artifact: { payload: { kind: string; externalExecution: boolean } };
    execution: { synthetic: boolean; syntheticRecordCount: number };
  };
  assert.equal(result.execution.synthetic, true);
  assert.equal(result.execution.syntheticRecordCount, 8);
  assert.equal(result.artifact.payload.kind, "sandbox_behavior_fixture");
  assert.equal(result.artifact.payload.externalExecution, false);
});

test("an agent can request but cannot release the next observation", () => {
  const fixture = endpointLateralScenario;
  const initial = createInitialCaseState(fixture);
  const requested = execute(
    fixture,
    initial,
    "request_next_observation",
    {
      expectedRevision: initial.revision,
      stageId: "STREAM-LAT-01",
      rationale:
        "Request the target-host prevention result before a containment decision.",
    },
    "webmcp_callback",
  );
  assert.equal(requested.ok, true);
  if (!requested.ok) return;
  assert.equal(requested.state.observationRequest?.status, "pending");
  assert.deepEqual(requested.state.releasedStreamStageIds, []);

  const agentRelease = execute(
    fixture,
    requested.state,
    "release_next_synthetic_signal",
    { expectedRevision: requested.state.revision },
    "webmcp_callback",
  );
  assert.equal(agentRelease.ok, false);
  if (!agentRelease.ok) {
    assert.equal(agentRelease.error.code, "SURFACE_NOT_ALLOWED");
  }

  const released = execute(
    fixture,
    requested.state,
    "release_next_synthetic_signal",
    { expectedRevision: requested.state.revision },
    "analyst_control",
  );
  assert.equal(released.ok, true);
  if (!released.ok) return;
  assert.deepEqual(released.state.releasedStreamStageIds, ["STREAM-LAT-01"]);
  assert.equal(released.state.observationRequest?.status, "released");
  assert.equal(typeof released.state.observationRequest?.releasedAt, "string");
});

test("response bundles prepare atomically and require analyst authorization", () => {
  const fixture = endpointLateralScenario;
  let state = createInitialCaseState(fixture);
  state = completeInvestigationPlan(fixture, state, "tier1_initial");
  state = succeed(
    execute(
      fixture,
      state,
      "request_next_observation",
      {
        expectedRevision: state.revision,
        stageId: "STREAM-LAT-01",
        rationale: "Request the blocked service-start result for disposition.",
      },
      "webmcp_callback",
    ),
  );
  state = succeed(
    execute(fixture, state, "release_next_synthetic_signal", {
      expectedRevision: state.revision,
    }),
  );
  state = completeInvestigationPlan(fixture, state, "stage_1_verification");
  state = succeed(
    execute(fixture, state, "record_evidence_decision", {
      expectedRevision: state.revision,
      decision: "confirmed_malicious",
      rationale:
        "Unsigned execution and the blocked remote-service attempt meet the synthetic containment threshold.",
    }),
  );
  state = succeed(
    execute(
      fixture,
      state,
      "calculate_reachability",
      {
        expectedRevision: state.revision,
        fromEntityId: fixture.reachability.sourceEntityId,
        maxDepth: 6,
      },
      "webmcp_callback",
    ),
  );
  state = succeed(
    execute(
      fixture,
      state,
      "simulate_control",
      {
        expectedRevision: state.revision,
        control: fixture.counterfactual.control,
      },
      "webmcp_callback",
    ),
  );

  const prepared = execute(
    fixture,
    state,
    "prepare_response_bundle",
    { expectedRevision: state.revision, bundleId: "containment" },
    "webmcp_callback",
  );
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  state = prepared.state;
  assert.equal(state.responseBundle?.bundleId, "containment");
  assert.deepEqual(
    state.responseActions.slice(0, 2).map((action) => action.status),
    ["simulated", "simulated"],
  );

  const agentAuthorization = execute(
    fixture,
    state,
    "authorize_response_bundle",
    {
      expectedRevision: state.revision,
      bundleId: "containment",
      proposalId: state.responseBundle?.id,
      acknowledgement: "AUTHORIZE_SYNTHETIC_BUNDLE",
    },
    "webmcp_callback",
  );
  assert.equal(agentAuthorization.ok, false);
  if (!agentAuthorization.ok) {
    assert.equal(agentAuthorization.error.code, "SURFACE_NOT_ALLOWED");
  }

  state = succeed(
    execute(fixture, state, "authorize_response_bundle", {
      expectedRevision: state.revision,
      bundleId: "containment",
      proposalId: state.responseBundle?.id,
      acknowledgement: "AUTHORIZE_SYNTHETIC_BUNDLE",
    }),
  );
  assert.deepEqual(state.authorizedResponseBundleIds, ["containment"]);
  assert.deepEqual(
    state.responseActions.slice(0, 2).map((action) => action.status),
    ["authorized_in_demo", "authorized_in_demo"],
  );

  state = succeed(
    execute(
      fixture,
      state,
      "request_next_observation",
      {
        expectedRevision: state.revision,
        stageId: "STREAM-LAT-02",
        rationale: "Request credential and workload recovery inventory.",
      },
      "webmcp_callback",
    ),
  );
  state = succeed(
    execute(fixture, state, "release_next_synthetic_signal", {
      expectedRevision: state.revision,
    }),
  );
  state = completeInvestigationPlan(fixture, state, "stage_2_verification");
  state = succeed(
    execute(
      fixture,
      state,
      "prepare_response_bundle",
      { expectedRevision: state.revision, bundleId: "recovery" },
      "webmcp_callback",
    ),
  );
  assert.equal(state.responseBundle?.bundleId, "recovery");
  assert.deepEqual(
    state.responseActions.slice(2).map((action) => action.status),
    ["simulated", "simulated"],
  );
  state = succeed(
    execute(fixture, state, "authorize_response_bundle", {
      expectedRevision: state.revision,
      bundleId: "recovery",
      proposalId: state.responseBundle?.id,
      acknowledgement: "AUTHORIZE_SYNTHETIC_BUNDLE",
    }),
  );
  assert.deepEqual(state.authorizedResponseBundleIds, [
    "containment",
    "recovery",
  ]);
  assert.equal(state.lifecycle, "contained_in_demo");
});

test("WebMCP exposes bounded case tools and withholds analyst gates", () => {
  assert.equal(caseToolNames.length, 32);
  const cloudNames = new Set(
    createCaseToolDefinitions(cloudIdentityScenario, async () => ({
      ok: true,
    })).map((tool) => tool.name),
  );
  const endpointNames = new Set(
    createCaseToolDefinitions(endpointLateralScenario, async () => ({
      ok: true,
    })).map((tool) => tool.name),
  );
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
  assert.deepEqual(
    cloudNames,
    new Set<CaseToolName>([
      ...common,
      "enrich_identity",
      "enrich_network_indicator",
      "enrich_cloud_role",
      "enrich_resource",
    ]),
  );
  assert.deepEqual(
    endpointNames,
    new Set<CaseToolName>([
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
    ]),
  );
  assert.equal(cloudNames.size, 18);
  assert.equal(endpointNames.size, 25);

  for (const withheld of [
    "record_evidence_decision",
    "release_next_synthetic_signal",
    "authorize_response_action",
    "authorize_response_bundle",
    "approve_case_report",
  ] satisfies readonly CaseToolName[]) {
    assert.equal(cloudNames.has(withheld), false);
    assert.equal(endpointNames.has(withheld), false);
  }
  for (const unavailableInCloud of [
    "enrich_endpoint",
    "enrich_file",
    "calculate_reachability",
    "simulate_control",
    "request_next_observation",
    "propose_response_action",
    "simulate_response_action",
    "prepare_response_bundle",
  ] satisfies readonly CaseToolName[]) {
    assert.equal(cloudNames.has(unavailableInCloud), false);
  }
  assert.equal(endpointNames.has("enrich_cloud_role"), false);

  const cloudDefinitions = createCaseToolDefinitions(
    cloudIdentityScenario,
    async () => ({ ok: true }),
  );
  assert.equal(
    cloudDefinitions.some((tool) => tool.name === "run_investigation_plan"),
    true,
  );
  assert.equal(
    cloudDefinitions.some((tool) => tool.name === "request_next_observation"),
    false,
  );
  assert.equal(
    cloudDefinitions.some((tool) => tool.name === "prepare_response_bundle"),
    false,
  );

  const endpointDefinitions = createCaseToolDefinitions(
    endpointLateralScenario,
    async () => ({ ok: true }),
  );
  for (const phaseTool of [
    "run_investigation_plan",
    "request_next_observation",
    "prepare_response_bundle",
  ]) {
    assert.equal(
      endpointDefinitions.some((tool) => tool.name === phaseTool),
      true,
    );
  }

  const endpointSchemas = JSON.stringify(
    createCaseToolDefinitions(endpointLateralScenario, async () => ({
      ok: true,
    })),
  );
  assert.equal(endpointSchemas.includes("windows_authentication"), true);
  for (const unreleasedId of [
    "EVT-EDR-0448-10",
    "EVT-CLOUD-0448-11",
    "ENR-LAT-WORKLOAD-01",
  ]) {
    assert.equal(endpointSchemas.includes(unreleasedId), false);
  }
});

test("tool registration uses the caller-owned teardown signal", async () => {
  const definitions = createCaseToolDefinitions(
    cloudIdentityScenario,
    async () => ({ ok: true }),
  );
  const signals: AbortSignal[] = [];
  const registry: DocumentModelContext = {
    async registerTool(_definition, options) {
      assert.ok(options?.signal);
      signals.push(options.signal);
    },
  };
  const controller = new AbortController();
  const result = await registerCaseTools(definitions, controller, registry);
  assert.equal(result.supported, true);
  assert.equal(result.registered, definitions.length);
  assert.equal(
    result.outcomes.every((outcome) => outcome.status === "registered"),
    true,
  );
  controller.abort();
  assert.equal(
    signals.every((signal) => signal.aborted),
    true,
  );
});

test("tool registration stops immediately when the caller aborts", async () => {
  const definitions = createCaseToolDefinitions(
    cloudIdentityScenario,
    async () => ({ ok: true }),
  );
  const controller = new AbortController();
  const registeredNames: string[] = [];
  let releaseFirstRegistration: (() => void) | undefined;
  const firstRegistration = new Promise<void>((resolve) => {
    releaseFirstRegistration = resolve;
  });
  const registry: DocumentModelContext = {
    async registerTool(definition) {
      registeredNames.push(definition.name);
      if (registeredNames.length === 1) await firstRegistration;
    },
  };

  const registration = registerCaseTools(definitions, controller, registry);
  await Promise.resolve();
  controller.abort();
  releaseFirstRegistration?.();

  const result = await registration;
  assert.deepEqual(registeredNames, [definitions[0]?.name]);
  assert.equal(result.registered, 0);
  assert.deepEqual(result.outcomes, []);
});

test("missing model context fails closed", async () => {
  const definitions = createCaseToolDefinitions(
    cloudIdentityScenario,
    async () => ({ ok: true }),
  );
  const unavailable = await registerCaseTools(
    definitions,
    new AbortController(),
    undefined,
  );
  assert.equal(unavailable.supported, false);
  assert.equal(unavailable.registered, 0);
  assert.equal(
    unavailable.outcomes.every((outcome) => outcome.status === "unavailable"),
    true,
  );
});

test("registered callbacks tolerate a missing native execution context", async () => {
  const receivedSignals: AbortSignal[] = [];
  const definition = createCaseToolDefinitions(
    cloudIdentityScenario,
    async (_toolName, _input, signal) => {
      receivedSignals.push(signal);
      return { ok: true };
    },
  )[0];
  assert.ok(definition);
  await definition.execute({ requestId: "native-no-context-001" });
  assert.equal(receivedSignals.length, 1);
  assert.equal(receivedSignals[0]?.aborted, false);
});

test("Jordan closes with an authorized exception and agent-drafted report", () => {
  const fixture = cloudIdentityScenario;
  let state = createInitialCaseState(fixture);
  state = enrich(fixture, state, "enrich_identity", "identity:jdoe");
  state = enrich(
    fixture,
    state,
    "enrich_network_indicator",
    "indicator:198.51.100.24",
  );
  state = enrich(fixture, state, "enrich_cloud_role", "role:prod-admin");
  state = enrich(fixture, state, "enrich_resource", "object:customer-export");
  state = succeed(
    execute(fixture, state, "record_evidence_decision", {
      expectedRevision: state.revision,
      decision: "authorized_exception",
      rationale:
        "CHG-2941 covers the export, but prod-admin remains a least-privilege exception.",
    }),
  );
  state = succeed(
    execute(
      fixture,
      state,
      "generate_case_report",
      { expectedRevision: state.revision },
      "webmcp_callback",
    ),
  );
  assert.equal(state.lifecycle, "report_drafted");
  assert.equal(
    state.report.report?.disposition,
    "authorized_activity_policy_exception",
  );
  assert.match(
    state.report.report?.executiveSummary ?? "",
    /Analyst correction: CHG-2941 covers the export, but prod-admin remains a least-privilege exception\./,
  );
  assert.ok(
    state.report.report?.confirmedFindings.includes(
      "Analyst correction: CHG-2941 covers the export, but prod-admin remains a least-privilege exception.",
    ),
  );

  const rejectedApproval = execute(
    fixture,
    state,
    "approve_case_report",
    {
      expectedRevision: state.revision,
      reportId: fixture.conclusion.reportId,
      acknowledgement: "APPROVE_SYNTHETIC_REPORT",
    },
    "webmcp_callback",
  );
  assert.equal(rejectedApproval.ok, false);
  if (!rejectedApproval.ok) {
    assert.equal(rejectedApproval.error.code, "SURFACE_NOT_ALLOWED");
  }

  state = succeed(
    execute(fixture, state, "approve_case_report", {
      expectedRevision: state.revision,
      reportId: fixture.conclusion.reportId,
      acknowledgement: "APPROVE_SYNTHETIC_REPORT",
    }),
  );
  assert.equal(state.lifecycle, "closed_in_demo");
  assert.equal(state.report.status, "approved_in_demo");
});

test("an analyst disposition cannot change after it is recorded", () => {
  const fixture = cloudIdentityScenario;
  let state = createInitialCaseState(fixture);
  state = enrich(fixture, state, "enrich_identity", "identity:jdoe");
  state = enrich(
    fixture,
    state,
    "enrich_network_indicator",
    "indicator:198.51.100.24",
  );
  state = enrich(fixture, state, "enrich_cloud_role", "role:prod-admin");
  state = enrich(fixture, state, "enrich_resource", "object:customer-export");
  state = succeed(
    execute(fixture, state, "record_evidence_decision", {
      expectedRevision: state.revision,
      decision: "authorized_exception",
      rationale:
        "The approved change covers the export but not the role scope.",
    }),
  );

  const changed = execute(fixture, state, "record_evidence_decision", {
    expectedRevision: state.revision,
    decision: "keep_suspect",
    rationale: "Attempt to replace the already recorded disposition.",
  });
  assert.equal(changed.ok, false);
  if (!changed.ok) {
    assert.equal(changed.error.code, "DECISION_STATE_CONFLICT");
  }
});

test("an alternate disposition produces explicit review and reset guidance", () => {
  const fixture = cloudIdentityScenario;
  let state = createInitialCaseState(fixture);
  state = enrich(fixture, state, "enrich_identity", "identity:jdoe");
  state = enrich(
    fixture,
    state,
    "enrich_network_indicator",
    "indicator:198.51.100.24",
  );
  state = enrich(fixture, state, "enrich_cloud_role", "role:prod-admin");
  state = enrich(fixture, state, "enrich_resource", "object:customer-export");
  state = succeed(
    execute(fixture, state, "record_evidence_decision", {
      expectedRevision: state.revision,
      decision: "keep_suspect",
      rationale: "The approved context does not explain the role scope.",
    }),
  );

  const nextStep = getDerivedNextStep(fixture, state);
  assert.equal(nextStep.phase, "review");
  assert.equal(nextStep.recommendedTool, "get_case_context");
  assert.match(nextStep.objective, /reset the synthetic case/i);
});

test("malicious case completes staged containment, recovery, report, and closure", () => {
  const fixture = endpointLateralScenario;
  let state = createInitialCaseState(fixture);
  state = enrich(fixture, state, "enrich_file", "file:invoice-sync-helper");
  state = enrich(fixture, state, "enrich_endpoint", "endpoint:fin-ws-044");
  state = enrich(fixture, state, "enrich_identity", "identity:svc-fin-reports");
  state = enrich(
    fixture,
    state,
    "enrich_network_indicator",
    "indicator:203.0.113.91",
  );
  state = succeed(
    execute(fixture, state, "release_next_synthetic_signal", {
      expectedRevision: state.revision,
    }),
  );
  state = enrich(fixture, state, "enrich_endpoint", "endpoint:app-srv-021");
  state = succeed(
    execute(fixture, state, "record_evidence_decision", {
      expectedRevision: state.revision,
      decision: "confirmed_malicious",
      rationale:
        "The blocked service-start attempt completes the synthetic containment threshold.",
    }),
  );
  state = succeed(
    execute(
      fixture,
      state,
      "calculate_reachability",
      {
        expectedRevision: state.revision,
        fromEntityId: fixture.reachability.sourceEntityId,
        maxDepth: 6,
      },
      "webmcp_callback",
    ),
  );
  state = succeed(
    execute(
      fixture,
      state,
      "simulate_control",
      {
        expectedRevision: state.revision,
        control: fixture.counterfactual.control,
      },
      "webmcp_callback",
    ),
  );
  state = completeResponse(fixture, state, "contain_endpoint");
  state = completeResponse(fixture, state, "disable_service_identity");
  state = succeed(
    execute(fixture, state, "release_next_synthetic_signal", {
      expectedRevision: state.revision,
    }),
  );
  state = enrich(fixture, state, "enrich_resource", "secret:ci-deploy-token");
  state = enrich(fixture, state, "enrich_resource", "workload:billing-api");
  state = completeResponse(fixture, state, "rotate_deployment_credential");
  state = completeResponse(fixture, state, "rollback_workload_image");
  assert.equal(state.lifecycle, "contained_in_demo");

  state = succeed(
    execute(
      fixture,
      state,
      "generate_case_report",
      { expectedRevision: state.revision },
      "webmcp_callback",
    ),
  );
  assert.equal(state.report.report?.actionIds.length, 4);
  assert.equal(state.report.report?.limitations.length, 3);
  state = succeed(
    execute(fixture, state, "approve_case_report", {
      expectedRevision: state.revision,
      reportId: fixture.conclusion.reportId,
      acknowledgement: "APPROVE_SYNTHETIC_REPORT",
    }),
  );
  assert.equal(state.lifecycle, "closed_in_demo");
});

test("future telemetry and analyst-only controls fail closed", () => {
  const fixture = endpointLateralScenario;
  const initial = createInitialCaseState(fixture);
  const futureEvent = execute(fixture, initial, "inspect_event", {
    eventId: "EVT-EDR-0448-10",
  });
  assert.equal(futureEvent.ok, false);
  if (!futureEvent.ok) {
    assert.equal(futureEvent.error.code, "EVENT_NOT_AVAILABLE");
  }

  const futureEnrichment = execute(
    fixture,
    initial,
    "enrich_resource",
    {
      expectedRevision: initial.revision,
      entityId: "workload:billing-api",
    },
    "webmcp_callback",
  );
  assert.equal(futureEnrichment.ok, false);
  if (!futureEnrichment.ok) {
    assert.equal(futureEnrichment.error.code, "UNSUPPORTED_SCOPE");
  }

  const replay = execute(
    fixture,
    initial,
    "release_next_synthetic_signal",
    { expectedRevision: initial.revision },
    "webmcp_callback",
  );
  assert.equal(replay.ok, false);
  if (!replay.ok) assert.equal(replay.error.code, "SURFACE_NOT_ALLOWED");
});

test("decision, model, response dependency, and report gates are enforced", () => {
  const fixture = endpointLateralScenario;
  let state = createInitialCaseState(fixture);
  state = enrich(fixture, state, "enrich_file", "file:invoice-sync-helper");
  state = enrich(fixture, state, "enrich_endpoint", "endpoint:fin-ws-044");
  state = enrich(fixture, state, "enrich_identity", "identity:svc-fin-reports");
  const earlyDecision = execute(fixture, state, "record_evidence_decision", {
    expectedRevision: state.revision,
    decision: "confirmed_malicious",
    rationale: "The initial evidence appears malicious in the synthetic case.",
  });
  assert.equal(earlyDecision.ok, false);
  if (!earlyDecision.ok) {
    assert.equal(earlyDecision.error.code, "CONTEXT_REQUIRED");
  }

  state = succeed(
    execute(fixture, state, "release_next_synthetic_signal", {
      expectedRevision: state.revision,
    }),
  );
  state = enrich(fixture, state, "enrich_endpoint", "endpoint:app-srv-021");
  state = succeed(
    execute(fixture, state, "record_evidence_decision", {
      expectedRevision: state.revision,
      decision: "confirmed_malicious",
      rationale:
        "The blocked service-start attempt completes the synthetic threshold.",
    }),
  );
  const missingModel = execute(
    fixture,
    state,
    "propose_response_action",
    {
      expectedRevision: state.revision,
      actionId: "contain_endpoint",
      reasoning:
        fixture.responseActions[0]?.proposalReasoning ??
        "Contain the endpoint safely.",
    },
    "webmcp_callback",
  );
  assert.equal(missingModel.ok, false);
  if (!missingModel.ok) assert.equal(missingModel.error.code, "MODEL_REQUIRED");

  const reportBlocked = execute(
    fixture,
    state,
    "generate_case_report",
    { expectedRevision: state.revision },
    "webmcp_callback",
  );
  assert.equal(reportBlocked.ok, false);
  if (!reportBlocked.ok) {
    assert.equal(reportBlocked.error.code, "CONTEXT_REQUIRED");
  }
});

test("read operations preserve revision and writes reject stale or extra input", () => {
  const fixture = cloudIdentityScenario;
  const initial = createInitialCaseState(fixture);
  const read = execute(fixture, initial, "get_case_context", {});
  assert.equal(read.ok, true);
  assert.equal(read.state.revision, 1);
  if (read.ok) {
    assert.equal(read.mutatesState, false);
    const data = read.data as {
      tier1Handoff: {
        observations: readonly unknown[];
        recommendedSteps: readonly { progress: string }[];
      };
      collaborationHandoff: {
        currentRevision: number;
        nextOwner: string;
        exactNextTool: string | null;
        whyNow: string;
      };
    };
    assert.equal(data.tier1Handoff.observations.length, 2);
    assert.equal(data.tier1Handoff.recommendedSteps.length, 4);
    assert.equal(
      data.tier1Handoff.recommendedSteps.every(
        (step) => step.progress === "recommended",
      ),
      true,
    );
    assert.equal(data.collaborationHandoff.currentRevision, 1);
    assert.equal(data.collaborationHandoff.nextOwner, "copilot");
    assert.equal(
      data.collaborationHandoff.exactNextTool,
      "run_investigation_plan",
    );
    assert.equal(data.collaborationHandoff.whyNow.length > 20, true);
  }

  const extra = execute(fixture, initial, "inspect_entity", {
    entityId: "identity:jdoe",
    arbitrary: true,
  });
  assert.equal(extra.ok, false);
  if (!extra.ok) assert.equal(extra.error.code, "VALIDATION_ERROR");

  const stale = execute(fixture, initial, "enrich_identity", {
    expectedRevision: 9,
    entityId: "identity:jdoe",
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) {
    assert.equal(stale.error.code, "STALE_STATE");
    assert.equal(stale.error.retryable, true);
  }
});
