import { getAppliedStreamStages } from "./incident-stream";
import type { CaseFixture, CaseQueueItem, CaseState } from "./types";

const queueCatalog: readonly CaseQueueItem[] = [
  {
    id: "queue-cloud-0421",
    caseId: "case-cloud-0421",
    title: "Privileged export outside standard workflow",
    impact: "An approved export used an exceptional production role.",
    severity: "high",
    status: "awaiting_review",
    source: "Okta · AWS · EDR",
    latestObservedAt: "2026-08-27T09:43:00Z",
    latestObservation: "customer-export.csv read under CHG-2941",
    entityLabels: ["Jordan Doe", "prod-admin", "customer-export.csv"],
    signalCount: 5,
    tier1Label: "Escalated by Tier 1 AI",
    investigationDepth: "full_response",
  },
  {
    id: "queue-endpoint-0448",
    caseId: "case-endpoint-0448",
    title: "Execution with early lateral movement",
    impact:
      "Unsigned execution overlaps an out-of-scope service logon and credential read.",
    severity: "critical",
    status: "awaiting_review",
    source: "EDR · Windows auth · Cloud audit",
    latestObservedAt: "2026-08-28T14:05:12Z",
    latestObservation:
      "svc-fin-reports read ci/deploy/production after two TLS connections",
    entityLabels: ["FIN-WS-044", "svc-fin-reports", "APP-SRV-021"],
    signalCount: 9,
    tier1Label: "Escalated by Tier 1 AI",
    investigationDepth: "full_response",
  },
  {
    id: "queue-oauth-0437",
    caseId: "case-oauth-0437",
    title: "OAuth consent followed by mailbox collection",
    impact:
      "New application received mail-read scope and queried 184 messages.",
    severity: "high",
    status: "awaiting_review",
    source: "Entra ID · Microsoft 365",
    latestObservedAt: "2026-08-27T09:38:42Z",
    latestObservation: "Graph API Mail.Read burst from new application",
    entityLabels: ["Maya Chen", "Inbox Sync Pro", "Mail.Read"],
    signalCount: 6,
    tier1Label: "Escalated by Tier 1 AI",
    investigationDepth: "reference_brief",
  },
  {
    id: "queue-k8s-0414",
    caseId: "case-k8s-0414",
    title: "Workload token used outside the cluster",
    impact: "Service-account token listed secrets from an external address.",
    severity: "high",
    status: "awaiting_review",
    source: "Kubernetes audit · Runtime inventory · Cloud audit",
    latestObservedAt: "2026-08-27T09:32:11Z",
    latestObservation:
      "build-runner listed 14 production secrets from an external address",
    entityLabels: ["build-runner", "payments-prod", "203.0.113.77"],
    signalCount: 6,
    tier1Label: "Escalated by Tier 1 AI",
    investigationDepth: "reference_brief",
  },
  {
    id: "queue-cicd-0392",
    caseId: "case-cicd-0392",
    title: "CI identity published an unreviewed artifact",
    impact: "Release workflow used an unexpected OIDC subject in production.",
    severity: "high",
    status: "awaiting_review",
    source: "GitHub audit · CloudTrail · Registry · Deployment log",
    latestObservedAt: "2026-08-27T09:20:41Z",
    latestObservation: "payments-api deployed unreviewed digest sha256:7b3d…",
    entityLabels: ["release.yml", "sha256:7b3d…", "payments-api"],
    signalCount: 7,
    tier1Label: "Escalated by Tier 1 AI",
    investigationDepth: "reference_brief",
  },
];

export function getCaseQueueItems(
  cases: readonly { fixture: CaseFixture; state: CaseState }[],
): readonly CaseQueueItem[] {
  return cases.reduce<readonly CaseQueueItem[]>(
    (items, current) => applyCaseState(items, current.fixture, current.state),
    queueCatalog,
  );
}

function applyCaseState(
  items: readonly CaseQueueItem[],
  fixture: CaseFixture,
  state: CaseState,
): readonly CaseQueueItem[] {
  const appliedStages = getAppliedStreamStages(fixture, state);
  const latestStage = appliedStages.at(-1);
  const latestEvent = latestStage?.events.at(-1);
  const releasedActionIds = new Set(
    appliedStages.flatMap((stage) => stage.responseActionIds),
  );
  const releasedActions = state.responseActions.filter((action) =>
    releasedActionIds.has(action.actionId),
  );
  const hasPendingResponse = releasedActions.some(
    (action) => action.status !== "authorized_in_demo",
  );
  const allReleasedActionsAuthorized =
    releasedActionIds.size > 0 &&
    releasedActions.length === releasedActionIds.size &&
    releasedActions.every((action) => action.status === "authorized_in_demo");
  const active = items.find((item) => item.caseId === fixture.id);
  if (!active) return items;

  const activeItem: CaseQueueItem = {
    ...active,
    status:
      state.lifecycle === "closed_in_demo"
        ? "closed_in_demo"
        : hasPendingResponse
          ? "response_pending"
          : allReleasedActionsAuthorized
            ? "contained_in_demo"
            : appliedStages.length > 0
              ? "response_pending"
              : state.revision > 1
                ? "investigating"
                : "awaiting_review",
    impact: latestStage?.summary ?? active.impact,
    latestObservedAt: latestEvent?.timestamp ?? active.latestObservedAt,
    latestObservation: latestEvent?.summary ?? active.latestObservation,
    entityLabels: active.entityLabels,
    signalCount: active.signalCount + appliedStages.length,
  };

  return items.map((item) => (item.id === active.id ? activeItem : item));
}
