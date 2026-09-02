import type { CaseToolName } from "@/domain/operations";

export type InvestigationResultTone =
  "observed" | "evidence" | "impact" | "response" | "report";

export interface InvestigationResultPresentation {
  summary: string | null;
  title: string;
  stateLabel: string;
  tone: InvestigationResultTone;
}

export function getInvestigationResultPresentation(
  toolName: CaseToolName,
  data: unknown,
): InvestigationResultPresentation {
  const graphExpanded = hasObservedGraphAddition(data);
  const visibleDeltaSummary = getVisibleDeltaSummary(data);
  if (
    toolName === "attach_discovery_stage" ||
    toolName === "release_next_synthetic_signal"
  ) {
    return {
      summary: graphExpanded ? visibleDeltaSummary : null,
      title: graphExpanded ? "Observed graph expanded" : "Evidence updated",
      stateLabel: graphExpanded
        ? "Observed graph expanded"
        : "Evidence updated · graph unchanged",
      tone: graphExpanded ? "observed" : "evidence",
    };
  }
  if (
    toolName === "calculate_reachability" ||
    toolName === "simulate_control"
  ) {
    return {
      summary: null,
      title:
        toolName === "calculate_reachability"
          ? "Reachability calculated"
          : "Control effect modeled",
      stateLabel: "Impact model updated · no new observed telemetry",
      tone: "impact",
    };
  }
  if (toolName === "prepare_response_bundle") {
    return {
      summary: null,
      title: "Response package prepared",
      stateLabel: "Impact model updated · no new observed telemetry",
      tone: "response",
    };
  }
  if (toolName === "generate_case_report") {
    return {
      summary: null,
      title: "Report drafted",
      stateLabel: "Case evidence updated · observed graph unchanged",
      tone: "report",
    };
  }
  return {
    summary: graphExpanded ? visibleDeltaSummary : null,
    title:
      toolName === "run_investigation_query" ||
      toolName === "run_investigation_plan"
        ? "Query result attached"
        : "Case evidence updated",
    stateLabel: graphExpanded
      ? "Observed graph expanded"
      : "Evidence updated · graph unchanged",
    tone: "evidence",
  };
}

function getVisibleDeltaSummary(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const delta = (data as { presentationDelta?: unknown }).presentationDelta;
  if (!delta || typeof delta !== "object" || Array.isArray(delta)) return null;
  const values = delta as {
    visibleEntityIdsAdded?: unknown;
    visibleEventIdsAdded?: unknown;
    visibleRelationshipIdsAdded?: unknown;
  };
  const entityCount = Array.isArray(values.visibleEntityIdsAdded)
    ? values.visibleEntityIdsAdded.length
    : 0;
  const relationshipCount = Array.isArray(values.visibleRelationshipIdsAdded)
    ? values.visibleRelationshipIdsAdded.length
    : 0;
  const eventCount = Array.isArray(values.visibleEventIdsAdded)
    ? values.visibleEventIdsAdded.length
    : 0;
  const parts = [
    countLabel(entityCount, "entity", "entities"),
    countLabel(relationshipCount, "relationship", "relationships"),
    countLabel(eventCount, "observation", "observations"),
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? `${parts.join(" · ")} now visible` : null;
}

function countLabel(
  count: number,
  singular: string,
  plural: string,
): string | null {
  if (count === 0) return null;
  return `${count} ${count === 1 ? singular : plural}`;
}

function hasObservedGraphAddition(data: unknown): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const presentationDelta = (data as { presentationDelta?: unknown })
    .presentationDelta;
  if (
    presentationDelta &&
    typeof presentationDelta === "object" &&
    !Array.isArray(presentationDelta)
  ) {
    const values = presentationDelta as {
      observedGraphChanged?: unknown;
      visibleEntityIdsAdded?: unknown;
      visibleRelationshipIdsAdded?: unknown;
    };
    if (typeof values.observedGraphChanged === "boolean") {
      return values.observedGraphChanged;
    }
    return (
      (Array.isArray(values.visibleEntityIdsAdded) &&
        values.visibleEntityIdsAdded.length > 0) ||
      (Array.isArray(values.visibleRelationshipIdsAdded) &&
        values.visibleRelationshipIdsAdded.length > 0)
    );
  }
  const added = (data as { added?: unknown }).added;
  if (!added || typeof added !== "object" || Array.isArray(added)) {
    return false;
  }
  const values = added as {
    entityIds?: unknown;
    relationshipIds?: unknown;
  };
  return (
    (Array.isArray(values.entityIds) && values.entityIds.length > 0) ||
    (Array.isArray(values.relationshipIds) && values.relationshipIds.length > 0)
  );
}

export function investigationResultKey(result: {
  toolName: CaseToolName;
  queryId: string | null;
  resultRevision: number;
}): string {
  return `${result.resultRevision}:${result.toolName}:${result.queryId ?? ""}`;
}
