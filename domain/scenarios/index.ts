import type { CaseFixture, Tier1RecommendationTool } from "../types";
import { getQueryConsoleContract } from "../query-console";
import { cloudIdentityScenario } from "./cloud-identity";
import { endpointLateralScenario } from "./endpoint-lateral";

const fixtures = [
  cloudIdentityScenario,
  endpointLateralScenario,
] satisfies readonly CaseFixture[];

const tier1RecommendationTools = new Set<Tier1RecommendationTool>([
  "inspect_event",
  "inspect_entity",
  "inspect_relationship",
  "query_related_activity",
  "enrich_identity",
  "enrich_network_indicator",
  "enrich_cloud_role",
  "enrich_resource",
  "enrich_endpoint",
  "enrich_file",
]);

export function validateCaseFixture(fixture: CaseFixture): void {
  if (
    fixture.presentation.command.stageScopes.length !==
    fixture.stream.stages.length
  ) {
    throw new Error(`${fixture.id} must define one command scope per stage.`);
  }

  if (fixture.events.length < 7 || fixture.events.length > 12) {
    throw new Error(`${fixture.id} must contain 7 to 12 observed events.`);
  }

  if (fixture.entities.length < 4 || fixture.entities.length > 7) {
    throw new Error(`${fixture.id} must contain 4 to 7 entities.`);
  }

  if (fixture.joins.length < 3 || fixture.joins.length > 5) {
    throw new Error(`${fixture.id} must contain 3 to 5 evidence joins.`);
  }

  if (fixture.enrichments.length < 3) {
    throw new Error(`${fixture.id} must contain at least three enrichments.`);
  }

  const enrichmentCategories = new Set(
    fixture.enrichments.map((artifact) => artifact.sourceCategory),
  );
  if (enrichmentCategories.size < 3) {
    throw new Error(
      `${fixture.id} must contain at least three enrichment source categories.`,
    );
  }

  const stageIds = new Set<string>();
  for (const [index, stage] of fixture.stream.stages.entries()) {
    if (stageIds.has(stage.id) || stage.ordinal !== index + 1) {
      throw new Error(`${fixture.id} has an invalid stream stage order.`);
    }
    stageIds.add(stage.id);
  }

  const allEntities = [
    ...fixture.entities,
    ...fixture.stream.stages.flatMap((stage) => stage.entities),
  ];
  const allEvents = [
    ...fixture.events,
    ...fixture.stream.stages.flatMap((stage) => stage.events),
  ];
  const allJoins = [
    ...fixture.joins,
    ...fixture.stream.stages.flatMap((stage) => stage.joins),
  ];
  const allEnrichments = [
    ...fixture.enrichments,
    ...fixture.stream.stages.flatMap((stage) => stage.enrichments),
  ];
  const allGraphNodes = [
    ...fixture.presentation.nodes,
    ...fixture.stream.stages.flatMap((stage) => stage.graphNodes),
  ];
  const entityIds = new Set(allEntities.map((entity) => entity.id));
  const eventIds = new Set(allEvents.map((event) => event.id));
  const initialEntityIds = new Set(fixture.entities.map((entity) => entity.id));
  const initialEventIds = new Set(fixture.events.map((event) => event.id));
  if (
    entityIds.size !== allEntities.length ||
    eventIds.size !== allEvents.length
  ) {
    throw new Error(`${fixture.id} has duplicate entity or event IDs.`);
  }
  const allGraphEntityIds = allGraphNodes.map((node) => node.entityId);
  if (
    new Set(allGraphEntityIds).size !== allGraphEntityIds.length ||
    allGraphEntityIds.length !== allEntities.length ||
    !allGraphEntityIds.every((id) => entityIds.has(id))
  ) {
    throw new Error(`${fixture.id} has an invalid graph node definition.`);
  }
  for (const stage of fixture.stream.stages) {
    const stageEntityIds = stage.entities.map((entity) => entity.id).sort();
    const stageGraphEntityIds = stage.graphNodes
      .map((node) => node.entityId)
      .sort();
    if (
      stageEntityIds.length !== stageGraphEntityIds.length ||
      stageEntityIds.some((id, index) => id !== stageGraphEntityIds[index])
    ) {
      throw new Error(`${stage.id} has an invalid staged graph definition.`);
    }
  }
  const artifactIds = new Set<string>();
  const artifactSequences = new Set<number>();
  const artifacts = [
    ...allEvents,
    ...allJoins,
    ...allEnrichments,
    fixture.tier1Escalation,
    fixture.decision,
    fixture.reachability,
    fixture.counterfactual,
  ];

  for (const artifact of artifacts) {
    if (artifactIds.has(artifact.id)) {
      throw new Error(`${fixture.id} has duplicate artifact ${artifact.id}.`);
    }
    artifactIds.add(artifact.id);
    if (artifactSequences.has(artifact.sequence)) {
      throw new Error(
        `${fixture.id} has duplicate artifact sequence ${artifact.sequence}.`,
      );
    }
    artifactSequences.add(artifact.sequence);

    if (
      artifact.caseId !== fixture.id ||
      artifact.scenarioId !== fixture.scenarioId ||
      artifact.fixtureVersion !== fixture.fixtureVersion ||
      artifact.synthetic !== true
    ) {
      throw new Error(`${artifact.id} has invalid fixture provenance.`);
    }
  }

  for (const milestone of fixture.presentation.command.scopeMilestones) {
    if (
      milestone.requiresEnrichmentIds.length === 0 ||
      !milestone.requiresEnrichmentIds.every((id) => artifactIds.has(id))
    ) {
      throw new Error(`${fixture.id} has an invalid command scope milestone.`);
    }
  }

  for (const event of allEvents) {
    if (!event.entityIds.every((entityId) => entityIds.has(entityId))) {
      throw new Error(`${event.id} references an unknown entity.`);
    }
  }

  for (const join of allJoins) {
    if (
      !entityIds.has(join.fromEntityId) ||
      !entityIds.has(join.toEntityId) ||
      !join.evidenceIds.every((eventId) => eventIds.has(eventId))
    ) {
      throw new Error(`${join.id} has an invalid entity or event reference.`);
    }
  }

  for (const enrichment of allEnrichments) {
    if (!entityIds.has(enrichment.entityId)) {
      throw new Error(`${enrichment.id} references an unknown entity.`);
    }
  }

  const queryIds = new Set(
    fixture.investigationQueries.map((query) => query.id),
  );
  if (
    fixture.investigationQueries.length === 0 ||
    queryIds.size !== fixture.investigationQueries.length
  ) {
    throw new Error(`${fixture.id} has invalid investigation query IDs.`);
  }
  for (const query of fixture.investigationQueries) {
    const consoleContract = getQueryConsoleContract(query.id);
    const artifact = allEnrichments.find(
      (candidate) => candidate.id === query.resultArtifactId,
    );
    const scanned = query.sourceScopes.reduce(
      (total, scope) => total + scope.syntheticRecordCount,
      0,
    );
    const expectedStage = query.requiresStageId
      ? fixture.stream.stages.find(
          (stage) => stage.id === query.requiresStageId,
        )
      : null;
    const resultIsAvailableAtRequiredStage = query.requiresStageId
      ? expectedStage?.enrichments.some(
          (candidate) => candidate.id === query.resultArtifactId,
        ) === true
      : fixture.enrichments.some(
          (candidate) => candidate.id === query.resultArtifactId,
        );
    const resultRecordIds = new Set(
      query.returnedRecords.map((record) => record.id),
    );
    const sourceLabels = new Set(
      query.sourceScopes.map((scope) => scope.sourceLabel),
    );
    if (
      !entityIds.has(query.targetEntityId) ||
      !artifact ||
      artifact.entityId !== query.targetEntityId ||
      artifact.toolName !== query.toolName ||
      !resultIsAvailableAtRequiredStage ||
      query.sourceScopes.length === 0 ||
      query.sourceScopes.some(
        (scope) =>
          !Number.isInteger(scope.syntheticRecordCount) ||
          scope.syntheticRecordCount < 1 ||
          Number.isNaN(Date.parse(scope.timeRange.start)) ||
          Number.isNaN(Date.parse(scope.timeRange.end)) ||
          Date.parse(scope.timeRange.start) > Date.parse(scope.timeRange.end),
      ) ||
      !Number.isInteger(query.matchedRecordCount) ||
      !Number.isInteger(query.returnedRecordCount) ||
      query.matchedRecordCount < 1 ||
      query.returnedRecordCount < 1 ||
      query.returnedRecordCount > query.matchedRecordCount ||
      query.matchedRecordCount > scanned ||
      query.returnedRecords.length !== query.returnedRecordCount ||
      resultRecordIds.size !== query.returnedRecords.length ||
      query.returnedRecords.some(
        (record) =>
          !record.id ||
          !sourceLabels.has(record.sourceLabel) ||
          Number.isNaN(Date.parse(record.timestamp)) ||
          record.entityIds.length === 0 ||
          !record.entityIds.every((entityId) => entityIds.has(entityId)) ||
          !record.recordType ||
          record.fields.length === 0 ||
          record.fields.some((field) => !field.label || !field.value),
      ) ||
      !consoleContract ||
      consoleContract.text.length < 40 ||
      consoleContract.text.length > 900
    ) {
      throw new Error(`${query.id} has an invalid bounded query definition.`);
    }
  }

  const visibleBeforeStageEntityIds = new Set(initialEntityIds);
  const visibleBeforeStageEventIds = new Set(initialEventIds);
  const visibleBeforeStageEnrichmentIds = new Set(
    fixture.enrichments.map((artifact) => artifact.id),
  );
  for (const stage of fixture.stream.stages) {
    const stageVisibleEntityIds = new Set([
      ...visibleBeforeStageEntityIds,
      ...stage.entities.map((entity) => entity.id),
    ]);
    const stageVisibleEventIds = new Set([
      ...visibleBeforeStageEventIds,
      ...stage.events.map((event) => event.id),
    ]);
    const sourceQueries = stage.admission.sourceQueryIds.flatMap((queryId) => {
      const query = fixture.investigationQueries.find(
        (candidate) => candidate.id === queryId,
      );
      return query ? [query] : [];
    });
    const sourceRecordIds = new Set(
      sourceQueries.flatMap((query) =>
        query.returnedRecords.map((record) => record.id),
      ),
    );
    if (
      stage.admission.requiredEnrichmentIds.length === 0 ||
      stage.admission.sourceQueryIds.length === 0 ||
      stage.admission.sourceRecordIds.length === 0 ||
      sourceQueries.length !== stage.admission.sourceQueryIds.length ||
      !stage.admission.requiredEnrichmentIds.every((id) =>
        visibleBeforeStageEnrichmentIds.has(id),
      ) ||
      !sourceQueries.every((query) =>
        stage.admission.requiredEnrichmentIds.includes(query.resultArtifactId),
      ) ||
      !stage.admission.sourceRecordIds.every((id) => sourceRecordIds.has(id)) ||
      !stage.events.every((event) =>
        event.entityIds.every((id) => stageVisibleEntityIds.has(id)),
      ) ||
      !stage.joins.every(
        (join) =>
          stageVisibleEntityIds.has(join.fromEntityId) &&
          stageVisibleEntityIds.has(join.toEntityId) &&
          join.evidenceIds.every((id) => stageVisibleEventIds.has(id)),
      )
    ) {
      throw new Error(`${stage.id} has an invalid discovery admission.`);
    }
    for (const entity of stage.entities) {
      visibleBeforeStageEntityIds.add(entity.id);
    }
    for (const event of stage.events) {
      visibleBeforeStageEventIds.add(event.id);
    }
    for (const artifact of stage.enrichments) {
      visibleBeforeStageEnrichmentIds.add(artifact.id);
    }
  }

  const tier1ObservationIds = new Set(
    fixture.tier1Escalation.observations.map((observation) => observation.id),
  );
  const tier1StepIds = new Set(
    fixture.tier1Escalation.recommendedSteps.map((step) => step.id),
  );
  if (
    fixture.tier1Escalation.observations.length === 0 ||
    fixture.tier1Escalation.recommendedSteps.length === 0 ||
    tier1ObservationIds.size !== fixture.tier1Escalation.observations.length ||
    tier1StepIds.size !== fixture.tier1Escalation.recommendedSteps.length ||
    !fixture.tier1Escalation.observations.every(
      (observation) =>
        observation.entityIds.length > 0 &&
        observation.evidenceIds.length > 0 &&
        observation.entityIds.every((id) => initialEntityIds.has(id)) &&
        observation.evidenceIds.every((id) => initialEventIds.has(id)),
    )
  ) {
    throw new Error(`${fixture.id} has an invalid Tier 1 observation.`);
  }
  if (
    !fixture.tier1Escalation.recommendedSteps.every((step) => {
      if (
        !tier1RecommendationTools.has(step.recommendedTool) ||
        !initialEntityIds.has(step.entityId) ||
        step.evidenceIds.length === 0 ||
        !step.evidenceIds.every((id) => initialEventIds.has(id))
      ) {
        return false;
      }
      if (step.completionArtifactId === null) return true;
      const artifact = allEnrichments.find(
        (candidate) => candidate.id === step.completionArtifactId,
      );
      const query = step.investigationQueryId
        ? fixture.investigationQueries.find(
            (candidate) => candidate.id === step.investigationQueryId,
          )
        : null;
      return (
        artifact?.entityId === step.entityId &&
        artifact.toolName === step.recommendedTool &&
        query?.targetEntityId === step.entityId &&
        query.resultArtifactId === step.completionArtifactId &&
        query.toolName === step.recommendedTool &&
        query.requiresStageId === null
      );
    })
  ) {
    throw new Error(`${fixture.id} has an invalid Tier 1 recommendation.`);
  }

  if (!fixture.primaryTraceEventIds.every((eventId) => eventIds.has(eventId))) {
    throw new Error(`${fixture.id} has an invalid primary trace event.`);
  }

  if (
    !fixture.tier1Escalation.evidenceIds.every((eventId) =>
      eventIds.has(eventId),
    ) ||
    !fixture.decision.evidenceIds.every((artifactId) =>
      artifactIds.has(artifactId),
    )
  ) {
    throw new Error(
      `${fixture.id} has invalid escalation or decision evidence.`,
    );
  }

  const responseActionIds = new Set(
    fixture.responseActions.map((action) => action.id),
  );
  if (responseActionIds.size !== fixture.responseActions.length) {
    throw new Error(`${fixture.id} has duplicate response action IDs.`);
  }
  const stagedResponseActionIds = new Set<string>();
  for (const stage of fixture.stream.stages) {
    for (const actionId of stage.responseActionIds) {
      const action = fixture.responseActions.find(
        (candidate) => candidate.id === actionId,
      );
      if (
        !action ||
        action.requiresStageId !== stage.id ||
        stagedResponseActionIds.has(action.id)
      ) {
        throw new Error(`${stage.id} has an invalid response action mapping.`);
      }
      stagedResponseActionIds.add(action.id);
    }
  }
  if (stagedResponseActionIds.size !== fixture.responseActions.length) {
    throw new Error(`${fixture.id} has an unstaged response action.`);
  }
  for (const action of fixture.responseActions) {
    if (
      !stageIds.has(action.requiresStageId) ||
      !entityIds.has(action.targetEntityId) ||
      !action.dependsOnActionIds.every((id) => responseActionIds.has(id)) ||
      !action.requiresEnrichmentIds.every((id) => artifactIds.has(id)) ||
      !action.evidenceIds.every((id) => eventIds.has(id)) ||
      action.executionScope !== "synthetic_demo_only" ||
      action.requiresHumanAuthorization !== true
    ) {
      throw new Error(`${action.id} has an invalid response boundary.`);
    }
  }

  if (
    !fixture.reachability.reachableEntityIds.every((entityId) =>
      entityIds.has(entityId),
    ) ||
    !fixture.reachability.paths.every((path) =>
      path.entityIds.every((entityId) => entityIds.has(entityId)),
    ) ||
    !entityIds.has(fixture.counterfactual.changedEntityId)
  ) {
    throw new Error(`${fixture.id} has an invalid model entity reference.`);
  }

  const pathIds = new Set(fixture.reachability.paths.map((path) => path.id));
  if (
    !fixture.counterfactual.severedPathIds.every((pathId) =>
      pathIds.has(pathId),
    ) ||
    !fixture.counterfactual.remainingPathIds.every((pathId) =>
      pathIds.has(pathId),
    )
  ) {
    throw new Error(
      `${fixture.id} has an invalid counterfactual path reference.`,
    );
  }

  if (
    !entityIds.has(fixture.reachability.sourceEntityId) ||
    !fixture.responseActions.every((action) =>
      action.seversPathIds.every((pathId) => pathIds.has(pathId)),
    )
  ) {
    throw new Error(`${fixture.id} has an invalid response impact path.`);
  }

  const decisionOptionIds = new Set(
    fixture.decision.options.map((option) => option.id),
  );
  if (
    decisionOptionIds.size !== fixture.decision.options.length ||
    !fixture.decision.requiresEnrichmentIds.every((id) =>
      artifactIds.has(id),
    ) ||
    !decisionOptionIds.has(fixture.conclusion.requiredDecision) ||
    !fixture.conclusion.requiredEnrichmentIds.every((id) =>
      artifactIds.has(id),
    ) ||
    !fixture.conclusion.requiredActionIds.every((id) =>
      responseActionIds.has(id),
    )
  ) {
    throw new Error(`${fixture.id} has an invalid conclusion gate.`);
  }

  const graphEntityIds = new Set(
    fixture.presentation.nodes.map((node) => node.entityId),
  );
  const threatOverlay = fixture.impact.threatOverlay;
  const threatIssueIds = new Set(
    threatOverlay?.issues.map((issue) => issue.id) ?? [],
  );
  const threatIssueRanks = new Set(
    threatOverlay?.issues.map((issue) => issue.rank) ?? [],
  );
  const priorityRoutePairs =
    threatOverlay?.priorityRoute.entityIds
      .slice(0, -1)
      .map((fromId, index) => ({
        fromId,
        toId: threatOverlay.priorityRoute.entityIds[index + 1]!,
      })) ?? [];
  const priorityRoutePathIds = new Set(
    threatOverlay?.priorityRoute.pathIds ?? [],
  );
  const priorityRouteJoinIds = new Set(
    threatOverlay?.priorityRoute.joinIds ?? [],
  );
  const priorityRouteValid =
    !threatOverlay ||
    (threatOverlay.priorityRoute.entityIds.length >= 2 &&
      new Set(threatOverlay.priorityRoute.entityIds).size ===
        threatOverlay.priorityRoute.entityIds.length &&
      threatOverlay.priorityRoute.pathIds.length ===
        priorityRoutePairs.length &&
      priorityRoutePathIds.size ===
        threatOverlay.priorityRoute.pathIds.length &&
      threatOverlay.priorityRoute.pathIds.every((pathId, index) => {
        const path = fixture.reachability.paths.find(
          (candidate) => candidate.id === pathId,
        );
        const pair = priorityRoutePairs[index];
        return (
          path?.entityIds.length === 2 &&
          path.entityIds[0] === pair?.fromId &&
          path.entityIds[1] === pair?.toId
        );
      }) &&
      threatOverlay.priorityRoute.joinIds.length ===
        priorityRoutePairs.length &&
      priorityRouteJoinIds.size ===
        threatOverlay.priorityRoute.joinIds.length &&
      threatOverlay.priorityRoute.joinIds.every((joinId, index) => {
        const join = allJoins.find((candidate) => candidate.id === joinId);
        const pair = priorityRoutePairs[index];
        return (
          join?.fromEntityId === pair?.fromId && join?.toEntityId === pair?.toId
        );
      }));
  const threatOverlayValid =
    !threatOverlay ||
    (threatIssueIds.size === threatOverlay.issues.length &&
      threatIssueRanks.size === threatOverlay.issues.length &&
      priorityRouteValid &&
      threatOverlay.issues.every(
        (issue) =>
          issue.rank > 0 &&
          entityIds.has(issue.entityId) &&
          (issue.requiresStageId === null ||
            stageIds.has(issue.requiresStageId)),
      ) &&
      threatOverlay.priorityRoute.entityIds.every((id) => entityIds.has(id)) &&
      threatOverlay.priorityRoute.pathIds.every((id) => pathIds.has(id)) &&
      threatOverlay.priorityRoute.joinIds.every((id) => artifactIds.has(id)));
  if (
    graphEntityIds.size !== fixture.presentation.nodes.length ||
    !fixture.presentation.nodes.every((node) => entityIds.has(node.entityId)) ||
    !fixture.impact.observedEntityIds.every((id) => entityIds.has(id)) ||
    !fixture.impact.atRiskEntityIds.every((id) => entityIds.has(id)) ||
    !fixture.impact.blockedJoinIds.every((id) => artifactIds.has(id)) ||
    !threatOverlayValid
  ) {
    throw new Error(`${fixture.id} has an invalid impact presentation.`);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visitAction = (actionId: string): boolean => {
    if (visited.has(actionId)) return true;
    if (visiting.has(actionId)) return false;
    const action = fixture.responseActions.find(
      (candidate) => candidate.id === actionId,
    );
    if (!action) return false;
    visiting.add(actionId);
    if (!action.dependsOnActionIds.every(visitAction)) return false;
    visiting.delete(actionId);
    visited.add(actionId);
    return true;
  };
  if (!fixture.responseActions.every((action) => visitAction(action.id))) {
    throw new Error(`${fixture.id} has a cyclic response dependency.`);
  }

  if (
    fixture.alerts.filter((alert) => alert.selected).length !== 1 ||
    fixture.alerts.some(
      (alert) => alert.caseId !== null && alert.caseId !== fixture.id,
    )
  ) {
    throw new Error(
      `${fixture.id} must have one selected, correctly linked alert.`,
    );
  }
}

for (const fixture of fixtures) {
  validateCaseFixture(fixture);
}

export function getCaseFixture(caseId: string): CaseFixture | null {
  return fixtures.find((fixture) => fixture.id === caseId) ?? null;
}

export function getAllFixtures(): readonly CaseFixture[] {
  return fixtures;
}

export { cloudIdentityScenario, endpointLateralScenario };
