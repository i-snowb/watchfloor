"use client";

import Link from "next/link";
import {
  getDerivedNextStep,
  getInvestigationPlans,
  getResponseBundles,
  type CaseToolName,
} from "@/domain/operations";
import { getAllEntities } from "@/domain/incident-stream";
import type {
  CaseFixture,
  CaseState,
  ResponseActionDefinition,
  ResponseActionState,
} from "@/domain/types";
import type { AgentStatus } from "./platform-shell";
import {
  selectionContainsEntity,
  type TraceSelection,
} from "./trace-interaction";

interface CaseCommandBarProps {
  fixture: CaseFixture;
  state: CaseState;
  agentStatus: AgentStatus;
  busy: boolean;
  streamPlaying: boolean;
  onExecute: (
    toolName: CaseToolName,
    input: Record<string, unknown>,
  ) => Promise<void>;
  onReleaseSignal: () => void;
  onReset: () => void;
  onSelect: (selection: TraceSelection) => void;
  selection: TraceSelection;
  showInvestigationControls: boolean;
}

type CommandOwner = "agent" | "analyst" | "evidence" | "complete";

export function CaseCommandBar({
  fixture,
  state,
  agentStatus,
  busy,
  streamPlaying,
  onExecute,
  onReleaseSignal,
  onReset,
  onSelect,
  selection,
  showInvestigationControls,
}: CaseCommandBarProps) {
  const nextStep = getDerivedNextStep(fixture, state);
  const releasedStageCount = state.releasedStreamStageIds.length;
  const nextStage = fixture.stream.stages[releasedStageCount] ?? null;
  const streamScope =
    fixture.presentation.command.stageScopes[releasedStageCount - 1] ??
    fixture.presentation.command.initialScope;
  const scopeMilestone = fixture.presentation.command.scopeMilestones
    .filter((milestone) =>
      milestone.requiresEnrichmentIds.every((id) =>
        state.attachedEnrichmentIds.includes(id),
      ),
    )
    .sort(
      (left, right) =>
        right.requiresEnrichmentIds.length - left.requiresEnrichmentIds.length,
    )[0];
  const scope = scopeMilestone?.summary ?? streamScope;
  const requiredContextCount = fixture.decision.requiresEnrichmentIds.filter(
    (id) => state.attachedEnrichmentIds.includes(id),
  ).length;
  const decisionReady =
    requiredContextCount === fixture.decision.requiresEnrichmentIds.length;
  const activeActionState = state.responseActions.find(
    (action) =>
      action.status !== "authorized_in_demo" && action.status !== "unavailable",
  );
  const activeAction = activeActionState
    ? (fixture.responseActions.find(
        (action) => action.id === activeActionState.actionId,
      ) ?? null)
    : null;
  const impact = impactSummary(fixture, state);
  const alternateDisposition =
    state.decision.status !== "pending" &&
    state.decision.status !== fixture.conclusion.requiredDecision;
  const derivedTarget = nextStep.targetEntityId
    ? (getAllEntities(fixture).find(
        (entity) => entity.id === nextStep.targetEntityId,
      ) ?? null)
    : null;
  const selectedQuery = findSelectedInvestigationQuery(
    fixture,
    state,
    selection,
  );
  const investigationOpen =
    state.decision.status === "pending" && !decisionReady;
  const nextQuery =
    investigationOpen && showInvestigationControls ? selectedQuery : null;
  const nextTarget = nextQuery
    ? (getAllEntities(fixture).find(
        (entity) => entity.id === nextQuery.targetEntityId,
      ) ?? null)
    : derivedTarget;
  const nextQueryTargetFocused = nextTarget
    ? selectionContainsEntity(fixture, selection, nextTarget.id)
    : false;
  const commandOwner = getCommandOwner(
    state,
    decisionReady,
    activeActionState,
    nextStage,
    nextStep.recommendedTool,
    alternateDisposition,
  );

  if (nextQuery) {
    return (
      <section
        className="case-command-bar case-command-query-gate command-owner-agent"
        aria-labelledby="case-command-heading"
      >
        <div className="case-command-next">
          <div className="case-command-label">
            <span>Investigate selection</span>
            <small>
              {nextTarget
                ? humanizeSelectionTarget(nextTarget.kind)
                : "Evidence"}
            </small>
          </div>
          <div className="case-command-copy">
            <h2 id="case-command-heading">{nextQuery.title}</h2>
            <p>
              {nextTarget?.label ?? "Selected item"} ·{" "}
              {nextQuery.sourceScopes.length} source
              {nextQuery.sourceScopes.length === 1 ? "" : "s"} · bounded query
            </p>
          </div>
          <div className="case-command-control">
            <button
              className="case-command-primary"
              disabled={busy || !nextTarget}
              onClick={() => {
                if (nextTarget && !nextQueryTargetFocused) {
                  onSelect({ kind: "entity", id: nextTarget.id });
                }
                void onExecute("run_investigation_query", {
                  expectedRevision: state.revision,
                  queryId: nextQuery.id,
                });
              }}
              type="button"
            >
              {busy ? "Running query" : "Run query"}
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (investigationOpen) return null;

  return (
    <section
      className={`case-command-bar command-owner-${commandOwner}`}
      aria-labelledby="case-command-heading"
    >
      <div className="case-command-next">
        <div className="case-command-label">
          <span>{commandOwnerLabel(commandOwner)}</span>
          <small>{commandSequenceLabel(fixture, state)}</small>
        </div>
        <div className="case-command-copy">
          <h2 id="case-command-heading">
            {commandTitle(
              fixture,
              state,
              nextStep.objective,
              nextStep.recommendedTool,
              activeAction,
            )}
          </h2>
          <p>
            {commandDetail(
              fixture,
              state,
              agentStatus,
              requiredContextCount,
              activeAction,
              nextStage,
              commandOwner,
            )}
          </p>
        </div>
        <div className="case-command-control">
          <CommandControls
            activeAction={activeAction}
            activeActionState={activeActionState}
            busy={busy}
            decisionReady={decisionReady}
            fixture={fixture}
            nextStage={nextStage}
            nextTool={nextStep.recommendedTool}
            onExecute={onExecute}
            onReleaseSignal={onReleaseSignal}
            onReset={onReset}
            onSelect={onSelect}
            selection={selection}
            state={state}
            streamPlaying={streamPlaying}
            targetEntityId={nextStep.targetEntityId}
          />
        </div>
      </div>

      <details className="case-command-context">
        <summary>Case status</summary>
        <div className="case-command-facts" aria-label="Current case impact">
          <article>
            <span>Observed</span>
            <strong>{fixture.presentation.command.observed}</strong>
          </article>
          <article>
            <span>Boundary</span>
            <strong>{scope}</strong>
          </article>
          <article>
            <span>Impact</span>
            <strong>{impact}</strong>
          </article>
        </div>
      </details>

      {fixture.responseActions.length > 0 &&
      state.decision.status !== "pending" &&
      !alternateDisposition ? (
        <ResponsePlan fixture={fixture} state={state} />
      ) : null}
    </section>
  );
}

function CommandControls({
  fixture,
  state,
  busy,
  streamPlaying,
  decisionReady,
  nextTool,
  targetEntityId,
  nextStage,
  activeAction,
  activeActionState,
  onExecute,
  onReleaseSignal,
  onReset,
  onSelect,
  selection,
}: {
  fixture: CaseFixture;
  state: CaseState;
  busy: boolean;
  streamPlaying: boolean;
  decisionReady: boolean;
  nextTool: CaseToolName | null;
  targetEntityId: string | null;
  nextStage: CaseFixture["stream"]["stages"][number] | null;
  activeAction: ResponseActionDefinition | null;
  activeActionState: ResponseActionState | undefined;
  onExecute: CaseCommandBarProps["onExecute"];
  onReleaseSignal: () => void;
  onReset: () => void;
  onSelect: (selection: TraceSelection) => void;
  selection: TraceSelection;
}) {
  if (state.lifecycle === "closed_in_demo") {
    return (
      <Link
        className="case-command-primary"
        href={
          fixture.id === "case-cloud-0421"
            ? "/cases/case-endpoint-0448"
            : "/alerts"
        }
      >
        {fixture.id === "case-cloud-0421"
          ? "Open next escalation"
          : "Return to incident ledger"}
      </Link>
    );
  }

  if (
    state.decision.status !== "pending" &&
    state.decision.status !== fixture.conclusion.requiredDecision
  ) {
    return (
      <button
        className="case-command-primary"
        disabled={busy}
        onClick={onReset}
        type="button"
      >
        Reset and replay case
      </button>
    );
  }

  if (state.report.status === "drafted" && state.report.report) {
    return (
      <button
        className="case-command-primary"
        disabled={busy}
        onClick={() =>
          void onExecute("approve_case_report", {
            expectedRevision: state.revision,
            reportId: state.report.report?.id,
            acknowledgement: "APPROVE_SYNTHETIC_REPORT",
          })
        }
        type="button"
      >
        Approve report and close case
      </button>
    );
  }

  if (state.responseBundle) {
    const bundle = getResponseBundles(fixture).find(
      (candidate) => candidate.id === state.responseBundle?.bundleId,
    );
    return (
      <button
        className="case-command-primary"
        disabled={busy || !bundle}
        onClick={() =>
          bundle
            ? void onExecute("authorize_response_bundle", {
                expectedRevision: state.revision,
                bundleId: bundle.id,
                proposalId: state.responseBundle?.id,
                acknowledgement: "AUTHORIZE_SYNTHETIC_BUNDLE",
              })
            : undefined
        }
        type="button"
      >
        Authorize {bundle?.id ?? "response"} package
      </button>
    );
  }

  if (activeActionState?.status === "simulated" && activeAction) {
    const proposal =
      state.responseProposal?.actionId === activeAction.id
        ? state.responseProposal
        : null;
    return (
      <button
        className="case-command-primary"
        disabled={busy || !proposal}
        onClick={() =>
          proposal
            ? void onExecute("authorize_response_action", {
                expectedRevision: state.revision,
                actionId: activeAction.id,
                proposalId: proposal.id,
                acknowledgement: "AUTHORIZE_SYNTHETIC_RESPONSE",
              })
            : undefined
        }
        type="button"
      >
        {authorizationLabel(activeAction)}
      </button>
    );
  }

  if (state.decision.status === "pending" && decisionReady) {
    return (
      <div className="case-command-decision-actions">
        {fixture.decision.options.map((option) => (
          <button
            className={
              option.id === fixture.conclusion.requiredDecision
                ? "case-command-primary"
                : "case-command-secondary"
            }
            disabled={busy}
            key={option.id}
            onClick={() =>
              void onExecute("record_evidence_decision", {
                expectedRevision: state.revision,
                decision: option.id,
                rationale: option.rationale,
              })
            }
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  }

  if (!nextTool && nextStage) {
    const requestedTargetId = state.observationRequest?.targetEntityIds.at(-1);
    const requestedTarget = requestedTargetId
      ? getAllEntities(fixture).find(
          (entity) => entity.id === requestedTargetId,
        )
      : null;
    return (
      <button
        className="case-command-primary"
        disabled={busy || streamPlaying}
        onClick={onReleaseSignal}
        type="button"
      >
        {streamPlaying
          ? `Receiving ${requestedTarget?.label ?? "telemetry"}`
          : state.observationRequest?.status === "pending"
            ? `Release ${requestedTarget?.label ?? "requested"} telemetry`
            : `Receive update: ${nextStage.title}`}
      </button>
    );
  }

  if (nextTool) {
    const target = targetEntityId
      ? getAllEntities(fixture).find((entity) => entity.id === targetEntityId)
      : null;
    const targetFocused = target
      ? selectionContainsEntity(fixture, selection, target.id)
      : false;
    if (nextTool === "calculate_reachability") {
      return (
        <button
          className="case-command-primary"
          disabled={busy}
          onClick={() =>
            void onExecute("calculate_reachability", {
              expectedRevision: state.revision,
              fromEntityId: fixture.reachability.sourceEntityId,
              maxDepth: 6,
            })
          }
          type="button"
        >
          Calculate blast radius
        </button>
      );
    }
    if (nextTool === "run_investigation_plan") {
      const plan = getInvestigationPlans(fixture).find(
        (candidate) =>
          (candidate.requiresStageId === null ||
            state.releasedStreamStageIds.includes(candidate.requiresStageId)) &&
          candidate.queryIds.some((queryId) => {
            const query = fixture.investigationQueries.find(
              (item) => item.id === queryId,
            );
            return query
              ? !state.attachedEnrichmentIds.includes(query.resultArtifactId)
              : false;
          }),
      );
      return (
        <button
          className="case-command-primary"
          disabled={busy || !plan}
          onClick={() =>
            plan
              ? void onExecute("run_investigation_plan", {
                  expectedRevision: state.revision,
                  planId: plan.id,
                })
              : undefined
          }
          type="button"
        >
          Run copilot evidence plan
        </button>
      );
    }
    if (nextTool === "simulate_control") {
      return (
        <button
          className="case-command-primary"
          disabled={busy}
          onClick={() =>
            void onExecute("simulate_control", {
              expectedRevision: state.revision,
              control: fixture.counterfactual.control,
            })
          }
          type="button"
        >
          Simulate containment effect
        </button>
      );
    }
    if (nextTool === "request_next_observation" && nextStage) {
      return (
        <button
          className="case-command-primary"
          disabled={busy}
          onClick={() =>
            void onExecute("request_next_observation", {
              expectedRevision: state.revision,
              stageId: nextStage.id,
              rationale: `Request ${nextStage.title.toLowerCase()} to resolve the current evidence boundary.`,
            })
          }
          type="button"
        >
          Request new telemetry
        </button>
      );
    }
    if (nextTool === "prepare_response_bundle") {
      const bundle = getResponseBundles(fixture).find(
        (candidate) =>
          !state.authorizedResponseBundleIds.includes(candidate.id) &&
          candidate.actionIds.some(
            (actionId) =>
              state.responseActions.find(
                (action) => action.actionId === actionId,
              )?.status === "available",
          ),
      );
      return (
        <button
          className="case-command-primary"
          disabled={busy || !bundle}
          onClick={() =>
            bundle
              ? void onExecute("prepare_response_bundle", {
                  expectedRevision: state.revision,
                  bundleId: bundle.id,
                })
              : undefined
          }
          type="button"
        >
          Prepare {bundle?.id ?? "response"} package
        </button>
      );
    }
    if (nextTool === "propose_response_action" && activeAction) {
      const dependenciesReady = activeAction.dependsOnActionIds.every(
        (dependencyId) =>
          state.responseActions.find(
            (candidate) => candidate.actionId === dependencyId,
          )?.status === "authorized_in_demo",
      );
      const contextReady = activeAction.requiresEnrichmentIds.every(
        (artifactId) => state.attachedEnrichmentIds.includes(artifactId),
      );
      return (
        <button
          className="case-command-primary"
          disabled={busy || !dependenciesReady || !contextReady}
          onClick={() =>
            void onExecute("propose_response_action", {
              expectedRevision: state.revision,
              actionId: activeAction.id,
              reasoning: activeAction.proposalReasoning,
            })
          }
          type="button"
        >
          Prepare response plan
        </button>
      );
    }
    if (nextTool === "simulate_response_action" && activeAction) {
      return (
        <button
          className="case-command-primary"
          disabled={busy}
          onClick={() =>
            void onExecute("simulate_response_action", {
              expectedRevision: state.revision,
              actionId: activeAction.id,
            })
          }
          type="button"
        >
          Simulate response
        </button>
      );
    }
    if (nextTool === "generate_case_report") {
      return (
        <button
          className="case-command-primary"
          disabled={busy}
          onClick={() =>
            void onExecute("generate_case_report", {
              expectedRevision: state.revision,
            })
          }
          type="button"
        >
          Generate evidence report
        </button>
      );
    }
    return (
      <button
        className="case-command-primary"
        disabled={busy || !target || targetFocused}
        onClick={() => {
          if (target) onSelect({ kind: "entity", id: target.id });
        }}
        type="button"
      >
        {target ? "Inspect " + target.label : "No manual action required"}
      </button>
    );
  }

  return null;
}

function findSelectedInvestigationQuery(
  fixture: CaseFixture,
  state: CaseState,
  selection: TraceSelection,
) {
  return (
    fixture.investigationQueries.find(
      (query) =>
        !state.attachedEnrichmentIds.includes(query.resultArtifactId) &&
        (query.requiresStageId === null ||
          state.releasedStreamStageIds.includes(query.requiresStageId)) &&
        selectionContainsEntity(fixture, selection, query.targetEntityId),
    ) ?? null
  );
}

function humanizeSelectionTarget(kind: string): string {
  return kind.replaceAll("_", " ");
}

function ResponsePlan({
  fixture,
  state,
}: {
  fixture: CaseFixture;
  state: CaseState;
}) {
  return (
    <ol className="case-response-plan" aria-label="Response sequence">
      {fixture.responseActions.map((definition, index) => {
        const actionState = state.responseActions.find(
          (action) => action.actionId === definition.id,
        );
        const status = actionState?.status ?? "unavailable";
        const contextReady = definition.requiresEnrichmentIds.every((id) =>
          state.attachedEnrichmentIds.includes(id),
        );
        const dependenciesReady = definition.dependsOnActionIds.every(
          (id) =>
            state.responseActions.find((action) => action.actionId === id)
              ?.status === "authorized_in_demo",
        );
        return (
          <li className={`response-plan-${status}`} key={definition.id}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <small>{phaseLabel(definition.phase)}</small>
              <strong>{definition.title}</strong>
            </div>
            <em>
              {responsePlanStatus(
                status,
                contextReady,
                dependenciesReady,
                state.counterfactualAttached,
              )}
            </em>
          </li>
        );
      })}
    </ol>
  );
}

function getCommandOwner(
  state: CaseState,
  decisionReady: boolean,
  activeActionState: ResponseActionState | undefined,
  nextStage: CaseFixture["stream"]["stages"][number] | null,
  nextTool: CaseToolName | null,
  alternateDisposition: boolean,
): CommandOwner {
  if (state.lifecycle === "closed_in_demo") return "complete";
  if (alternateDisposition) return "analyst";
  if (state.report.status === "drafted") return "analyst";
  if (activeActionState?.status === "simulated") return "analyst";
  if (state.decision.status === "pending" && decisionReady) return "analyst";
  if (!nextTool && nextStage) return "evidence";
  return "agent";
}

function commandTitle(
  fixture: CaseFixture,
  state: CaseState,
  derivedObjective: string,
  recommendedTool: CaseToolName | null,
  activeAction: ResponseActionDefinition | null,
): string {
  if (state.lifecycle === "closed_in_demo") return "Case closed";
  if (
    state.decision.status !== "pending" &&
    state.decision.status !== fixture.conclusion.requiredDecision
  ) {
    const disposition = fixture.decision.options.find(
      (option) => option.id === state.decision.status,
    );
    return `Review required: ${disposition?.label ?? state.decision.status}`;
  }
  if (state.report.status === "drafted") return "Approve the evidence report";
  if (state.responseBundle) {
    return `Authorize ${state.responseBundle.bundleId} package`;
  }
  const activeState = activeAction
    ? state.responseActions.find(
        (action) => action.actionId === activeAction.id,
      )
    : null;
  if (activeState?.status === "simulated" && activeAction) {
    return authorizationLabel(activeAction);
  }
  if (state.decision.status === "pending") {
    const ready = fixture.decision.requiresEnrichmentIds.every((id) =>
      state.attachedEnrichmentIds.includes(id),
    );
    if (ready) return fixture.decision.question;
  }
  const nextStage =
    fixture.stream.stages[state.releasedStreamStageIds.length] ?? null;
  if (!recommendedTool && nextStage) {
    const requestedTargetId = state.observationRequest?.targetEntityIds.at(-1);
    const requestedTarget = requestedTargetId
      ? getAllEntities(fixture).find(
          (entity) => entity.id === requestedTargetId,
        )
      : null;
    return state.observationRequest?.status === "pending"
      ? `Copilot requests ${requestedTarget?.label ?? "the next target"} telemetry.`
      : `New telemetry ready: ${nextStage.title}`;
  }
  if (recommendedTool === "calculate_reachability") {
    const source = getAllEntities(fixture).find(
      (entity) => entity.id === fixture.reachability.sourceEntityId,
    );
    return `Calculate blast radius from ${source?.label ?? "the observed entry point"}.`;
  }
  if (recommendedTool === "run_investigation_plan") {
    return derivedObjective;
  }
  if (recommendedTool === "simulate_control") {
    return "Test the containment effect before response.";
  }
  if (recommendedTool === "request_next_observation") {
    return `Resolve: ${fixture.tier1Escalation.unresolvedQuestions[0]}`;
  }
  if (recommendedTool === "prepare_response_bundle") {
    return derivedObjective;
  }
  if (recommendedTool === "propose_response_action" && activeAction) {
    return `Prepare: ${activeAction.title}`;
  }
  if (recommendedTool === "simulate_response_action" && activeAction) {
    return `Simulate: ${activeAction.title}`;
  }
  if (recommendedTool === "generate_case_report") {
    return "Generate the evidence report.";
  }
  return derivedObjective;
}

function commandDetail(
  fixture: CaseFixture,
  state: CaseState,
  agentStatus: AgentStatus,
  requiredContextCount: number,
  activeAction: ResponseActionDefinition | null,
  nextStage: CaseFixture["stream"]["stages"][number] | null,
  commandOwner: CommandOwner,
): string {
  if (state.lifecycle === "closed_in_demo") {
    return "Evidence and approved response records are complete. No external system was contacted.";
  }
  if (
    state.decision.status !== "pending" &&
    state.decision.status !== fixture.conclusion.requiredDecision
  ) {
    return "This disposition stops the response workflow. Reset the case to replay another path.";
  }
  if (state.report.status === "drafted") {
    return "Analyst approval records closure. The report is not published externally.";
  }
  if (state.responseBundle) {
    return `${state.responseBundle.actionIds.length} controls modeled. Analyst authorization is required; no external system has been contacted.`;
  }
  const activeState = activeAction
    ? state.responseActions.find(
        (action) => action.actionId === activeAction.id,
      )
    : null;
  if (activeState?.status === "simulated") {
    return `${activeAction?.simulatedEffect ?? ""} Approval records the simulated response; no external system is contacted.`;
  }
  if (state.decision.status === "pending") {
    return `${requiredContextCount}/${fixture.decision.requiresEnrichmentIds.length} required context records attached.`;
  }
  if (commandOwner === "evidence" && nextStage && !activeAction) {
    if (state.observationRequest?.status === "pending") {
      return state.observationRequest.rationale;
    }
    return `Case replay · ${state.releasedStreamStageIds.length}/${fixture.stream.stages.length} updates received.`;
  }
  if (agentStatus.state === "available") {
    return "Copilot ready. It can run the next case operation through WebMCP.";
  }
  return "The same operation is available in the evidence inspector.";
}

function impactSummary(fixture: CaseFixture, state: CaseState): string {
  if (
    state.decision.status !== "pending" &&
    state.decision.status !== fixture.conclusion.requiredDecision
  ) {
    return "Response held · further evidence required";
  }
  if (fixture.responseActions.length === 0) {
    return state.decision.status === "pending"
      ? "Containment decision pending"
      : "No containment warranted · least-privilege exception remains";
  }
  const authorized = state.responseActions.filter(
    (action) => action.status === "authorized_in_demo",
  );
  const severed = new Set(
    authorized.flatMap(
      (actionState) =>
        fixture.responseActions.find(
          (definition) => definition.id === actionState.actionId,
        )?.seversPathIds ?? [],
    ),
  );
  if (
    fixture.conclusion.requiredActionIds.length > 0 &&
    fixture.conclusion.requiredActionIds.every((id) =>
      authorized.some((action) => action.actionId === id),
    )
  ) {
    return "Modeled propagation halted · no external control executed";
  }
  if (authorized.length > 0) {
    return `${authorized.length}/${fixture.responseActions.length} controls approved · ${severed.size} modeled segment${severed.size === 1 ? "" : "s"} severed`;
  }
  if (state.counterfactualAttached) {
    const count = fixture.counterfactual.severedPathIds.length;
    return `Simulation blocks ${count} modeled path${count === 1 ? "" : "s"} · no control executed`;
  }
  if (state.reachabilityAttached) {
    return `${fixture.reachability.paths.length} candidate risk segments · billing-api modeled only`;
  }
  return "Propagation not yet modeled";
}

function authorizationLabel(action: ResponseActionDefinition): string {
  if (action.id === "contain_endpoint") {
    return "Authorize containment: FIN-WS-044";
  }
  if (action.id === "disable_service_identity") {
    return "Authorize identity disablement: svc-fin-reports";
  }
  if (action.id === "rotate_deployment_credential") {
    return "Authorize credential rotation: ci/deploy/production";
  }
  if (action.id === "rollback_workload_image") {
    return "Authorize recovery: billing-api";
  }
  return `Authorize: ${action.title}`;
}

function commandOwnerLabel(owner: CommandOwner): string {
  if (owner === "analyst") return "Analyst approval required";
  if (owner === "evidence") return "Telemetry update";
  if (owner === "complete") return "Case complete";
  return "Copilot operation";
}

function commandSequenceLabel(fixture: CaseFixture, state: CaseState): string {
  if (state.lifecycle === "closed_in_demo") return "Closed";
  if (
    state.decision.status !== "pending" &&
    state.decision.status !== fixture.conclusion.requiredDecision
  ) {
    return "Review";
  }
  if (state.report.status === "drafted") return "Review";
  if (state.decision.status === "pending") return "Triage";
  if (fixture.responseActions.length === 0) {
    return "Report";
  }
  if (!state.reachabilityAttached) return "Scope";
  if (!state.counterfactualAttached) return "Model";
  const authorized = state.responseActions.filter(
    (action) => action.status === "authorized_in_demo",
  ).length;
  return `Response ${authorized}/${fixture.responseActions.length}`;
}

function phaseLabel(phase: ResponseActionDefinition["phase"]): string {
  if (phase === "containment") return "Contain";
  if (phase === "eradication") return "Eradicate";
  return "Recover";
}

function responsePlanStatus(
  status: ResponseActionState["status"],
  contextReady: boolean,
  dependenciesReady: boolean,
  responseModelReady: boolean,
): string {
  if (status === "authorized_in_demo") return "Approved · no execution";
  if (status === "simulated") return "Needs approval";
  if (status === "proposed") return "Copilot proposed";
  if (status === "available") {
    if (!responseModelReady && contextReady && dependenciesReady) {
      return "Queued after model";
    }
    return contextReady && dependenciesReady ? "Ready" : "Needs context";
  }
  return "Awaiting evidence";
}
