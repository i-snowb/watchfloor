import { getApprovedInvestigationSkills } from "./investigation-skills";
import {
  getAppliedStreamStages,
  getVisibleEnrichments,
  getVisibleEntities,
  getVisibleEvents,
  getVisibleJoins,
} from "./incident-stream";
import { getQueryConsoleContract } from "./query-console";
import type {
  ApprovedInvestigationSkill,
  CaseFixture,
  CaseState,
  EnrichmentArtifact,
  Entity,
  EvidenceLineageTargetType,
  EvidenceJoin,
  IncidentStreamStage,
  InvestigationQueryDefinition,
  InvestigationQueryReturnedRecord,
  OperationReceipt,
  SourceCategory,
  TelemetryEvent,
  TruthStatus,
} from "./types";

export type { EvidenceLineageTargetType } from "./types";

export interface EvidenceLineageTarget {
  targetType: EvidenceLineageTargetType;
  targetId: string;
}

export interface EvidenceLineageTargetSummary {
  type: EvidenceLineageTargetType;
  id: string;
  label: string;
  status: TruthStatus | CaseState["report"]["status"] | null;
  sourceLabel: string | null;
  sourceCategory: SourceCategory | null;
  timestamp: string | null;
}

export interface EvidenceLineageReceipt {
  id: string;
  requestId: string;
  toolName: string;
  status: OperationReceipt["status"];
  baseRevision: number;
  resultRevision: number;
  occurredAt: string;
  references: NonNullable<OperationReceipt["references"]>;
}

export interface EvidenceLineage {
  caseId: string;
  currentRevision: number;
  target: EvidenceLineageTargetSummary;
  availability: {
    kind: "initial" | "released" | "attached" | "reported";
    releaseStageId: string | null;
  };
  skills: readonly ApprovedInvestigationSkill[];
  queries: readonly {
    definition: InvestigationQueryDefinition;
    queryText: string;
    executed: true;
  }[];
  records: readonly InvestigationQueryReturnedRecord[];
  events: readonly TelemetryEvent[];
  relationships: readonly EvidenceJoin[];
  receipts: readonly EvidenceLineageReceipt[];
  reportConsumers: readonly {
    reportId: string;
    version: string;
    status: Exclude<CaseState["report"]["status"], "unavailable">;
    evidenceId: string;
  }[];
  limitations: readonly {
    source: string;
    referenceId: string;
    text: string;
  }[];
  externalExecution: false;
}

interface ResolvedTarget {
  target: EvidenceLineageTargetSummary;
  availability: EvidenceLineage["availability"];
  entityIds: readonly string[];
  eventIds: readonly string[];
  relationshipIds: readonly string[];
  enrichmentIds: readonly string[];
  discoveryIds: readonly string[];
  reportIds: readonly string[];
  actionIds: readonly string[];
  explicitQueryIds: readonly string[];
  explicitRecordIds: readonly string[];
}

const emptyReferences: NonNullable<OperationReceipt["references"]> = {
  eventIds: [],
  entityIds: [],
  relationshipIds: [],
  enrichmentIds: [],
  queryIds: [],
  recordIds: [],
  discoveryIds: [],
  reportIds: [],
  actionIds: [],
};

/**
 * Builds a read-only, case-scoped lineage view. It intentionally accepts
 * trusted receipt history as an input and does not execute or authorize work.
 */
export function traceEvidenceLineage(
  fixture: CaseFixture,
  state: CaseState,
  receipts: readonly OperationReceipt[],
  requested: EvidenceLineageTarget,
): EvidenceLineage | null {
  const entities = getVisibleEntities(fixture, state);
  const events = getVisibleEvents(fixture, state);
  const relationships = getVisibleJoins(fixture, state);
  const enrichments = getVisibleEnrichments(fixture, state);
  const stages = getAppliedStreamStages(fixture, state);
  const resolved = resolveTarget(
    fixture,
    state,
    requested,
    entities,
    events,
    relationships,
    enrichments,
    stages,
  );

  if (resolved === null) {
    return null;
  }

  const relevantEntityIds = new Set(resolved.entityIds);
  const relevantEventIds = new Set(resolved.eventIds);
  const relevantRelationshipIds = new Set(resolved.relationshipIds);
  const relevantEnrichmentIds = new Set(resolved.enrichmentIds);
  const relevantDiscoveryIds = new Set(resolved.discoveryIds);
  const relevantReportIds = new Set(resolved.reportIds);
  const relevantActionIds = new Set(resolved.actionIds);
  const explicitQueryIds = new Set(resolved.explicitQueryIds);
  const explicitRecordIds = new Set(resolved.explicitRecordIds);

  const directlyRelatedEvents = uniqueById(
    events.filter(
      (event) =>
        relevantEventIds.has(event.id) ||
        event.entityIds.some((entityId) => relevantEntityIds.has(entityId)),
    ),
  );
  directlyRelatedEvents.forEach((event) => relevantEventIds.add(event.id));

  const selectedRelationships = uniqueById(
    relationships.filter(
      (relationship) =>
        relevantRelationshipIds.has(relationship.id) ||
        relationship.evidenceIds.some((id) => relevantEventIds.has(id)) ||
        relevantEntityIds.has(relationship.fromEntityId) ||
        relevantEntityIds.has(relationship.toEntityId),
    ),
  );
  selectedRelationships.forEach((relationship) => {
    relevantRelationshipIds.add(relationship.id);
    relevantEntityIds.add(relationship.fromEntityId);
    relevantEntityIds.add(relationship.toEntityId);
    relationship.evidenceIds.forEach((id) => relevantEventIds.add(id));
  });
  // A relationship can cite an event outside its endpoint's direct event set.
  // Return that released source event with the relationship rather than leave
  // an unresolved evidence reference in the lineage response.
  const selectedEvents = uniqueById([
    ...directlyRelatedEvents,
    ...events.filter((event) => relevantEventIds.has(event.id)),
  ]);

  const selectedEnrichments = uniqueById(
    enrichments.filter(
      (enrichment) =>
        state.attachedEnrichmentIds.includes(enrichment.id) &&
        (relevantEnrichmentIds.has(enrichment.id) ||
          relevantEntityIds.has(enrichment.entityId)),
    ),
  );
  selectedEnrichments.forEach((enrichment) => {
    relevantEnrichmentIds.add(enrichment.id);
    relevantEntityIds.add(enrichment.entityId);
  });

  const executedQueryIds = new Set(state.executedInvestigationQueryIds);
  const relationshipReceiptRecordIds =
    requested.targetType === "relationship"
      ? recordIdsByQueryFromRelationshipReceipts(
          receipts,
          resolved,
          state.revision,
        )
      : new Map<string, ReadonlySet<string>>();
  const receiptQueryIds = new Set(relationshipReceiptRecordIds.keys());
  const selectedQueries = fixture.investigationQueries.filter((query) => {
    if (!executedQueryIds.has(query.id)) return false;
    if (explicitQueryIds.size > 0) return explicitQueryIds.has(query.id);
    if (requested.targetType === "relationship") {
      return receiptQueryIds.has(query.id);
    }
    if (requested.targetType === "entity") {
      return query.targetEntityId === requested.targetId;
    }
    if (
      requested.targetType === "enrichment" ||
      requested.targetType === "report_finding"
    ) {
      return query.resultArtifactId === requested.targetId;
    }
    return false;
  });
  const queries = selectedQueries.flatMap((definition) => {
    const contract = getQueryConsoleContract(definition.id);
    return contract === null
      ? []
      : [{ definition, queryText: contract.text, executed: true as const }];
  });
  const selectedQueryIds = new Set(queries.map((query) => query.definition.id));
  const records = uniqueById(
    selectedQueries.flatMap((query) =>
      query.returnedRecords.filter((record) => {
        if (requested.targetType === "relationship") {
          const citedRecordIds =
            explicitQueryIds.size > 0
              ? explicitRecordIds
              : relationshipReceiptRecordIds.get(query.id);
          return citedRecordIds?.has(record.id) ?? false;
        }
        return (
          explicitRecordIds.size === 0 ||
          !explicitQueryIds.has(query.id) ||
          explicitRecordIds.has(record.id) ||
          !relevantDiscoveryIds.size
        );
      }),
    ),
  );
  records.forEach((record) =>
    record.entityIds.forEach((entityId) => relevantEntityIds.add(entityId)),
  );

  const selectedSkills = getApprovedInvestigationSkills(fixture, state).filter(
    (skill) => selectedQueryIds.has(skill.queryId),
  );
  const reportConsumerEvidenceIds =
    requested.targetType === "report_finding"
      ? new Set([requested.targetId])
      : new Set([
          ...relevantEventIds,
          ...relevantRelationshipIds,
          ...relevantEnrichmentIds,
        ]);
  const reportConsumers = getReportConsumers(state, reportConsumerEvidenceIds);
  reportConsumers.forEach((consumer) =>
    relevantReportIds.add(consumer.reportId),
  );

  const receiptIds = new Set([
    ...relevantEventIds,
    ...relevantEntityIds,
    ...relevantRelationshipIds,
    ...relevantEnrichmentIds,
    ...selectedQueryIds,
    ...records.map((record) => record.id),
    ...relevantDiscoveryIds,
    ...relevantReportIds,
    ...relevantActionIds,
  ]);
  const lineageReceipts = receipts
    .filter(
      (receipt) =>
        receipt.status === "completed" &&
        receipt.baseRevision <= state.revision &&
        receipt.resultRevision <= state.revision &&
        receiptReferencesQueryIds(receipt, selectedQueryIds) &&
        receiptReferences(receipt).some((id) => receiptIds.has(id)),
    )
    .map((receipt) => ({
      id: receipt.id,
      requestId: receipt.requestId,
      toolName: receipt.toolName,
      status: receipt.status,
      baseRevision: receipt.baseRevision,
      resultRevision: receipt.resultRevision,
      occurredAt: receipt.occurredAt,
      references: receipt.references ?? emptyReferences,
    }));

  return {
    caseId: fixture.id,
    currentRevision: state.revision,
    target: resolved.target,
    availability: resolved.availability,
    skills: selectedSkills,
    queries,
    records,
    events: selectedEvents,
    relationships: selectedRelationships,
    receipts: uniqueById(lineageReceipts),
    reportConsumers,
    limitations: getLimitations(
      selectedRelationships,
      selectedEnrichments,
      selectedQueries,
      state,
      reportConsumers.length > 0 || resolved.availability.kind === "reported",
    ),
    externalExecution: false,
  };
}

function recordIdsByQueryFromRelationshipReceipts(
  receipts: readonly OperationReceipt[],
  resolved: ResolvedTarget,
  currentRevision: number,
): ReadonlyMap<string, ReadonlySet<string>> {
  const relatedEventIds = new Set(resolved.eventIds);
  const relatedRelationshipIds = new Set(resolved.relationshipIds);
  const recordIdsByQuery = new Map<string, Set<string>>();

  for (const receipt of receipts) {
    if (
      receipt.status !== "completed" ||
      receipt.baseRevision > currentRevision ||
      receipt.resultRevision > currentRevision
    ) {
      continue;
    }
    const references = receipt.references;
    if (references === undefined || references.queryIds.length === 0) {
      continue;
    }
    const isRelated =
      references.relationshipIds.some((id) => relatedRelationshipIds.has(id)) ||
      references.eventIds.some((id) => relatedEventIds.has(id));
    if (!isRelated) continue;
    for (const queryId of references.queryIds) {
      const recordIds = recordIdsByQuery.get(queryId) ?? new Set<string>();
      references.recordIds.forEach((recordId) => recordIds.add(recordId));
      recordIdsByQuery.set(queryId, recordIds);
    }
  }

  return recordIdsByQuery;
}

function resolveTarget(
  fixture: CaseFixture,
  state: CaseState,
  requested: EvidenceLineageTarget,
  entities: readonly Entity[],
  events: readonly TelemetryEvent[],
  relationships: readonly EvidenceJoin[],
  enrichments: readonly EnrichmentArtifact[],
  stages: readonly IncidentStreamStage[],
): ResolvedTarget | null {
  if (requested.targetType === "event") {
    const event = events.find((item) => item.id === requested.targetId);
    return event === undefined ? null : fromEvent(event, fixture, stages);
  }
  if (requested.targetType === "entity") {
    const entity = entities.find((item) => item.id === requested.targetId);
    return entity === undefined ? null : fromEntity(entity, fixture, stages);
  }
  if (requested.targetType === "relationship") {
    const relationship = relationships.find(
      (item) => item.id === requested.targetId,
    );
    return relationship === undefined
      ? null
      : fromRelationship(relationship, fixture, stages);
  }
  if (requested.targetType === "enrichment") {
    const enrichment = enrichments.find(
      (item) => item.id === requested.targetId,
    );
    return enrichment === undefined ||
      !state.attachedEnrichmentIds.includes(enrichment.id)
      ? null
      : fromEnrichment(enrichment, fixture, stages);
  }
  if (requested.targetType === "discovery") {
    const stage = stages.find((item) => item.id === requested.targetId);
    return stage === undefined ? null : fromDiscovery(stage);
  }
  const report = state.report.report;
  const enrichment = enrichments.find((item) => item.id === requested.targetId);
  return report === null ||
    state.report.status === "unavailable" ||
    enrichment === undefined ||
    !state.attachedEnrichmentIds.includes(enrichment.id) ||
    !report.evidenceIds.includes(enrichment.id)
    ? null
    : {
        target: {
          ...artifactTarget("enrichment", enrichment),
          type: "report_finding",
          status: state.report.status,
        },
        availability: { kind: "reported", releaseStageId: null },
        entityIds: [enrichment.entityId],
        eventIds: [],
        relationshipIds: [],
        enrichmentIds: [enrichment.id],
        discoveryIds: [],
        reportIds: [report.id],
        actionIds: report.actionIds,
        explicitQueryIds: [],
        explicitRecordIds: [],
      };
}

function fromEvent(
  event: TelemetryEvent,
  fixture: CaseFixture,
  stages: readonly IncidentStreamStage[],
): ResolvedTarget {
  const stage = stages.find((item) =>
    item.events.some(({ id }) => id === event.id),
  );
  return {
    target: artifactTarget("event", event),
    availability: availabilityFor(event.id, fixture, stages),
    entityIds: event.entityIds,
    eventIds: [event.id],
    relationshipIds: [],
    enrichmentIds: [],
    discoveryIds: stage ? [stage.id] : [],
    reportIds: [],
    actionIds: [],
    explicitQueryIds: stage?.admission.sourceQueryIds ?? [],
    explicitRecordIds: stage?.admission.sourceRecordIds ?? [],
  };
}

function fromEntity(
  entity: Entity,
  fixture: CaseFixture,
  stages: readonly IncidentStreamStage[],
): ResolvedTarget {
  const stage = stages.find((item) =>
    item.entities.some(({ id }) => id === entity.id),
  );
  return {
    target: {
      type: "entity",
      id: entity.id,
      label: entity.label,
      status: null,
      sourceLabel: null,
      sourceCategory: null,
      timestamp: null,
    },
    availability:
      stage === undefined
        ? { kind: "initial", releaseStageId: null }
        : { kind: "released", releaseStageId: stage.id },
    entityIds: [entity.id],
    eventIds: [],
    relationshipIds: [],
    enrichmentIds: [],
    discoveryIds: stage ? [stage.id] : [],
    reportIds: [],
    actionIds: [],
    explicitQueryIds: stage?.admission.sourceQueryIds ?? [],
    explicitRecordIds: stage?.admission.sourceRecordIds ?? [],
  };
}

function fromRelationship(
  relationship: EvidenceJoin,
  fixture: CaseFixture,
  stages: readonly IncidentStreamStage[],
): ResolvedTarget {
  const stage = stages.find((item) =>
    item.joins.some(({ id }) => id === relationship.id),
  );
  return {
    target: artifactTarget("relationship", relationship),
    availability: availabilityFor(relationship.id, fixture, stages),
    entityIds: [relationship.fromEntityId, relationship.toEntityId],
    eventIds: relationship.evidenceIds,
    relationshipIds: [relationship.id],
    enrichmentIds: [],
    discoveryIds: stage ? [stage.id] : [],
    reportIds: [],
    actionIds: [],
    explicitQueryIds: stage?.admission.sourceQueryIds ?? [],
    explicitRecordIds: stage?.admission.sourceRecordIds ?? [],
  };
}

function fromEnrichment(
  enrichment: EnrichmentArtifact,
  fixture: CaseFixture,
  stages: readonly IncidentStreamStage[],
): ResolvedTarget {
  return {
    target: artifactTarget("enrichment", enrichment),
    availability: {
      kind: "attached",
      releaseStageId: releaseStageFor(enrichment.id, stages),
    },
    entityIds: [enrichment.entityId],
    eventIds: [],
    relationshipIds: [],
    enrichmentIds: [enrichment.id],
    discoveryIds: [],
    reportIds: [],
    actionIds: [],
    explicitQueryIds: [],
    explicitRecordIds: [],
  };
}

function fromDiscovery(stage: IncidentStreamStage): ResolvedTarget {
  return {
    target: {
      type: "discovery",
      id: stage.id,
      label: stage.title,
      status: null,
      sourceLabel: `Discovery stage ${stage.ordinal}`,
      sourceCategory: "analyst_judgment",
      timestamp: stage.receivedAt,
    },
    availability: { kind: "released", releaseStageId: stage.id },
    entityIds: stage.entities.map((entity) => entity.id),
    eventIds: stage.events.map((event) => event.id),
    relationshipIds: stage.joins.map((relationship) => relationship.id),
    enrichmentIds: stage.enrichments.map((enrichment) => enrichment.id),
    discoveryIds: [stage.id],
    reportIds: [],
    actionIds: stage.responseActionIds,
    explicitQueryIds: stage.admission.sourceQueryIds,
    explicitRecordIds: stage.admission.sourceRecordIds,
  };
}

function artifactTarget(
  type: Exclude<
    EvidenceLineageTargetType,
    "entity" | "discovery" | "report_finding"
  >,
  artifact: TelemetryEvent | EvidenceJoin | EnrichmentArtifact,
): EvidenceLineageTargetSummary {
  return {
    type,
    id: artifact.id,
    label:
      "label" in artifact
        ? artifact.label
        : "title" in artifact
          ? artifact.title
          : artifact.summary,
    status: artifact.status,
    sourceLabel: artifact.sourceLabel,
    sourceCategory: artifact.sourceCategory,
    timestamp: artifact.timestamp,
  };
}

function availabilityFor(
  id: string,
  fixture: CaseFixture,
  stages: readonly IncidentStreamStage[],
): EvidenceLineage["availability"] {
  const releaseStageId = releaseStageFor(id, stages);
  return releaseStageId === null && isInitialArtifact(id, fixture)
    ? { kind: "initial", releaseStageId: null }
    : { kind: "released", releaseStageId };
}

function isInitialArtifact(id: string, fixture: CaseFixture): boolean {
  return [...fixture.events, ...fixture.joins, ...fixture.enrichments].some(
    (artifact) => artifact.id === id,
  );
}

function releaseStageFor(
  id: string,
  stages: readonly IncidentStreamStage[],
): string | null {
  return (
    stages.find(
      (stage) =>
        stage.events.some((artifact) => artifact.id === id) ||
        stage.joins.some((artifact) => artifact.id === id) ||
        stage.enrichments.some((artifact) => artifact.id === id),
    )?.id ?? null
  );
}

function getReportConsumers(
  state: CaseState,
  evidenceIds: ReadonlySet<string>,
): EvidenceLineage["reportConsumers"] {
  const report = state.report.report;
  const status = state.report.status;
  if (report === null || status === "unavailable") {
    return [];
  }
  return report.evidenceIds
    .filter((evidenceId) => evidenceIds.has(evidenceId))
    .map((evidenceId) => ({
      reportId: report.id,
      version: report.version,
      status,
      evidenceId,
    }));
}

function getLimitations(
  relationships: readonly EvidenceJoin[],
  enrichments: readonly EnrichmentArtifact[],
  queries: readonly InvestigationQueryDefinition[],
  state: CaseState,
  includeReportLimitations: boolean,
): EvidenceLineage["limitations"] {
  const reportLimitations = includeReportLimitations
    ? (state.report.report?.limitations ?? [])
    : [];
  return uniqueByKey(
    [
      ...relationships.map((relationship) => ({
        source: relationship.sourceLabel,
        referenceId: relationship.id,
        text: relationship.limitation,
      })),
      ...enrichments.map((enrichment) => ({
        source: enrichment.sourceLabel,
        referenceId: enrichment.id,
        text: enrichment.caveat,
      })),
      ...queries.flatMap((query) =>
        query.sourceScopes.map((scope) => ({
          source: scope.sourceLabel,
          referenceId: query.id,
          text: query.caveat,
        })),
      ),
      ...reportLimitations.map((text, index) => ({
        source: "Case report",
        referenceId: `${state.report.report?.id ?? "report"}:limitation:${index + 1}`,
        text,
      })),
    ],
    (limitation) =>
      `${limitation.source}\u0000${limitation.referenceId}\u0000${limitation.text}`,
  );
}

function receiptReferences(receipt: OperationReceipt): readonly string[] {
  const references = receipt.references;
  return references === undefined
    ? []
    : [
        ...references.eventIds,
        ...references.entityIds,
        ...references.relationshipIds,
        ...references.enrichmentIds,
        ...references.queryIds,
        ...references.recordIds,
        ...references.discoveryIds,
        ...references.reportIds,
        ...references.actionIds,
      ];
}

function receiptReferencesQueryIds(
  receipt: OperationReceipt,
  selectedQueryIds: ReadonlySet<string>,
): boolean {
  return (receipt.references?.queryIds ?? []).every((queryId) =>
    selectedQueryIds.has(queryId),
  );
}

function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

function uniqueByKey<T>(items: readonly T[], keyFor: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFor(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
