import type { CSSProperties } from "react";
import {
  getDerivedNextStep,
  getInvestigationPlans,
  getResponseBundles,
} from "@/domain/operations";
import { getAllEntities } from "@/domain/incident-stream";
import type { CaseFixture, CaseState, OperationReceipt } from "@/domain/types";
import type {
  InvestigationActivity,
  InvestigationResultView,
} from "./investigation-activity";

export function AgentNowRail({
  fixture,
  state,
  activity,
  result,
  latestReceipt,
  selectedQuery,
}: {
  fixture: CaseFixture;
  state: CaseState;
  activity: InvestigationActivity;
  result: InvestigationResultView | null;
  latestReceipt: OperationReceipt | null;
  selectedQuery: CaseFixture["investigationQueries"][number] | null;
}) {
  const content = getAgentNowContent(
    fixture,
    state,
    activity,
    result,
    latestReceipt,
    selectedQuery,
  );
  return (
    <div
      aria-live="polite"
      className={`agent-now-rail agent-now-${content.state}`}
    >
      <span>{content.label}</span>
      <strong>{content.headline}</strong>
      <small>{content.detail}</small>
      {activity.status === "running" ? (
        <i
          aria-hidden="true"
          className="agent-now-progress"
          style={
            {
              "--agent-progress": activity.progress,
            } as CSSProperties
          }
        />
      ) : null}
    </div>
  );
}

function getAgentNowContent(
  fixture: CaseFixture,
  state: CaseState,
  activity: InvestigationActivity,
  result: InvestigationResultView | null,
  latestReceipt: OperationReceipt | null,
  selectedQuery: CaseFixture["investigationQueries"][number] | null,
): {
  state: "idle" | "running" | "result" | "waiting" | "approval" | "closed";
  label: string;
  headline: string;
  detail: string;
} {
  if (state.lifecycle === "closed_in_demo") {
    return {
      state: "closed",
      label: "Case state",
      headline: "Closed · report approved",
      detail: `Shared revision r${state.revision}`,
    };
  }
  const next = getDerivedNextStep(fixture, state);
  const nextObjective = next.objective;
  if (
    activity.status === "running" &&
    activity.toolName === "prepare_investigation_query"
  ) {
    const query = fixture.investigationQueries.find(
      (candidate) => candidate.id === activity.queryId,
    );
    return {
      state: "running",
      label:
        activity.actor === "agent"
          ? "Copilot · Preparing query"
          : "Analyst · Preparing query",
      headline: query?.title ?? "Preparing investigation query",
      detail: "Selecting approved sources and validating bounded KQL",
    };
  }
  if (activity.status === "running") {
    const planProgress =
      activity.toolName === "run_investigation_plan"
        ? getPlanQueryProgress(fixture, state, activity.queryId)
        : null;
    return {
      state: "running",
      label:
        activity.actor === "agent" ? "Copilot · Running" : "Analyst · Running",
      headline:
        activity.toolName === "generate_case_report"
          ? reportPhaseLabel(activity.phase)
          : runningPhaseLabel(activity.phase),
      detail: planProgress
        ? `${planProgress.currentQuery.title} · ${planProgress.currentQuery.sourceScopes.length} approved sources`
        : activity.toolName === "generate_case_report"
          ? `${state.attachedEnrichmentIds.length} evidence artifacts · ${state.responseActions.filter((action) => action.status === "authorized_in_demo").length} recorded controls`
          : operationLabel(activity.toolName),
    };
  }
  if (state.responseBundle) {
    const bundle = getResponseBundles(fixture).find(
      (candidate) => candidate.id === state.responseBundle?.bundleId,
    );
    return {
      state: "approval",
      label: "Analyst · Approval required",
      headline: `${bundle?.title ?? "Response package"} ready`,
      detail: `${state.responseBundle.actionIds.length} controls modeled · no external execution`,
    };
  }
  if (state.observationRequest?.status === "pending") {
    const stage = fixture.stream.stages.find(
      (candidate) => candidate.id === state.observationRequest?.stageId,
    );
    return {
      state: "waiting",
      label: "Telemetry request pending",
      headline: stage?.title ?? "Waiting for the next observation",
      detail: `Request recorded · r${state.revision}`,
    };
  }
  if (state.report.status === "drafted") {
    return {
      state: "approval",
      label: "Analyst review required",
      headline: "Evidence report ready",
      detail: `${state.report.report?.confirmedFindings.length ?? 0} findings · ${state.report.report?.actionIds.length ?? 0} recorded controls · review before approval`,
    };
  }
  if (next.recommendedTool === null) {
    return {
      state: "approval",
      label: "Analyst · Approval required",
      headline: next.objective,
      detail: `Approval required · r${state.revision}`,
    };
  }
  if (result && result.resultRevision === state.revision) {
    const aggregate = readPlanAggregate(result.data);
    const planProgress =
      result.toolName === "run_investigation_plan"
        ? getPlanQueryProgress(fixture, state, result.queryId)
        : null;
    return {
      state: "result",
      label:
        result.actor === "agent"
          ? "Copilot · Evidence attached"
          : "Analyst · Evidence attached",
      headline: planProgress
        ? `${planProgress.completed} findings attached · ${planProgress.currentQuery.title}`
        : resultHeadline(fixture, result, aggregate),
      detail: planProgress
        ? formatReceiptDetail(
            result.receipt,
            planProgress.nextQuery
              ? `Next investigation: ${planProgress.nextQuery.title}`
              : "Suggested investigations complete",
          )
        : aggregate
          ? formatReceiptDetail(
              result.receipt,
              `${aggregate.evidenceAttached} results · next: ${nextObjective}`,
            )
          : formatReceiptDetail(result.receipt, `Next: ${nextObjective}`),
    };
  }
  if (
    latestReceipt?.status === "completed" &&
    latestReceipt.resultRevision === state.revision
  ) {
    if (latestReceipt.toolName === "prepare_investigation_query") {
      return {
        state: "idle",
        label:
          latestReceipt.reportedSurface === "webmcp_callback"
            ? "Copilot · Query prepared"
            : "Analyst · Query prepared",
        headline: latestReceipt.title.replace(/^Prepared /, ""),
        detail: "Review the query in the shared console, then run it",
      };
    }
    return {
      state: "result",
      label:
        latestReceipt.reportedSurface === "webmcp_callback"
          ? "Copilot · Evidence attached"
          : "Analyst · Evidence attached",
      headline: latestReceipt.title,
      detail: `Next: ${nextObjective}`,
    };
  }
  if (selectedQuery) {
    const target = getAllEntities(fixture).find(
      (entity) => entity.id === selectedQuery.targetEntityId,
    );
    const queryPrepared =
      state.preparedQuery?.queryId === selectedQuery.id &&
      state.preparedQuery.preparedAtRevision === state.revision;
    return {
      state: "idle",
      label: queryPrepared ? "Query prepared" : "Selected evidence",
      headline: `${target?.label ?? "Entity"} selected`,
      detail: queryPrepared
        ? `${selectedQuery.title} · approved KQL ready to run`
        : `${selectedQuery.title} · prepare a bounded query`,
    };
  }
  return {
    state: "idle",
    label: "Copilot · Ready",
    headline: "Select an entity",
    detail: "Run a bounded query here or ask the copilot to investigate it",
  };
}

function formatReceiptDetail(
  receipt: InvestigationResultView["receipt"],
  next: string,
): string {
  const actor = receipt.actor === "agent" ? "Copilot" : "Analyst";
  const duration = `${(receipt.durationMs / 1_000).toFixed(1)}s`;
  const recordSummary =
    receipt.syntheticRecordCount === null
      ? null
      : `${formatCount(receipt.matchedRecordCount ?? 0)}/${formatCount(receipt.syntheticRecordCount)} matched`;
  return [actor, duration, recordSummary, next]
    .filter((value): value is string => value !== null)
    .join(" · ");
}

function runningPhaseLabel(
  phase: Extract<InvestigationActivity, { status: "running" }>["phase"],
): string {
  if (phase === "scope") return "Selecting data sources";
  if (phase === "search") return "Searching case records";
  return "Reviewing matches";
}

function reportPhaseLabel(
  phase: Extract<InvestigationActivity, { status: "running" }>["phase"],
): string {
  if (phase === "scope") return "Inventorying case evidence";
  if (phase === "search") return "Assembling findings and controls";
  return "Validating provenance and limits";
}

function resultHeadline(
  fixture: CaseFixture,
  result: InvestigationResultView,
  aggregate: { evidenceAttached: number; syntheticRecordCount: number } | null,
): string {
  if (aggregate) {
    return `${aggregate.evidenceAttached} results added`;
  }
  if (result.toolName === "run_investigation_query") {
    const query = fixture.investigationQueries.find(
      (candidate) => candidate.id === result.queryId,
    );
    const artifact = query
      ? fixture.enrichments.find(
          (candidate) => candidate.id === query.resultArtifactId,
        )
      : null;
    return artifact?.title ?? query?.title ?? "Evidence attached";
  }
  return operationLabel(result.toolName);
}

function readPlanAggregate(data: unknown): {
  evidenceAttached: number;
  syntheticRecordCount: number;
} | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const aggregate = (data as { aggregate?: unknown }).aggregate;
  if (!aggregate || typeof aggregate !== "object" || Array.isArray(aggregate)) {
    return null;
  }
  const values = aggregate as {
    evidenceAttached?: unknown;
    syntheticRecordCount?: unknown;
  };
  return typeof values.evidenceAttached === "number" &&
    typeof values.syntheticRecordCount === "number"
    ? {
        evidenceAttached: values.evidenceAttached,
        syntheticRecordCount: values.syntheticRecordCount,
      }
    : null;
}

function operationLabel(toolName: string): string {
  const labels: Record<string, string> = {
    prepare_investigation_query: "Preparing investigation query",
    run_investigation_plan: "Running suggested investigation",
    run_investigation_query: "Running evidence query",
    calculate_reachability: "Mapping blast radius",
    simulate_control: "Testing containment",
    request_next_observation: "Requesting new telemetry",
    attach_discovery_stage: "Adding verified discovery",
    prepare_response_bundle: "Preparing response package",
    generate_case_report: "Drafting evidence report",
  };
  return labels[toolName] ?? toolName.replaceAll("_", " ");
}

function getPlanQueryProgress(
  fixture: CaseFixture,
  state: CaseState,
  queryId: string | null,
): {
  completed: number;
  currentQuery: CaseFixture["investigationQueries"][number];
  nextQuery: CaseFixture["investigationQueries"][number] | null;
  position: number;
  recordCount: number;
  total: number;
} | null {
  const attached = new Set(state.attachedEnrichmentIds);
  const plan = getInvestigationPlans(fixture).find((candidate) =>
    queryId ? candidate.queryIds.includes(queryId) : false,
  );
  if (!plan) return null;
  const queries = plan.queryIds.flatMap((candidateId) => {
    const query = fixture.investigationQueries.find(
      (candidate) => candidate.id === candidateId,
    );
    return query ? [query] : [];
  });
  const currentQuery = queries.find((query) => query.id === queryId);
  if (!currentQuery) return null;
  const completed = queries.filter((query) =>
    attached.has(query.resultArtifactId),
  ).length;
  const nextQuery =
    queries.find((query) => !attached.has(query.resultArtifactId)) ?? null;
  return {
    completed,
    currentQuery,
    nextQuery,
    position: queries.findIndex((query) => query.id === currentQuery.id) + 1,
    recordCount: currentQuery.sourceScopes.reduce(
      (total, scope) => total + scope.syntheticRecordCount,
      0,
    ),
    total: queries.length,
  };
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}
