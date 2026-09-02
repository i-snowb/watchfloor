import type { PublicCaseFixture, PublicCaseView } from "@/domain/public-view";
import {
  getAppliedStreamStages,
  getVisibleEntities,
  getVisibleEvents,
  getVisibleGraphNodes,
  getVisibleJoins,
} from "@/domain/incident-stream";
import { createInitialCaseState } from "@/domain/operations";
import { getCaseToolManifest } from "@/domain/tool-manifest";
import type {
  CaseFixture,
  CaseSnapshot,
  CaseState,
  IncidentStreamStage,
  InvestigationQueryDefinition,
  OperationReceipt,
  ResponseActionDefinition,
} from "@/domain/types";

const withheldDiscoveryTitle = "Pending verified discovery";
const withheldDiscoverySummary =
  "Discovery content remains server-side until its evidence admission contract succeeds.";

export function projectInitialPublicCaseView(
  fixture: CaseFixture,
): PublicCaseView {
  return projectPublicCaseView(fixture, {
    state: createInitialCaseState(fixture),
    receipts: [],
  });
}

export function projectPublicCaseView(
  fixture: CaseFixture,
  snapshot: CaseSnapshot,
): PublicCaseView {
  const state = snapshot.state;
  const visibleEntities = getVisibleEntities(fixture, state);
  const visibleEvents = getVisibleEvents(fixture, state);
  const visibleJoins = getVisibleJoins(fixture, state);
  const visibleGraphNodes = getVisibleGraphNodes(fixture, state);
  const visibleEntityIds = new Set(visibleEntities.map((entity) => entity.id));
  const visibleEventIds = new Set(visibleEvents.map((event) => event.id));
  const visibleJoinIds = new Set(visibleJoins.map((join) => join.id));
  const visibleGraphEntityIds = new Set(
    visibleGraphNodes.map((node) => node.entityId),
  );
  const releasedStageIds = new Set(state.releasedStreamStageIds);
  const publicQueries = fixture.investigationQueries
    .filter(
      (query) =>
        query.requiresStageId === null ||
        releasedStageIds.has(query.requiresStageId),
    )
    .map((query) => projectQuery(query, state));
  const publicArtifactIds = new Set(
    publicQueries.map((query) => query.resultArtifactId),
  );
  const publicQueryIds = new Set(publicQueries.map((query) => query.id));
  const publicRecordIds = new Set(
    publicQueries.flatMap((query) =>
      state.executedInvestigationQueryIds.includes(query.id)
        ? query.returnedRecords.map((record) => record.id)
        : [],
    ),
  );
  const publicResponseActions = fixture.responseActions.filter((action) =>
    releasedStageIds.has(action.requiresStageId),
  );
  const publicResponseActionIds = new Set(
    publicResponseActions.map((action) => action.id),
  );
  const releasedStages = getAppliedStreamStages(fixture, state).map((stage) =>
    projectReleasedStage(
      stage,
      visibleEntityIds,
      visibleEventIds,
      visibleJoinIds,
      visibleGraphEntityIds,
      publicResponseActionIds,
    ),
  );
  const nextStage = fixture.stream.stages[state.releasedStreamStageIds.length];
  const publicStages = nextStage
    ? [
        ...releasedStages,
        projectWithheldStage(nextStage, fixture.timeRange.end),
      ]
    : releasedStages;
  const attachedEnrichmentIds = new Set(state.attachedEnrichmentIds);
  const baseEntityIds = new Set(fixture.entities.map((entity) => entity.id));
  const baseEventIds = new Set(fixture.events.map((event) => event.id));
  const baseJoinIds = new Set(fixture.joins.map((join) => join.id));
  const baseGraphEntityIds = new Set(
    fixture.presentation.nodes.map((node) => node.entityId),
  );
  const projectedState = projectState(
    state,
    visibleEntityIds,
    publicResponseActionIds,
  );
  const reportAvailable = projectedState.report.report !== null;
  const decisionRecorded = projectedState.decision.status !== "pending";
  const publicRequiredDecision = decisionRecorded
    ? fixture.conclusion.requiredDecision
    : "insufficient_evidence";
  const publicDecision = {
    ...fixture.decision,
    evidenceIds: fixture.decision.evidenceIds.filter(
      (id) =>
        visibleEventIds.has(id) ||
        visibleJoinIds.has(id) ||
        attachedEnrichmentIds.has(id),
    ),
  };
  if (!(
    fixture.decision.deeperForensics &&
    (state.decision.status === fixture.decision.deeperForensics.holdDecision ||
      fixture.decision.deeperForensics.queryIds.some((queryId) =>
        state.executedInvestigationQueryIds.includes(queryId),
      ))
  )) {
    delete publicDecision.deeperForensics;
  }
  const publicThreatOverlay = projectThreatOverlay(
    fixture,
    state,
    visibleEntityIds,
    visibleJoinIds,
  );
  const publicImpact = {
    ...fixture.impact,
    observedEntityIds: fixture.impact.observedEntityIds.filter((id) =>
      visibleEntityIds.has(id),
    ),
    atRiskEntityIds: state.reachabilityAttached
      ? fixture.impact.atRiskEntityIds.filter((id) => visibleEntityIds.has(id))
      : [],
    blockedJoinIds: state.counterfactualAttached
      ? fixture.impact.blockedJoinIds.filter((id) => visibleJoinIds.has(id))
      : [],
  };
  if (publicThreatOverlay) {
    publicImpact.threatOverlay = publicThreatOverlay;
  } else {
    delete publicImpact.threatOverlay;
  }
  const publicFixture: PublicCaseFixture = {
    ...fixture,
    publicProjection: true,
    projectionRevision: state.revision,
    entities: visibleEntities.filter((entity) => baseEntityIds.has(entity.id)),
    events: visibleEvents.filter((event) => baseEventIds.has(event.id)),
    primaryTraceEventIds: fixture.primaryTraceEventIds.filter((eventId) =>
      visibleEventIds.has(eventId),
    ),
    joins: visibleJoins.filter((join) => baseJoinIds.has(join.id)),
    enrichments: fixture.enrichments.filter((artifact) =>
      attachedEnrichmentIds.has(artifact.id),
    ),
    investigationQueries: publicQueries,
    decision: publicDecision,
    reachability: state.reachabilityAttached
      ? fixture.reachability
      : {
          ...fixture.reachability,
          sourceEntityId: visibleEntityIds.has(
            fixture.reachability.sourceEntityId,
          )
            ? fixture.reachability.sourceEntityId
            : (visibleEntities[0]?.id ?? fixture.reachability.sourceEntityId),
          assumption: "Modeled reach is unavailable until analyst disposition.",
          reachableEntityIds: [],
          paths: [],
          caveat: "No reachability result is attached at this revision.",
        },
    counterfactual: state.counterfactualAttached
      ? fixture.counterfactual
      : {
          ...fixture.counterfactual,
          changedEntityId: visibleEntityIds.has(
            fixture.counterfactual.changedEntityId,
          )
            ? fixture.counterfactual.changedEntityId
            : (visibleEntities[0]?.id ??
              fixture.counterfactual.changedEntityId),
          severedPathIds: [],
          remainingPathIds: [],
          caveat: "No control simulation is attached at this revision.",
        },
    stream: { ...fixture.stream, stages: publicStages },
    responseActions: publicResponseActions,
    presentation: {
      ...fixture.presentation,
      nodes: visibleGraphNodes.filter((node) =>
        baseGraphEntityIds.has(node.entityId),
      ),
      stageQuestions: fixture.presentation.stageQuestions.slice(
        0,
        state.releasedStreamStageIds.length + 1,
      ),
      coverageNotes: fixture.presentation.coverageNotes.slice(
        0,
        state.releasedStreamStageIds.length + 1,
      ),
      command: {
        ...fixture.presentation.command,
        stageScopes: fixture.presentation.command.stageScopes.slice(
          0,
          state.releasedStreamStageIds.length,
        ),
        scopeMilestones: fixture.presentation.command.scopeMilestones.filter(
          (milestone) =>
            milestone.requiresEnrichmentIds.every(
              (id) =>
                publicArtifactIds.has(id) || attachedEnrichmentIds.has(id),
            ),
        ),
      },
    },
    impact: publicImpact,
    conclusion: reportAvailable
      ? fixture.conclusion
      : {
          ...fixture.conclusion,
          reportId: "report-pending",
          reportVersion: "pending",
          title: "Case report pending",
          executiveSummary:
            "The report remains server-side until its evidence and response gates succeed.",
          confirmedFindings: [],
          limitations: [],
          residualRisk: [],
          requiredDecision: publicRequiredDecision,
          requiredEnrichmentIds:
            fixture.conclusion.requiredEnrichmentIds.filter(
              (id) =>
                publicArtifactIds.has(id) || attachedEnrichmentIds.has(id),
            ),
          requiredActionIds: fixture.conclusion.requiredActionIds.filter((id) =>
            publicResponseActionIds.has(id),
          ),
        },
  };

  return {
    fixture: publicFixture,
    snapshot: {
      ...snapshot,
      state: projectedState,
      receipts: projectReceipts(snapshot.receipts, state, {
        visibleEntityIds,
        visibleEventIds,
        visibleJoinIds,
        publicArtifactIds: attachedEnrichmentIds,
        publicQueryIds,
        publicRecordIds,
        publicDiscoveryIds: new Set([
          ...state.releasedStreamStageIds,
          ...(nextStage ? [nextStage.id] : []),
        ]),
        publicReportIds: new Set(
          state.report.report ? [state.report.report.id] : [],
        ),
        publicResponseActionIds,
      }),
      publicProjection: true,
    },
    toolNames: getCaseToolManifest(),
  };
}

function projectQuery(
  query: InvestigationQueryDefinition,
  state: CaseState,
): InvestigationQueryDefinition {
  if (state.executedInvestigationQueryIds.includes(query.id)) return query;
  return {
    ...query,
    matchedRecordCount: 0,
    returnedRecordCount: 0,
    returnedRecords: [],
    resultChange: "Pending bounded execution.",
    caveat: "No query records are attached at this revision.",
  };
}

function projectReleasedStage(
  stage: IncidentStreamStage,
  visibleEntityIds: ReadonlySet<string>,
  visibleEventIds: ReadonlySet<string>,
  visibleJoinIds: ReadonlySet<string>,
  visibleGraphEntityIds: ReadonlySet<string>,
  publicResponseActionIds: ReadonlySet<ResponseActionDefinition["id"]>,
): IncidentStreamStage {
  return {
    ...stage,
    entities: stage.entities.filter((entity) =>
      visibleEntityIds.has(entity.id),
    ),
    graphNodes: stage.graphNodes.filter((node) =>
      visibleGraphEntityIds.has(node.entityId),
    ),
    events: stage.events.filter((event) => visibleEventIds.has(event.id)),
    joins: stage.joins.filter((join) => visibleJoinIds.has(join.id)),
    responseActionIds: stage.responseActionIds.filter((id) =>
      publicResponseActionIds.has(id),
    ),
  };
}

function projectWithheldStage(
  stage: IncidentStreamStage,
  receivedAt: string,
): IncidentStreamStage {
  return {
    ...stage,
    title: withheldDiscoveryTitle,
    summary: withheldDiscoverySummary,
    receivedAt,
    admission: { ...stage.admission, sourceRecordIds: [] },
    entities: [],
    graphNodes: [],
    events: [],
    joins: [],
    enrichments: [],
    responseActionIds: [],
  };
}

function projectState(
  state: CaseState,
  visibleEntityIds: ReadonlySet<string>,
  publicResponseActionIds: ReadonlySet<ResponseActionDefinition["id"]>,
): CaseState {
  return {
    ...state,
    observationRequest: state.observationRequest
      ? {
          ...state.observationRequest,
          targetEntityIds: state.observationRequest.targetEntityIds.filter(
            (entityId) => visibleEntityIds.has(entityId),
          ),
        }
      : null,
    responseActions: state.responseActions.filter((action) =>
      publicResponseActionIds.has(action.actionId),
    ),
  };
}

interface PublicReceiptScope {
  visibleEntityIds: ReadonlySet<string>;
  visibleEventIds: ReadonlySet<string>;
  visibleJoinIds: ReadonlySet<string>;
  publicArtifactIds: ReadonlySet<string>;
  publicQueryIds: ReadonlySet<string>;
  publicRecordIds: ReadonlySet<string>;
  publicDiscoveryIds: ReadonlySet<string>;
  publicReportIds: ReadonlySet<string>;
  publicResponseActionIds: ReadonlySet<string>;
}

function projectReceipts(
  receipts: readonly OperationReceipt[],
  state: CaseState,
  scope: PublicReceiptScope,
): OperationReceipt[] {
  const telemetryPending = state.observationRequest?.status === "pending";
  return receipts.map((receipt) => {
    const references = receipt.references
      ? {
          eventIds: receipt.references.eventIds.filter((id) =>
            scope.visibleEventIds.has(id),
          ),
          entityIds: receipt.references.entityIds.filter((id) =>
            scope.visibleEntityIds.has(id),
          ),
          relationshipIds: receipt.references.relationshipIds.filter((id) =>
            scope.visibleJoinIds.has(id),
          ),
          enrichmentIds: receipt.references.enrichmentIds.filter((id) =>
            scope.publicArtifactIds.has(id),
          ),
          queryIds: receipt.references.queryIds.filter((id) =>
            scope.publicQueryIds.has(id),
          ),
          recordIds: receipt.references.recordIds.filter((id) =>
            scope.publicRecordIds.has(id),
          ),
          discoveryIds: receipt.references.discoveryIds.filter((id) =>
            scope.publicDiscoveryIds.has(id),
          ),
          reportIds: receipt.references.reportIds.filter((id) =>
            scope.publicReportIds.has(id),
          ),
          actionIds: receipt.references.actionIds.filter((id) =>
            scope.publicResponseActionIds.has(id),
          ),
        }
      : undefined;
    const pendingObservationReceipt =
      telemetryPending && receipt.toolName === "request_next_observation";
    return {
      ...receipt,
      ...(pendingObservationReceipt
        ? {
            target: withheldDiscoveryTitle,
            resultSummary:
              "Pending verified discovery requested · analyst release required",
          }
        : {}),
      ...(references ? { references } : {}),
    };
  });
}

function projectThreatOverlay(
  fixture: CaseFixture,
  state: CaseState,
  visibleEntityIds: ReadonlySet<string>,
  visibleJoinIds: ReadonlySet<string>,
): CaseFixture["impact"]["threatOverlay"] {
  const overlay = fixture.impact.threatOverlay;
  if (!overlay) return undefined;
  const issues = overlay.issues.filter(
    (issue) =>
      visibleEntityIds.has(issue.entityId) &&
      (issue.requiresStageId === null ||
        state.releasedStreamStageIds.includes(issue.requiresStageId)) &&
      (!issue.requiresReachability || state.reachabilityAttached),
  );
  if (issues.length === 0) return undefined;
  return {
    issues,
    priorityRoute: {
      ...overlay.priorityRoute,
      title: state.reachabilityAttached
        ? overlay.priorityRoute.title
        : "Priority observed route",
      detail: state.reachabilityAttached
        ? overlay.priorityRoute.detail
        : "Modeled path detail is withheld until reachability is attached.",
      entityIds: overlay.priorityRoute.entityIds.filter((id) =>
        visibleEntityIds.has(id),
      ),
      pathIds: state.reachabilityAttached ? overlay.priorityRoute.pathIds : [],
      joinIds: overlay.priorityRoute.joinIds.filter((id) =>
        visibleJoinIds.has(id),
      ),
    },
  };
}
