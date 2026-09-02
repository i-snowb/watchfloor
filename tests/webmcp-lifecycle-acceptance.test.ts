import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitialCaseState,
  executeCaseTool,
  type AnalystGate,
  type CaseCoordination,
  type CaseToolName,
  type NextAgentAction,
  type ToolOutcome,
} from "../domain/operations";
import { getQueryConsoleContract } from "../domain/query-console";
import { endpointLateralScenario } from "../domain/scenarios";
import type { CaseState } from "../domain/types";
import { getVisibleEntities } from "../domain/incident-stream";
import { createCaseToolDefinitions } from "../webmcp/tools";

const fixture = endpointLateralScenario;
let invocation = 0;

function call(
  state: CaseState,
  toolName: CaseToolName,
  input: Record<string, unknown>,
  reportedSurface: "webmcp_callback" | "analyst_control" = "webmcp_callback",
): ToolOutcome {
  invocation += 1;
  return executeCaseTool(fixture, state, {
    requestId: `acceptance-${String(invocation).padStart(4, "0")}-${toolName}`,
    toolName,
    reportedSurface,
    input,
  });
}

function web(
  state: CaseState,
  toolName: CaseToolName,
  input: Record<string, unknown>,
): ToolOutcome {
  return call(state, toolName, input, "webmcp_callback");
}

function analyst(
  state: CaseState,
  toolName: CaseToolName,
  input: Record<string, unknown>,
): ToolOutcome {
  return call(state, toolName, input, "analyst_control");
}

function success(outcome: ToolOutcome): Extract<ToolOutcome, { ok: true }> {
  if (!outcome.ok) assert.fail(outcome.error.message);
  return outcome;
}

function coordination(
  outcome: Extract<ToolOutcome, { ok: true }>,
): CaseCoordination {
  const data = outcome.data as Partial<CaseCoordination>;
  assert.ok(
    data.collaborationHandoff,
    "Operation must return a refreshed handoff",
  );
  assert.ok(
    "nextAgentAction" in data,
    "Operation must declare the next agent action, including null at analyst gates",
  );
  assert.ok(
    "analystGate" in data,
    "Operation must declare the analyst gate, including null while agent work continues",
  );
  const result = data as CaseCoordination;
  assert.equal(
    result.collaborationHandoff.currentRevision,
    outcome.state.revision,
  );
  return result;
}

function readCoordination(state: CaseState): CaseCoordination {
  return coordination(success(web(state, "get_case_context", {})));
}

function nextAction(
  current: CaseCoordination,
  state: CaseState,
): NextAgentAction {
  assert.equal(current.collaborationHandoff.nextOwner, "agent");
  assert.equal(current.analystGate, null);
  assert.ok(current.nextAgentAction, "Agent ownership requires a next action");
  assert.equal(current.nextAgentAction.validForRevision, state.revision);
  assert.equal(current.nextAgentAction.input.expectedRevision, state.revision);
  return current.nextAgentAction;
}

function agentStep(
  state: CaseState,
  current: CaseCoordination,
): {
  state: CaseState;
  coordination: CaseCoordination;
  action: NextAgentAction;
  outcome: Extract<ToolOutcome, { ok: true }>;
} {
  const action = nextAction(current, state);
  const outcome = success(web(state, action.toolName, action.input));
  return {
    state: outcome.state,
    coordination: coordination(outcome),
    action,
    outcome,
  };
}

function runAgentUntilAnalystGate(
  state: CaseState,
  current: CaseCoordination,
  onStep: (step: ReturnType<typeof agentStep>) => void,
): { state: CaseState; coordination: CaseCoordination; steps: CaseToolName[] } {
  const steps: CaseToolName[] = [];
  for (let index = 0; index < 24; index += 1) {
    if (current.analystGate) {
      assert.equal(current.collaborationHandoff.nextOwner, "analyst");
      assert.equal(current.nextAgentAction, null);
      return { state, coordination: current, steps };
    }
    const step = agentStep(state, current);
    steps.push(step.action.toolName);
    onStep(step);
    state = step.state;
    current = step.coordination;
  }
  assert.fail("Agent did not reach an analyst gate within 24 bounded actions.");
}

function expectGate(
  current: CaseCoordination,
  kind: AnalystGate["kind"],
): void {
  assert.equal(current.collaborationHandoff.nextOwner, "analyst");
  assert.equal(current.nextAgentAction, null);
  assert.equal(current.analystGate?.kind, kind);
}

test("WebMCP and an analyst complete the endpoint lifecycle through returned shared coordination", () => {
  invocation = 0;
  let state = createInitialCaseState(fixture);
  let current = readCoordination(state);
  const initial = nextAction(current, state);
  assert.equal(initial.toolName, "prepare_investigation_query");

  let preparedKql = false;
  let rawRecordsExposed = false;
  const initialInvestigation = runAgentUntilAnalystGate(
    state,
    current,
    (step) => {
      if (step.action.toolName === "prepare_investigation_query") {
        const data = step.outcome.data as {
          queryText: string;
          executable: boolean;
        };
        assert.equal(data.executable, true);
        assert.ok(data.queryText.length > 20);
        preparedKql = true;
      }
      if (step.action.toolName === "run_investigation_query") {
        const queryId = step.action.input.queryId;
        const queryText = step.action.input.queryText;
        if (typeof queryId !== "string")
          assert.fail("Query ID must be a string.");
        assert.equal(
          queryText,
          getQueryConsoleContract(queryId)?.text,
          "The agent must execute the exact visible canonical KQL.",
        );
        const data = step.outcome.data as {
          returnedRecords: readonly unknown[];
          execution: { synthetic: boolean; returnedRecordCount: number };
        };
        assert.equal(data.execution.synthetic, true);
        assert.equal(
          data.returnedRecords.length,
          data.execution.returnedRecordCount,
        );
        assert.ok(data.returnedRecords.length > 0);
        rawRecordsExposed = true;
      }
    },
  );
  state = initialInvestigation.state;
  current = initialInvestigation.coordination;
  assert.equal(preparedKql, true);
  assert.equal(rawRecordsExposed, true);
  assert.ok(initialInvestigation.steps.includes("attach_discovery_stage"));
  assert.deepEqual(state.releasedStreamStageIds, ["STREAM-LAT-01"]);
  expectGate(current, "evidence_disposition");

  const decision = success(
    analyst(state, "record_evidence_decision", {
      expectedRevision: state.revision,
      decision: "confirmed_malicious",
      rationale:
        "The unsigned execution, malicious hash intelligence, repeated egress, service identity misuse, and blocked remote service attempt meet the containment threshold.",
    }),
  );
  state = decision.state;
  current = coordination(decision);

  const containment = runAgentUntilAnalystGate(state, current, () => {});
  state = containment.state;
  current = containment.coordination;
  assert.deepEqual(containment.steps, [
    "calculate_reachability",
    "simulate_control",
    "prepare_response_bundle",
  ]);
  expectGate(current, "response_authorization");
  const containmentProposalId = state.responseBundle?.id;
  assert.equal(typeof containmentProposalId, "string");

  const containmentApproval = success(
    analyst(state, "authorize_response_bundle", {
      expectedRevision: state.revision,
      bundleId: "containment",
      proposalId: containmentProposalId,
      acknowledgement: "AUTHORIZE_SYNTHETIC_BUNDLE",
    }),
  );
  state = containmentApproval.state;
  current = coordination(containmentApproval);
  assert.deepEqual(state.authorizedResponseBundleIds, ["containment"]);

  const telemetryRequest = runAgentUntilAnalystGate(state, current, () => {});
  state = telemetryRequest.state;
  current = telemetryRequest.coordination;
  assert.deepEqual(telemetryRequest.steps, ["request_next_observation"]);
  assert.equal(state.observationRequest?.status, "pending");
  assert.deepEqual(state.releasedStreamStageIds, ["STREAM-LAT-01"]);
  expectGate(current, "telemetry_release");

  const telemetryRelease = success(
    analyst(state, "release_next_synthetic_signal", {
      expectedRevision: state.revision,
    }),
  );
  state = telemetryRelease.state;
  current = coordination(telemetryRelease);
  assert.equal(state.observationRequest?.status, "released");
  assert.deepEqual(state.releasedStreamStageIds, [
    "STREAM-LAT-01",
    "STREAM-LAT-02",
  ]);

  const recovery = runAgentUntilAnalystGate(state, current, () => {});
  state = recovery.state;
  current = recovery.coordination;
  assert.deepEqual(recovery.steps, [
    "prepare_investigation_query",
    "run_investigation_query",
    "prepare_investigation_query",
    "run_investigation_query",
    "prepare_response_bundle",
  ]);
  assert.deepEqual(state.releasedStreamStageIds, [
    "STREAM-LAT-01",
    "STREAM-LAT-02",
  ]);
  expectGate(current, "response_authorization");
  const recoveryProposalId = state.responseBundle?.id;
  assert.equal(typeof recoveryProposalId, "string");

  const recoveryApproval = success(
    analyst(state, "authorize_response_bundle", {
      expectedRevision: state.revision,
      bundleId: "recovery",
      proposalId: recoveryProposalId,
      acknowledgement: "AUTHORIZE_SYNTHETIC_BUNDLE",
    }),
  );
  state = recoveryApproval.state;
  current = coordination(recoveryApproval);
  assert.equal(state.lifecycle, "contained_in_demo");

  const report = runAgentUntilAnalystGate(state, current, () => {});
  state = report.state;
  current = report.coordination;
  assert.deepEqual(report.steps, ["generate_case_report"]);
  assert.equal(state.report.report?.id, "REPORT-ENDPOINT-0448");
  expectGate(current, "report_approval");
  assert.equal(current.collaborationHandoff.exactNextTool, null);

  const closure = success(
    analyst(state, "approve_case_report", {
      expectedRevision: state.revision,
      reportId: "REPORT-ENDPOINT-0448",
      acknowledgement: "APPROVE_SYNTHETIC_REPORT",
      analystClosureNote:
        "The modeled controls are approved and the case is ready for closure.",
    }),
  );
  state = closure.state;
  current = coordination(closure);
  assert.equal(state.lifecycle, "closed_in_demo");
  assert.equal(state.report.status, "approved_in_demo");
  assert.equal(state.report.report?.actionIds.length, 6);
  assert.equal(current.collaborationHandoff.nextOwner, "complete");
  assert.equal(current.nextAgentAction, null);
  assert.equal(current.analystGate, null);
});

test("registered WebMCP callbacks complete the endpoint lifecycle and stop at every analyst gate", async () => {
  invocation = 0;
  let state = createInitialCaseState(fixture);
  const visibleBeforeDiscovery = getVisibleEntities(fixture, state).map(
    (entity) => entity.id,
  );
  const definitions = createCaseToolDefinitions(
    fixture,
    async (toolName, input) => {
      invocation += 1;
      return executeCaseTool(fixture, state, {
        requestId: `registered-lifecycle-${String(invocation).padStart(4, "0")}-${toolName}`,
        toolName,
        reportedSurface: "webmcp_callback",
        input,
      });
    },
  );
  const registered = new Map(
    definitions.map((definition) => [definition.name, definition]),
  );

  for (const analystOnly of [
    "record_evidence_decision",
    "release_next_synthetic_signal",
    "authorize_response_bundle",
    "approve_case_report",
  ] satisfies readonly CaseToolName[]) {
    assert.equal(
      registered.has(analystOnly),
      false,
      `${analystOnly} must not register`,
    );
  }

  async function webCallback(
    toolName: CaseToolName,
    input: Record<string, unknown>,
  ): Promise<Extract<ToolOutcome, { ok: true }>> {
    const definition = registered.get(toolName);
    assert.ok(
      definition,
      `${toolName} must be registered for the endpoint case`,
    );
    const outcome = (await definition.execute(input)) as ToolOutcome;
    assert.equal(
      outcome.ok,
      true,
      outcome.ok ? undefined : outcome.error.message,
    );
    state = outcome.state;
    return outcome;
  }

  async function webCoordination(
    toolName: CaseToolName,
    input: Record<string, unknown>,
  ): Promise<CaseCoordination> {
    return coordination(await webCallback(toolName, input));
  }

  async function lineageRead(targetType: string, targetId: string) {
    const beforeState = state;
    const beforeRevision = state.revision;
    const outcome = await webCallback("trace_evidence_lineage", {
      targetType,
      targetId,
    });
    assert.equal(outcome.mutatesState, false);
    assert.equal(outcome.state, beforeState);
    assert.equal(outcome.state.revision, beforeRevision);
    return outcome.data as {
      currentRevision: number;
      availability: { kind: string; releaseStageId: string | null };
      queries: readonly { definition: { id: string } }[];
      records: readonly { id: string }[];
      reportConsumers: readonly { reportId: string; evidenceId: string }[];
      externalExecution: boolean;
    };
  }

  async function runRegisteredUntilGate(
    current: CaseCoordination,
    onStep: (
      action: NextAgentAction,
      outcome: Extract<ToolOutcome, { ok: true }>,
    ) => void,
  ): Promise<CaseCoordination> {
    for (let index = 0; index < 24; index += 1) {
      if (current.analystGate) return current;
      const action = nextAction(current, state);
      const outcome = await webCallback(action.toolName, action.input);
      onStep(action, outcome);
      current = coordination(outcome);
    }
    assert.fail("Registered WebMCP callbacks did not reach an analyst gate.");
  }

  let current = await webCoordination("get_case_context", {});
  const lineageDefinition = registered.get("trace_evidence_lineage");
  assert.ok(lineageDefinition);
  const beforeUnreleased = state;
  const unreleased = (await lineageDefinition.execute({
    targetType: "event",
    targetId: "EVT-EDR-0448-10",
  })) as ToolOutcome;
  assert.equal(unreleased.ok, false);
  if (!unreleased.ok) {
    assert.equal(unreleased.error.code, "LINEAGE_NOT_AVAILABLE");
    assert.equal(unreleased.state, beforeUnreleased);
  }
  const initialLineage = await lineageRead("event", "EVT-EDR-0448-01");
  assert.equal(initialLineage.currentRevision, 1);
  assert.deepEqual(initialLineage.availability, {
    kind: "initial",
    releaseStageId: null,
  });
  assert.equal(initialLineage.externalExecution, false);
  let queryPrepared = false;
  let rawRecordsReturned = false;
  current = await runRegisteredUntilGate(current, (action, outcome) => {
    if (action.toolName === "prepare_investigation_query") {
      const data = outcome.data as { queryText: string; executable: boolean };
      assert.equal(data.executable, true);
      assert.equal(
        data.queryText,
        getQueryConsoleContract(action.input.queryId as string)?.text,
      );
      queryPrepared = true;
    }
    if (action.toolName === "run_investigation_query") {
      const data = outcome.data as {
        returnedRecords: readonly unknown[];
        execution: { synthetic: boolean; returnedRecordCount: number };
      };
      assert.equal(data.execution.synthetic, true);
      assert.equal(
        data.returnedRecords.length,
        data.execution.returnedRecordCount,
      );
      assert.ok(data.returnedRecords.length > 0);
      rawRecordsReturned = true;
    }
  });
  assert.equal(queryPrepared, true);
  assert.equal(rawRecordsReturned, true);
  assert.deepEqual(state.releasedStreamStageIds, ["STREAM-LAT-01"]);
  assert.ok(
    getVisibleEntities(fixture, state).length > visibleBeforeDiscovery.length,
    "Attaching the verified discovery must expand the graph data.",
  );
  const discoveryLineage = await lineageRead("event", "EVT-EDR-0448-10");
  assert.deepEqual(discoveryLineage.availability, {
    kind: "released",
    releaseStageId: "STREAM-LAT-01",
  });
  assert.deepEqual(
    discoveryLineage.queries.map((query) => query.definition.id),
    ["QRY-ENDPOINT-IDENTITY-03"],
  );
  assert.deepEqual(
    discoveryLineage.records.map((record) => record.id),
    [
      "QRR-ENDPOINT-IDENTITY-01",
      "QRR-ENDPOINT-IDENTITY-02",
      "QRR-ENDPOINT-IDENTITY-03",
    ],
  );
  expectGate(current, "evidence_disposition");

  const decision = success(
    analyst(state, "record_evidence_decision", {
      expectedRevision: state.revision,
      decision: "confirmed_malicious",
      rationale:
        "Observed execution, egress, identity misuse, and the blocked remote-service attempt meet the synthetic containment threshold.",
    }),
  );
  state = decision.state;
  current = coordination(decision);

  current = await runRegisteredUntilGate(current, () => {});
  expectGate(current, "response_authorization");
  assert.equal(state.reachabilityAttached, true);
  assert.equal(state.counterfactualAttached, true);
  const containmentProposalId = state.responseBundle?.id;
  assert.equal(typeof containmentProposalId, "string");

  const containmentApproval = success(
    analyst(state, "authorize_response_bundle", {
      expectedRevision: state.revision,
      bundleId: "containment",
      proposalId: containmentProposalId,
      acknowledgement: "AUTHORIZE_SYNTHETIC_BUNDLE",
    }),
  );
  state = containmentApproval.state;
  current = coordination(containmentApproval);

  const attachDefinition = registered.get("attach_discovery_stage");
  assert.ok(attachDefinition);
  const preRequestRevision = state.revision;
  const preRequestBypass = (await attachDefinition.execute({
    expectedRevision: preRequestRevision,
    stageId: "STREAM-LAT-02",
    rationale: "Skip the request and attach the recovery observation directly.",
  })) as ToolOutcome;
  assert.equal(preRequestBypass.ok, false);
  if (!preRequestBypass.ok) {
    assert.equal(preRequestBypass.error.code, "TELEMETRY_RELEASE_REQUIRED");
    assert.equal(preRequestBypass.state.revision, preRequestRevision);
    assert.equal(preRequestBypass.state.observationRequest, null);
    assert.deepEqual(preRequestBypass.state.releasedStreamStageIds, [
      "STREAM-LAT-01",
    ]);
  }

  current = await runRegisteredUntilGate(current, () => {});
  expectGate(current, "telemetry_release");
  assert.equal(state.observationRequest?.status, "pending");
  assert.deepEqual(state.releasedStreamStageIds, ["STREAM-LAT-01"]);

  const gatedRevision = state.revision;
  const bypass = (await attachDefinition.execute({
    expectedRevision: gatedRevision,
    stageId: "STREAM-LAT-02",
    rationale:
      "Attach the requested recovery observation without analyst release.",
  })) as ToolOutcome;
  assert.equal(bypass.ok, false);
  if (!bypass.ok) {
    assert.equal(bypass.error.code, "TELEMETRY_RELEASE_REQUIRED");
    assert.equal(bypass.state.revision, gatedRevision);
    assert.deepEqual(bypass.state.releasedStreamStageIds, ["STREAM-LAT-01"]);
    assert.equal(bypass.state.observationRequest?.status, "pending");
  }
  assert.equal(state.revision, gatedRevision);

  const telemetryRelease = success(
    analyst(state, "release_next_synthetic_signal", {
      expectedRevision: state.revision,
    }),
  );
  state = telemetryRelease.state;
  current = coordination(telemetryRelease);
  assert.equal(state.observationRequest?.status, "released");
  assert.deepEqual(state.releasedStreamStageIds, [
    "STREAM-LAT-01",
    "STREAM-LAT-02",
  ]);

  current = await runRegisteredUntilGate(current, () => {});
  expectGate(current, "response_authorization");
  const recoveryProposalId = state.responseBundle?.id;
  assert.equal(typeof recoveryProposalId, "string");

  const recoveryApproval = success(
    analyst(state, "authorize_response_bundle", {
      expectedRevision: state.revision,
      bundleId: "recovery",
      proposalId: recoveryProposalId,
      acknowledgement: "AUTHORIZE_SYNTHETIC_BUNDLE",
    }),
  );
  state = recoveryApproval.state;
  current = coordination(recoveryApproval);

  current = await runRegisteredUntilGate(current, () => {});
  expectGate(current, "report_approval");
  assert.equal(state.report.status, "drafted");
  assert.equal(state.report.report?.id, "REPORT-ENDPOINT-0448");
  const reportLineage = await lineageRead("report_finding", "ENR-LAT-FILE-01");
  assert.equal(reportLineage.availability.kind, "reported");
  assert.deepEqual(
    reportLineage.reportConsumers.map(({ reportId, evidenceId }) => ({
      reportId,
      evidenceId,
    })),
    [
      {
        reportId: "REPORT-ENDPOINT-0448",
        evidenceId: "ENR-LAT-FILE-01",
      },
    ],
  );

  const closure = success(
    analyst(state, "approve_case_report", {
      expectedRevision: state.revision,
      reportId: "REPORT-ENDPOINT-0448",
      acknowledgement: "APPROVE_SYNTHETIC_REPORT",
      analystClosureNote:
        "The modeled controls are approved and the synthetic case is ready for closure.",
    }),
  );
  state = closure.state;
  current = coordination(closure);
  assert.equal(state.lifecycle, "closed_in_demo");
  assert.equal(state.report.status, "approved_in_demo");
  assert.equal(current.collaborationHandoff.nextOwner, "complete");
});
