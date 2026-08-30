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

  const recovery = runAgentUntilAnalystGate(state, current, () => {});
  state = recovery.state;
  current = recovery.coordination;
  assert.deepEqual(recovery.steps, [
    "attach_discovery_stage",
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
