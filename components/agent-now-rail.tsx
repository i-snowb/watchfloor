import {
  getCollaborationHandoff,
  getDerivedNextStep,
  getInvestigationPlans,
  getResponseBundles,
} from "@/domain/operations";
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
}: {
  fixture: CaseFixture;
  state: CaseState;
  activity: InvestigationActivity;
  result: InvestigationResultView | null;
  latestReceipt: OperationReceipt | null;
}) {
  const content = getAgentNowContent(
    fixture,
    state,
    activity,
    result,
    latestReceipt,
  );
  return (
    <div
      aria-live="polite"
      className={`agent-now-rail agent-now-${content.state}`}
    >
      <span>{content.label}</span>
      <strong>{content.headline}</strong>
      <small>{content.detail}</small>
    </div>
  );
}

function getAgentNowContent(
  fixture: CaseFixture,
  state: CaseState,
  activity: InvestigationActivity,
  result: InvestigationResultView | null,
  latestReceipt: OperationReceipt | null,
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
  const handoff = getCollaborationHandoff(fixture, state);
  if (activity.status === "running") {
    const planProgress =
      activity.toolName === "run_investigation_plan"
        ? getPlanQueryProgress(fixture, state, activity.queryId)
        : null;
    return {
      state: "running",
      label:
        activity.actor === "agent" ? "Copilot working" : "Analyst requested",
      headline: planProgress
        ? `Query ${planProgress.position}/${planProgress.total} · ${planProgress.currentQuery.title}`
        : operationLabel(activity.toolName),
      detail: planProgress
        ? `${formatCount(planProgress.recordCount)} bounded records · ${planProgress.currentQuery.sourceScopes.length} sources · r${activity.baseRevision}`
        : `Working from r${activity.baseRevision} · bounded case data`,
    };
  }
  if (state.responseBundle) {
    const bundle = getResponseBundles(fixture).find(
      (candidate) => candidate.id === state.responseBundle?.bundleId,
    );
    return {
      state: "approval",
      label: "Next · Analyst",
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
      label: "Next · Analyst",
      headline: `Waiting for ${stage?.title ?? "next observation"}`,
      detail: `Analyst release required · r${state.revision}`,
    };
  }
  if (state.report.status === "drafted") {
    return {
      state: "approval",
      label: "Next · Analyst",
      headline: "Review and approve the evidence report",
      detail: `Closure gate · r${state.revision}`,
    };
  }
  if (next.recommendedTool === null) {
    return {
      state: "approval",
      label: "Next · Analyst",
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
        result.actor === "agent" ? "Attached · Copilot" : "Attached · Analyst",
      headline: planProgress
        ? `${planProgress.completed}/${planProgress.total} attached · ${planProgress.currentQuery.title}`
        : resultHeadline(result, aggregate),
      detail: planProgress
        ? formatReceiptDetail(
            result.receipt,
            planProgress.nextQuery
              ? `Next planned: ${planProgress.nextQuery.title}`
              : "Tier 1 plan complete",
          )
        : aggregate
          ? formatReceiptDetail(
              result.receipt,
              `${aggregate.evidenceAttached} findings · next: ${next.objective}`,
            )
          : formatReceiptDetail(result.receipt, `Next: ${next.objective}`),
    };
  }
  if (
    latestReceipt?.status === "completed" &&
    latestReceipt.resultRevision === state.revision
  ) {
    return {
      state: "result",
      label:
        latestReceipt.reportedSurface === "webmcp_callback"
          ? "Attached · Copilot"
          : "Attached · Analyst",
      headline: latestReceipt.title,
      detail: `Next: ${next.objective}`,
    };
  }
  return {
    state: "idle",
    label: "Next · Copilot",
    headline: next.objective,
    detail: capabilityDetail(activity, `Why now · ${handoff.whyNow}`),
  };
}

function capabilityDetail(
  activity: InvestigationActivity,
  fallback: string,
): string {
  if (
    activity.status === "idle" &&
    typeof activity.availableToolCount === "number" &&
    typeof activity.totalToolCount === "number"
  ) {
    return `${activity.availableToolCount}/${activity.totalToolCount} case capabilities available · ${fallback}`;
  }
  return fallback;
}

function formatReceiptDetail(
  receipt: InvestigationResultView["receipt"],
  next: string,
): string {
  const actor = receipt.actor === "agent" ? "Copilot · WebMCP" : "Analyst";
  const duration = `${(receipt.durationMs / 1_000).toFixed(1)}s`;
  const recordSummary =
    receipt.syntheticRecordCount === null
      ? null
      : `${formatCount(receipt.matchedRecordCount ?? 0)}/${formatCount(receipt.syntheticRecordCount)} matched`;
  const target = receipt.targetEntityId ? `→ ${receipt.targetEntityId}` : null;
  return [
    actor,
    receipt.toolName,
    duration,
    recordSummary,
    `r${receipt.baseRevision}→r${receipt.resultRevision}`,
    target,
    next,
  ]
    .filter((value): value is string => value !== null)
    .join(" · ");
}

function resultHeadline(
  result: InvestigationResultView,
  aggregate: { evidenceAttached: number; syntheticRecordCount: number } | null,
): string {
  if (aggregate) {
    return `${aggregate.evidenceAttached} findings attached`;
  }
  if (result.toolName === "run_investigation_query")
    return "1 finding attached";
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
    run_investigation_plan: "Investigating Tier 1 questions",
    run_investigation_query: "Running evidence query",
    calculate_reachability: "Mapping blast radius",
    simulate_control: "Testing containment",
    request_next_observation: "Requesting new telemetry",
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
