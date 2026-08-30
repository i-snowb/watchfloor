"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
import type { InvestigationActivity } from "./investigation-activity";
import { QueryConsole } from "./query-console";
import {
  selectionContainsEntity,
  type TraceSelection,
} from "./trace-interaction";

interface CaseCommandBarProps {
  fixture: CaseFixture;
  state: CaseState;
  agentStatus: AgentStatus;
  busy: boolean;
  onExecute: (
    toolName: CaseToolName,
    input: Record<string, unknown>,
  ) => Promise<void>;
  onReset: () => void;
  onSelect: (selection: TraceSelection) => void;
  selection: TraceSelection;
  showInvestigationControls: boolean;
  investigationActivity: InvestigationActivity;
  onOpenReportReview: () => void;
}

type CommandOwner = "agent" | "analyst" | "evidence" | "complete";

export function CaseCommandBar({
  fixture,
  state,
  agentStatus,
  busy,
  onExecute,
  onReset,
  onSelect,
  selection,
  showInvestigationControls,
  investigationActivity,
  onOpenReportReview,
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
  const selectedQueries = findSelectedInvestigationQueries(
    fixture,
    state,
    selection,
  );
  const investigationOpen =
    state.decision.status === "pending" && !decisionReady;
  const [preferredQueryId, setPreferredQueryId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [dismissedStopActivity, setDismissedStopActivity] =
    useState<InvestigationActivity | null>(null);
  const previousRevision = useRef(state.revision);
  const previousSelection = useRef(`${selection.kind}:${selection.id}`);

  useEffect(() => {
    const selectionKey = `${selection.kind}:${selection.id}`;
    if (previousSelection.current !== selectionKey) {
      setDismissed(true);
      previousSelection.current = selectionKey;
    }
  }, [selection.id, selection.kind]);

  useEffect(() => {
    if (previousRevision.current !== state.revision) {
      setDismissed(false);
      previousRevision.current = state.revision;
    }
  }, [state.revision]);
  const activityQuery =
    investigationActivity.status !== "idle"
      ? (selectedQueries.find(
          (query) => query.id === investigationActivity.queryId,
        ) ?? null)
      : null;
  const preferredQuery = preferredQueryId
    ? (selectedQueries.find((query) => query.id === preferredQueryId) ?? null)
    : null;
  const preparedQuery = state.preparedQuery
    ? (selectedQueries.find(
        (query) => query.id === state.preparedQuery?.queryId,
      ) ?? null)
    : null;
  const nextQuery =
    investigationOpen &&
    (showInvestigationControls ||
      activityQuery !== null ||
      preparedQuery !== null) &&
    selectedQueries.length > 0
      ? investigationActivity.status === "running" && activityQuery
        ? activityQuery
        : (preferredQuery ??
          activityQuery ??
          preparedQuery ??
          selectedQueries.find(
            (query) =>
              !state.attachedEnrichmentIds.includes(query.resultArtifactId),
          ) ??
          selectedQueries[0] ??
          null)
      : null;
  const commandOwner = getCommandOwner(
    state,
    decisionReady,
    activeActionState,
    nextStage,
    nextStep.recommendedTool,
    alternateDisposition,
  );
  const webMcpAnalystStop =
    dismissedStopActivity !== investigationActivity &&
    investigationActivity.status === "rejected" &&
    investigationActivity.actor === "agent" &&
    investigationActivity.errorCode === "HUMAN_DECISION_REQUIRED";

  if (webMcpAnalystStop && state.decision.status === "pending") {
    return (
      <section
        aria-labelledby="webmcp-analyst-stop-heading"
        className="case-command-bar command-owner-analyst webmcp-stop-card"
      >
        <div className="case-command-next">
          <div className="case-command-label">
            <span>Automation paused</span>
            <small>Analyst boundary</small>
          </div>
          <div className="case-command-copy">
            <h2 id="webmcp-analyst-stop-heading">
              {investigationActivity.summary}
            </h2>
            <p>
              {requiredContextCount}/
              {fixture.decision.requiresEnrichmentIds.length} decision records
              attached. WebMCP cannot record the evidence disposition or
              authorize a response.
            </p>
          </div>
          <button
            aria-label="Dismiss automation pause"
            className="case-command-dismiss"
            onClick={() => setDismissedStopActivity(investigationActivity)}
            title="Dismiss"
            type="button"
          >
            ×
          </button>
        </div>
      </section>
    );
  }

  if (nextQuery) {
    return (
      <QueryConsole
        key={nextQuery.id}
        activity={investigationActivity}
        busy={busy}
        candidates={selectedQueries}
        fixture={fixture}
        onChooseQuery={setPreferredQueryId}
        onPrepare={(input) => onExecute("prepare_investigation_query", input)}
        onExecute={(input) => onExecute("run_investigation_query", input)}
        onSelect={onSelect}
        query={nextQuery}
        state={state}
      />
    );
  }

  if (investigationOpen) {
    return null;
  }

  if (state.report.status === "drafted" && state.report.report) {
    return (
      <button
        className="report-review-link"
        disabled={busy}
        onClick={onOpenReportReview}
        type="button"
      >
        <span>Report ready</span>
        <strong>Review the evidence report</strong>
        <em>Open report</em>
      </button>
    );
  }

  if (dismissed) return null;

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
            onReset={onReset}
            onSelect={onSelect}
            selection={selection}
            state={state}
            targetEntityId={nextStep.targetEntityId}
          />
        </div>
        <button
          aria-label="Dismiss current operation"
          className="case-command-dismiss"
          onClick={() => setDismissed(true)}
          title="Dismiss"
          type="button"
        >
          ×
        </button>
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
  decisionReady,
  nextTool,
  targetEntityId,
  nextStage,
  activeAction,
  activeActionState,
  onExecute,
  onReset,
  onSelect,
  selection,
}: {
  fixture: CaseFixture;
  state: CaseState;
  busy: boolean;
  decisionReady: boolean;
  nextTool: CaseToolName | null;
  targetEntityId: string | null;
  nextStage: CaseFixture["stream"]["stages"][number] | null;
  activeAction: ResponseActionDefinition | null;
  activeActionState: ResponseActionState | undefined;
  onExecute: CaseCommandBarProps["onExecute"];
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
        Reset case
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
        Approve {bundle?.id ?? "response"} package
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
      const nextQuery = plan?.queryIds
        .map((queryId) =>
          fixture.investigationQueries.find((query) => query.id === queryId),
        )
        .find(
          (query) =>
            query !== undefined &&
            !state.attachedEnrichmentIds.includes(query.resultArtifactId),
        );
      return (
        <button
          className="case-command-primary"
          disabled={busy || !nextQuery}
          onClick={() => {
            if (nextQuery) {
              onSelect({ kind: "entity", id: nextQuery.targetEntityId });
            }
          }}
          type="button"
        >
          Open next query
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
    if (
      (nextTool === "attach_discovery_stage" ||
        nextTool === "request_next_observation") &&
      nextStage
    ) {
      return (
        <div className="case-command-agent-handoff">
          <span>Evidence ready</span>
          <strong>Discovery available: {nextStage.title}</strong>
          <small>Supporting evidence is attached to this case.</small>
        </div>
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
        <div className="case-command-report-ready">
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
            Draft evidence report
          </button>
          <code>Automation · generate_case_report</code>
        </div>
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

function findSelectedInvestigationQueries(
  fixture: CaseFixture,
  state: CaseState,
  selection: TraceSelection,
) {
  return fixture.investigationQueries.filter(
    (query) =>
      (query.requiresStageId === null ||
        state.releasedStreamStageIds.includes(query.requiresStageId)) &&
      selectionContainsEntity(fixture, selection, query.targetEntityId),
  );
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
  if (state.report.status === "drafted") return "Review the evidence report";
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
    return `Discovery available: ${nextStage.title}.`;
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
  if (recommendedTool === "attach_discovery_stage") {
    return nextStage
      ? `Add verified discovery: ${nextStage.title}`
      : "Add the verified discovery to the case.";
  }
  if (recommendedTool === "request_next_observation") {
    return nextStage
      ? `Discovery available: ${nextStage.title}.`
      : "Verified discoveries are available when supporting evidence is attached.";
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
    return "This disposition holds the response workflow for further review.";
  }
  if (state.report.status === "drafted") {
    return "Review evidence coverage, response provenance, limitations, and residual risk before approval.";
  }
  if (state.responseBundle) {
    return `${state.responseBundle.actionIds.length} response actions modeled. Analyst authorization is required; no external system has been contacted.`;
  }
  const activeState = activeAction
    ? state.responseActions.find(
        (action) => action.actionId === activeAction.id,
      )
    : null;
  if (activeState?.status === "simulated") {
    return `${activeAction?.simulatedEffect ?? ""} Approval records the response decision; no external system is contacted.`;
  }
  if (state.decision.status === "pending") {
    if (commandOwner === "analyst") {
      return `${requiredContextCount}/${fixture.decision.requiresEnrichmentIds.length} required context records attached. WebMCP cannot record this disposition; analyst review is required.`;
    }
    return `${requiredContextCount}/${fixture.decision.requiresEnrichmentIds.length} required context records attached.`;
  }
  if (commandOwner === "evidence" && nextStage && !activeAction) {
    return "Supporting evidence is attached and the discovery is ready to add to the case.";
  }
  if (agentStatus.state === "available") {
    return "Investigation automation is available for the current case scope.";
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
    return "Potential propagation interrupted · no external control executed";
  }
  if (authorized.length > 0) {
    return `${authorized.length}/${fixture.responseActions.length} controls approved · ${severed.size} modeled segment${severed.size === 1 ? "" : "s"} severed`;
  }
  if (state.counterfactualAttached) {
    const count = fixture.counterfactual.severedPathIds.length;
    return `Modeled response interrupts ${count} potential path${count === 1 ? "" : "s"} · no control executed`;
  }
  if (state.reachabilityAttached) {
    return `${fixture.reachability.paths.length} candidate risk segments · billing-api modeled only`;
  }
  return "Propagation not yet modeled";
}

function authorizationLabel(action: ResponseActionDefinition): string {
  if (action.id === "collect_endpoint_forensics") {
    return "Approve collection: FIN-WS-044 forensic triage";
  }
  if (action.id === "contain_endpoint") {
    return "Approve isolation: FIN-WS-044";
  }
  if (action.id === "block_network_indicator") {
    return "Approve egress block: 203.0.113.91";
  }
  if (action.id === "disable_service_identity") {
    return "Approve identity disablement: svc-fin-reports";
  }
  if (action.id === "rotate_deployment_credential") {
    return "Approve credential rotation: ci/deploy/production";
  }
  if (action.id === "rollback_workload_image") {
    return "Approve known-good redeploy: billing-api";
  }
  return `Approve: ${action.title}`;
}

function commandOwnerLabel(owner: CommandOwner): string {
  if (owner === "analyst") return "Automation paused · analyst required";
  if (owner === "evidence") return "Telemetry update";
  if (owner === "complete") return "Case complete";
  return "Investigation automation";
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
  if (status === "authorized_in_demo") return "Approved · recorded only";
  if (status === "simulated") return "Needs approval";
  if (status === "proposed") return "Prepared for review";
  if (status === "available") {
    if (!responseModelReady && contextReady && dependenciesReady) {
      return "Queued after model";
    }
    return contextReady && dependenciesReady ? "Ready" : "Needs context";
  }
  return "Awaiting evidence";
}
