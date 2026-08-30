import assert from "node:assert/strict";
import test from "node:test";
import {
  caseToolNames,
  createInitialCaseState,
  executeCaseTool,
  getDerivedNextStep,
  getInvestigationPlans,
  type CaseToolName,
  type ToolOutcome,
  type ToolSurface,
} from "../domain/operations";
import {
  cloudIdentityScenario,
  endpointLateralScenario,
  validateCaseFixture,
} from "../domain/scenarios";
import { parseCaseState } from "../domain/case-state";
import type { CaseFixture, CaseState } from "../domain/types";
import {
  getQueryConsoleContract,
  matchesQueryConsoleContract,
} from "../domain/query-console";
import { createCaseToolDefinitions, registerCaseTools } from "../webmcp/tools";
import { layoutTraceResultPackets } from "../lib/trace-result-layout";
import {
  TRACE_NODE_HEIGHT,
  TRACE_NODE_WIDTH,
  TRACE_RESULT_PACKET_HEIGHT,
  TRACE_RESULT_PACKET_WIDTH,
} from "../lib/trace-geometry";

function execute(
  fixture: CaseFixture,
  state: CaseState,
  toolName: CaseToolName,
  input: Record<string, unknown>,
  reportedSurface: ToolSurface = "analyst_control",
): ToolOutcome {
  const normalizedInput =
    toolName === "run_investigation_query" &&
    typeof input.queryId === "string" &&
    input.queryText === undefined
      ? {
          ...input,
          queryText: getQueryConsoleContract(input.queryId)?.text ?? "",
        }
      : input;
  return executeCaseTool(fixture, state, {
    requestId: `test-${fixture.scenarioId}-${toolName}-${state.revision}`,
    toolName,
    reportedSurface,
    input: normalizedInput,
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

function runPreparedQuery(
  fixture: CaseFixture,
  state: CaseState,
  queryId: string,
  reportedSurface: ToolSurface = "webmcp_callback",
): ToolOutcome {
  const prepared =
    state.preparedQuery?.queryId === queryId
      ? state
      : succeed(
          execute(
            fixture,
            state,
            "prepare_investigation_query",
            { expectedRevision: state.revision, queryId },
            reportedSurface,
          ),
        );
  return execute(
    fixture,
    prepared,
    "run_investigation_query",
    { expectedRevision: prepared.revision, queryId },
    reportedSurface,
  );
}

function runPreparedPlan(
  fixture: CaseFixture,
  state: CaseState,
  planId: string,
  queryId: string,
  reportedSurface: ToolSurface = "webmcp_callback",
): ToolOutcome {
  const prepared = succeed(
    execute(
      fixture,
      state,
      "prepare_investigation_query",
      { expectedRevision: state.revision, queryId },
      reportedSurface,
    ),
  );
  return execute(
    fixture,
    prepared,
    "run_investigation_plan",
    { expectedRevision: prepared.revision, planId },
    reportedSurface,
  );
}

function attachDiscovery(
  fixture: CaseFixture,
  state: CaseState,
  stageId: string,
  reportedSurface: ToolSurface = "webmcp_callback",
): ToolOutcome {
  return execute(
    fixture,
    state,
    "attach_discovery_stage",
    {
      expectedRevision: state.revision,
      stageId,
      rationale:
        "The required bounded query evidence is attached and supports adding this verified discovery.",
    },
    reportedSurface,
  );
}

const completeReportReview = {
  acknowledgement: "APPROVE_SYNTHETIC_REPORT",
  analystClosureNote:
    "Evidence supports closure. Track the privileged-role exception with the service owner.",
} as const;

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
    const plan = getInvestigationPlans(fixture).find(
      (candidate) => candidate.id === planId,
    );
    const queryId = plan?.queryIds.find((candidateId) => {
      const query = fixture.investigationQueries.find(
        (candidate) => candidate.id === candidateId,
      );
      return (
        query !== undefined &&
        !current.executedInvestigationQueryIds.includes(query.id)
      );
    });
    assert.ok(queryId, `No unresolved query exists for ${planId}`);
    const outcome = runPreparedPlan(fixture, current, planId, queryId);
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
  assert.equal(cloudIdentityScenario.stream.stages.length, 2);
  assert.equal(cloudIdentityScenario.responseActions.length, 0);
  assert.equal(endpointLateralScenario.events.length, 9);
  assert.equal(endpointLateralScenario.joins.length, 5);
  assert.equal(endpointLateralScenario.stream.stages.length, 2);
  assert.equal(endpointLateralScenario.responseActions.length, 6);
});

test("fixture validation rejects a noncontiguous priority route", () => {
  const overlay = endpointLateralScenario.impact.threatOverlay!;
  const invalid: CaseFixture = {
    ...endpointLateralScenario,
    impact: {
      ...endpointLateralScenario.impact,
      threatOverlay: {
        ...overlay,
        priorityRoute: {
          ...overlay.priorityRoute,
          pathIds: ["PATH-LAT-03", "PATH-LAT-01", "PATH-LAT-04"],
        },
      },
    },
  };

  assert.throws(
    () => validateCaseFixture(invalid),
    /invalid impact presentation/,
  );
});

test("result packets do not cover another investigation entity", () => {
  for (const fixture of [cloudIdentityScenario, endpointLateralScenario]) {
    const nodes = fixture.presentation.nodes;
    const nodeById = new Map(nodes.map((node) => [node.entityId, node]));
    const visibleEntityIds = new Set(nodes.map((node) => node.entityId));
    const targetEntityIds = [
      ...new Set(
        fixture.investigationQueries.map((query) => query.targetEntityId),
      ),
    ];
    const placements = layoutTraceResultPackets(
      targetEntityIds,
      nodes,
      visibleEntityIds,
      fixture.presentation.graphWidth,
      fixture.presentation.graphHeight,
    );

    for (const targetEntityId of targetEntityIds) {
      const placement = placements.get(targetEntityId);
      assert.ok(placement);
      const packet = {
        left: placement.x,
        top: placement.y,
        right: placement.x + TRACE_RESULT_PACKET_WIDTH,
        bottom: placement.y + TRACE_RESULT_PACKET_HEIGHT,
      };

      for (const [entityId, node] of nodeById) {
        if (entityId === targetEntityId) continue;
        const overlaps =
          packet.left < node.x + TRACE_NODE_WIDTH &&
          packet.right > node.x &&
          packet.top < node.y + TRACE_NODE_HEIGHT &&
          packet.bottom > node.y;
        assert.equal(
          overlaps,
          false,
          `${fixture.scenarioId}: ${targetEntityId} result packet overlaps ${entityId}`,
        );
      }
    }
  }
});

test("presentation cards do not overlap at release geometry", () => {
  for (const fixture of [
    cloudIdentityScenario,
    endpointLateralScenario,
  ] as readonly CaseFixture[]) {
    const nodes = [
      ...fixture.presentation.nodes,
      ...fixture.stream.stages.flatMap((stage) => stage.graphNodes),
    ];
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index]!;
      assert.ok(node.x >= 0 && node.y >= 0);
      assert.ok(node.x + TRACE_NODE_WIDTH <= fixture.presentation.graphWidth);
      assert.ok(node.y + TRACE_NODE_HEIGHT <= fixture.presentation.graphHeight);
      for (const candidate of nodes.slice(index + 1)) {
        const overlaps =
          node.x < candidate.x + TRACE_NODE_WIDTH &&
          node.x + TRACE_NODE_WIDTH > candidate.x &&
          node.y < candidate.y + TRACE_NODE_HEIGHT &&
          node.y + TRACE_NODE_HEIGHT > candidate.y;
        assert.equal(
          overlaps,
          false,
          `${fixture.scenarioId}: ${node.entityId} overlaps ${candidate.entityId}`,
        );
      }
    }
  }
});

test("human and agent run the same deterministic investigation query", () => {
  const initial = createInitialCaseState(cloudIdentityScenario);
  const human = runPreparedQuery(
    cloudIdentityScenario,
    initial,
    "QRY-CLOUD-IDENTITY-01",
    "analyst_control",
  );
  const agent = runPreparedQuery(
    cloudIdentityScenario,
    initial,
    "QRY-CLOUD-IDENTITY-01",
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
    returnedRecords: readonly { id: string; sourceLabel: string }[];
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
  assert.equal(execution.returnedRecords.length, 2);
  assert.deepEqual(
    execution.returnedRecords.map((record) => record.id),
    ["QRR-CLOUD-IDENTITY-01", "QRR-CLOUD-IDENTITY-02"],
  );

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

test("raw query execution requires the visible canonical query text", () => {
  const state = createInitialCaseState(cloudIdentityScenario);
  const outcome = executeCaseTool(cloudIdentityScenario, state, {
    requestId: "test-query-text-required",
    toolName: "run_investigation_query",
    reportedSurface: "webmcp_callback",
    input: {
      expectedRevision: state.revision,
      queryId: "QRY-CLOUD-IDENTITY-01",
    },
  });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.error.code, "VALIDATION_ERROR");
    assert.equal(
      outcome.error.message,
      "Missing required input field 'queryText'.",
    );
  }
});

test("canonical query text still requires shared preparation", () => {
  const state = createInitialCaseState(cloudIdentityScenario);
  const queryId = "QRY-CLOUD-IDENTITY-01";
  const queryText = getQueryConsoleContract(queryId)?.text;
  assert.equal(typeof queryText, "string");
  const outcome = executeCaseTool(cloudIdentityScenario, state, {
    requestId: "test-query-preparation-required",
    toolName: "run_investigation_query",
    reportedSurface: "webmcp_callback",
    input: { expectedRevision: state.revision, queryId, queryText },
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.error.code, "QUERY_PREPARATION_REQUIRED");
  assert.equal(outcome.state.revision, state.revision);
  assert.deepEqual(outcome.state.attachedEnrichmentIds, []);
});

test("agent can prepare a shared visible query without attaching evidence", () => {
  const initial = createInitialCaseState(cloudIdentityScenario);
  const prepared = execute(
    cloudIdentityScenario,
    initial,
    "prepare_investigation_query",
    {
      expectedRevision: initial.revision,
      queryId: "QRY-CLOUD-IDENTITY-01",
    },
    "webmcp_callback",
  );
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.equal(prepared.state.revision, initial.revision + 1);
  assert.deepEqual(prepared.state.attachedEnrichmentIds, []);
  assert.deepEqual(prepared.state.preparedQuery, {
    queryId: "QRY-CLOUD-IDENTITY-01",
    targetEntityId: "identity:jdoe",
    actor: "agent",
    preparedAtRevision: 2,
    preparedAt: "2026-08-27T09:43:02.000Z",
  });
  const data = prepared.data as {
    language: string;
    queryId: string;
    queryText: string;
    targetEntityId: string;
    executable: boolean;
  };
  assert.equal(data.language, "KQL");
  assert.equal(data.queryId, "QRY-CLOUD-IDENTITY-01");
  assert.equal(data.targetEntityId, "identity:jdoe");
  assert.match(data.queryText, /^let start_time = datetime/);
  assert.match(data.queryText, /Timestamp between/);
  assert.equal(data.executable, true);

  const context = execute(
    cloudIdentityScenario,
    prepared.state,
    "get_case_context",
    {},
  );
  assert.equal(context.ok, true);
  if (context.ok) {
    const contextData = context.data as {
      queryWorkset: { prepared: CaseState["preparedQuery"] };
    };
    assert.equal(
      contextData.queryWorkset.prepared?.queryId,
      "QRY-CLOUD-IDENTITY-01",
    );
  }

  const stalePrepare = execute(
    cloudIdentityScenario,
    prepared.state,
    "prepare_investigation_query",
    {
      expectedRevision: initial.revision,
      queryId: "QRY-CLOUD-EGRESS-02",
    },
    "webmcp_callback",
  );
  assert.equal(stalePrepare.ok, false);
  if (!stalePrepare.ok) assert.equal(stalePrepare.error.code, "STALE_STATE");

  const extraInput = execute(
    cloudIdentityScenario,
    initial,
    "prepare_investigation_query",
    {
      expectedRevision: initial.revision,
      queryId: "QRY-CLOUD-IDENTITY-01",
      queryText: "arbitrary input must not execute",
    },
    "webmcp_callback",
  );
  assert.equal(extraInput.ok, false);
  if (!extraInput.ok) {
    assert.match(extraInput.error.message, /Unknown input field 'queryText'/);
  }

  const contract = getQueryConsoleContract("QRY-CLOUD-IDENTITY-01");
  assert.notEqual(contract, null);
  if (!contract) return;
  const rejectedDraft = execute(
    cloudIdentityScenario,
    prepared.state,
    "run_investigation_query",
    {
      expectedRevision: prepared.state.revision,
      queryId: "QRY-CLOUD-IDENTITY-01",
      queryText: contract.text.replace(
        '| where User == "jdoe"',
        '| where User != "jdoe"',
      ),
    },
  );
  assert.equal(rejectedDraft.ok, false);
  if (!rejectedDraft.ok) {
    assert.equal(rejectedDraft.error.code, "QUERY_TEXT_MISMATCH");
  }

  const approvedDraft = execute(
    cloudIdentityScenario,
    prepared.state,
    "run_investigation_query",
    {
      expectedRevision: prepared.state.revision,
      queryId: "QRY-CLOUD-IDENTITY-01",
      queryText: contract.text,
    },
  );
  assert.equal(approvedDraft.ok, true);

  const executed = execute(
    cloudIdentityScenario,
    prepared.state,
    "run_investigation_query",
    {
      expectedRevision: prepared.state.revision,
      queryId: "QRY-CLOUD-IDENTITY-01",
    },
    "webmcp_callback",
  );
  assert.equal(executed.ok, true);
  if (executed.ok) assert.equal(executed.state.preparedQuery, null);
});

test("query console accepts only the selected canonical case query", () => {
  const contract = getQueryConsoleContract("QRY-CLOUD-IDENTITY-01");
  assert.notEqual(contract, null);
  if (!contract) return;
  assert.equal(
    matchesQueryConsoleContract("QRY-CLOUD-IDENTITY-01", contract.text),
    true,
  );
  assert.equal(
    matchesQueryConsoleContract(
      "QRY-CLOUD-IDENTITY-01",
      "operator and change baseline",
    ),
    false,
  );
  assert.equal(
    matchesQueryConsoleContract(
      "QRY-CLOUD-IDENTITY-01",
      contract.text.replace('| where User == "jdoe"', '| where User != "jdoe"'),
    ),
    false,
  );
});

test("a prepared query cannot authorize a different query", () => {
  const fixture = cloudIdentityScenario;
  const prepared = succeed(
    execute(
      fixture,
      createInitialCaseState(fixture),
      "prepare_investigation_query",
      {
        expectedRevision: 1,
        queryId: "QRY-CLOUD-IDENTITY-01",
      },
      "webmcp_callback",
    ),
  );
  const executed = execute(
    fixture,
    prepared,
    "run_investigation_query",
    {
      expectedRevision: prepared.revision,
      queryId: "QRY-CLOUD-EGRESS-02",
    },
    "webmcp_callback",
  );

  assert.equal(executed.ok, false);
  if (executed.ok) return;
  assert.equal(executed.error.code, "QUERY_PREPARATION_REQUIRED");
  assert.equal(executed.state.preparedQuery?.queryId, "QRY-CLOUD-IDENTITY-01");
  assert.deepEqual(
    parseCaseState(JSON.stringify(executed.state), fixture),
    executed.state,
  );
});

test("a prepared query cannot execute after the shared case advances", () => {
  const fixture = cloudIdentityScenario;
  const prepared = succeed(
    execute(
      fixture,
      createInitialCaseState(fixture),
      "prepare_investigation_query",
      {
        expectedRevision: 1,
        queryId: "QRY-CLOUD-IDENTITY-01",
      },
      "webmcp_callback",
    ),
  );
  const advanced = succeed(
    execute(
      fixture,
      prepared,
      "enrich_network_indicator",
      {
        expectedRevision: prepared.revision,
        entityId: "indicator:198.51.100.24",
      },
      "webmcp_callback",
    ),
  );
  const outcome = execute(
    fixture,
    advanced,
    "run_investigation_query",
    {
      expectedRevision: advanced.revision,
      queryId: "QRY-CLOUD-IDENTITY-01",
    },
    "webmcp_callback",
  );

  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.error.code, "QUERY_PREPARATION_STALE");
  assert.equal(outcome.state.revision, advanced.revision);
  assert.equal(outcome.state.preparedQuery?.queryId, "QRY-CLOUD-IDENTITY-01");
});

test("an investigation plan requires its next query in the shared console", () => {
  const fixture = endpointLateralScenario;
  const state = createInitialCaseState(fixture);
  const outcome = execute(
    fixture,
    state,
    "run_investigation_plan",
    { expectedRevision: state.revision, planId: "tier1_initial" },
    "webmcp_callback",
  );

  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.error.code, "QUERY_PREPARATION_REQUIRED");
    assert.equal(outcome.state.revision, state.revision);
  }
});

test("an investigation plan clears a prepared query only when it executes it", () => {
  const fixture = endpointLateralScenario;
  const prepared = succeed(
    execute(
      fixture,
      createInitialCaseState(fixture),
      "prepare_investigation_query",
      {
        expectedRevision: 1,
        queryId: "QRY-ENDPOINT-FILE-01",
      },
      "webmcp_callback",
    ),
  );
  const planned = succeed(
    execute(
      fixture,
      prepared,
      "run_investigation_plan",
      {
        expectedRevision: prepared.revision,
        planId: "tier1_initial",
      },
      "webmcp_callback",
    ),
  );

  assert.deepEqual(planned.attachedEnrichmentIds, ["ENR-LAT-FILE-01"]);
  assert.equal(planned.preparedQuery, null);
  assert.deepEqual(parseCaseState(JSON.stringify(planned), fixture), planned);
});

test("every catalog query executes through the shared WebMCP operation", () => {
  for (const fixture of [cloudIdentityScenario, endpointLateralScenario]) {
    let state = createInitialCaseState(fixture);
    const pendingQueryIds = new Set(
      fixture.investigationQueries.map((query) => query.id),
    );
    while (pendingQueryIds.size > 0) {
      const query = fixture.investigationQueries.find(
        (candidate) =>
          pendingQueryIds.has(candidate.id) &&
          (candidate.requiresStageId === null ||
            state.releasedStreamStageIds.includes(candidate.requiresStageId)),
      );
      if (!query) {
        const nextStage = fixture.stream.stages.find(
          (stage) => !state.releasedStreamStageIds.includes(stage.id),
        );
        assert.ok(
          nextStage,
          "A pending query must have an attachable discovery",
        );
        if (
          fixture.id === endpointLateralScenario.id &&
          nextStage.ordinal > 1
        ) {
          state = succeed(
            execute(fixture, state, "record_evidence_decision", {
              expectedRevision: state.revision,
              decision: "confirmed_malicious",
              rationale:
                "The bounded endpoint evidence supports the synthetic containment decision.",
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
          state = succeed(
            execute(
              fixture,
              state,
              "prepare_response_bundle",
              { expectedRevision: state.revision, bundleId: "containment" },
              "webmcp_callback",
            ),
          );
          state = succeed(
            execute(fixture, state, "authorize_response_bundle", {
              expectedRevision: state.revision,
              bundleId: "containment",
              proposalId: state.responseBundle?.id,
              acknowledgement: "AUTHORIZE_SYNTHETIC_BUNDLE",
            }),
          );
        }
        state = succeed(attachDiscovery(fixture, state, nextStage.id));
        continue;
      }
      const outcome = runPreparedQuery(fixture, state, query.id);
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
        returnedRecords: readonly { id: string }[];
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
      assert.equal(data.returnedRecords.length, query.returnedRecordCount);
      pendingQueryIds.delete(query.id);
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
        returnedRecordCount?: number;
      }[];
      blockedCount: number;
    };
  };
  assert.equal(data.queryWorkset.available.length, 7);
  assert.equal(data.queryWorkset.blockedCount, 3);
  assert.equal(
    data.queryWorkset.available.some(
      (query) => query.id === "QRY-ENDPOINT-APP-05",
    ),
    false,
  );
  assert.equal(
    data.queryWorkset.available.some(
      (query) => query.returnedRecordCount !== undefined,
    ),
    false,
  );
});

test("investigation plans attach one available finding in deterministic order", () => {
  const fixture = endpointLateralScenario;
  const initial = createInitialCaseState(fixture);
  const first = runPreparedPlan(
    fixture,
    initial,
    "tier1_initial",
    "QRY-ENDPOINT-FILE-01",
  );
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.state.revision, initial.revision + 2);
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
    returnedRecords: readonly { id: string }[];
    execution: { syntheticRecordCount: number; matchedRecordCount: number };
  };
  assert.equal(firstData.planId, "tier1_initial");
  assert.equal(firstData.queryId, "QRY-ENDPOINT-FILE-01");
  assert.equal(firstData.targetEntityId, "file:invoice-sync-helper");
  assert.equal(firstData.completedCount, 1);
  assert.equal(firstData.totalCount, 5);
  assert.equal(firstData.remainingCount, 4);
  assert.equal(firstData.nextQueryId, "QRY-ENDPOINT-HASH-10");
  assert.equal(firstData.artifact.id, "ENR-LAT-FILE-01");
  assert.equal(firstData.execution.syntheticRecordCount, 2496);
  assert.equal(firstData.execution.matchedRecordCount, 11);
  assert.equal(firstData.returnedRecords.length, 6);
  assert.equal(firstData.returnedRecords[0]?.id, "QRR-ENDPOINT-FILE-01");
  assert.equal(first.receipt.title, "Helper behavior and prevalence");
  assert.equal(first.receipt.target, "invoice-sync-helper.exe");
  assert.match(first.receipt.resultSummary, /^1\/5 results added/);

  let state = first.state;
  const expected = [
    ["QRY-ENDPOINT-HASH-10", "ENR-LAT-HASH-04"],
    ["QRY-ENDPOINT-HOST-02", "ENR-LAT-ENDPOINT-01"],
    ["QRY-ENDPOINT-IDENTITY-03", "ENR-LAT-IDENTITY-01"],
    ["QRY-ENDPOINT-EGRESS-04", "ENR-LAT-DEST-01"],
  ] as const;
  for (const [queryId, artifactId] of expected) {
    const outcome = runPreparedPlan(fixture, state, "tier1_initial", queryId);
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
    "ENR-LAT-HASH-04",
    "ENR-LAT-ENDPOINT-01",
    "ENR-LAT-IDENTITY-01",
    "ENR-LAT-DEST-01",
  ]);

  const nextStep = getDerivedNextStep(fixture, state);
  assert.equal(nextStep.recommendedTool, "attach_discovery_stage");
  assert.equal(
    nextStep.objective,
    "Add remote service start blocked to the shared case.",
  );

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
  const direct = runPreparedQuery(
    fixture,
    initial,
    "QRY-ENDPOINT-FILE-01",
    "analyst_control",
  );
  assert.equal(direct.ok, true);
  if (!direct.ok) return;
  const planned = runPreparedPlan(
    fixture,
    direct.state,
    "tier1_initial",
    "QRY-ENDPOINT-HASH-10",
  );
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  const data = planned.data as {
    queryId: string;
    completedCount: number;
    remainingCount: number;
  };
  assert.equal(data.queryId, "QRY-ENDPOINT-HASH-10");
  assert.equal(data.completedCount, 2);
  assert.equal(data.remainingCount, 3);
});

test("endpoint forensic pivot attaches bounded static and sandbox fixtures", () => {
  const fixture = endpointLateralScenario;
  let state = createInitialCaseState(fixture);
  state = succeed(runPreparedQuery(fixture, state, "QRY-ENDPOINT-FILE-01"));
  state = succeed(runPreparedQuery(fixture, state, "QRY-ENDPOINT-HASH-10"));
  state = succeed(runPreparedQuery(fixture, state, "QRY-ENDPOINT-STATIC-08"));
  const sandbox = runPreparedQuery(fixture, state, "QRY-ENDPOINT-SANDBOX-09");
  assert.equal(sandbox.ok, true);
  if (!sandbox.ok) return;
  state = sandbox.state;
  assert.equal(state.revision, 9);
  assert.deepEqual(state.attachedEnrichmentIds, [
    "ENR-LAT-FILE-01",
    "ENR-LAT-HASH-04",
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
  const hashQuery = fixture.investigationQueries.find(
    (query) => query.id === "QRY-ENDPOINT-HASH-10",
  );
  const hashEntity = fixture.entities.find(
    (entity) => entity.id === "file:invoice-sync-helper",
  );
  assert.equal(
    hashQuery?.returnedRecords[0]?.fields.find(
      (field) => field.label === "SHA256",
    )?.value,
    hashEntity?.kind === "file" ? hashEntity.sha256 : undefined,
  );
});

test("an agent can attach only the next discovery after its required evidence is attached", () => {
  const fixture = endpointLateralScenario;
  const initial = createInitialCaseState(fixture);
  const blocked = attachDiscovery(fixture, initial, "STREAM-LAT-01");
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.error.code, "DISCOVERY_EVIDENCE_REQUIRED");
    assert.equal(blocked.state.revision, initial.revision);
  }

  const withIdentityEvidence = enrich(
    fixture,
    initial,
    "enrich_identity",
    "identity:svc-fin-reports",
  );
  const wrongOrder = attachDiscovery(
    fixture,
    withIdentityEvidence,
    "STREAM-LAT-02",
  );
  assert.equal(wrongOrder.ok, false);
  if (!wrongOrder.ok)
    assert.equal(wrongOrder.error.code, "DISCOVERY_NOT_AVAILABLE");

  const missingQuery = attachDiscovery(
    fixture,
    withIdentityEvidence,
    "STREAM-LAT-01",
  );
  assert.equal(missingQuery.ok, false);
  if (!missingQuery.ok)
    assert.equal(missingQuery.error.code, "DISCOVERY_QUERY_REQUIRED");

  const queried = succeed(
    runPreparedQuery(fixture, withIdentityEvidence, "QRY-ENDPOINT-IDENTITY-03"),
  );
  const attached = attachDiscovery(fixture, queried, "STREAM-LAT-01");
  assert.equal(attached.ok, true);
  if (!attached.ok) return;
  assert.deepEqual(attached.state.releasedStreamStageIds, ["STREAM-LAT-01"]);
  const data = attached.data as {
    added: {
      entityIds: readonly string[];
      eventIds: readonly string[];
      relationshipIds: readonly string[];
    };
    provenance: {
      sourceQueryIds: readonly string[];
      sourceRecordIds: readonly string[];
    };
  };
  assert.deepEqual(data.added.entityIds, ["endpoint:fin-reports-srv-010"]);
  assert.deepEqual(data.added.eventIds, [
    "EVT-EDR-0448-10",
    "EVT-DIRECTORY-0448-13",
  ]);
  assert.deepEqual(data.added.relationshipIds, ["JOIN-LAT-06", "JOIN-LAT-08"]);
  assert.deepEqual(data.provenance.sourceQueryIds, [
    "QRY-ENDPOINT-IDENTITY-03",
  ]);
  assert.equal(attached.receipt.title, "Verified discovery added");

  const responseProposal = execute(
    fixture,
    attached.state,
    "propose_response_action",
    {
      expectedRevision: attached.state.revision,
      actionId: "contain_endpoint",
      reasoning:
        fixture.responseActions.find(
          (action) => action.id === "contain_endpoint",
        )?.proposalReasoning ?? "Contain the endpoint after evidence review.",
    },
    "webmcp_callback",
  );
  assert.equal(responseProposal.ok, false);
  if (!responseProposal.ok)
    assert.equal(responseProposal.error.code, "DECISION_REQUIRED");

  const agentAuthorization = execute(
    fixture,
    attached.state,
    "authorize_response_action",
    {
      expectedRevision: attached.state.revision,
      actionId: "contain_endpoint",
      proposalId: "PROPOSAL-NOT-AVAILABLE",
      acknowledgement: "AUTHORIZE_SYNTHETIC_RESPONSE",
    },
    "webmcp_callback",
  );
  assert.equal(agentAuthorization.ok, false);
  if (!agentAuthorization.ok) {
    assert.equal(agentAuthorization.error.code, "SURFACE_NOT_ALLOWED");
    assert.equal(agentAuthorization.state.revision, attached.state.revision);
  }
});

test("response bundles prepare atomically and require analyst authorization", () => {
  const fixture = endpointLateralScenario;
  let state = createInitialCaseState(fixture);
  state = completeInvestigationPlan(fixture, state, "tier1_initial");
  state = succeed(attachDiscovery(fixture, state, "STREAM-LAT-01"));
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
    state.responseActions
      .filter((action) =>
        fixture.responseActions.find(
          (definition) =>
            definition.id === action.actionId &&
            definition.phase === "containment",
        ),
      )
      .map((action) => action.status),
    Array(4).fill("simulated"),
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
    state.responseActions
      .filter((action) =>
        fixture.responseActions.find(
          (definition) =>
            definition.id === action.actionId &&
            definition.phase === "containment",
        ),
      )
      .map((action) => action.status),
    Array(4).fill("authorized_in_demo"),
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
    state.responseActions
      .filter((action) =>
        fixture.responseActions.find(
          (definition) =>
            definition.id === action.actionId &&
            definition.phase !== "containment",
        ),
      )
      .map((action) => action.status),
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

test("endpoint context orders containment before recovery discovery", () => {
  const fixture = endpointLateralScenario;
  let state = createInitialCaseState(fixture);
  state = completeInvestigationPlan(fixture, state, "tier1_initial");
  state = succeed(attachDiscovery(fixture, state, "STREAM-LAT-01"));
  state = completeInvestigationPlan(fixture, state, "stage_1_verification");
  state = succeed(
    execute(fixture, state, "record_evidence_decision", {
      expectedRevision: state.revision,
      decision: "confirmed_malicious",
      rationale:
        "Unsigned execution and the blocked remote-service attempt meet the synthetic containment threshold.",
    }),
  );

  const nextTool = (): CaseToolName | null => {
    const context = execute(fixture, state, "get_case_context", {});
    assert.equal(context.ok, true);
    if (!context.ok) return null;
    return (
      context.data as {
        collaborationHandoff: { exactNextTool: CaseToolName | null };
      }
    ).collaborationHandoff.exactNextTool;
  };

  assert.equal(state.revision, 15);
  assert.equal(nextTool(), "calculate_reachability");

  const gatedContext = execute(fixture, state, "get_case_context", {});
  assert.equal(gatedContext.ok, true);
  if (gatedContext.ok) {
    const gatedDiscovery = (
      gatedContext.data as {
        discoveries: {
          available: Array<{
            id: string;
            progress: string;
            blocker: string | null;
          }>;
        };
      }
    ).discoveries.available.find((stage) => stage.id === "STREAM-LAT-02");
    assert.equal(gatedDiscovery?.progress, "blocked");
    assert.equal(gatedDiscovery?.blocker, "containment_authorization_required");
  }
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
  assert.equal(state.revision, 16);
  assert.equal(nextTool(), "simulate_control");
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
  assert.equal(state.revision, 17);
  assert.equal(nextTool(), "prepare_response_bundle");

  const blockedRecovery = execute(
    fixture,
    state,
    "request_next_observation",
    {
      expectedRevision: state.revision,
      stageId: "STREAM-LAT-02",
      rationale: "Request credential and workload recovery inventory.",
    },
    "webmcp_callback",
  );
  assert.equal(blockedRecovery.ok, false);
  if (!blockedRecovery.ok) {
    assert.equal(
      blockedRecovery.error.code,
      "CONTAINMENT_AUTHORIZATION_REQUIRED",
    );
  }

  state = succeed(
    execute(
      fixture,
      state,
      "prepare_response_bundle",
      { expectedRevision: state.revision, bundleId: "containment" },
      "webmcp_callback",
    ),
  );
  assert.equal(state.revision, 18);
  assert.equal(nextTool(), null);
  state = succeed(
    execute(fixture, state, "authorize_response_bundle", {
      expectedRevision: state.revision,
      bundleId: "containment",
      proposalId: state.responseBundle?.id,
      acknowledgement: "AUTHORIZE_SYNTHETIC_BUNDLE",
    }),
  );
  assert.equal(state.revision, 19);
  assert.equal(nextTool(), "attach_discovery_stage");
});

test("case context lists query readiness without embedding canonical KQL", () => {
  const fixture = endpointLateralScenario;
  const context = execute(
    fixture,
    createInitialCaseState(fixture),
    "get_case_context",
    {},
  );
  assert.equal(context.ok, true);
  if (!context.ok) return;
  const data = context.data as {
    queryWorkset: {
      available: Array<{
        id: string;
        language: string;
        sourceLabels: readonly string[];
        queryTextAvailableVia: string;
        console?: unknown;
      }>;
    };
  };
  const fileQuery = data.queryWorkset.available.find(
    (query) => query.id === "QRY-ENDPOINT-FILE-01",
  );
  assert.deepEqual(fileQuery, {
    id: "QRY-ENDPOINT-FILE-01",
    title: "Helper behavior and prevalence",
    question: "What did the unsigned helper do, and has it appeared elsewhere?",
    objective:
      "Correlate file creation, process lineage, signer state, and peer prevalence before deeper analysis.",
    targetEntityId: "file:invoice-sync-helper",
    language: "KQL",
    sourceLabels: ["Endpoint telemetry", "Enterprise file prevalence"],
    syntheticRecordCount: 2496,
    queryTextAvailableVia: "prepare_investigation_query",
    progress: "available",
  });
  assert.equal("console" in (fileQuery ?? {}), false);
  assert.equal(
    JSON.stringify(data.queryWorkset).includes(
      getQueryConsoleContract("QRY-ENDPOINT-FILE-01")?.text ?? "",
    ),
    false,
  );
});

test("approved investigation skills are allowlisted, revision-safe query playbooks", () => {
  const fixture = endpointLateralScenario;
  const initial = createInitialCaseState(fixture);
  const listed = execute(
    fixture,
    initial,
    "list_investigation_skills",
    {},
    "webmcp_callback",
  );
  assert.equal(listed.ok, true);
  if (!listed.ok) return;
  assert.equal(listed.state.revision, initial.revision);
  const data = listed.data as {
    skills: Array<{
      id: string;
      version: string;
      queryId: string;
      availability: string;
      constraint: string | null;
    }>;
    blockedSkillCount: number;
  };
  const fileSkill = data.skills.find(
    (skill) => skill.id === "QRY-ENDPOINT-FILE-01",
  );
  assert.deepEqual(fileSkill, {
    id: "QRY-ENDPOINT-FILE-01",
    version: "1.0",
    title: "Helper behavior and prevalence",
    objective:
      "Correlate file creation, process lineage, signer state, and peer prevalence before deeper analysis.",
    question: "What did the unsigned helper do, and has it appeared elsewhere?",
    queryId: "QRY-ENDPOINT-FILE-01",
    targetEntityId: "file:invoice-sync-helper",
    sourceLabels: ["Endpoint telemetry", "Enterprise file prevalence"],
    availability: "available",
    constraint: null,
  });
  assert.equal(
    data.skills.some((skill) => skill.availability === "blocked"),
    false,
  );
  assert.equal(data.blockedSkillCount, 3);
  assert.equal(
    JSON.stringify(data).includes(
      getQueryConsoleContract("QRY-ENDPOINT-FILE-01")?.text ?? "",
    ),
    false,
  );

  const prepared = execute(
    fixture,
    initial,
    "prepare_investigation_query",
    { expectedRevision: initial.revision, queryId: fileSkill?.id },
    "webmcp_callback",
  );
  assert.equal(prepared.ok, true);
  if (prepared.ok) {
    assert.equal(prepared.state.preparedQuery?.queryId, fileSkill?.queryId);
  }
});

test("WebMCP exposes bounded case tools and withholds analyst gates", () => {
  assert.equal(caseToolNames.length, 35);
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
    "list_investigation_skills",
    "prepare_investigation_query",
    "run_investigation_query",
    "run_investigation_plan",
    "propose_investigation_step",
    "attach_discovery_stage",
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
      "propose_response_action",
      "simulate_response_action",
      "prepare_response_bundle",
    ]),
  );
  assert.equal(cloudNames.size, 21);
  assert.equal(endpointNames.size, 27);

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
    "attach_discovery_stage",
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
  assert.equal(result.readiness.ready, true);
  assert.deepEqual(result.readiness.missingCriticalToolNames, []);
  assert.deepEqual(result.readiness.criticalToolNames, [
    "get_case_context",
    "list_investigation_skills",
    "prepare_investigation_query",
    "run_investigation_query",
    "attach_discovery_stage",
    "generate_case_report",
  ]);
  controller.abort();
  assert.equal(
    signals.every((signal) => signal.aborted),
    true,
  );
});

test("tool registration retries a transient failure without duplicating successes", async () => {
  const definitions = createCaseToolDefinitions(
    endpointLateralScenario,
    async () => ({ ok: true }),
  );
  const calls = new Map<string, number>();
  const registry: DocumentModelContext = {
    async registerTool(definition) {
      const attempts = (calls.get(definition.name) ?? 0) + 1;
      calls.set(definition.name, attempts);
      if (definition.name === "prepare_investigation_query" && attempts === 1) {
        throw new Error("Native host was initializing");
      }
    },
  };

  const result = await registerCaseTools(
    definitions,
    new AbortController(),
    registry,
  );

  assert.equal(result.registered, definitions.length);
  assert.equal(result.readiness.ready, true);
  assert.deepEqual(result.readiness.missingCriticalToolNames, []);
  assert.equal(calls.get("prepare_investigation_query"), 2);
  for (const definition of definitions) {
    assert.equal(
      calls.get(definition.name),
      definition.name === "prepare_investigation_query" ? 2 : 1,
      `${definition.name} should register once after another tool retries`,
    );
  }
  assert.deepEqual(
    result.outcomes.find(
      (outcome) => outcome.name === "prepare_investigation_query",
    ),
    {
      name: "prepare_investigation_query",
      status: "registered",
      error: null,
      attempts: 2,
    },
  );
});

test("tool registration reports missing critical capabilities deterministically", async () => {
  const definitions = createCaseToolDefinitions(
    endpointLateralScenario,
    async () => ({ ok: true }),
  );
  const calls = new Map<string, number>();
  const registry: DocumentModelContext = {
    async registerTool(definition) {
      const attempts = (calls.get(definition.name) ?? 0) + 1;
      calls.set(definition.name, attempts);
      if (definition.name === "simulate_control") {
        throw new Error("Native host rejected this capability");
      }
    },
  };

  const result = await registerCaseTools(
    definitions,
    new AbortController(),
    registry,
  );

  assert.equal(result.registered, definitions.length - 1);
  assert.equal(result.readiness.ready, false);
  assert.deepEqual(result.readiness.criticalToolNames, [
    "get_case_context",
    "list_investigation_skills",
    "prepare_investigation_query",
    "run_investigation_query",
    "calculate_reachability",
    "simulate_control",
    "attach_discovery_stage",
    "prepare_response_bundle",
    "generate_case_report",
  ]);
  assert.deepEqual(result.readiness.missingCriticalToolNames, [
    "simulate_control",
  ]);
  assert.deepEqual(
    result.outcomes.find((outcome) => outcome.name === "simulate_control"),
    {
      name: "simulate_control",
      status: "failed",
      error: "Native host rejected this capability",
      attempts: 2,
    },
  );
  assert.equal(calls.get("simulate_control"), 2);
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
  state = succeed(runPreparedQuery(fixture, state, "QRY-CLOUD-IDENTITY-01"));
  state = succeed(attachDiscovery(fixture, state, "DISCOVERY-CLOUD-01"));
  state = succeed(runPreparedQuery(fixture, state, "QRY-CLOUD-EGRESS-02"));
  state = succeed(runPreparedQuery(fixture, state, "QRY-CLOUD-ROLE-03"));
  state = succeed(runPreparedQuery(fixture, state, "QRY-CLOUD-EXPORT-04"));
  state = succeed(attachDiscovery(fixture, state, "DISCOVERY-CLOUD-02"));
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
      ...completeReportReview,
    },
    "webmcp_callback",
  );
  assert.equal(rejectedApproval.ok, false);
  if (!rejectedApproval.ok) {
    assert.equal(rejectedApproval.error.code, "SURFACE_NOT_ALLOWED");
  }

  const incompleteApproval = execute(
    fixture,
    state,
    "approve_case_report",
    {
      expectedRevision: state.revision,
      reportId: fixture.conclusion.reportId,
      acknowledgement: "APPROVE_SYNTHETIC_REPORT",
    },
    "analyst_control",
  );
  assert.equal(incompleteApproval.ok, false);
  if (!incompleteApproval.ok) {
    assert.equal(incompleteApproval.error.code, "VALIDATION_ERROR");
    assert.equal(incompleteApproval.state.lifecycle, "report_drafted");
    assert.equal(incompleteApproval.state.revision, state.revision);
  }

  for (const analystClosureNote of ["", "   ", "Too short"]) {
    const unsignedApproval = execute(
      fixture,
      state,
      "approve_case_report",
      {
        expectedRevision: state.revision,
        reportId: fixture.conclusion.reportId,
        ...completeReportReview,
        analystClosureNote,
      },
      "analyst_control",
    );
    assert.equal(unsignedApproval.ok, false);
    if (!unsignedApproval.ok) {
      assert.equal(unsignedApproval.error.code, "CLOSURE_NOTE_REQUIRED");
      assert.equal(unsignedApproval.state.lifecycle, "report_drafted");
      assert.equal(unsignedApproval.state.revision, state.revision);
    }
  }

  const oversizedApproval = execute(
    fixture,
    state,
    "approve_case_report",
    {
      expectedRevision: state.revision,
      reportId: fixture.conclusion.reportId,
      ...completeReportReview,
      analystClosureNote: "x".repeat(601),
    },
    "analyst_control",
  );
  assert.equal(oversizedApproval.ok, false);
  if (!oversizedApproval.ok) {
    assert.equal(oversizedApproval.error.code, "CLOSURE_NOTE_REQUIRED");
    assert.equal(oversizedApproval.state.revision, state.revision);
  }

  state = succeed(
    execute(fixture, state, "approve_case_report", {
      expectedRevision: state.revision,
      reportId: fixture.conclusion.reportId,
      ...completeReportReview,
    }),
  );
  assert.equal(state.lifecycle, "closed_in_demo");
  assert.equal(state.report.status, "approved_in_demo");
  assert.equal(
    state.report.analystClosureNote,
    completeReportReview.analystClosureNote,
  );
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
  assert.equal(nextStep.recommendedTool, null);
  assert.match(nextStep.objective, /reset the case/i);
  const context = execute(fixture, state, "get_case_context", {});
  assert.equal(context.ok, true);
  if (context.ok) {
    const data = context.data as {
      collaborationHandoff: {
        nextOwner: string;
        pendingGate: string | null;
        exactNextTool: string | null;
      };
      nextAgentAction: unknown;
      analystGate: { kind: string } | null;
    };
    assert.equal(data.collaborationHandoff.nextOwner, "analyst");
    assert.equal(data.collaborationHandoff.pendingGate, "case_hold");
    assert.equal(data.collaborationHandoff.exactNextTool, null);
    assert.equal(data.nextAgentAction, null);
    assert.equal(data.analystGate?.kind, "case_hold");
  }
});

test("malicious case completes staged containment, recovery, report, and closure", () => {
  const fixture = endpointLateralScenario;
  let state = createInitialCaseState(fixture);
  state = enrich(fixture, state, "enrich_file", "file:invoice-sync-helper");
  state = succeed(runPreparedQuery(fixture, state, "QRY-ENDPOINT-HASH-10"));
  state = enrich(fixture, state, "enrich_endpoint", "endpoint:fin-ws-044");
  state = enrich(fixture, state, "enrich_identity", "identity:svc-fin-reports");
  state = succeed(runPreparedQuery(fixture, state, "QRY-ENDPOINT-IDENTITY-03"));
  state = enrich(
    fixture,
    state,
    "enrich_network_indicator",
    "indicator:203.0.113.91",
  );
  state = succeed(attachDiscovery(fixture, state, "STREAM-LAT-01"));
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
  state = completeResponse(fixture, state, "collect_endpoint_forensics");
  state = completeResponse(fixture, state, "contain_endpoint");
  state = completeResponse(fixture, state, "block_network_indicator");
  state = completeResponse(fixture, state, "disable_service_identity");
  state = succeed(runPreparedQuery(fixture, state, "QRY-ENDPOINT-APP-05"));
  state = succeed(attachDiscovery(fixture, state, "STREAM-LAT-02"));
  state = enrich(fixture, state, "enrich_resource", "secret:ci-deploy-token");
  state = enrich(fixture, state, "enrich_resource", "workload:billing-api");
  state = completeResponse(fixture, state, "rotate_deployment_credential");
  state = completeResponse(fixture, state, "rollback_workload_image");
  assert.equal(state.lifecycle, "contained_in_demo");
  assert.equal(
    getDerivedNextStep(fixture, state).recommendedTool,
    "generate_case_report",
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
  assert.equal(state.report.report?.actionIds.length, 6);
  assert.equal(state.report.report?.limitations.length, 3);
  state = succeed(
    execute(fixture, state, "approve_case_report", {
      expectedRevision: state.revision,
      reportId: fixture.conclusion.reportId,
      ...completeReportReview,
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
  state = succeed(runPreparedQuery(fixture, state, "QRY-ENDPOINT-HASH-10"));
  state = enrich(fixture, state, "enrich_endpoint", "endpoint:fin-ws-044");
  state = enrich(fixture, state, "enrich_identity", "identity:svc-fin-reports");
  state = succeed(runPreparedQuery(fixture, state, "QRY-ENDPOINT-IDENTITY-03"));
  const earlyDecision = execute(fixture, state, "record_evidence_decision", {
    expectedRevision: state.revision,
    decision: "confirmed_malicious",
    rationale: "The initial evidence appears malicious in the synthetic case.",
  });
  assert.equal(earlyDecision.ok, false);
  if (!earlyDecision.ok) {
    assert.equal(earlyDecision.error.code, "CONTEXT_REQUIRED");
  }

  state = succeed(attachDiscovery(fixture, state, "STREAM-LAT-01"));
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
        fixture.responseActions.find(
          (action) => action.id === "contain_endpoint",
        )?.proposalReasoning ?? "Contain the endpoint safely.",
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
    assert.equal(data.collaborationHandoff.nextOwner, "agent");
    assert.equal(
      data.collaborationHandoff.exactNextTool,
      "prepare_investigation_query",
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
