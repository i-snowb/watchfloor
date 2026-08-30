import { getDerivedNextStep, getResponseBundles } from "@/domain/operations";
import type { CaseFixture, CaseState, OperationReceipt } from "@/domain/types";
import type {
  InvestigationActivity,
  InvestigationResultView,
} from "./investigation-activity";
import styles from "./agent-now-rail.module.css";

type ProofState = "idle" | "running" | "result" | "gate" | "closed";

interface ProofContent {
  state: ProofState;
  actor: string;
  tool: string;
  scope: string;
  revision: string;
  result: string;
}

/** A compact, persistent chain from semantic page tool to visible evidence. */
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
  const content = getProofContent(
    fixture,
    state,
    activity,
    result,
    latestReceipt,
    selectedQuery,
  );

  return (
    <section
      aria-label="WebMCP shared-work proof"
      aria-live="polite"
      className={`${styles.proof} ${styles[content.state]}`}
    >
      <header className={styles.header}>
        <span>WebMCP shared-work proof</span>
        <strong>{content.actor}</strong>
      </header>
      <div className={styles.operation}>
        <span>Semantic operation</span>
        <code>{content.tool}</code>
      </div>
      <div className={styles.scope}>
        <span>Bounded input / scope</span>
        <p>{content.scope}</p>
      </div>
      <footer className={styles.receipt}>
        <span>{content.revision}</span>
        <strong>{content.result}</strong>
      </footer>
    </section>
  );
}

function getProofContent(
  fixture: CaseFixture,
  state: CaseState,
  activity: InvestigationActivity,
  result: InvestigationResultView | null,
  latestReceipt: OperationReceipt | null,
  selectedQuery: CaseFixture["investigationQueries"][number] | null,
): ProofContent {
  if (state.lifecycle === "closed_in_demo") {
    return {
      state: "closed",
      actor: "Analyst sign-off recorded",
      tool: "approve_case_report",
      scope: "Immutable report, cited evidence, and the analyst closure note.",
      revision: `Shared revision r${state.revision}`,
      result: "Case closed in demo · no external system contacted",
    };
  }

  const gate = getAnalystGate(fixture, state);
  if (gate) return gate;

  if (activity.status === "running") {
    const query = findQuery(fixture, activity.queryId, selectedQuery);
    return {
      state: "running",
      actor:
        activity.actor === "agent"
          ? "Copilot is using a registered page tool"
          : "Analyst is using the shared operation layer",
      tool: activity.toolName,
      scope: query
        ? queryScope(query)
        : boundedToolScope(activity.toolName, activity.targetEntityId),
      revision: `Shared revision r${activity.baseRevision} · result pending`,
      result: "Visible workbench updates only after a validated result",
    };
  }

  if (result && result.resultRevision === state.revision) {
    const query = findQuery(fixture, result.queryId, selectedQuery);
    return {
      state: "result",
      actor:
        result.actor === "agent"
          ? "WebMCP callback completed"
          : "Analyst operation completed",
      tool: result.toolName,
      scope: query
        ? queryScope(query)
        : boundedToolScope(result.toolName, result.targetEntityId),
      revision: formatRevision(
        result.receipt.baseRevision,
        result.receipt.resultRevision,
      ),
      result: result.summary,
    };
  }

  if (latestReceipt?.status === "completed") {
    const query = selectedQueryForReceipt(
      fixture,
      latestReceipt,
      selectedQuery,
    );
    return {
      state:
        latestReceipt.reportedSurface === "webmcp_callback" ? "result" : "idle",
      actor:
        latestReceipt.reportedSurface === "webmcp_callback"
          ? "WebMCP callback completed"
          : "Analyst control completed",
      tool: latestReceipt.toolName,
      scope: query
        ? queryScope(query)
        : boundedToolScope(latestReceipt.toolName, latestReceipt.target),
      revision: formatRevision(
        latestReceipt.baseRevision,
        latestReceipt.resultRevision,
      ),
      result: latestReceipt.resultSummary,
    };
  }

  const next = getDerivedNextStep(fixture, state);
  const query = findQuery(fixture, null, selectedQuery);
  return {
    state: "idle",
    actor: "Copilot ready · registered page tools available",
    tool: next.recommendedTool ?? "get_case_context",
    scope: query
      ? queryScope(query)
      : "Fixture-scoped entities and approved synthetic evidence only.",
    revision: `Shared revision r${state.revision}`,
    result: "No operation has run from this state",
  };
}

function getAnalystGate(
  fixture: CaseFixture,
  state: CaseState,
): ProofContent | null {
  if (state.responseBundle) {
    const bundle = getResponseBundles(fixture).find(
      (candidate) => candidate.id === state.responseBundle?.bundleId,
    );
    return {
      state: "gate",
      actor: "Copilot waiting · analyst approval required",
      tool: "authorize_response_bundle",
      scope: `${bundle?.title ?? "Prepared response package"} · ${state.responseBundle.actionIds.length} modeled controls · external execution disabled.`,
      revision: `Shared revision r${state.revision}`,
      result: "Copilot cannot authorize containment or recovery",
    };
  }
  if (state.observationRequest?.status === "pending") {
    const stage = fixture.stream.stages.find(
      (candidate) => candidate.id === state.observationRequest?.stageId,
    );
    return {
      state: "gate",
      actor: "Copilot waiting · analyst telemetry release required",
      tool: "release_next_synthetic_signal",
      scope: `${stage?.title ?? "Next fixture stage"} · ordered synthetic evidence only.`,
      revision: `Shared revision r${state.revision}`,
      result: "Copilot cannot release the next observation",
    };
  }
  if (state.report.status === "drafted") {
    return {
      state: "gate",
      actor: "Copilot waiting · analyst report review required",
      tool: "approve_case_report",
      scope: `${state.report.report?.evidenceIds.length ?? 0} immutable evidence references · closure note required.`,
      revision: `Shared revision r${state.revision}`,
      result: "Copilot cannot approve its own report",
    };
  }
  const next = getDerivedNextStep(fixture, state);
  if (next.recommendedTool === null) {
    return {
      state: "gate",
      actor: "Copilot waiting · analyst decision required",
      tool: "record_evidence_decision",
      scope:
        "Attached evidence supports a bounded disposition; intent remains an analyst judgment.",
      revision: `Shared revision r${state.revision}`,
      result: "Copilot cannot record the case disposition",
    };
  }
  return null;
}

function findQuery(
  fixture: CaseFixture,
  queryId: string | null,
  selectedQuery: CaseFixture["investigationQueries"][number] | null,
) {
  if (queryId) {
    const query = fixture.investigationQueries.find(
      (candidate) => candidate.id === queryId,
    );
    if (query) return query;
  }
  return selectedQuery;
}

function selectedQueryForReceipt(
  fixture: CaseFixture,
  receipt: OperationReceipt,
  selectedQuery: CaseFixture["investigationQueries"][number] | null,
) {
  if (receipt.toolName !== "run_investigation_query") return null;
  return (
    fixture.investigationQueries.find(
      (query) => query.title === receipt.title,
    ) ?? selectedQuery
  );
}

function queryScope(
  query: CaseFixture["investigationQueries"][number],
): string {
  const records = query.sourceScopes.reduce(
    (total, source) => total + source.syntheticRecordCount,
    0,
  );
  return `${query.id} · ${query.sourceScopes.length} approved sources · ${records.toLocaleString("en-US")} synthetic records · at most ${query.returnedRecordCount} returned.`;
}

function boundedToolScope(toolName: string, target: string | null): string {
  const targetScope = target ? `Target ${target} · ` : "";
  if (toolName.includes("response") || toolName === "simulate_control") {
    return `${targetScope}allowlisted demo control only · external execution disabled.`;
  }
  if (toolName === "calculate_reachability") {
    return `${targetScope}fixture-defined paths only · modeled reach is not observed compromise.`;
  }
  return `${targetScope}current case revision and fixture-visible evidence only.`;
}

function formatRevision(baseRevision: number, resultRevision: number): string {
  return baseRevision === resultRevision
    ? `Shared revision r${resultRevision} · read only`
    : `Shared revision r${baseRevision} → r${resultRevision}`;
}
