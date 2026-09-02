import type { OperationReceipt } from "./types";

/**
 * Derives stable evidence identifiers from trusted stored operation JSON.
 * Rejected or malformed results establish no lineage.
 */
export function deriveReceiptReferences(
  inputJson: string,
  outputJson: string,
): OperationReceipt["references"] | undefined {
  const input = parseRecordJson(inputJson);
  const output = parseRecordJson(outputJson);
  if (!output || output.ok !== true) return undefined;

  const eventIds: string[] = [];
  const entityIds: string[] = [];
  const relationshipIds: string[] = [];
  const enrichmentIds: string[] = [];
  const queryIds: string[] = [];
  const recordIds: string[] = [];
  const discoveryIds: string[] = [];
  const reportIds: string[] = [];
  const actionIds: string[] = [];
  const add = (values: string[], value: unknown) => {
    if (typeof value === "string" && !values.includes(value))
      values.push(value);
  };
  const addMany = (values: string[], value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) add(values, item);
  };

  if (input) {
    add(eventIds, input.eventId);
    add(entityIds, input.entityId);
    add(relationshipIds, input.relationshipId);
    add(queryIds, input.queryId);
    add(discoveryIds, input.stageId);
    add(reportIds, input.reportId);
    add(actionIds, input.actionId);
  }

  const data = isRecord(output.data) ? output.data : null;
  if (data) {
    add(queryIds, data.queryId);
    add(entityIds, data.targetEntityId);
    const event = isRecord(data.event) ? data.event : null;
    if (event) {
      add(eventIds, event.id);
      addMany(entityIds, event.entityIds);
    }
    const entity = isRecord(data.entity) ? data.entity : null;
    if (entity) add(entityIds, entity.id);
    const relationship = isRecord(data.relationship) ? data.relationship : null;
    if (relationship) {
      add(relationshipIds, relationship.id);
      addMany(eventIds, relationship.evidenceIds);
      add(entityIds, relationship.fromEntityId);
      add(entityIds, relationship.toEntityId);
    }
    const query = isRecord(data.query) ? data.query : null;
    if (query) {
      add(queryIds, query.id);
      add(entityIds, query.targetEntityId);
    }
    const artifact = isRecord(data.artifact) ? data.artifact : null;
    if (artifact) {
      add(enrichmentIds, artifact.id);
      add(entityIds, artifact.entityId);
    }
    if (Array.isArray(data.returnedRecords)) {
      for (const record of data.returnedRecords) {
        if (!isRecord(record)) continue;
        add(recordIds, record.id);
        addMany(entityIds, record.entityIds);
      }
    }
    const discovery = isRecord(data.discovery) ? data.discovery : null;
    if (discovery) add(discoveryIds, discovery.id);
    const added = isRecord(data.added) ? data.added : null;
    if (added) {
      addMany(entityIds, added.entityIds);
      addMany(eventIds, added.eventIds);
      addMany(relationshipIds, added.relationshipIds);
      addMany(enrichmentIds, added.availableEnrichmentIds);
    }
    const report = isRecord(data.report) ? data.report : null;
    if (report) {
      add(reportIds, report.id);
      addMany(actionIds, report.actionIds);
    }
    const action = isRecord(data.action) ? data.action : null;
    if (action) {
      add(actionIds, action.id);
      add(entityIds, action.targetEntityId);
    }
    const bundle = isRecord(data.bundle) ? data.bundle : null;
    if (bundle) addMany(actionIds, bundle.actionIds);
    addMany(actionIds, data.authorizedActionIds);
  }

  return {
    eventIds,
    entityIds,
    relationshipIds,
    enrichmentIds,
    queryIds,
    recordIds,
    discoveryIds,
    reportIds,
    actionIds,
  };
}

function parseRecordJson(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
