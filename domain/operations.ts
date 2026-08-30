import type {
  CaseFixture,
  CaseState,
  EnrichmentArtifact,
  InvestigationProposal,
  OperationSurface,
  ResponseActionId,
  ResponseBundleId,
  ResponseBundleProposal,
  ResponseProposal,
} from "./types";
import { normalizeAnalystClosureNote } from "./report-signoff";
import {
  getAllEnrichments,
  getAllEntities,
  getAppliedStreamStages,
  getNextStreamStage,
  getVisibleEnrichments,
  getVisibleEntities,
  getVisibleEvents,
  getVisibleJoins,
} from "./incident-stream";
import {
  getQueryConsoleContract,
  matchesQueryConsoleContract,
} from "./query-console";
import { getApprovedInvestigationSkills } from "./investigation-skills";

export const caseToolNames = [
  "list_alerts",
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
  "enrich_identity",
  "enrich_network_indicator",
  "enrich_cloud_role",
  "enrich_resource",
  "enrich_endpoint",
  "enrich_file",
  "record_evidence_decision",
  "calculate_reachability",
  "simulate_control",
  "attach_discovery_stage",
  "request_next_observation",
  "release_next_synthetic_signal",
  "propose_response_action",
  "simulate_response_action",
  "prepare_response_bundle",
  "authorize_response_action",
  "authorize_response_bundle",
  "generate_case_report",
  "approve_case_report",
] as const;

export type CaseToolName = (typeof caseToolNames)[number];
export type ToolSurface = OperationSurface;

export interface CaseToolRequest {
  requestId: string;
  toolName: CaseToolName;
  reportedSurface: ToolSurface;
  input: Record<string, unknown>;
}

export interface ReceiptMaterial {
  title: string;
  target: string | null;
  resultSummary: string;
}

export interface ToolSuccess {
  ok: true;
  data: unknown;
  state: CaseState;
  mutatesState: boolean;
  receipt: ReceiptMaterial;
}

export interface ToolFailure {
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
  state: CaseState;
  receipt: ReceiptMaterial;
}

export type ToolOutcome = ToolSuccess | ToolFailure;

const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9:._-]{7,79}$/;
const proposalTools = new Set<CaseToolName>([
  "inspect_entity",
  "inspect_event",
  "inspect_relationship",
  "query_related_activity",
  "list_investigation_skills",
  "prepare_investigation_query",
  "run_investigation_query",
  "run_investigation_plan",
  "enrich_identity",
  "enrich_network_indicator",
  "enrich_cloud_role",
  "enrich_resource",
  "enrich_endpoint",
  "enrich_file",
  "calculate_reachability",
  "simulate_control",
  "attach_discovery_stage",
  "request_next_observation",
  "propose_response_action",
  "simulate_response_action",
  "prepare_response_bundle",
  "generate_case_report",
]);

export function createInitialCaseState(fixture: CaseFixture): CaseState {
  return {
    caseId: fixture.id,
    fixtureVersion: fixture.fixtureVersion,
    revision: 1,
    attachedEnrichmentIds: [],
    executedInvestigationQueryIds: [],
    preparedQuery: null,
    proposal: null,
    decision: {
      status: "pending",
      rationale: null,
      decidedAt: null,
    },
    reachabilityAttached: false,
    counterfactualAttached: false,
    releasedStreamStageIds: [],
    observationRequest: null,
    responseProposal: null,
    responseBundle: null,
    authorizedResponseBundleIds: [],
    responseActions: fixture.responseActions.map((action) => ({
      actionId: action.id,
      status: "unavailable",
      proposalId: null,
      simulatedAt: null,
      authorizedAt: null,
    })),
    lifecycle: "investigating",
    report: {
      status: "unavailable",
      report: null,
      approvedAt: null,
      analystClosureNote: null,
    },
  };
}

export function getCaseReportNarrative(
  fixture: CaseFixture,
  state: Pick<CaseState, "decision">,
): Pick<CaseFixture["conclusion"], "executiveSummary" | "confirmedFindings"> {
  const rationale = state.decision.rationale;
  if (
    fixture.id !== "case-cloud-0421" ||
    state.decision.status !== "authorized_exception" ||
    rationale === null
  ) {
    return {
      executiveSummary: fixture.conclusion.executiveSummary,
      confirmedFindings: fixture.conclusion.confirmedFindings,
    };
  }

  return {
    executiveSummary: `${fixture.conclusion.executiveSummary} Analyst correction: ${rationale}`,
    confirmedFindings: [
      ...fixture.conclusion.confirmedFindings,
      `Analyst correction: ${rationale}`,
    ],
  };
}

export function isCaseToolName(value: unknown): value is CaseToolName {
  return (
    typeof value === "string" &&
    (caseToolNames as readonly string[]).includes(value)
  );
}

export function validateRequestId(requestId: unknown): requestId is string {
  return typeof requestId === "string" && requestIdPattern.test(requestId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateInput(
  input: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
): string | null {
  const unknown = Object.keys(input).find((key) => !allowed.includes(key));
  if (unknown) {
    return `Unknown input field '${unknown}'.`;
  }

  const missing = required.find((key) => !(key in input));
  return missing ? `Missing required input field '${missing}'.` : null;
}

function fail(
  state: CaseState,
  toolName: string,
  message: string,
  code = "VALIDATION_ERROR",
  retryable = false,
): ToolFailure {
  return {
    ok: false,
    error: { code, message, retryable },
    state,
    receipt: {
      title: humanizeToolName(toolName),
      target: null,
      resultSummary: message,
    },
  };
}

function writeGuard(
  state: CaseState,
  input: Record<string, unknown>,
  toolName: string,
): ToolFailure | null {
  if (!Number.isInteger(input.expectedRevision)) {
    return fail(state, toolName, "expectedRevision must be an integer.");
  }
  if (input.expectedRevision !== state.revision) {
    return fail(
      state,
      toolName,
      `Expected revision ${String(input.expectedRevision)}; current revision is ${state.revision}.`,
      "STALE_STATE",
      true,
    );
  }
  return null;
}

function success(
  state: CaseState,
  data: unknown,
  receipt: ReceiptMaterial,
  mutatesState = false,
): ToolSuccess {
  return { ok: true, data, state, receipt, mutatesState };
}

function nextState(state: CaseState): CaseState {
  return {
    ...state,
    revision: state.revision + 1,
    attachedEnrichmentIds: [...state.attachedEnrichmentIds],
    executedInvestigationQueryIds: [...state.executedInvestigationQueryIds],
    preparedQuery: state.preparedQuery ? { ...state.preparedQuery } : null,
    decision: { ...state.decision },
    proposal: state.proposal ? { ...state.proposal } : null,
    releasedStreamStageIds: [...state.releasedStreamStageIds],
    observationRequest: state.observationRequest
      ? {
          ...state.observationRequest,
          targetEntityIds: [...state.observationRequest.targetEntityIds],
        }
      : null,
    responseProposal: state.responseProposal
      ? { ...state.responseProposal }
      : null,
    responseBundle: state.responseBundle
      ? {
          ...state.responseBundle,
          actionIds: [...state.responseBundle.actionIds],
        }
      : null,
    authorizedResponseBundleIds: [...state.authorizedResponseBundleIds],
    responseActions: state.responseActions.map((action) => ({ ...action })),
    report: {
      ...state.report,
      report: state.report.report
        ? {
            ...state.report.report,
            confirmedFindings: [...state.report.report.confirmedFindings],
            limitations: [...state.report.report.limitations],
            residualRisk: [...state.report.report.residualRisk],
            evidenceIds: [...state.report.report.evidenceIds],
            actionIds: [...state.report.report.actionIds],
          }
        : null,
    },
  };
}

function humanizeToolName(toolName: string): string {
  return toolName
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function caseToken(fixture: CaseFixture): string {
  return fixture.id
    .replace(/^case-/, "")
    .replace(/[^A-Za-z0-9]/g, "-")
    .toUpperCase();
}

function labelForEntity(fixture: CaseFixture, entityId: string): string {
  return (
    getAllEntities(fixture).find((entity) => entity.id === entityId)?.label ??
    entityId
  );
}

export interface InvestigationPlanDefinition {
  id: string;
  title: string;
  queryIds: readonly string[];
  requiresStageId: string | null;
  targetEntityIds: readonly string[];
}

export interface ResponseBundleDefinition {
  id: ResponseBundleId;
  title: string;
  actionIds: readonly ResponseActionId[];
  targetEntityIds: readonly string[];
  reasoning: string;
  approvalPrompt: string;
}

export function getInvestigationPlans(
  fixture: CaseFixture,
): readonly InvestigationPlanDefinition[] {
  const groups = new Map<string, CaseFixture["investigationQueries"]>();
  const tier1QueryIds = new Set(
    fixture.tier1Escalation.recommendedSteps.flatMap((step) =>
      step.investigationQueryId ? [step.investigationQueryId] : [],
    ),
  );
  for (const query of fixture.investigationQueries) {
    if (query.requiresStageId === null && !tier1QueryIds.has(query.id)) {
      continue;
    }
    const key = query.requiresStageId ?? "initial";
    const current = groups.get(key) ?? [];
    groups.set(key, [...current, query]);
  }
  return [...groups.entries()].map(([key, queries], index) => ({
    id: key === "initial" ? "tier1_initial" : `stage_${index}_verification`,
    title:
      key === "initial"
        ? "Resolve escalation evidence gaps"
        : `Investigate ${fixture.stream.stages.find((stage) => stage.id === key)?.title ?? "attached discovery"}`,
    queryIds: queries.map((query) => query.id),
    requiresStageId: key === "initial" ? null : key,
    targetEntityIds: queries.map((query) => query.targetEntityId),
  }));
}

export function getResponseBundles(
  fixture: CaseFixture,
): readonly ResponseBundleDefinition[] {
  const containment = fixture.responseActions.filter(
    (action) => action.phase === "containment",
  );
  const recovery = fixture.responseActions.filter(
    (action) => action.phase !== "containment",
  );
  const bundles: ResponseBundleDefinition[] = [];
  if (containment.length > 0) {
    bundles.push({
      id: "containment",
      title: "Preserve evidence and contain exposed paths",
      actionIds: containment.map((action) => action.id),
      targetEntityIds: [
        ...new Set(containment.map((action) => action.targetEntityId)),
      ],
      reasoning:
        "Prepare forensic collection, endpoint isolation, exact-indicator blocking, and identity disablement before analyst approval.",
      approvalPrompt: "Approve the prepared containment package?",
    });
  }
  if (recovery.length > 0) {
    bundles.push({
      id: "recovery",
      title: "Rotate exposed access and restore known-good service",
      actionIds: recovery.map((action) => action.id),
      targetEntityIds: [
        ...new Set(recovery.map((action) => action.targetEntityId)),
      ],
      reasoning:
        "Prepare the supported credential and workload recovery controls in dependency order before analyst authorization.",
      approvalPrompt: "Approve the prepared recovery package?",
    });
  }
  return bundles;
}

export interface DerivedNextStep {
  phase: "inspect" | "decide" | "scope" | "model" | "respond" | "review";
  objective: string;
  recommendedTool: CaseToolName | null;
  targetEntityId: string | null;
}

export interface CollaborationHandoff {
  currentRevision: number;
  nextOwner: "agent" | "analyst" | "complete";
  pendingGate:
    | "evidence_disposition"
    | "discovery_attachment"
    | "response_authorization"
    | "report_approval"
    | null;
  objective: string;
  exactNextTool: CaseToolName | null;
  whyNow: string;
  lastAnalystAction: string | null;
}

export function getCollaborationHandoff(
  fixture: CaseFixture,
  state: CaseState,
): CollaborationHandoff {
  const next = getDerivedNextStep(fixture, state);
  const requiredAttached = fixture.decision.requiresEnrichmentIds.filter((id) =>
    state.attachedEnrichmentIds.includes(id),
  ).length;
  const authorizedCount = state.responseActions.filter(
    (action) => action.status === "authorized_in_demo",
  ).length;
  const pendingGate =
    state.lifecycle === "closed_in_demo"
      ? null
      : state.report.status === "drafted"
        ? "report_approval"
        : state.responseBundle !== null
          ? "response_authorization"
          : next.recommendedTool === "attach_discovery_stage"
            ? "discovery_attachment"
            : next.recommendedTool === null &&
                state.decision.status === "pending"
              ? "evidence_disposition"
              : null;
  const whyNow =
    next.recommendedTool === "prepare_investigation_query"
      ? "Tier 1 identified an evidence gap; the agent must prepare the case-approved skill in the visible query console."
      : next.recommendedTool === "run_investigation_query"
        ? "The case-approved query is visible and ready to run against bounded case data."
        : next.recommendedTool === "attach_discovery_stage"
          ? "The required query evidence is attached; the agent can add the verified discovery to the case."
          : next.recommendedTool === "calculate_reachability"
            ? "The analyst disposition is recorded; modeled reach is still unknown."
            : next.recommendedTool === "simulate_control"
              ? "Modeled reach is attached; the control effect is not."
              : pendingGate === "evidence_disposition"
                ? `${requiredAttached}/${fixture.decision.requiresEnrichmentIds.length} required context records are attached.`
                : pendingGate === "discovery_attachment"
                  ? "The next provenance-backed discovery is ready for the agent to attach."
                  : pendingGate === "response_authorization"
                    ? "The response package is modeled; external execution remains disabled."
                    : pendingGate === "report_approval"
                      ? "The evidence-bound report is drafted and awaits analyst approval."
                      : state.lifecycle === "closed_in_demo"
                        ? "The evidence report and recorded response actions are approved."
                        : "The shared case revision determines the next bounded operation.";
  const lastAnalystAction =
    state.report.status === "approved_in_demo"
      ? "Approved the evidence report"
      : authorizedCount > 0
        ? `Approved ${authorizedCount} response control${authorizedCount === 1 ? "" : "s"}`
        : state.decision.status !== "pending"
          ? "Recorded the evidence disposition"
          : null;
  return {
    currentRevision: state.revision,
    nextOwner:
      state.lifecycle === "closed_in_demo"
        ? "complete"
        : next.recommendedTool === null
          ? "analyst"
          : "agent",
    pendingGate,
    objective: next.objective,
    exactNextTool: next.recommendedTool,
    whyNow,
    lastAnalystAction,
  };
}

export function getDerivedNextStep(
  fixture: CaseFixture,
  state: CaseState,
): DerivedNextStep {
  if (state.lifecycle === "closed_in_demo") {
    return {
      phase: "review",
      objective: "Review the approved evidence report and operation receipts.",
      recommendedTool: "get_case_context",
      targetEntityId: null,
    };
  }

  if (
    state.decision.status !== "pending" &&
    state.decision.status !== fixture.conclusion.requiredDecision
  ) {
    return {
      phase: "review",
      objective:
        "The recorded disposition holds this case for further evidence. Reset the case before recording another decision path.",
      recommendedTool: "get_case_context",
      targetEntityId: null,
    };
  }

  const attached = new Set(state.attachedEnrichmentIds);
  const visibleEnrichments = getVisibleEnrichments(fixture, state);
  const nextDiscovery = getNextStreamStage(fixture, state);
  if (
    nextDiscovery &&
    containmentAuthorizationSatisfied(fixture, state, nextDiscovery) &&
    nextDiscovery.admission.requiredEnrichmentIds.every((id) =>
      attached.has(id),
    ) &&
    nextDiscovery.admission.sourceQueryIds.every((id) =>
      state.executedInvestigationQueryIds.includes(id),
    )
  ) {
    return {
      phase: "inspect",
      objective: `Add ${nextDiscovery.title.toLowerCase()} to the shared case.`,
      recommendedTool: "attach_discovery_stage",
      targetEntityId:
        nextDiscovery.entities[0]?.id ??
        nextDiscovery.events.at(-1)?.entityIds.at(-1) ??
        null,
    };
  }
  const nextPlan = getInvestigationPlans(fixture).find(
    (plan) =>
      (plan.requiresStageId === null ||
        state.releasedStreamStageIds.includes(plan.requiresStageId)) &&
      plan.queryIds.some((queryId) => {
        const query = fixture.investigationQueries.find(
          (candidate) => candidate.id === queryId,
        );
        return query
          ? !state.executedInvestigationQueryIds.includes(query.id)
          : false;
      }),
  );
  if (nextPlan) {
    const nextQuery = nextPlan.queryIds
      .map((queryId) =>
        fixture.investigationQueries.find(
          (candidate) => candidate.id === queryId,
        ),
      )
      .find(
        (query): query is CaseFixture["investigationQueries"][number] =>
          query !== undefined &&
          !state.executedInvestigationQueryIds.includes(query.id),
      );
    const preparedQuery = state.preparedQuery
      ? fixture.investigationQueries.find(
          (query) => query.id === state.preparedQuery?.queryId,
        )
      : null;
    const query =
      preparedQuery &&
      !state.executedInvestigationQueryIds.includes(preparedQuery.id)
        ? preparedQuery
        : nextQuery;
    return {
      phase: "inspect",
      objective: query?.title ?? nextPlan.title,
      recommendedTool:
        query && state.preparedQuery?.queryId === query.id
          ? "run_investigation_query"
          : "prepare_investigation_query",
      targetEntityId:
        query?.targetEntityId ?? nextPlan.targetEntityIds[0] ?? null,
    };
  }
  const nextRequiredEnrichment = fixture.conclusion.requiredEnrichmentIds
    .map((id) => visibleEnrichments.find((artifact) => artifact.id === id))
    .find(
      (artifact): artifact is EnrichmentArtifact =>
        artifact !== undefined && !attached.has(artifact.id),
    );
  if (nextRequiredEnrichment) {
    return {
      phase: "inspect",
      objective: `Attach ${nextRequiredEnrichment.title.toLowerCase()} for ${labelForEntity(fixture, nextRequiredEnrichment.entityId)}.`,
      recommendedTool: nextRequiredEnrichment.toolName,
      targetEntityId: nextRequiredEnrichment.entityId,
    };
  }

  if (state.decision.status === "pending") {
    const hiddenDecisionContext = fixture.decision.requiresEnrichmentIds.some(
      (artifactId) =>
        !attached.has(artifactId) &&
        !visibleEnrichments.some((artifact) => artifact.id === artifactId),
    );
    if (
      hiddenDecisionContext &&
      state.releasedStreamStageIds.length < fixture.stream.stages.length
    ) {
      return {
        phase: "inspect",
        objective:
          state.observationRequest?.status === "pending"
            ? "The requested observation is pending."
            : "Run the required investigation query before adding the next verified discovery.",
        recommendedTool: null,
        targetEntityId: null,
      };
    }
    return {
      phase: "decide",
      objective: fixture.decision.question,
      recommendedTool: null,
      targetEntityId: fixture.reachability.sourceEntityId,
    };
  }

  const requiresImpactModel =
    fixture.impact.atRiskEntityIds.length > 0 ||
    fixture.responseActions.length > 0;

  if (requiresImpactModel && !state.reachabilityAttached) {
    return {
      phase: "scope",
      objective:
        "Map deterministic candidate risk segments downstream of the observed entry point.",
      recommendedTool: "calculate_reachability",
      targetEntityId: fixture.reachability.sourceEntityId,
    };
  }

  if (requiresImpactModel && !state.counterfactualAttached) {
    return {
      phase: "model",
      objective:
        "Model the case-defined response against the current impact paths.",
      recommendedTool: "simulate_control",
      targetEntityId: fixture.counterfactual.changedEntityId,
    };
  }

  if (state.responseBundle) {
    const bundle = getResponseBundles(fixture).find(
      (candidate) => candidate.id === state.responseBundle?.bundleId,
    );
    return {
      phase: "respond",
      objective: `${bundle?.title ?? "Response package"} requires analyst authorization.`,
      recommendedTool: null,
      targetEntityId: bundle?.targetEntityIds[0] ?? null,
    };
  }

  const nextBundle = getResponseBundles(fixture).find(
    (bundle) =>
      !state.authorizedResponseBundleIds.includes(bundle.id) &&
      bundle.actionIds.some(
        (actionId) =>
          state.responseActions.find((action) => action.actionId === actionId)
            ?.status === "available",
      ) &&
      bundle.actionIds.every((actionId) => {
        const definition = fixture.responseActions.find(
          (action) => action.id === actionId,
        );
        return definition?.dependsOnActionIds.every(
          (dependencyId) =>
            bundle.actionIds.includes(dependencyId) ||
            state.responseActions.find(
              (action) => action.actionId === dependencyId,
            )?.status === "authorized_in_demo",
        );
      }),
  );
  if (nextBundle) {
    return {
      phase: "respond",
      objective: `Prepare ${nextBundle.title.toLowerCase()} for analyst review.`,
      recommendedTool: "prepare_response_bundle",
      targetEntityId: nextBundle.targetEntityIds[0] ?? null,
    };
  }

  const nextVisibleEnrichment = visibleEnrichments.find(
    (artifact) => !attached.has(artifact.id),
  );
  if (nextVisibleEnrichment) {
    const query = fixture.investigationQueries.find(
      (candidate) =>
        candidate.resultArtifactId === nextVisibleEnrichment.id &&
        (candidate.requiresStageId === null ||
          state.releasedStreamStageIds.includes(candidate.requiresStageId)),
    );
    return {
      phase: "inspect",
      objective: query
        ? query.title
        : `Attach ${nextVisibleEnrichment.title.toLowerCase()} for ${labelForEntity(fixture, nextVisibleEnrichment.entityId)}.`,
      recommendedTool: query
        ? state.preparedQuery?.queryId === query.id
          ? "run_investigation_query"
          : "prepare_investigation_query"
        : nextVisibleEnrichment.toolName,
      targetEntityId: nextVisibleEnrichment.entityId,
    };
  }

  const responseState = state.responseActions.find(
    (action) =>
      action.status === "available" ||
      action.status === "proposed" ||
      action.status === "simulated",
  );
  const responseDefinition = responseState
    ? fixture.responseActions.find(
        (action) => action.id === responseState.actionId,
      )
    : null;
  if (responseState && responseDefinition) {
    const unmetDependency = responseDefinition.dependsOnActionIds.find(
      (id) =>
        state.responseActions.find((action) => action.actionId === id)
          ?.status !== "authorized_in_demo",
    );
    if (unmetDependency) {
      return {
        phase: "respond",
        objective: `Complete ${unmetDependency.replaceAll("_", " ")} before ${responseDefinition.title.toLowerCase()}.`,
        recommendedTool: null,
        targetEntityId: responseDefinition.targetEntityId,
      };
    }
    if (responseState.status === "available") {
      return {
        phase: "respond",
        objective: `Prepare a bounded response for ${responseDefinition.title.toLowerCase()}.`,
        recommendedTool: "propose_response_action",
        targetEntityId: responseDefinition.targetEntityId,
      };
    }
    if (responseState.status === "proposed") {
      return {
        phase: "respond",
        objective: `Model the effect of ${responseDefinition.title.toLowerCase()}.`,
        recommendedTool: "simulate_response_action",
        targetEntityId: responseDefinition.targetEntityId,
      };
    }
    return {
      phase: "respond",
      objective: `Analyst authorization is required for ${responseDefinition.title.toLowerCase()}.`,
      recommendedTool: null,
      targetEntityId: responseDefinition.targetEntityId,
    };
  }

  if (state.releasedStreamStageIds.length < fixture.stream.stages.length) {
    return {
      phase: "respond",
      objective:
        "Run the required investigation query before adding the next verified discovery.",
      recommendedTool: null,
      targetEntityId: null,
    };
  }

  if (state.report.status === "unavailable") {
    return {
      phase: "respond",
      objective:
        "Assemble the deterministic case evidence report for analyst approval.",
      recommendedTool: "generate_case_report",
      targetEntityId: null,
    };
  }

  return {
    phase: "review",
    objective: "Analyst approval is required to close the case report.",
    recommendedTool: "get_case_context",
    targetEntityId: null,
  };
}

function executeRead(
  fixture: CaseFixture,
  state: CaseState,
  request: CaseToolRequest,
): ToolOutcome | null {
  const { input, toolName } = request;
  const visibleEntities = getVisibleEntities(fixture, state);
  const visibleEvents = getVisibleEvents(fixture, state);
  const visibleJoins = getVisibleJoins(fixture, state);
  const visibleEnrichments = getVisibleEnrichments(fixture, state);

  if (toolName === "list_alerts") {
    const invalid = validateInput(input, [], []);
    if (invalid) return fail(state, toolName, invalid);
    return success(
      state,
      { alerts: fixture.alerts, count: fixture.alerts.length },
      {
        title: "Listed case alerts",
        target: fixture.id,
        resultSummary: `${fixture.alerts.length} alert objects returned`,
      },
    );
  }

  if (toolName === "get_case_context") {
    const invalid = validateInput(input, [], []);
    if (invalid) return fail(state, toolName, invalid);
    const attachedEnrichments = visibleEnrichments.filter((artifact) =>
      state.attachedEnrichmentIds.includes(artifact.id),
    );
    const approvedSkills = getApprovedInvestigationSkills(fixture, state);
    const releasedResponseActions = state.responseActions.filter(
      (actionState) => {
        const definition = fixture.responseActions.find(
          (action) => action.id === actionState.actionId,
        );
        return (
          definition !== undefined &&
          state.releasedStreamStageIds.includes(definition.requiresStageId)
        );
      },
    );
    return success(
      state,
      {
        caseId: fixture.id,
        revision: state.revision,
        lifecycle: state.lifecycle,
        unresolvedQuestion:
          state.decision.status === "pending"
            ? fixture.decision.question
            : null,
        evidenceEventIds: visibleEvents.map((event) => event.id),
        correlationIds: visibleJoins.map((join) => join.id),
        attachedEnrichmentIds: attachedEnrichments.map(
          (artifact) => artifact.id,
        ),
        executedInvestigationQueryIds: state.executedInvestigationQueryIds,
        decisionStatus: state.decision.status,
        reachabilityAttached: state.reachabilityAttached,
        counterfactualAttached: state.counterfactualAttached,
        report: state.report,
        stream: {
          cursor: state.releasedStreamStageIds.length,
          releasedStageIds: state.releasedStreamStageIds,
          latestObservedEventId: visibleEvents.at(-1)?.id ?? null,
        },
        discoveries: {
          nextStageId: getNextStreamStage(fixture, state)?.id ?? null,
          available: fixture.stream.stages.map((stage) => {
            const attached = state.releasedStreamStageIds.includes(stage.id);
            const containmentReady = containmentAuthorizationSatisfied(
              fixture,
              state,
              stage,
            );
            const evidenceReady =
              stage.admission.requiredEnrichmentIds.every((id) =>
                state.attachedEnrichmentIds.includes(id),
              ) &&
              stage.admission.sourceQueryIds.every((id) =>
                state.executedInvestigationQueryIds.includes(id),
              );
            const isNext = stage.id === getNextStreamStage(fixture, state)?.id;
            return {
              id: stage.id,
              title: stage.title,
              requiredEnrichmentIds: stage.admission.requiredEnrichmentIds,
              sourceQueryIds: stage.admission.sourceQueryIds,
              progress: attached
                ? "attached"
                : isNext && containmentReady && evidenceReady
                  ? "ready"
                  : "blocked",
              blocker: attached
                ? null
                : !containmentReady
                  ? "containment_authorization_required"
                  : !evidenceReady
                    ? "required_query_evidence"
                    : null,
            };
          }),
        },
        responseActions: releasedResponseActions,
        tier1Handoff: {
          id: fixture.tier1Escalation.id,
          confidence: fixture.tier1Escalation.confidence,
          escalationReason: fixture.tier1Escalation.escalationReason,
          observations: fixture.tier1Escalation.observations,
          recommendedSteps: fixture.tier1Escalation.recommendedSteps.map(
            (step) => ({
              ...step,
              progress:
                step.completionArtifactId !== null &&
                state.attachedEnrichmentIds.includes(step.completionArtifactId)
                  ? "attached"
                  : "recommended",
            }),
          ),
          unresolvedQuestions: fixture.tier1Escalation.unresolvedQuestions,
          actionsWithheld: fixture.tier1Escalation.actionsWithheld,
        },
        queryWorkset: {
          synthetic: true,
          prepared: state.preparedQuery,
          available: fixture.investigationQueries
            .filter(
              (query) =>
                query.requiresStageId === null ||
                state.releasedStreamStageIds.includes(query.requiresStageId),
            )
            .map((query) => ({
              id: query.id,
              title: query.title,
              question: query.question,
              objective: query.objective,
              targetEntityId: query.targetEntityId,
              language: getQueryConsoleContract(query.id)?.language ?? "KQL",
              sourceLabels: query.sourceScopes.map(
                (scope) => scope.sourceLabel,
              ),
              syntheticRecordCount: query.sourceScopes.reduce(
                (total, scope) => total + scope.syntheticRecordCount,
                0,
              ),
              queryTextAvailableVia: "prepare_investigation_query",
              progress:
                state.attachedEnrichmentIds.includes(query.resultArtifactId) &&
                state.executedInvestigationQueryIds.includes(query.id)
                  ? "attached"
                  : "available",
            })),
          blockedCount: fixture.investigationQueries.filter(
            (query) =>
              query.requiresStageId !== null &&
              !state.releasedStreamStageIds.includes(query.requiresStageId),
          ).length,
        },
        investigationSkillCatalog: {
          tool: "list_investigation_skills",
          availableCount: approvedSkills.filter(
            (skill) => skill.availability === "available",
          ).length,
          blockedCount: approvedSkills.filter(
            (skill) => skill.availability === "blocked",
          ).length,
        },
        investigationPlans: getInvestigationPlans(fixture).map((plan) => ({
          ...plan,
          progress: plan.queryIds.every((queryId) => {
            return state.executedInvestigationQueryIds.includes(queryId);
          })
            ? "complete"
            : plan.requiresStageId === null ||
                state.releasedStreamStageIds.includes(plan.requiresStageId)
              ? "available"
              : "blocked",
        })),
        observationRequest: state.observationRequest,
        responsePackages: getResponseBundles(fixture).map((bundle) => ({
          ...bundle,
          progress: state.authorizedResponseBundleIds.includes(bundle.id)
            ? "authorized"
            : state.responseBundle?.bundleId === bundle.id
              ? "prepared"
              : bundle.actionIds.some(
                    (actionId) =>
                      state.responseActions.find(
                        (action) => action.actionId === actionId,
                      )?.status === "available",
                  )
                ? "available"
                : "blocked",
        })),
        nextStep: getDerivedNextStep(fixture, state),
        collaborationHandoff: getCollaborationHandoff(fixture, state),
      },
      {
        title: "Read case context",
        target: fixture.id,
        resultSummary: `Context read at revision ${state.revision}`,
      },
    );
  }

  if (toolName === "list_investigation_skills") {
    const invalid = validateInput(input, [], []);
    if (invalid) return fail(state, toolName, invalid);
    const skills = getApprovedInvestigationSkills(fixture, state);
    const available = skills.filter(
      (skill) => skill.availability === "available",
    );
    return success(
      state,
      {
        skills: available,
        blockedSkillCount: skills.length - available.length,
        executionContract:
          "Choose one returned skill ID, then call prepare_investigation_query with the same queryId. Preparation returns the immutable query text required by run_investigation_query.",
      },
      {
        title: "Listed approved investigation skills",
        target: fixture.id,
        resultSummary: `${available.length} allowlisted skills available`,
      },
    );
  }

  if (toolName === "get_case_delta") {
    const invalid = validateInput(input, ["sinceCursor"], ["sinceCursor"]);
    if (invalid) return fail(state, toolName, invalid);
    if (
      !Number.isInteger(input.sinceCursor) ||
      Number(input.sinceCursor) < 0 ||
      Number(input.sinceCursor) > fixture.stream.stages.length
    ) {
      return fail(
        state,
        toolName,
        `sinceCursor must be an integer from 0 to ${fixture.stream.stages.length}.`,
      );
    }
    const appliedStages = getAppliedStreamStages(fixture, state);
    const updates = appliedStages.slice(Number(input.sinceCursor));
    return success(
      state,
      {
        previousCursor: input.sinceCursor,
        cursor: appliedStages.length,
        updates,
      },
      {
        title: "Read case delta",
        target: fixture.id,
        resultSummary: `${updates.length} released telemetry updates returned`,
      },
    );
  }

  if (toolName === "inspect_event") {
    const invalid = validateInput(input, ["eventId"], ["eventId"]);
    if (invalid) return fail(state, toolName, invalid);
    if (typeof input.eventId !== "string") {
      return fail(state, toolName, "eventId must be a string.");
    }
    const event = visibleEvents.find((item) => item.id === input.eventId);
    if (!event) {
      return fail(
        state,
        toolName,
        `Event '${input.eventId}' is not available in the released case state.`,
        "EVENT_NOT_AVAILABLE",
      );
    }
    const entities = visibleEntities.filter((entity) =>
      event.entityIds.includes(entity.id),
    );
    const joins = visibleJoins.filter((join) =>
      join.evidenceIds.includes(event.id),
    );
    return success(
      state,
      { event, entities, joins },
      {
        title: "Inspected observed event",
        target: event.id,
        resultSummary: `${entities.length} entities and ${joins.length} joins returned`,
      },
    );
  }

  if (toolName === "inspect_entity" || toolName === "focus_entity") {
    const invalid = validateInput(input, ["entityId"], ["entityId"]);
    if (invalid) return fail(state, toolName, invalid);
    if (typeof input.entityId !== "string") {
      return fail(state, toolName, "entityId must be a string.");
    }
    const entity = visibleEntities.find((item) => item.id === input.entityId);
    if (!entity) {
      return fail(
        state,
        toolName,
        `Unknown entity '${input.entityId}'.`,
        "ENTITY_NOT_FOUND",
      );
    }
    const eventIds = visibleEvents
      .filter((event) => event.entityIds.includes(entity.id))
      .map((event) => event.id);
    const joinIds = visibleJoins
      .filter(
        (join) =>
          join.fromEntityId === entity.id || join.toEntityId === entity.id,
      )
      .map((join) => join.id);
    return success(
      state,
      { entity, eventIds, joinIds, focusEntityId: entity.id },
      {
        title:
          toolName === "focus_entity" ? "Focused entity" : "Inspected entity",
        target: entity.label,
        resultSummary: `${eventIds.length} events and ${joinIds.length} joins returned`,
      },
    );
  }

  if (toolName === "inspect_relationship") {
    const invalid = validateInput(
      input,
      ["relationshipId"],
      ["relationshipId"],
    );
    if (invalid) return fail(state, toolName, invalid);
    if (typeof input.relationshipId !== "string") {
      return fail(state, toolName, "relationshipId must be a string.");
    }
    const relationship = visibleJoins.find(
      (join) => join.id === input.relationshipId,
    );
    if (!relationship) {
      return fail(
        state,
        toolName,
        `Unknown relationship '${input.relationshipId}'.`,
        "RELATIONSHIP_NOT_FOUND",
      );
    }
    return success(
      state,
      { relationship },
      {
        title: "Inspected evidence join",
        target: relationship.id,
        resultSummary: `${relationship.matchField} matched across ${relationship.evidenceIds.length} records`,
      },
    );
  }

  if (toolName === "search_events") {
    const invalid = validateInput(
      input,
      ["entityId", "sourceCategory", "action", "limit"],
      [],
    );
    if (invalid) return fail(state, toolName, invalid);
    const limit = input.limit === undefined ? 20 : input.limit;
    if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 50) {
      return fail(state, toolName, "limit must be an integer from 1 to 50.");
    }
    if (
      input.entityId !== undefined &&
      (typeof input.entityId !== "string" ||
        !visibleEntities.some((entity) => entity.id === input.entityId))
    ) {
      return fail(state, toolName, "entityId is not part of this case.");
    }
    const allowedCategories = new Set([
      "identity_telemetry",
      "cloud_audit",
      "endpoint_telemetry",
      "windows_authentication",
      "static_analysis",
      "asset_inventory",
      "identity_directory",
      "network_inventory",
    ]);
    if (
      input.sourceCategory !== undefined &&
      (typeof input.sourceCategory !== "string" ||
        !allowedCategories.has(input.sourceCategory))
    ) {
      return fail(state, toolName, "sourceCategory is invalid.");
    }
    if (
      input.action !== undefined &&
      (typeof input.action !== "string" || input.action.length > 80)
    ) {
      return fail(
        state,
        toolName,
        "action must contain at most 80 characters.",
      );
    }
    const events = visibleEvents
      .filter(
        (event) =>
          (input.entityId === undefined ||
            event.entityIds.includes(String(input.entityId))) &&
          (input.sourceCategory === undefined ||
            event.sourceCategory === input.sourceCategory) &&
          (input.action === undefined || event.action === input.action),
      )
      .slice(0, Number(limit));
    return success(
      state,
      { events, count: events.length, limit },
      {
        title: "Searched observed events",
        target:
          typeof input.entityId === "string"
            ? labelForEntity(fixture, input.entityId)
            : fixture.id,
        resultSummary: `${events.length} observed events returned`,
      },
    );
  }

  if (toolName === "find_first_occurrence") {
    const invalid = validateInput(input, ["entityId"], ["entityId"]);
    if (invalid) return fail(state, toolName, invalid);
    if (typeof input.entityId !== "string") {
      return fail(state, toolName, "entityId must be a string.");
    }
    const entity = visibleEntities.find((item) => item.id === input.entityId);
    if (!entity) {
      return fail(
        state,
        toolName,
        `Unknown entity '${input.entityId}'.`,
        "ENTITY_NOT_FOUND",
      );
    }
    const event = visibleEvents.find((item) =>
      item.entityIds.includes(entity.id),
    );
    return success(
      state,
      { entityId: entity.id, event: event ?? null },
      {
        title: "Found first occurrence",
        target: entity.label,
        resultSummary: event
          ? `${event.id} at ${event.timestamp}`
          : "No event found",
      },
    );
  }

  if (toolName === "compare_timepoints") {
    const invalid = validateInput(
      input,
      ["fromEventId", "toEventId"],
      ["fromEventId", "toEventId"],
    );
    if (invalid) return fail(state, toolName, invalid);
    if (
      typeof input.fromEventId !== "string" ||
      typeof input.toEventId !== "string"
    ) {
      return fail(state, toolName, "Event IDs must be strings.");
    }
    const fromIndex = visibleEvents.findIndex(
      (event) => event.id === input.fromEventId,
    );
    const toIndex = visibleEvents.findIndex(
      (event) => event.id === input.toEventId,
    );
    if (fromIndex < 0 || toIndex < 0 || fromIndex > toIndex) {
      return fail(
        state,
        toolName,
        "Event IDs must define an ordered interval in this case.",
      );
    }
    const events = visibleEvents.slice(fromIndex, toIndex + 1);
    const entityIds = [...new Set(events.flatMap((event) => event.entityIds))];
    return success(
      state,
      {
        fromEventId: input.fromEventId,
        toEventId: input.toEventId,
        events,
        entityIds,
      },
      {
        title: "Compared timepoints",
        target: `${input.fromEventId} → ${input.toEventId}`,
        resultSummary: `${events.length} events and ${entityIds.length} entities in interval`,
      },
    );
  }

  if (toolName === "query_related_activity") {
    const invalid = validateInput(
      input,
      ["entityId", "beforeMinutes", "afterMinutes"],
      ["entityId", "beforeMinutes", "afterMinutes"],
    );
    if (invalid) return fail(state, toolName, invalid);
    if (
      typeof input.entityId !== "string" ||
      !visibleEntities.some((entity) => entity.id === input.entityId)
    ) {
      return fail(state, toolName, "entityId is not part of this case.");
    }
    if (
      !Number.isInteger(input.beforeMinutes) ||
      !Number.isInteger(input.afterMinutes) ||
      Number(input.beforeMinutes) < 0 ||
      Number(input.beforeMinutes) > 60 ||
      Number(input.afterMinutes) < 0 ||
      Number(input.afterMinutes) > 60
    ) {
      return fail(
        state,
        toolName,
        "Activity windows must be integers from 0 to 60 minutes.",
      );
    }
    const anchor = visibleEvents.find((event) =>
      event.entityIds.includes(String(input.entityId)),
    );
    const anchorTime = anchor ? Date.parse(anchor.timestamp) : NaN;
    const start = anchorTime - Number(input.beforeMinutes) * 60_000;
    const end = anchorTime + Number(input.afterMinutes) * 60_000;
    const events = visibleEvents.filter((event) => {
      const timestamp = Date.parse(event.timestamp);
      return timestamp >= start && timestamp <= end;
    });
    return success(
      state,
      { anchorEventId: anchor?.id ?? null, events },
      {
        title: "Queried related activity",
        target: labelForEntity(fixture, input.entityId),
        resultSummary: `${events.length} events in the selected window`,
      },
    );
  }

  return null;
}

function attachEnrichment(
  fixture: CaseFixture,
  state: CaseState,
  request: CaseToolRequest,
): ToolOutcome {
  const invalid = validateInput(
    request.input,
    ["expectedRevision", "entityId"],
    ["expectedRevision", "entityId"],
  );
  if (invalid) return fail(state, request.toolName, invalid);
  const guarded = writeGuard(state, request.input, request.toolName);
  if (guarded) return guarded;
  if (typeof request.input.entityId !== "string") {
    return fail(state, request.toolName, "entityId must be a string.");
  }
  const artifact = getVisibleEnrichments(fixture, state).find(
    (item) =>
      item.toolName === request.toolName &&
      item.entityId === request.input.entityId,
  );
  if (!artifact) {
    return fail(
      state,
      request.toolName,
      "This tool and entity combination is not available in the current case.",
      "UNSUPPORTED_SCOPE",
    );
  }
  if (state.attachedEnrichmentIds.includes(artifact.id)) {
    return fail(
      state,
      request.toolName,
      `${artifact.id} is already attached.`,
      "ALREADY_ATTACHED",
    );
  }
  const updated = nextState(state);
  updated.attachedEnrichmentIds.push(artifact.id);
  const preparedDefinition = state.preparedQuery
    ? fixture.investigationQueries.find(
        (query) => query.id === state.preparedQuery?.queryId,
      )
    : null;
  if (preparedDefinition?.resultArtifactId === artifact.id) {
    updated.preparedQuery = null;
  }
  return success(
    updated,
    { artifact },
    {
      title: artifact.title,
      target: labelForEntity(fixture, artifact.entityId),
      resultSummary: `${artifact.id} attached from ${artifact.sourceLabel}`,
    },
    true,
  );
}

function runInvestigationQuery(
  fixture: CaseFixture,
  state: CaseState,
  request: CaseToolRequest,
): ToolOutcome {
  const invalid = validateInput(
    request.input,
    ["expectedRevision", "queryId", "queryText"],
    ["expectedRevision", "queryId", "queryText"],
  );
  if (invalid) return fail(state, request.toolName, invalid);
  const guarded = writeGuard(state, request.input, request.toolName);
  if (guarded) return guarded;
  if (typeof request.input.queryId !== "string") {
    return fail(state, request.toolName, "queryId must be a string.");
  }
  if (typeof request.input.queryText !== "string") {
    return fail(state, request.toolName, "queryText must be a string.");
  }
  if (
    request.input.queryText.length > 1024 ||
    !matchesQueryConsoleContract(request.input.queryId, request.input.queryText)
  ) {
    return fail(
      state,
      request.toolName,
      "queryText does not match the selected case-approved query.",
      "QUERY_TEXT_MISMATCH",
    );
  }
  const query = fixture.investigationQueries.find(
    (candidate) => candidate.id === request.input.queryId,
  );
  if (!query) {
    return fail(
      state,
      request.toolName,
      "queryId is not part of the current case query catalog.",
      "QUERY_NOT_FOUND",
    );
  }
  if (
    query.requiresStageId !== null &&
    !state.releasedStreamStageIds.includes(query.requiresStageId)
  ) {
    return fail(
      state,
      request.toolName,
      "The query depends on telemetry that has not been added to the case.",
      "QUERY_NOT_AVAILABLE",
    );
  }
  const artifact = getVisibleEnrichments(fixture, state).find(
    (candidate) => candidate.id === query.resultArtifactId,
  );
  if (!artifact) {
    return fail(
      state,
      request.toolName,
      "The query result is unavailable in the current bounded case state.",
      "QUERY_RESULT_UNAVAILABLE",
    );
  }
  if (state.executedInvestigationQueryIds.includes(query.id)) {
    return fail(
      state,
      request.toolName,
      `${query.id} has already executed and attached ${artifact.id}.`,
      "ALREADY_ATTACHED",
    );
  }
  if (state.preparedQuery?.queryId !== query.id) {
    return fail(
      state,
      request.toolName,
      "Prepare this query in the shared investigation console before execution.",
      "QUERY_PREPARATION_REQUIRED",
    );
  }
  if (state.preparedQuery.preparedAtRevision !== state.revision) {
    return fail(
      state,
      request.toolName,
      "The prepared query is stale. Prepare it again against the current shared case revision.",
      "QUERY_PREPARATION_STALE",
    );
  }
  const syntheticRecordCount = query.sourceScopes.reduce(
    (total, scope) => total + scope.syntheticRecordCount,
    0,
  );
  const updated = nextState(state);
  if (!updated.attachedEnrichmentIds.includes(artifact.id)) {
    updated.attachedEnrichmentIds.push(artifact.id);
  }
  updated.executedInvestigationQueryIds.push(query.id);
  if (state.preparedQuery?.queryId === query.id) {
    updated.preparedQuery = null;
  }
  return success(
    updated,
    {
      query,
      returnedRecords: query.returnedRecords,
      execution: {
        synthetic: true,
        syntheticRecordCount,
        matchedRecordCount: query.matchedRecordCount,
        returnedRecordCount: query.returnedRecordCount,
      },
      artifact,
    },
    {
      title: query.title,
      target: labelForEntity(fixture, query.targetEntityId),
      resultSummary: `${query.matchedRecordCount} matches from ${syntheticRecordCount.toLocaleString("en-US")} records searched · result added`,
    },
    true,
  );
}

function prepareInvestigationQuery(
  fixture: CaseFixture,
  state: CaseState,
  request: CaseToolRequest,
): ToolOutcome {
  const invalid = validateInput(
    request.input,
    ["expectedRevision", "queryId"],
    ["expectedRevision", "queryId"],
  );
  if (invalid) return fail(state, request.toolName, invalid);
  const guarded = writeGuard(state, request.input, request.toolName);
  if (guarded) return guarded;
  if (typeof request.input.queryId !== "string") {
    return fail(state, request.toolName, "queryId must be a string.");
  }
  const query = fixture.investigationQueries.find(
    (candidate) => candidate.id === request.input.queryId,
  );
  if (!query) {
    return fail(
      state,
      request.toolName,
      "queryId is not part of this case query catalog.",
      "QUERY_NOT_FOUND",
    );
  }
  if (
    query.requiresStageId !== null &&
    !state.releasedStreamStageIds.includes(query.requiresStageId)
  ) {
    return fail(
      state,
      request.toolName,
      "The query depends on telemetry that has not been released.",
      "QUERY_NOT_AVAILABLE",
    );
  }
  if (state.executedInvestigationQueryIds.includes(query.id)) {
    return fail(
      state,
      request.toolName,
      `${query.id} has already executed and attached ${query.resultArtifactId}.`,
      "ALREADY_ATTACHED",
    );
  }
  if (state.preparedQuery?.queryId === query.id) {
    return fail(
      state,
      request.toolName,
      `${query.id} is already loaded in the shared investigation console.`,
      "ALREADY_PREPARED",
    );
  }
  const consoleContract = getQueryConsoleContract(query.id);
  if (!consoleContract) {
    return fail(
      state,
      request.toolName,
      "The query console contract is unavailable.",
      "QUERY_NOT_AVAILABLE",
    );
  }
  const updated = nextState(state);
  updated.preparedQuery = {
    queryId: query.id,
    targetEntityId: query.targetEntityId,
    actor: request.reportedSurface === "webmcp_callback" ? "agent" : "analyst",
    preparedAtRevision: updated.revision,
    preparedAt: deterministicTimestamp(updated.revision),
  };
  return success(
    updated,
    {
      queryId: query.id,
      targetEntityId: query.targetEntityId,
      title: query.title,
      language: consoleContract.language,
      queryText: consoleContract.text,
      sourceScopes: query.sourceScopes,
      executable: true,
    },
    {
      title: `Prepared ${query.title}`,
      target: labelForEntity(fixture, query.targetEntityId),
      resultSummary: "Query loaded into the shared investigation console",
    },
    true,
  );
}

function runInvestigationPlan(
  fixture: CaseFixture,
  state: CaseState,
  request: CaseToolRequest,
): ToolOutcome {
  const invalid = validateInput(
    request.input,
    ["expectedRevision", "planId"],
    ["expectedRevision", "planId"],
  );
  if (invalid) return fail(state, request.toolName, invalid);
  const guarded = writeGuard(state, request.input, request.toolName);
  if (guarded) return guarded;
  if (typeof request.input.planId !== "string") {
    return fail(state, request.toolName, "planId must be a string.");
  }
  const plan = getInvestigationPlans(fixture).find(
    (candidate) => candidate.id === request.input.planId,
  );
  if (!plan) {
    return fail(
      state,
      request.toolName,
      "planId is not part of the current case investigation catalog.",
      "PLAN_NOT_FOUND",
    );
  }
  if (
    plan.requiresStageId !== null &&
    !state.releasedStreamStageIds.includes(plan.requiresStageId)
  ) {
    return fail(
      state,
      request.toolName,
      "The plan depends on telemetry that has not been released.",
      "PLAN_NOT_AVAILABLE",
    );
  }

  const planQueries: CaseFixture["investigationQueries"][number][] = [];
  for (const queryId of plan.queryIds) {
    const query = fixture.investigationQueries.find(
      (candidate) => candidate.id === queryId,
    );
    if (!query) {
      return fail(
        state,
        request.toolName,
        `Plan query '${queryId}' is missing from the fixture.`,
        "INVALID_FIXTURE",
      );
    }
    planQueries.push(query);
  }
  const unresolvedQueries = planQueries.filter(
    (query) => !state.executedInvestigationQueryIds.includes(query.id),
  );
  const query = unresolvedQueries[0];
  if (!query) {
    return fail(
      state,
      request.toolName,
      "Every result in this investigation plan is already attached.",
      "ALREADY_ATTACHED",
    );
  }
  const artifact = getVisibleEnrichments(fixture, state).find(
    (candidate) => candidate.id === query.resultArtifactId,
  );
  if (!artifact) {
    return fail(
      state,
      request.toolName,
      `Result for '${query.id}' is unavailable in the current case state.`,
      "PLAN_RESULT_UNAVAILABLE",
    );
  }
  if (state.preparedQuery?.queryId !== query.id) {
    return fail(
      state,
      request.toolName,
      "Prepare the plan's next query in the shared investigation console before execution.",
      "QUERY_PREPARATION_REQUIRED",
    );
  }
  if (state.preparedQuery.preparedAtRevision !== state.revision) {
    return fail(
      state,
      request.toolName,
      "The prepared plan query is stale. Prepare it again against the current shared case revision.",
      "QUERY_PREPARATION_STALE",
    );
  }
  const syntheticRecordCount = query.sourceScopes.reduce(
    (total, scope) => total + scope.syntheticRecordCount,
    0,
  );
  const completedCount = planQueries.length - unresolvedQueries.length + 1;
  const remainingCount = unresolvedQueries.length - 1;
  const nextQueryId = unresolvedQueries[1]?.id ?? null;

  const updated = nextState(state);
  if (!updated.attachedEnrichmentIds.includes(artifact.id)) {
    updated.attachedEnrichmentIds.push(artifact.id);
  }
  updated.executedInvestigationQueryIds.push(query.id);
  if (state.preparedQuery?.queryId === query.id) {
    updated.preparedQuery = null;
  }
  return success(
    updated,
    {
      planId: plan.id,
      queryId: query.id,
      targetEntityId: query.targetEntityId,
      completedCount,
      totalCount: planQueries.length,
      remainingCount,
      nextQueryId,
      artifact,
      returnedRecords: query.returnedRecords,
      execution: {
        synthetic: true,
        syntheticRecordCount,
        matchedRecordCount: query.matchedRecordCount,
        returnedRecordCount: query.returnedRecordCount,
      },
    },
    {
      title: query.title,
      target: labelForEntity(fixture, query.targetEntityId),
      resultSummary: `${completedCount}/${planQueries.length} results added · ${query.matchedRecordCount} matches from ${syntheticRecordCount.toLocaleString("en-US")} records searched`,
    },
    true,
  );
}

function prepareResponseBundle(
  fixture: CaseFixture,
  state: CaseState,
  request: CaseToolRequest,
): ToolOutcome {
  const invalid = validateInput(
    request.input,
    ["expectedRevision", "bundleId"],
    ["expectedRevision", "bundleId"],
  );
  if (invalid) return fail(state, request.toolName, invalid);
  const guarded = writeGuard(state, request.input, request.toolName);
  if (guarded) return guarded;
  const bundle = getResponseBundles(fixture).find(
    (candidate) => candidate.id === request.input.bundleId,
  );
  if (!bundle) {
    return fail(
      state,
      request.toolName,
      "bundleId is not part of the current case response catalog.",
      "BUNDLE_NOT_FOUND",
    );
  }
  if (state.responseBundle || state.responseProposal) {
    return fail(
      state,
      request.toolName,
      "Complete the active response proposal before preparing another package.",
      "ACTION_STATE_CONFLICT",
    );
  }
  if (state.decision.status !== fixture.conclusion.requiredDecision) {
    return fail(
      state,
      request.toolName,
      "Record the required analyst disposition before preparing a response.",
      "DECISION_REQUIRED",
    );
  }
  if (!state.reachabilityAttached || !state.counterfactualAttached) {
    return fail(
      state,
      request.toolName,
      "Attach reachability and the response impact model before preparing a response.",
      "MODEL_REQUIRED",
    );
  }

  const definitions = bundle.actionIds.map((actionId) =>
    fixture.responseActions.find((action) => action.id === actionId),
  );
  if (definitions.some((definition) => definition === undefined)) {
    return fail(
      state,
      request.toolName,
      "The response package contains an invalid action.",
      "INVALID_FIXTURE",
    );
  }
  const resolvedDefinitions = definitions.filter(
    (definition): definition is NonNullable<typeof definition> =>
      definition !== undefined,
  );
  for (const definition of resolvedDefinitions) {
    const actionState = state.responseActions.find(
      (action) => action.actionId === definition.id,
    );
    if (!actionState || actionState.status !== "available") {
      return fail(
        state,
        request.toolName,
        `${definition.title} is not available for package preparation.`,
        "ACTION_STATE_CONFLICT",
      );
    }
    if (!state.releasedStreamStageIds.includes(definition.requiresStageId)) {
      return fail(
        state,
        request.toolName,
        `${definition.title} requires an unreleased observation.`,
        "SIGNAL_REQUIRED",
      );
    }
    if (
      !definition.requiresEnrichmentIds.every((artifactId) =>
        state.attachedEnrichmentIds.includes(artifactId),
      )
    ) {
      return fail(
        state,
        request.toolName,
        `${definition.title} requires additional response context.`,
        "CONTEXT_REQUIRED",
      );
    }
    const unmetExternalDependency = definition.dependsOnActionIds.find(
      (dependencyId) =>
        !bundle.actionIds.includes(dependencyId) &&
        state.responseActions.find((action) => action.actionId === dependencyId)
          ?.status !== "authorized_in_demo",
    );
    if (unmetExternalDependency) {
      return fail(
        state,
        request.toolName,
        `Authorize '${unmetExternalDependency}' before preparing this package.`,
        "DEPENDENCY_REQUIRED",
      );
    }
  }

  const updated = nextState(state);
  const proposal: ResponseBundleProposal = {
    id: `BUNDLE-${caseToken(fixture)}-${String(updated.revision).padStart(4, "0")}`,
    bundleId: bundle.id,
    actionIds: [...bundle.actionIds],
    reasoning: bundle.reasoning,
    basedOnRevision: state.revision,
    reportedSurface: request.reportedSurface,
    preparedAt: deterministicTimestamp(updated.revision),
  };
  updated.responseBundle = proposal;
  for (const definition of resolvedDefinitions) {
    const actionState = updated.responseActions.find(
      (action) => action.actionId === definition.id,
    );
    if (!actionState) {
      return fail(
        state,
        request.toolName,
        "The response action state is unavailable.",
        "INVALID_FIXTURE",
      );
    }
    actionState.status = "simulated";
    actionState.proposalId = proposal.id;
    actionState.simulatedAt = deterministicTimestamp(updated.revision);
  }
  const severedPathIds = [
    ...new Set(resolvedDefinitions.flatMap((action) => action.seversPathIds)),
  ];
  return success(
    updated,
    {
      proposal,
      bundle,
      actions: resolvedDefinitions,
      simulation: {
        targetCount: bundle.targetEntityIds.length,
        severedPathIds,
        externalExecution: false,
      },
      requiresAnalystAuthorization: true,
    },
    {
      title: `Prepared ${bundle.title.toLowerCase()}`,
      target: `${bundle.targetEntityIds.length} response targets`,
      resultSummary: `${resolvedDefinitions.length} controls modeled · ${severedPathIds.length} risk segments affected · analyst approval required`,
    },
    true,
  );
}

function applyDiscoveryStage(
  fixture: CaseFixture,
  state: CaseState,
  stage: CaseFixture["stream"]["stages"][number],
  toolName: CaseToolName,
): ToolOutcome {
  const updated = nextState(state);
  updated.releasedStreamStageIds.push(stage.id);
  if (
    updated.observationRequest?.status === "pending" &&
    updated.observationRequest.stageId === stage.id
  ) {
    updated.observationRequest.status = "released";
    updated.observationRequest.releasedAt = deterministicTimestamp(
      updated.revision,
    );
  }
  for (const actionId of stage.responseActionIds) {
    const responseState = updated.responseActions.find(
      (action) => action.actionId === actionId,
    );
    if (!responseState) {
      return fail(
        state,
        toolName,
        "The discovery has an invalid response action mapping.",
        "INVALID_FIXTURE",
      );
    }
    responseState.status = "available";
  }
  const entityIds = stage.entities.map((entity) => entity.id);
  const eventIds = stage.events.map((event) => event.id);
  const relationshipIds = stage.joins.map((join) => join.id);
  return success(
    updated,
    {
      discovery: {
        id: stage.id,
        title: stage.title,
        summary: stage.summary,
        receivedAt: stage.receivedAt,
      },
      added: {
        entityIds,
        eventIds,
        relationshipIds,
        availableEnrichmentIds: stage.enrichments.map(
          (artifact) => artifact.id,
        ),
      },
      provenance: {
        sourceQueryIds: stage.admission.sourceQueryIds,
        sourceRecordIds: stage.admission.sourceRecordIds,
      },
      cursor: updated.releasedStreamStageIds.length,
      remaining:
        fixture.stream.stages.length - updated.releasedStreamStageIds.length,
      availableResponseActionIds: stage.responseActionIds,
    },
    {
      title: "Verified discovery added",
      target: stage.title,
      resultSummary: `${entityIds.length} ${entityIds.length === 1 ? "entity" : "entities"}, ${relationshipIds.length} ${relationshipIds.length === 1 ? "relationship" : "relationships"}, and ${eventIds.length} ${eventIds.length === 1 ? "observation" : "observations"} added from ${stage.admission.sourceRecordIds.length} cited records`,
    },
    true,
  );
}

function containmentAuthorizationSatisfied(
  fixture: CaseFixture,
  state: CaseState,
  stage: CaseFixture["stream"]["stages"][number],
): boolean {
  const containmentActions = fixture.responseActions.filter(
    (action) => action.phase === "containment",
  );
  if (containmentActions.length === 0 || stage.ordinal <= 1) return true;
  return containmentActions.every(
    (definition) =>
      state.responseActions.find((action) => action.actionId === definition.id)
        ?.status === "authorized_in_demo",
  );
}

function validateDiscoveryAdmission(
  fixture: CaseFixture,
  state: CaseState,
  stage: CaseFixture["stream"]["stages"][number],
  toolName: CaseToolName,
): ToolFailure | null {
  if (!containmentAuthorizationSatisfied(fixture, state, stage)) {
    return fail(
      state,
      toolName,
      "Authorize the containment response package before adding recovery discovery.",
      "CONTAINMENT_AUTHORIZATION_REQUIRED",
    );
  }
  const missingEvidence = stage.admission.requiredEnrichmentIds.filter(
    (id) => !state.attachedEnrichmentIds.includes(id),
  );
  if (missingEvidence.length > 0) {
    return fail(
      state,
      toolName,
      `Attach the required query evidence before adding this discovery: ${missingEvidence.join(", ")}.`,
      "DISCOVERY_EVIDENCE_REQUIRED",
    );
  }
  const missingQueries = stage.admission.sourceQueryIds.filter(
    (id) => !state.executedInvestigationQueryIds.includes(id),
  );
  if (missingQueries.length > 0) {
    return fail(
      state,
      toolName,
      `Run the cited investigation queries before adding this discovery: ${missingQueries.join(", ")}.`,
      "DISCOVERY_QUERY_REQUIRED",
    );
  }
  return null;
}

function executeWrite(
  fixture: CaseFixture,
  state: CaseState,
  request: CaseToolRequest,
): ToolOutcome | null {
  const { input, toolName } = request;

  if (toolName === "propose_investigation_step") {
    const invalid = validateInput(
      input,
      ["expectedRevision", "phase", "objective", "recommendedTool", "entityId"],
      ["expectedRevision", "phase", "objective", "recommendedTool"],
    );
    if (invalid) return fail(state, toolName, invalid);
    const guarded = writeGuard(state, input, toolName);
    if (guarded) return guarded;
    const phases = new Set(["inspect", "decide", "scope", "model", "respond"]);
    if (typeof input.phase !== "string" || !phases.has(input.phase)) {
      return fail(state, toolName, "phase is invalid.");
    }
    if (
      typeof input.objective !== "string" ||
      input.objective.length < 8 ||
      input.objective.length > 180
    ) {
      return fail(
        state,
        toolName,
        "objective must contain 8 to 180 characters.",
      );
    }
    if (
      !isCaseToolName(input.recommendedTool) ||
      !proposalTools.has(input.recommendedTool)
    ) {
      return fail(state, toolName, "recommendedTool is invalid.");
    }
    if (
      input.entityId !== undefined &&
      (typeof input.entityId !== "string" ||
        !getVisibleEntities(fixture, state).some(
          (entity) => entity.id === input.entityId,
        ))
    ) {
      return fail(state, toolName, "entityId is not part of this case.");
    }
    const updated = nextState(state);
    const proposal: InvestigationProposal = {
      id: `STEP-${caseToken(fixture)}-${String(updated.revision).padStart(4, "0")}`,
      phase: input.phase as InvestigationProposal["phase"],
      objective: input.objective,
      recommendedTool: input.recommendedTool,
      targetEntityId:
        typeof input.entityId === "string" ? input.entityId : null,
      basedOnRevision: state.revision,
      reportedSurface: request.reportedSurface,
    };
    updated.proposal = proposal;
    return success(
      updated,
      { proposal },
      {
        title: "Proposed investigation step",
        target: proposal.targetEntityId
          ? labelForEntity(fixture, proposal.targetEntityId)
          : fixture.id,
        resultSummary: `${humanizeToolName(proposal.recommendedTool)} proposed`,
      },
      true,
    );
  }

  if (
    toolName === "enrich_identity" ||
    toolName === "enrich_network_indicator" ||
    toolName === "enrich_cloud_role" ||
    toolName === "enrich_resource" ||
    toolName === "enrich_endpoint" ||
    toolName === "enrich_file"
  ) {
    return attachEnrichment(fixture, state, request);
  }

  if (toolName === "prepare_investigation_query") {
    return prepareInvestigationQuery(fixture, state, request);
  }

  if (toolName === "run_investigation_query") {
    return runInvestigationQuery(fixture, state, request);
  }

  if (toolName === "run_investigation_plan") {
    return runInvestigationPlan(fixture, state, request);
  }

  if (toolName === "attach_discovery_stage") {
    const invalid = validateInput(
      input,
      ["expectedRevision", "stageId", "rationale"],
      ["expectedRevision", "stageId", "rationale"],
    );
    if (invalid) return fail(state, toolName, invalid);
    const guarded = writeGuard(state, input, toolName);
    if (guarded) return guarded;
    const stage = getNextStreamStage(fixture, state);
    if (!stage || input.stageId !== stage.id) {
      return fail(
        state,
        toolName,
        "stageId must identify the next available discovery.",
        "DISCOVERY_NOT_AVAILABLE",
      );
    }
    if (
      typeof input.rationale !== "string" ||
      input.rationale.length < 8 ||
      input.rationale.length > 240
    ) {
      return fail(
        state,
        toolName,
        "rationale must contain 8 to 240 characters.",
      );
    }
    const admissionFailure = validateDiscoveryAdmission(
      fixture,
      state,
      stage,
      toolName,
    );
    if (admissionFailure) return admissionFailure;
    return applyDiscoveryStage(fixture, state, stage, toolName);
  }

  if (toolName === "request_next_observation") {
    const invalid = validateInput(
      input,
      ["expectedRevision", "stageId", "rationale"],
      ["expectedRevision", "stageId", "rationale"],
    );
    if (invalid) return fail(state, toolName, invalid);
    const guarded = writeGuard(state, input, toolName);
    if (guarded) return guarded;
    const stage = getNextStreamStage(fixture, state);
    if (!stage || input.stageId !== stage.id) {
      return fail(
        state,
        toolName,
        "stageId must identify the next bounded observation.",
        "STREAM_STAGE_NOT_AVAILABLE",
      );
    }
    if (!containmentAuthorizationSatisfied(fixture, state, stage)) {
      return fail(
        state,
        toolName,
        "Authorize the containment response package before requesting recovery discovery.",
        "CONTAINMENT_AUTHORIZATION_REQUIRED",
      );
    }
    if (
      typeof input.rationale !== "string" ||
      input.rationale.length < 8 ||
      input.rationale.length > 240
    ) {
      return fail(
        state,
        toolName,
        "rationale must contain 8 to 240 characters.",
      );
    }
    if (
      state.observationRequest?.status === "pending" &&
      state.observationRequest.stageId === stage.id
    ) {
      return fail(
        state,
        toolName,
        "This observation is already awaiting analyst release.",
        "REQUEST_ALREADY_PENDING",
      );
    }
    const updated = nextState(state);
    updated.observationRequest = {
      stageId: stage.id,
      rationale: input.rationale,
      targetEntityIds: [
        ...new Set(stage.events.flatMap((event) => event.entityIds)),
      ],
      basedOnRevision: state.revision,
      requestedAt: deterministicTimestamp(updated.revision),
      releasedAt: null,
      status: "pending",
    };
    return success(
      updated,
      {
        request: updated.observationRequest,
        releaseAuthority: "analyst_control",
      },
      {
        title: "Requested next observation",
        target: stage.title,
        resultSummary: `${stage.title} requested · analyst release required`,
      },
      true,
    );
  }

  if (toolName === "release_next_synthetic_signal") {
    if (request.reportedSurface !== "analyst_control") {
      return fail(
        state,
        toolName,
        "This operation is reserved for the internal telemetry control.",
        "SURFACE_NOT_ALLOWED",
      );
    }
    const invalid = validateInput(
      input,
      ["expectedRevision"],
      ["expectedRevision"],
    );
    if (invalid) return fail(state, toolName, invalid);
    const guarded = writeGuard(state, input, toolName);
    if (guarded) return guarded;
    const stage = getNextStreamStage(fixture, state);
    if (!stage) {
      return fail(
        state,
        toolName,
        "All available telemetry updates are already attached.",
        "STREAM_COMPLETE",
      );
    }
    const admissionFailure = validateDiscoveryAdmission(
      fixture,
      state,
      stage,
      toolName,
    );
    if (admissionFailure) return admissionFailure;
    return applyDiscoveryStage(fixture, state, stage, toolName);
  }

  if (toolName === "prepare_response_bundle") {
    return prepareResponseBundle(fixture, state, request);
  }

  if (toolName === "propose_response_action") {
    const invalid = validateInput(
      input,
      ["expectedRevision", "actionId", "reasoning"],
      ["expectedRevision", "actionId", "reasoning"],
    );
    if (invalid) return fail(state, toolName, invalid);
    const guarded = writeGuard(state, input, toolName);
    if (guarded) return guarded;
    if (state.responseBundle) {
      return fail(
        state,
        toolName,
        "Complete the active response package before proposing an individual action.",
        "ACTION_STATE_CONFLICT",
      );
    }
    const definition = fixture.responseActions.find(
      (action) => action.id === input.actionId,
    );
    const actionState = state.responseActions.find(
      (action) => action.actionId === input.actionId,
    );
    if (!definition || !actionState) {
      return fail(state, toolName, "actionId is invalid.");
    }
    if (!state.releasedStreamStageIds.includes(definition.requiresStageId)) {
      return fail(
        state,
        toolName,
        "The required observed signal has not been released.",
        "SIGNAL_REQUIRED",
      );
    }
    if (state.decision.status !== fixture.conclusion.requiredDecision) {
      return fail(
        state,
        toolName,
        "Record the required analyst disposition before proposing a response.",
        "DECISION_REQUIRED",
      );
    }
    if (!state.reachabilityAttached || !state.counterfactualAttached) {
      return fail(
        state,
        toolName,
        "Attach reachability and the response impact model before proposing a response.",
        "MODEL_REQUIRED",
      );
    }
    if (
      !definition.requiresEnrichmentIds.every((artifactId) =>
        state.attachedEnrichmentIds.includes(artifactId),
      )
    ) {
      return fail(
        state,
        toolName,
        "Attach the required response context before proposing this action.",
        "CONTEXT_REQUIRED",
      );
    }
    const unmetDependency = definition.dependsOnActionIds.find(
      (actionId) =>
        state.responseActions.find((action) => action.actionId === actionId)
          ?.status !== "authorized_in_demo",
    );
    if (unmetDependency) {
      return fail(
        state,
        toolName,
        `Authorize '${unmetDependency}' before proposing this action.`,
        "DEPENDENCY_REQUIRED",
      );
    }
    if (actionState.status !== "available") {
      return fail(
        state,
        toolName,
        "This response action is not available for a new proposal.",
        "ACTION_STATE_CONFLICT",
      );
    }
    const activeResponse = state.responseActions.find(
      (action) =>
        action.actionId !== definition.id &&
        (action.status === "proposed" || action.status === "simulated"),
    );
    if (activeResponse) {
      return fail(
        state,
        toolName,
        `Complete ${activeResponse.actionId} before proposing another response.`,
        "ACTION_STATE_CONFLICT",
      );
    }
    if (
      typeof input.reasoning !== "string" ||
      input.reasoning.length < 8 ||
      input.reasoning.length > 240
    ) {
      return fail(
        state,
        toolName,
        "reasoning must contain 8 to 240 characters.",
      );
    }
    const updated = nextState(state);
    const proposal: ResponseProposal = {
      id: `RESP-${caseToken(fixture)}-${String(updated.revision).padStart(4, "0")}`,
      actionId: definition.id,
      reasoning: input.reasoning,
      basedOnRevision: state.revision,
      reportedSurface: request.reportedSurface,
    };
    updated.responseProposal = proposal;
    const updatedAction = updated.responseActions.find(
      (action) => action.actionId === definition.id,
    );
    if (!updatedAction) {
      return fail(
        state,
        toolName,
        "The response action state is unavailable.",
        "INVALID_FIXTURE",
      );
    }
    updatedAction.status = "proposed";
    updatedAction.proposalId = proposal.id;
    return success(
      updated,
      { proposal, definition },
      {
        title: "Proposed bounded response",
        target: labelForEntity(fixture, definition.targetEntityId),
        resultSummary: `${definition.title} prepared for simulation`,
      },
      true,
    );
  }

  if (toolName === "simulate_response_action") {
    const invalid = validateInput(
      input,
      ["expectedRevision", "actionId"],
      ["expectedRevision", "actionId"],
    );
    if (invalid) return fail(state, toolName, invalid);
    const guarded = writeGuard(state, input, toolName);
    if (guarded) return guarded;
    const definition = fixture.responseActions.find(
      (action) => action.id === input.actionId,
    );
    const actionState = state.responseActions.find(
      (action) => action.actionId === input.actionId,
    );
    if (
      !definition ||
      !actionState ||
      actionState.status !== "proposed" ||
      state.responseProposal?.actionId !== definition.id ||
      state.responseProposal.id !== actionState.proposalId
    ) {
      return fail(
        state,
        toolName,
        "A matching response proposal is required before modeling its effect.",
        "PROPOSAL_REQUIRED",
      );
    }
    const updated = nextState(state);
    const updatedAction = updated.responseActions.find(
      (action) => action.actionId === definition.id,
    );
    if (!updatedAction) {
      return fail(
        state,
        toolName,
        "The response action state is unavailable.",
        "INVALID_FIXTURE",
      );
    }
    updatedAction.status = "simulated";
    updatedAction.simulatedAt = deterministicTimestamp(updated.revision);
    return success(
      updated,
      {
        action: definition,
        result: definition.simulatedEffect,
        executed: false,
      },
      {
        title: "Simulated bounded response",
        target: labelForEntity(fixture, definition.targetEntityId),
        resultSummary: `${definition.title} modeled · not executed`,
      },
      true,
    );
  }

  if (toolName === "authorize_response_action") {
    if (request.reportedSurface !== "analyst_control") {
      return fail(
        state,
        toolName,
        "Response authorization is not available through the WebMCP surface.",
        "SURFACE_NOT_ALLOWED",
      );
    }
    const invalid = validateInput(
      input,
      ["expectedRevision", "actionId", "proposalId", "acknowledgement"],
      ["expectedRevision", "actionId", "proposalId", "acknowledgement"],
    );
    if (invalid) return fail(state, toolName, invalid);
    const guarded = writeGuard(state, input, toolName);
    if (guarded) return guarded;
    const definition = fixture.responseActions.find(
      (action) => action.id === input.actionId,
    );
    const actionState = state.responseActions.find(
      (action) => action.actionId === input.actionId,
    );
    if (
      !definition ||
      !actionState ||
      actionState.status !== "simulated" ||
      actionState.proposalId !== input.proposalId ||
      state.responseProposal?.id !== input.proposalId
    ) {
      return fail(
        state,
        toolName,
        "A matching simulated response is required before authorization.",
        "SIMULATION_REQUIRED",
      );
    }
    if (state.decision.status !== fixture.conclusion.requiredDecision) {
      return fail(
        state,
        toolName,
        "The required analyst disposition is no longer current.",
        "DECISION_REQUIRED",
      );
    }
    if (!state.reachabilityAttached || !state.counterfactualAttached) {
      return fail(
        state,
        toolName,
        "The response model is no longer attached.",
        "MODEL_REQUIRED",
      );
    }
    if (input.acknowledgement !== "AUTHORIZE_SYNTHETIC_RESPONSE") {
      return fail(
        state,
        toolName,
        "acknowledgement must confirm the recorded-only response boundary.",
      );
    }
    const updated = nextState(state);
    const updatedAction = updated.responseActions.find(
      (action) => action.actionId === definition.id,
    );
    if (!updatedAction) {
      return fail(
        state,
        toolName,
        "The response action state is unavailable.",
        "INVALID_FIXTURE",
      );
    }
    updatedAction.status = "authorized_in_demo";
    updatedAction.authorizedAt = deterministicTimestamp(updated.revision);
    updated.responseProposal = null;
    if (
      fixture.conclusion.requiredActionIds.every(
        (actionId) =>
          updated.responseActions.find((action) => action.actionId === actionId)
            ?.status === "authorized_in_demo",
      )
    ) {
      updated.lifecycle = "contained_in_demo";
    }
    return success(
      updated,
      {
        action: definition,
        authorizedInDemo: true,
        externalExecution: false,
      },
      {
        title: "Response approved",
        target: labelForEntity(fixture, definition.targetEntityId),
        resultSummary: `${definition.title} approved · no external execution`,
      },
      true,
    );
  }

  if (toolName === "authorize_response_bundle") {
    if (request.reportedSurface !== "analyst_control") {
      return fail(
        state,
        toolName,
        "Response package authorization is not available through the WebMCP surface.",
        "SURFACE_NOT_ALLOWED",
      );
    }
    const invalid = validateInput(
      input,
      ["expectedRevision", "bundleId", "proposalId", "acknowledgement"],
      ["expectedRevision", "bundleId", "proposalId", "acknowledgement"],
    );
    if (invalid) return fail(state, toolName, invalid);
    const guarded = writeGuard(state, input, toolName);
    if (guarded) return guarded;
    const bundle = getResponseBundles(fixture).find(
      (candidate) => candidate.id === input.bundleId,
    );
    const proposal = state.responseBundle;
    if (
      !bundle ||
      !proposal ||
      proposal.bundleId !== bundle.id ||
      proposal.id !== input.proposalId ||
      !bundle.actionIds.every((actionId) => {
        const actionState = state.responseActions.find(
          (action) => action.actionId === actionId,
        );
        return (
          actionState?.status === "simulated" &&
          actionState.proposalId === proposal.id
        );
      })
    ) {
      return fail(
        state,
        toolName,
        "A matching prepared response package is required before authorization.",
        "SIMULATION_REQUIRED",
      );
    }
    if (input.acknowledgement !== "AUTHORIZE_SYNTHETIC_BUNDLE") {
      return fail(
        state,
        toolName,
        "acknowledgement must confirm the recorded-only response boundary.",
      );
    }
    const updated = nextState(state);
    for (const actionId of bundle.actionIds) {
      const actionState = updated.responseActions.find(
        (action) => action.actionId === actionId,
      );
      if (!actionState) {
        return fail(
          state,
          toolName,
          "The response action state is unavailable.",
          "INVALID_FIXTURE",
        );
      }
      actionState.status = "authorized_in_demo";
      actionState.authorizedAt = deterministicTimestamp(updated.revision);
    }
    updated.responseBundle = null;
    if (!updated.authorizedResponseBundleIds.includes(bundle.id)) {
      updated.authorizedResponseBundleIds.push(bundle.id);
    }
    if (
      fixture.conclusion.requiredActionIds.every(
        (actionId) =>
          updated.responseActions.find((action) => action.actionId === actionId)
            ?.status === "authorized_in_demo",
      )
    ) {
      updated.lifecycle = "contained_in_demo";
    }
    return success(
      updated,
      {
        bundle,
        authorizedActionIds: bundle.actionIds,
        authorizedInDemo: true,
        externalExecution: false,
      },
      {
        title: `Authorized ${bundle.title.toLowerCase()}`,
        target: `${bundle.targetEntityIds.length} response targets`,
        resultSummary: `${bundle.actionIds.length} controls approved · no external execution`,
      },
      true,
    );
  }

  if (toolName === "record_evidence_decision") {
    if (request.reportedSurface !== "analyst_control") {
      return fail(
        state,
        toolName,
        "This operation is not available through the WebMCP surface.",
        "SURFACE_NOT_ALLOWED",
      );
    }
    const invalid = validateInput(
      input,
      ["expectedRevision", "decision", "rationale"],
      ["expectedRevision", "decision", "rationale"],
    );
    if (invalid) return fail(state, toolName, invalid);
    const guarded = writeGuard(state, input, toolName);
    if (guarded) return guarded;
    if (state.decision.status !== "pending") {
      return fail(
        state,
        toolName,
        "The recorded disposition is immutable. Reset the case to choose a different disposition.",
        "DECISION_STATE_CONFLICT",
      );
    }
    if (
      !fixture.decision.requiresEnrichmentIds.every((artifactId) =>
        state.attachedEnrichmentIds.includes(artifactId),
      )
    ) {
      return fail(
        state,
        toolName,
        "Attach the decision-required context before recording a disposition.",
        "CONTEXT_REQUIRED",
      );
    }
    const option = fixture.decision.options.find(
      (candidate) => candidate.id === input.decision,
    );
    if (!option) {
      return fail(state, toolName, "decision is invalid.");
    }
    if (
      typeof input.rationale !== "string" ||
      input.rationale.length < 8 ||
      input.rationale.length > 240
    ) {
      return fail(
        state,
        toolName,
        "rationale must contain 8 to 240 characters.",
      );
    }
    const updated = nextState(state);
    updated.decision = {
      status: option.id,
      rationale: input.rationale,
      decidedAt: deterministicTimestamp(updated.revision),
    };
    return success(
      updated,
      { decision: updated.decision, definition: fixture.decision },
      {
        title: "Recorded evidence disposition",
        target: fixture.id,
        resultSummary: option.label,
      },
      true,
    );
  }

  if (toolName === "calculate_reachability") {
    const invalid = validateInput(
      input,
      ["expectedRevision", "fromEntityId", "maxDepth"],
      ["expectedRevision", "fromEntityId", "maxDepth"],
    );
    if (invalid) return fail(state, toolName, invalid);
    const guarded = writeGuard(state, input, toolName);
    if (guarded) return guarded;
    if (input.fromEntityId !== fixture.reachability.sourceEntityId) {
      return fail(state, toolName, "fromEntityId is invalid.");
    }
    if (
      !Number.isInteger(input.maxDepth) ||
      Number(input.maxDepth) < 1 ||
      Number(input.maxDepth) > 8
    ) {
      return fail(state, toolName, "maxDepth must be an integer from 1 to 8.");
    }
    if (state.decision.status === "pending") {
      return fail(
        state,
        toolName,
        "Record the evidence disposition before modeling reachability.",
        "HUMAN_DECISION_REQUIRED",
      );
    }
    if (state.reachabilityAttached) {
      return fail(
        state,
        toolName,
        "Reachability is already attached.",
        "ALREADY_ATTACHED",
      );
    }
    const updated = nextState(state);
    updated.reachabilityAttached = true;
    return success(
      updated,
      { result: fixture.reachability },
      {
        title: "Calculated modeled reach",
        target: labelForEntity(fixture, fixture.reachability.sourceEntityId),
        resultSummary: `${fixture.reachability.paths.length} modeled risk paths added`,
      },
      true,
    );
  }

  if (toolName === "simulate_control") {
    const invalid = validateInput(
      input,
      ["expectedRevision", "control"],
      ["expectedRevision", "control"],
    );
    if (invalid) return fail(state, toolName, invalid);
    const guarded = writeGuard(state, input, toolName);
    if (guarded) return guarded;
    if (input.control !== fixture.counterfactual.control) {
      return fail(state, toolName, "control is invalid.");
    }
    if (!state.reachabilityAttached) {
      return fail(
        state,
        toolName,
        "Calculate reachability before simulating a control.",
        "REACHABILITY_REQUIRED",
      );
    }
    if (state.counterfactualAttached) {
      return fail(
        state,
        toolName,
        "The response impact model is already attached.",
        "ALREADY_ATTACHED",
      );
    }
    const updated = nextState(state);
    updated.counterfactualAttached = true;
    return success(
      updated,
      { result: fixture.counterfactual },
      {
        title: "Simulated impact control",
        target: labelForEntity(fixture, fixture.counterfactual.changedEntityId),
        resultSummary: `${fixture.counterfactual.severedPathIds.length} risk path${fixture.counterfactual.severedPathIds.length === 1 ? "" : "s"} blocked in simulation · not executed`,
      },
      true,
    );
  }

  if (toolName === "generate_case_report") {
    const invalid = validateInput(
      input,
      ["expectedRevision"],
      ["expectedRevision"],
    );
    if (invalid) return fail(state, toolName, invalid);
    const guarded = writeGuard(state, input, toolName);
    if (guarded) return guarded;
    if (state.report.status !== "unavailable") {
      return fail(
        state,
        toolName,
        "A case report already exists for this case state.",
        "REPORT_STATE_CONFLICT",
      );
    }
    if (state.decision.status !== fixture.conclusion.requiredDecision) {
      return fail(
        state,
        toolName,
        "The required analyst disposition is not recorded.",
        "DECISION_REQUIRED",
      );
    }
    if (
      !fixture.conclusion.requiredEnrichmentIds.every((artifactId) =>
        state.attachedEnrichmentIds.includes(artifactId),
      )
    ) {
      return fail(
        state,
        toolName,
        "The report-required enrichment evidence is incomplete.",
        "CONTEXT_REQUIRED",
      );
    }
    if (
      !fixture.conclusion.requiredActionIds.every(
        (actionId) =>
          state.responseActions.find((action) => action.actionId === actionId)
            ?.status === "authorized_in_demo",
      )
    ) {
      return fail(
        state,
        toolName,
        "The report-required response actions are incomplete.",
        "RESPONSE_REQUIRED",
      );
    }
    if (state.releasedStreamStageIds.length !== fixture.stream.stages.length) {
      return fail(
        state,
        toolName,
        "All required telemetry discoveries must be attached before report generation.",
        "STREAM_INCOMPLETE",
      );
    }
    const requiresImpactModel =
      fixture.impact.atRiskEntityIds.length > 0 ||
      fixture.responseActions.length > 0;
    if (
      requiresImpactModel &&
      (!state.reachabilityAttached || !state.counterfactualAttached)
    ) {
      return fail(
        state,
        toolName,
        "Attach reachability and the response impact model before report generation.",
        "MODEL_REQUIRED",
      );
    }

    const updated = nextState(state);
    const reportNarrative = getCaseReportNarrative(fixture, updated);
    const visibleEvents = getVisibleEvents(fixture, state);
    const visibleJoins = getVisibleJoins(fixture, state);
    updated.report = {
      status: "drafted",
      report: {
        id: fixture.conclusion.reportId,
        version: fixture.conclusion.reportVersion,
        title: fixture.conclusion.title,
        disposition: fixture.conclusion.disposition,
        executiveSummary: reportNarrative.executiveSummary,
        confirmedFindings: [...reportNarrative.confirmedFindings],
        limitations: [...fixture.conclusion.limitations],
        residualRisk: [...fixture.conclusion.residualRisk],
        evidenceIds: [
          ...visibleEvents.map((event) => event.id),
          ...visibleJoins.map((join) => join.id),
          ...state.attachedEnrichmentIds,
        ],
        actionIds: state.responseActions
          .filter((action) => action.status === "authorized_in_demo")
          .map((action) => action.actionId),
        generatedAt: deterministicTimestamp(updated.revision),
      },
      approvedAt: null,
      analystClosureNote: null,
    };
    updated.lifecycle = "report_drafted";
    return success(
      updated,
      { report: updated.report.report, requiresAnalystApproval: true },
      {
        title: "Generated case evidence report",
        target: fixture.conclusion.reportId,
        resultSummary:
          "Evidence report assembled from attached findings and recorded controls; analyst review required",
      },
      true,
    );
  }

  if (toolName === "approve_case_report") {
    if (request.reportedSurface !== "analyst_control") {
      return fail(
        state,
        toolName,
        "Case report approval is not available through the WebMCP surface.",
        "SURFACE_NOT_ALLOWED",
      );
    }
    const invalid = validateInput(
      input,
      ["expectedRevision", "reportId", "acknowledgement", "analystClosureNote"],
      ["expectedRevision", "reportId", "acknowledgement", "analystClosureNote"],
    );
    if (invalid) return fail(state, toolName, invalid);
    const guarded = writeGuard(state, input, toolName);
    if (guarded) return guarded;
    if (
      state.report.status !== "drafted" ||
      !state.report.report ||
      input.reportId !== state.report.report.id
    ) {
      return fail(
        state,
        toolName,
        "A matching drafted report is required before approval.",
        "REPORT_REQUIRED",
      );
    }
    if (state.decision.status !== fixture.conclusion.requiredDecision) {
      return fail(
        state,
        toolName,
        "The report disposition no longer matches the current analyst decision.",
        "DECISION_REQUIRED",
      );
    }
    if (
      !fixture.conclusion.requiredEnrichmentIds.every((artifactId) =>
        state.attachedEnrichmentIds.includes(artifactId),
      ) ||
      state.releasedStreamStageIds.length !== fixture.stream.stages.length
    ) {
      return fail(
        state,
        toolName,
        "The report evidence gate is no longer satisfied.",
        "CONTEXT_REQUIRED",
      );
    }
    if (
      !fixture.conclusion.requiredActionIds.every(
        (actionId) =>
          state.responseActions.find((action) => action.actionId === actionId)
            ?.status === "authorized_in_demo",
      )
    ) {
      return fail(
        state,
        toolName,
        "The report response gate is no longer satisfied.",
        "RESPONSE_REQUIRED",
      );
    }
    const reportRequiresImpactModel =
      fixture.impact.atRiskEntityIds.length > 0 ||
      fixture.responseActions.length > 0;
    if (
      reportRequiresImpactModel &&
      (!state.reachabilityAttached || !state.counterfactualAttached)
    ) {
      return fail(
        state,
        toolName,
        "The report impact model is no longer attached.",
        "MODEL_REQUIRED",
      );
    }
    if (input.acknowledgement !== "APPROVE_SYNTHETIC_REPORT") {
      return fail(
        state,
        toolName,
        "acknowledgement must confirm the recorded-only report boundary.",
      );
    }
    const analystClosureNote = normalizeAnalystClosureNote(
      input.analystClosureNote,
    );
    if (analystClosureNote === null) {
      return fail(
        state,
        toolName,
        "Record a 24–600 character analyst closure note before approval.",
        "CLOSURE_NOTE_REQUIRED",
      );
    }
    const updated = nextState(state);
    updated.report = {
      ...updated.report,
      status: "approved_in_demo",
      approvedAt: deterministicTimestamp(updated.revision),
      analystClosureNote,
    };
    updated.lifecycle = "closed_in_demo";
    return success(
      updated,
      {
        report: updated.report.report,
        approvedInDemo: true,
        externalExecution: false,
      },
      {
        title: "Approved case evidence report",
        target: state.report.report.id,
        resultSummary: "Report approved; case closed · no external execution",
      },
      true,
    );
  }

  return null;
}

export function executeCaseTool(
  fixture: CaseFixture,
  state: CaseState,
  request: CaseToolRequest,
): ToolOutcome {
  if (!validateRequestId(request.requestId)) {
    return fail(
      state,
      request.toolName,
      "requestId must contain 8 to 80 safe characters.",
    );
  }
  if (!isRecord(request.input)) {
    return fail(state, request.toolName, "input must be an object.");
  }

  const readResult = executeRead(fixture, state, request);
  if (readResult) return readResult;

  const writeResult = executeWrite(fixture, state, request);
  if (writeResult) return writeResult;

  return fail(
    state,
    request.toolName,
    "Tool is not implemented.",
    "TOOL_NOT_IMPLEMENTED",
  );
}

export function deterministicTimestamp(sequence: number): string {
  const origin = Date.parse("2026-08-27T09:43:00Z");
  return new Date(origin + sequence * 1_000).toISOString();
}

export function enrichmentForEntity(
  fixture: CaseFixture,
  entityId: string,
): EnrichmentArtifact | null {
  return (
    getAllEnrichments(fixture).find(
      (artifact) => artifact.entityId === entityId,
    ) ?? null
  );
}
