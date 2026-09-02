import type {
  CaseFixture,
  CaseState,
  CaseGraphNode,
  EnrichmentArtifact,
  Entity,
  EvidenceJoin,
  IncidentStreamStage,
  PresentationVisibility,
  TelemetryEvent,
} from "./types";

export function getAppliedStreamStages(
  fixture: CaseFixture,
  state: CaseState,
): readonly IncidentStreamStage[] {
  const released = new Set(state.releasedStreamStageIds);
  return fixture.stream.stages.filter((stage) => released.has(stage.id));
}

export function getNextStreamStage(
  fixture: CaseFixture,
  state: CaseState,
): IncidentStreamStage | null {
  return fixture.stream.stages[state.releasedStreamStageIds.length] ?? null;
}

export function getAllEntities(fixture: CaseFixture): readonly Entity[] {
  return [
    ...fixture.entities,
    ...fixture.stream.stages.flatMap((stage) => stage.entities),
  ];
}

/**
 * Known entities remain available to bounded query contracts before they are
 * promoted into the analyst-visible graph.
 */
export function getKnownEntities(fixture: CaseFixture): readonly Entity[] {
  return getAllEntities(fixture);
}

export function getVisibleEntities(
  fixture: CaseFixture,
  state: CaseState,
): readonly Entity[] {
  return [
    ...fixture.entities,
    ...getAppliedStreamStages(fixture, state).flatMap(
      (stage) => stage.entities,
    ),
  ].filter((entity) =>
    isPresentationVisible(entity.presentationVisibility, state),
  );
}

export function getAllGraphNodes(
  fixture: CaseFixture,
): readonly CaseGraphNode[] {
  return [
    ...fixture.presentation.nodes,
    ...fixture.stream.stages.flatMap((stage) => stage.graphNodes),
  ];
}

export function getVisibleGraphNodes(
  fixture: CaseFixture,
  state: CaseState,
): readonly CaseGraphNode[] {
  const visibleEntityIds = new Set(
    getVisibleEntities(fixture, state).map((entity) => entity.id),
  );
  return [
    ...fixture.presentation.nodes,
    ...getAppliedStreamStages(fixture, state).flatMap(
      (stage) => stage.graphNodes,
    ),
  ].filter((node) => visibleEntityIds.has(node.entityId));
}

export function getAllEvents(fixture: CaseFixture): readonly TelemetryEvent[] {
  return [
    ...fixture.events,
    ...fixture.stream.stages.flatMap((stage) => stage.events),
  ];
}

export function getVisibleEvents(
  fixture: CaseFixture,
  state: CaseState,
): readonly TelemetryEvent[] {
  const visibleEntityIds = new Set(
    getVisibleEntities(fixture, state).map((entity) => entity.id),
  );
  return [
    ...fixture.events,
    ...getAppliedStreamStages(fixture, state).flatMap((stage) => stage.events),
  ].filter(
    (event) =>
      isPresentationVisible(event.presentationVisibility, state) &&
      event.entityIds.every((entityId) => visibleEntityIds.has(entityId)),
  );
}

export function getAllJoins(fixture: CaseFixture): readonly EvidenceJoin[] {
  return [
    ...fixture.joins,
    ...fixture.stream.stages.flatMap((stage) => stage.joins),
  ];
}

export function getVisibleJoins(
  fixture: CaseFixture,
  state: CaseState,
): readonly EvidenceJoin[] {
  const visibleEntityIds = new Set(
    getVisibleEntities(fixture, state).map((entity) => entity.id),
  );
  const visibleEventIds = new Set(
    getVisibleEvents(fixture, state).map((event) => event.id),
  );
  return [
    ...fixture.joins,
    ...getAppliedStreamStages(fixture, state).flatMap((stage) => stage.joins),
  ].filter(
    (join) =>
      visibleEntityIds.has(join.fromEntityId) &&
      visibleEntityIds.has(join.toEntityId) &&
      join.evidenceIds.every((eventId) => visibleEventIds.has(eventId)),
  );
}

export function getAllEnrichments(
  fixture: CaseFixture,
): readonly EnrichmentArtifact[] {
  return [
    ...fixture.enrichments,
    ...fixture.stream.stages.flatMap((stage) => stage.enrichments),
  ];
}

export function getVisibleEnrichments(
  fixture: CaseFixture,
  state: CaseState,
): readonly EnrichmentArtifact[] {
  return [
    ...fixture.enrichments,
    ...getAppliedStreamStages(fixture, state).flatMap(
      (stage) => stage.enrichments,
    ),
  ];
}

function isPresentationVisible(
  visibility: PresentationVisibility | undefined,
  state: CaseState,
): boolean {
  if (!visibility) return true;
  return (
    (visibility.requiresEnrichmentId === undefined ||
      state.attachedEnrichmentIds.includes(visibility.requiresEnrichmentId)) &&
    (visibility.requiresStageId === undefined ||
      state.releasedStreamStageIds.includes(visibility.requiresStageId)) &&
    (visibility.requiresReachability !== true || state.reachabilityAttached)
  );
}
