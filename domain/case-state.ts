import type {
  CaseFixture,
  CaseReport,
  CaseState,
  ResponseActionDefinition,
} from "./types";
import {
  getCaseReportNarrative,
  getResponseBundles,
  type ResponseBundleDefinition,
} from "./operations";
import { normalizeAnalystClosureNote } from "./report-signoff";

export function parseCaseState(value: string, fixture: CaseFixture): CaseState {
  const parsed: unknown = JSON.parse(value);
  if (isRecord(parsed) && !("preparedQuery" in parsed)) {
    parsed.preparedQuery = null;
  }
  if (isRecord(parsed) && !("executedInvestigationQueryIds" in parsed)) {
    parsed.executedInvestigationQueryIds = [];
  }
  if (!hasValidBaseShape(parsed, fixture)) {
    throw new Error(`Stored state for ${fixture.id} is invalid.`);
  }

  const releasedStageIds = parsed.releasedStreamStageIds as string[];
  const expectedPrefix = fixture.stream.stages
    .slice(0, releasedStageIds.length)
    .map((stage) => stage.id);
  if (
    releasedStageIds.length > fixture.stream.stages.length ||
    releasedStageIds.some((id, index) => id !== expectedPrefix[index])
  ) {
    throw new Error(`Stored stream state for ${fixture.id} is invalid.`);
  }

  const attachedEnrichmentIds = parsed.attachedEnrichmentIds as string[];
  const visibleEnrichmentIds = new Set(
    [
      ...fixture.enrichments,
      ...fixture.stream.stages
        .slice(0, releasedStageIds.length)
        .flatMap((stage) => stage.enrichments),
    ].map((artifact) => artifact.id),
  );
  if (
    new Set(attachedEnrichmentIds).size !== attachedEnrichmentIds.length ||
    attachedEnrichmentIds.some((id) => !visibleEnrichmentIds.has(id))
  ) {
    throw new Error(`Stored enrichment state for ${fixture.id} is invalid.`);
  }

  const executedQueryIds = parsed.executedInvestigationQueryIds as string[];
  const queryById = new Map(
    fixture.investigationQueries.map((query) => [query.id, query]),
  );
  if (
    new Set(executedQueryIds).size !== executedQueryIds.length ||
    executedQueryIds.some((id) => {
      const query = queryById.get(id);
      return (
        !query ||
        !attachedEnrichmentIds.includes(query.resultArtifactId) ||
        (query.requiresStageId !== null &&
          !releasedStageIds.includes(query.requiresStageId))
      );
    }) ||
    fixture.stream.stages
      .slice(0, releasedStageIds.length)
      .some(
        (stage) =>
          stage.admission.requiredEnrichmentIds.some(
            (id) => !attachedEnrichmentIds.includes(id),
          ) ||
          stage.admission.sourceQueryIds.some(
            (id) => !executedQueryIds.includes(id),
          ),
      )
  ) {
    throw new Error(`Stored query provenance for ${fixture.id} is invalid.`);
  }

  const visibleEntityIds = new Set(
    [
      ...fixture.entities,
      ...fixture.stream.stages
        .slice(0, releasedStageIds.length)
        .flatMap((stage) => stage.entities),
    ].map((entity) => entity.id),
  );
  if (!hasValidInvestigationState(parsed, visibleEntityIds)) {
    throw new Error(`Stored investigation state for ${fixture.id} is invalid.`);
  }
  if (!isValidPreparedQuery(parsed, fixture, releasedStageIds)) {
    throw new Error(`Stored prepared query for ${fixture.id} is invalid.`);
  }

  const actionDefinitions = new Map<string, ResponseActionDefinition>(
    fixture.responseActions.map((action) => [action.id, action]),
  );
  const responseBundleDefinitions = new Map<string, ResponseBundleDefinition>(
    getResponseBundles(fixture).map((bundle) => [bundle.id, bundle]),
  );
  const actionIds = new Set<string>();
  const responseActionsValid = parsed.responseActions.every((action) => {
    if (
      !isRecord(action) ||
      typeof action.actionId !== "string" ||
      actionIds.has(action.actionId) ||
      !actionDefinitions.has(action.actionId) ||
      ![
        "unavailable",
        "available",
        "proposed",
        "simulated",
        "authorized_in_demo",
      ].includes(String(action.status)) ||
      (action.proposalId !== null && typeof action.proposalId !== "string") ||
      (action.simulatedAt !== null && typeof action.simulatedAt !== "string") ||
      (action.authorizedAt !== null && typeof action.authorizedAt !== "string")
    ) {
      return false;
    }

    actionIds.add(action.actionId);
    const definition = actionDefinitions.get(action.actionId);
    const released = definition
      ? releasedStageIds.includes(definition.requiresStageId)
      : false;
    if (!released) {
      return (
        action.status === "unavailable" &&
        action.proposalId === null &&
        action.simulatedAt === null &&
        action.authorizedAt === null
      );
    }
    if (action.status === "available") {
      return (
        action.proposalId === null &&
        action.simulatedAt === null &&
        action.authorizedAt === null
      );
    }

    if (
      !isRecord(parsed.decision) ||
      parsed.decision.status !== fixture.conclusion.requiredDecision ||
      parsed.reachabilityAttached !== true ||
      parsed.counterfactualAttached !== true
    ) {
      return false;
    }

    if (
      !definition ||
      !definition.requiresEnrichmentIds.every((artifactId) =>
        attachedEnrichmentIds.includes(artifactId),
      ) ||
      typeof action.proposalId !== "string"
    ) {
      return false;
    }
    if (
      !definition.dependsOnActionIds.every((dependencyId) => {
        const dependency = parsed.responseActions.find(
          (candidate) =>
            isRecord(candidate) && candidate.actionId === dependencyId,
        );
        if (!isRecord(dependency)) return false;
        if (dependency.status === "authorized_in_demo") return true;
        return (
          action.status === "simulated" &&
          dependency.status === "simulated" &&
          isRecord(parsed.responseBundle) &&
          Array.isArray(parsed.responseBundle.actionIds) &&
          parsed.responseBundle.actionIds.includes(action.actionId) &&
          parsed.responseBundle.actionIds.includes(dependencyId) &&
          dependency.proposalId === action.proposalId
        );
      })
    ) {
      return false;
    }
    if (action.status === "proposed") {
      return action.simulatedAt === null && action.authorizedAt === null;
    }
    if (action.status === "simulated") {
      return (
        typeof action.simulatedAt === "string" && action.authorizedAt === null
      );
    }
    return (
      action.status === "authorized_in_demo" &&
      typeof action.simulatedAt === "string" &&
      typeof action.authorizedAt === "string"
    );
  });

  if (
    !responseActionsValid ||
    actionIds.size !== fixture.responseActions.length ||
    !isValidObservationRequest(parsed.observationRequest, fixture, parsed) ||
    !isValidAuthorizedBundleIds(
      parsed.authorizedResponseBundleIds,
      responseBundleDefinitions,
      parsed.responseActions,
    ) ||
    !isValidResponseBundle(
      parsed.responseBundle,
      responseBundleDefinitions,
      parsed.responseActions,
      Number(parsed.revision),
    ) ||
    !isValidResponseProposal(
      parsed.responseProposal,
      actionDefinitions,
      releasedStageIds,
      parsed.responseActions,
      Number(parsed.revision),
      parsed.responseBundle,
    ) ||
    !hasValidReportState(parsed, fixture)
  ) {
    throw new Error(`Stored response state for ${fixture.id} is invalid.`);
  }

  return parsed as unknown as CaseState;
}

function hasValidBaseShape(
  value: unknown,
  fixture: CaseFixture,
): value is Record<string, unknown> & {
  attachedEnrichmentIds: unknown[];
  executedInvestigationQueryIds: unknown[];
  releasedStreamStageIds: unknown[];
  observationRequest: unknown;
  responseBundle: unknown;
  authorizedResponseBundleIds: unknown[];
  responseActions: unknown[];
} {
  return (
    isRecord(value) &&
    value.caseId === fixture.id &&
    value.fixtureVersion === fixture.fixtureVersion &&
    Number.isInteger(value.revision) &&
    Number(value.revision) >= 1 &&
    Array.isArray(value.attachedEnrichmentIds) &&
    value.attachedEnrichmentIds.every((id) => typeof id === "string") &&
    Array.isArray(value.executedInvestigationQueryIds) &&
    value.executedInvestigationQueryIds.every((id) => typeof id === "string") &&
    (value.preparedQuery === null || isRecord(value.preparedQuery)) &&
    typeof value.reachabilityAttached === "boolean" &&
    typeof value.counterfactualAttached === "boolean" &&
    Array.isArray(value.releasedStreamStageIds) &&
    value.releasedStreamStageIds.every((id) => typeof id === "string") &&
    (value.observationRequest === null || isRecord(value.observationRequest)) &&
    (value.responseBundle === null || isRecord(value.responseBundle)) &&
    Array.isArray(value.authorizedResponseBundleIds) &&
    value.authorizedResponseBundleIds.every((id) => typeof id === "string") &&
    Array.isArray(value.responseActions) &&
    isRecord(value.decision) &&
    [
      "pending",
      ...fixture.decision.options.map((option) => option.id),
    ].includes(String(value.decision.status)) &&
    [
      "investigating",
      "contained_in_demo",
      "report_drafted",
      "closed_in_demo",
    ].includes(String(value.lifecycle)) &&
    isRecord(value.report)
  );
}

function isValidPreparedQuery(
  state: Record<string, unknown> & {
    executedInvestigationQueryIds: unknown[];
  },
  fixture: CaseFixture,
  releasedStageIds: readonly string[],
): boolean {
  if (state.preparedQuery === null) return true;
  if (!isRecord(state.preparedQuery)) return false;
  const prepared = state.preparedQuery;
  const query = fixture.investigationQueries.find(
    (candidate) => candidate.id === prepared.queryId,
  );
  return (
    query !== undefined &&
    prepared.targetEntityId === query.targetEntityId &&
    (prepared.actor === "agent" || prepared.actor === "analyst") &&
    Number.isInteger(prepared.preparedAtRevision) &&
    Number(prepared.preparedAtRevision) >= 2 &&
    Number(prepared.preparedAtRevision) <= Number(state.revision) &&
    typeof prepared.preparedAt === "string" &&
    !Number.isNaN(Date.parse(prepared.preparedAt)) &&
    (query.requiresStageId === null ||
      releasedStageIds.includes(query.requiresStageId)) &&
    !state.executedInvestigationQueryIds.includes(query.id)
  );
}

function hasValidReportState(
  state: Record<string, unknown> & { responseActions: unknown[] },
  fixture: CaseFixture,
): boolean {
  if (!isRecord(state.report)) return false;
  const reportState = state.report;
  const status = reportState.status;
  if (
    !["unavailable", "drafted", "approved_in_demo"].includes(String(status)) ||
    (reportState.approvedAt !== null &&
      typeof reportState.approvedAt !== "string")
  ) {
    return false;
  }

  if (status === "unavailable") {
    if (
      reportState.report !== null ||
      reportState.approvedAt !== null ||
      reportState.analystClosureNote !== null
    ) {
      return false;
    }
    if (
      state.lifecycle !== "investigating" &&
      state.lifecycle !== "contained_in_demo"
    ) {
      return false;
    }
    if (state.lifecycle === "contained_in_demo") {
      return fixture.conclusion.requiredActionIds.every((actionId) => {
        const action = state.responseActions.find(
          (candidate) => isRecord(candidate) && candidate.actionId === actionId,
        );
        return isRecord(action) && action.status === "authorized_in_demo";
      });
    }
    return true;
  }

  if (
    !isRecord(state.decision) ||
    state.decision.status !== fixture.conclusion.requiredDecision ||
    !Array.isArray(state.releasedStreamStageIds) ||
    state.releasedStreamStageIds.length !== fixture.stream.stages.length ||
    !isValidCaseReport(reportState.report, fixture, state)
  ) {
    return false;
  }
  if (
    fixture.conclusion.requiredActionIds.some((actionId) => {
      const action = state.responseActions.find(
        (candidate) => isRecord(candidate) && candidate.actionId === actionId,
      );
      return !isRecord(action) || action.status !== "authorized_in_demo";
    })
  ) {
    return false;
  }

  if (status === "drafted") {
    return (
      state.lifecycle === "report_drafted" &&
      reportState.approvedAt === null &&
      reportState.analystClosureNote === null
    );
  }

  const closureNote = normalizeAnalystClosureNote(
    reportState.analystClosureNote,
  );
  return (
    state.lifecycle === "closed_in_demo" &&
    typeof reportState.approvedAt === "string" &&
    closureNote !== null &&
    closureNote === reportState.analystClosureNote
  );
}

function isValidCaseReport(
  value: unknown,
  fixture: CaseFixture,
  state: Record<string, unknown> & { responseActions: unknown[] },
): value is CaseReport {
  const expectedNarrative = getCaseReportNarrative(
    fixture,
    state as unknown as Pick<CaseState, "decision">,
  );
  if (
    !isRecord(value) ||
    value.id !== fixture.conclusion.reportId ||
    value.version !== fixture.conclusion.reportVersion ||
    value.title !== fixture.conclusion.title ||
    value.disposition !== fixture.conclusion.disposition ||
    value.executiveSummary !== expectedNarrative.executiveSummary ||
    typeof value.generatedAt !== "string" ||
    !Array.isArray(value.confirmedFindings) ||
    !Array.isArray(value.limitations) ||
    !Array.isArray(value.residualRisk) ||
    !Array.isArray(value.evidenceIds) ||
    !Array.isArray(value.actionIds)
  ) {
    return false;
  }
  const exact = (left: readonly unknown[], right: readonly string[]) =>
    left.length === right.length &&
    left.every((item, index) => item === right[index]);
  if (
    !exact(value.confirmedFindings, expectedNarrative.confirmedFindings) ||
    !exact(value.limitations, fixture.conclusion.limitations) ||
    !exact(value.residualRisk, fixture.conclusion.residualRisk)
  ) {
    return false;
  }
  if (
    !Array.isArray(state.attachedEnrichmentIds) ||
    !state.attachedEnrichmentIds.every((id) => typeof id === "string")
  ) {
    return false;
  }
  const expectedEvidenceIds = [
    ...fixture.events.map((event) => event.id),
    ...fixture.stream.stages.flatMap((stage) =>
      stage.events.map((event) => event.id),
    ),
    ...fixture.joins.map((join) => join.id),
    ...fixture.stream.stages.flatMap((stage) =>
      stage.joins.map((join) => join.id),
    ),
    ...state.attachedEnrichmentIds,
  ];
  const expectedActionIds = state.responseActions.flatMap((action) =>
    isRecord(action) &&
    action.status === "authorized_in_demo" &&
    typeof action.actionId === "string"
      ? [action.actionId]
      : [],
  );
  return (
    exact(value.evidenceIds, expectedEvidenceIds) &&
    exact(value.actionIds, expectedActionIds)
  );
}

function hasValidInvestigationState(
  state: Record<string, unknown>,
  visibleEntityIds: ReadonlySet<string>,
): boolean {
  const decision = state.decision;
  if (!isRecord(decision)) return false;
  const pending = decision.status === "pending";
  if (
    pending
      ? decision.rationale !== null || decision.decidedAt !== null
      : typeof decision.rationale !== "string" ||
        typeof decision.decidedAt !== "string"
  ) {
    return false;
  }
  if (
    (state.reachabilityAttached === true && pending) ||
    (state.counterfactualAttached === true &&
      state.reachabilityAttached !== true)
  ) {
    return false;
  }
  return isValidInvestigationProposal(
    state.proposal,
    Number(state.revision),
    visibleEntityIds,
  );
}

function isValidInvestigationProposal(
  value: unknown,
  revision: number,
  visibleEntityIds: ReadonlySet<string>,
): boolean {
  if (value === null) return true;
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    ["inspect", "decide", "scope", "model", "respond"].includes(
      String(value.phase),
    ) &&
    typeof value.objective === "string" &&
    value.objective.length >= 8 &&
    value.objective.length <= 180 &&
    typeof value.recommendedTool === "string" &&
    (value.targetEntityId === null ||
      (typeof value.targetEntityId === "string" &&
        visibleEntityIds.has(value.targetEntityId))) &&
    Number.isInteger(value.basedOnRevision) &&
    Number(value.basedOnRevision) >= 1 &&
    Number(value.basedOnRevision) < revision &&
    isOperationSurface(value.reportedSurface)
  );
}

function isValidObservationRequest(
  value: unknown,
  fixture: CaseFixture,
  state: Record<string, unknown> & { releasedStreamStageIds: unknown[] },
): boolean {
  if (value === null) return true;
  if (
    !isRecord(value) ||
    typeof value.stageId !== "string" ||
    typeof value.rationale !== "string" ||
    value.rationale.length < 8 ||
    value.rationale.length > 240 ||
    !Array.isArray(value.targetEntityIds) ||
    !value.targetEntityIds.every((id) => typeof id === "string") ||
    !Number.isInteger(value.basedOnRevision) ||
    Number(value.basedOnRevision) < 1 ||
    Number(value.basedOnRevision) >= Number(state.revision) ||
    typeof value.requestedAt !== "string" ||
    !["pending", "released"].includes(String(value.status)) ||
    (value.releasedAt !== null && typeof value.releasedAt !== "string")
  ) {
    return false;
  }
  const stage = fixture.stream.stages.find(
    (candidate) => candidate.id === value.stageId,
  );
  if (!stage) return false;
  const released = state.releasedStreamStageIds.includes(stage.id);
  if (value.status === "pending") {
    return !released && value.releasedAt === null;
  }
  return released && typeof value.releasedAt === "string";
}

function isValidAuthorizedBundleIds(
  value: unknown,
  definitions: ReadonlyMap<string, ResponseBundleDefinition>,
  responseActions: readonly unknown[],
): boolean {
  if (
    !Array.isArray(value) ||
    !value.every((id) => typeof id === "string") ||
    new Set(value).size !== value.length
  ) {
    return false;
  }
  return value.every((bundleId) => {
    const definition = definitions.get(bundleId);
    return (
      definition !== undefined &&
      definition.actionIds.every((actionId) => {
        const action = responseActions.find(
          (candidate) => isRecord(candidate) && candidate.actionId === actionId,
        );
        return isRecord(action) && action.status === "authorized_in_demo";
      })
    );
  });
}

function isValidResponseBundle(
  value: unknown,
  definitions: ReadonlyMap<string, ResponseBundleDefinition>,
  responseActions: readonly unknown[],
  revision: number,
): boolean {
  if (value === null) return true;
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.bundleId !== "string" ||
    !Array.isArray(value.actionIds) ||
    !value.actionIds.every((id) => typeof id === "string") ||
    typeof value.reasoning !== "string" ||
    value.reasoning.length < 8 ||
    value.reasoning.length > 240 ||
    !Number.isInteger(value.basedOnRevision) ||
    Number(value.basedOnRevision) < 1 ||
    Number(value.basedOnRevision) >= revision ||
    typeof value.preparedAt !== "string" ||
    !isOperationSurface(value.reportedSurface)
  ) {
    return false;
  }
  const definition = definitions.get(value.bundleId);
  if (
    !definition ||
    value.actionIds.length !== definition.actionIds.length ||
    !value.actionIds.every(
      (actionId, index) => actionId === definition.actionIds[index],
    )
  ) {
    return false;
  }
  return definition.actionIds.every((actionId) => {
    const action = responseActions.find(
      (candidate) => isRecord(candidate) && candidate.actionId === actionId,
    );
    return (
      isRecord(action) &&
      action.status === "simulated" &&
      action.proposalId === value.id &&
      typeof action.simulatedAt === "string" &&
      action.authorizedAt === null
    );
  });
}

function isValidResponseProposal(
  value: unknown,
  actionDefinitions: ReadonlyMap<string, ResponseActionDefinition>,
  releasedStageIds: readonly string[],
  responseActions: readonly unknown[],
  revision: number,
  responseBundle: unknown,
): boolean {
  const activeActions = responseActions.filter(
    (action) =>
      isRecord(action) &&
      (action.status === "proposed" || action.status === "simulated"),
  );
  if (responseBundle !== null) {
    return value === null;
  }
  if (activeActions.length > 1) return false;
  if (value === null) return activeActions.length === 0;
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.actionId !== "string" ||
    typeof value.reasoning !== "string" ||
    value.reasoning.length < 8 ||
    value.reasoning.length > 240 ||
    !Number.isInteger(value.basedOnRevision) ||
    Number(value.basedOnRevision) < 1 ||
    Number(value.basedOnRevision) >= revision ||
    !isOperationSurface(value.reportedSurface)
  ) {
    return false;
  }

  const definition = actionDefinitions.get(value.actionId);
  const actionState = responseActions.find(
    (action) => isRecord(action) && action.actionId === value.actionId,
  );
  if (
    !definition ||
    !releasedStageIds.includes(definition.requiresStageId) ||
    !isRecord(actionState) ||
    actionState.proposalId !== value.id ||
    !["proposed", "simulated"].includes(String(actionState.status))
  ) {
    return false;
  }
  const activeAction = activeActions[0];
  return (
    activeAction === undefined ||
    (isRecord(activeAction) && activeAction.actionId === value.actionId)
  );
}

function isOperationSurface(value: unknown): boolean {
  return value === "webmcp_callback" || value === "analyst_control";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
