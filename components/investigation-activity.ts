import type { CaseToolName } from "@/domain/operations";

export type InvestigationActor = "agent" | "analyst";

export type InvestigationRunPhase = "scope" | "search" | "review";

interface InvestigationActivityBase {
  actor: InvestigationActor;
  toolName: CaseToolName;
  queryId: string | null;
  targetEntityId: string | null;
  baseRevision: number;
}

export type InvestigationActivity =
  | {
      status: "idle";
      availableToolCount?: number;
      totalToolCount?: number;
    }
  | (InvestigationActivityBase & {
      status: "running";
      startedAt: number;
      expectedDurationMs: number;
      phase: InvestigationRunPhase;
      progress: number;
    })
  | (InvestigationActivityBase & {
      status: "completed" | "rejected";
      resultRevision: number;
      summary: string;
      receipt?: InvestigationReceiptView;
    });

export interface InvestigationResultView {
  actor: InvestigationActor;
  toolName: CaseToolName;
  queryId: string | null;
  targetEntityId: string | null;
  baseRevision: number;
  resultRevision: number;
  summary: string;
  data: unknown;
  receipt: InvestigationReceiptView;
}

export interface InvestigationReceiptView {
  actor: InvestigationActor;
  toolName: CaseToolName;
  targetEntityId: string | null;
  baseRevision: number;
  resultRevision: number;
  durationMs: number;
  summary: string;
  syntheticRecordCount: number | null;
  matchedRecordCount: number | null;
  returnedRecordCount: number | null;
}

export function createInvestigationReceiptView({
  actor,
  toolName,
  targetEntityId,
  baseRevision,
  resultRevision,
  durationMs,
  summary,
  data,
}: Omit<
  InvestigationReceiptView,
  "syntheticRecordCount" | "matchedRecordCount" | "returnedRecordCount"
> & {
  data: unknown;
}): InvestigationReceiptView {
  const execution = readExecution(data);
  return {
    actor,
    toolName,
    targetEntityId,
    baseRevision,
    resultRevision,
    durationMs,
    summary,
    syntheticRecordCount: execution?.syntheticRecordCount ?? null,
    matchedRecordCount: execution?.matchedRecordCount ?? null,
    returnedRecordCount: execution?.returnedRecordCount ?? null,
  };
}

function readExecution(data: unknown): {
  syntheticRecordCount: number | null;
  matchedRecordCount: number | null;
  returnedRecordCount: number | null;
} | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const execution = (data as { execution?: unknown }).execution;
  if (!execution || typeof execution !== "object" || Array.isArray(execution)) {
    return null;
  }
  const values = execution as {
    syntheticRecordCount?: unknown;
    matchedRecordCount?: unknown;
    returnedRecordCount?: unknown;
  };
  return {
    syntheticRecordCount:
      typeof values.syntheticRecordCount === "number"
        ? values.syntheticRecordCount
        : null,
    matchedRecordCount:
      typeof values.matchedRecordCount === "number"
        ? values.matchedRecordCount
        : null,
    returnedRecordCount:
      typeof values.returnedRecordCount === "number"
        ? values.returnedRecordCount
        : null,
  };
}

const investigationTools = new Set<CaseToolName>([
  "prepare_investigation_query",
  "inspect_event",
  "inspect_entity",
  "inspect_relationship",
  "search_events",
  "find_first_occurrence",
  "compare_timepoints",
  "query_related_activity",
  "run_investigation_query",
  "run_investigation_plan",
  "enrich_identity",
  "enrich_network_indicator",
  "enrich_cloud_role",
  "enrich_resource",
  "enrich_endpoint",
  "enrich_file",
  "calculate_reachability",
  "request_next_observation",
  "prepare_response_bundle",
  "generate_case_report",
]);

export function isInvestigationTool(toolName: CaseToolName): boolean {
  return investigationTools.has(toolName);
}
