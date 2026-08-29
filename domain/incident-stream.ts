import type {
  CaseFixture,
  CaseState,
  CaseGraphNode,
  EnrichmentArtifact,
  Entity,
  EvidenceJoin,
  IncidentStreamStage,
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

export function getVisibleEntities(
  fixture: CaseFixture,
  state: CaseState,
): readonly Entity[] {
  return [
    ...fixture.entities,
    ...getAppliedStreamStages(fixture, state).flatMap(
      (stage) => stage.entities,
    ),
  ];
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
  return [
    ...fixture.presentation.nodes,
    ...getAppliedStreamStages(fixture, state).flatMap(
      (stage) => stage.graphNodes,
    ),
  ];
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
  return [
    ...fixture.events,
    ...getAppliedStreamStages(fixture, state).flatMap((stage) => stage.events),
  ];
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
  return [
    ...fixture.joins,
    ...getAppliedStreamStages(fixture, state).flatMap((stage) => stage.joins),
  ];
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
