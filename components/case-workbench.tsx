"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ToolApiResponse } from "@/domain/api";
import {
  createInitialCaseState,
  getDerivedNextStep,
  getInvestigationPlans,
  getResponseBundles,
  type CaseToolName,
} from "@/domain/operations";
import type { CaseFixture, CaseSnapshot } from "@/domain/types";
import { getAllEntities } from "@/domain/incident-stream";
import { executeTool, loadCase, resetCase } from "@/lib/client-api";
import {
  createCaseToolDefinitions,
  registerCaseTools,
  type ToolRegistrationOutcome,
} from "@/webmcp/tools";
import { AgentDrawer } from "./agent-drawer";
import { AnalystActionDock } from "./analyst-action-dock";
import {
  createInvestigationReceiptView,
  isInvestigationTool,
  type InvestigationActivity,
  type InvestigationResultView,
} from "./investigation-activity";
import { CaseCommandBar } from "./case-command-bar";
import type { TraceSelection } from "./trace-interaction";
import { CaseInspector } from "./case-inspector";
import { EvidenceMap } from "./evidence-map";
import { InvestigationDeck } from "./investigation-deck";
import { PlatformShell, type AgentStatus } from "./platform-shell";

export function CaseWorkbench({ fixture }: { fixture: CaseFixture }) {
  const initialSelection = useMemo(
    () => getInitialSelection(fixture),
    [fixture],
  );
  const [snapshot, setSnapshot] = useState<CaseSnapshot>({
    state: createInitialCaseState(fixture),
    receipts: [],
  });
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const [selection, setSelection] = useState<TraceSelection>(initialSelection);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const mainRef = useRef<HTMLElement>(null);
  const [workbenchEpoch, setWorkbenchEpoch] = useState(0);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({
    state: "checking",
    count: 0,
  });
  const [registrationOutcomes, setRegistrationOutcomes] = useState<
    ToolRegistrationOutcome[]
  >([]);
  const [agentDrawerOpen, setAgentDrawerOpen] = useState(false);
  const [backendReady, setBackendReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamPlaying, setStreamPlaying] = useState(false);
  const [agentFocusEntityId, setAgentFocusEntityId] = useState<string | null>(
    null,
  );
  const [investigationActivity, setInvestigationActivity] =
    useState<InvestigationActivity>({ status: "idle" });
  const [investigationResult, setInvestigationResult] =
    useState<InvestigationResultView | null>(null);
  const [syntheticExpansion, setSyntheticExpansion] = useState<{
    stageId: string;
    revision: number;
    token: number;
  } | null>(null);
  const expansionSequence = useRef(0);
  const releasedStageCount = snapshot.state.releasedStreamStageIds.length;

  useEffect(() => {
    let active = true;
    async function hydrateCase() {
      try {
        const response = await loadCase(fixture.id);
        if (!active) return;
        setSnapshot(response.snapshot);
        setSelection(
          getSelectionForState(
            fixture,
            response.snapshot.state,
            initialSelection,
          ),
        );
        setBackendReady(true);
      } catch (loadError) {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Case state is unavailable.",
        );
      }
    }
    void hydrateCase();
    return () => {
      active = false;
    };
  }, [fixture, initialSelection]);

  useEffect(() => {
    if (!backendReady) return;
    let active = true;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void loadCase(fixture.id)
        .then((response) => {
          if (!active) return;
          setSnapshot((current) =>
            response.snapshot.state.revision !== current.state.revision ||
            response.snapshot.receipts.length !== current.receipts.length
              ? response.snapshot
              : current,
          );
        })
        .catch(() => undefined);
    }, 2_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [backendReady, fixture.id]);

  const runAgentTool = useCallback(
    async (
      toolName: CaseToolName,
      webInput: Record<string, unknown>,
      signal: AbortSignal,
    ) => {
      const { requestId, ...input } = webInput;
      if (typeof requestId !== "string") {
        return {
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "requestId is required.",
            retryable: false,
          },
        };
      }
      const requestedExecution = resolveInvestigationExecution(
        fixture,
        snapshotRef.current.state,
        toolName,
        input,
      );
      const requestedFocusEntityId = readRequestedFocusEntityId(
        fixture,
        toolName,
        input,
        snapshotRef.current.state,
      );
      const baseRevision =
        typeof input.expectedRevision === "number"
          ? input.expectedRevision
          : snapshotRef.current.state.revision;
      setInvestigationActivity({
        status: "running",
        actor: "agent",
        toolName,
        queryId: requestedExecution?.queryId ?? readQueryId(input),
        targetEntityId: requestedFocusEntityId,
        baseRevision,
      });
      if (requestedFocusEntityId) {
        setAgentFocusEntityId(requestedFocusEntityId);
        setSelection({ kind: "entity", id: requestedFocusEntityId });
      }
      try {
        const startedAt = performance.now();
        await waitForOperation(toolName, signal);
        const response = await executeTool(
          fixture.id,
          toolName,
          "webmcp_callback",
          input,
          requestId,
          signal,
        );
        setSnapshot(response.snapshot);
        setBackendReady(true);
        setError(response.result.ok ? null : response.result.error.message);
        const receipt = response.snapshot.receipts.at(-1);
        const completedExecution =
          readResponseInvestigationExecution(response) ?? requestedExecution;
        const summary =
          receipt?.resultSummary ??
          (response.result.ok
            ? "Copilot result added to the case."
            : response.result.error.message);
        const receiptView = createInvestigationReceiptView({
          actor: "agent",
          toolName,
          targetEntityId:
            completedExecution?.targetEntityId ?? requestedFocusEntityId,
          baseRevision,
          resultRevision: response.snapshot.state.revision,
          durationMs: Math.round(performance.now() - startedAt),
          summary,
          data: response.result.ok ? response.result.data : null,
        });
        setInvestigationActivity({
          status: response.result.ok ? "completed" : "rejected",
          actor: "agent",
          toolName,
          queryId: completedExecution?.queryId ?? readQueryId(input),
          targetEntityId:
            completedExecution?.targetEntityId ?? requestedFocusEntityId,
          baseRevision,
          resultRevision: response.snapshot.state.revision,
          summary,
          receipt: receiptView,
        });
        if (response.result.ok && isInvestigationTool(toolName)) {
          setInvestigationResult({
            actor: "agent",
            toolName,
            queryId: completedExecution?.queryId ?? readQueryId(input),
            targetEntityId:
              completedExecution?.targetEntityId ?? requestedFocusEntityId,
            baseRevision,
            resultRevision: response.snapshot.state.revision,
            summary,
            data: response.result.data,
            receipt: receiptView,
          });
        }
        const focusEntityId = readFocusEntityId(response);
        if (focusEntityId) {
          setAgentFocusEntityId(focusEntityId);
          setSelection({ kind: "entity", id: focusEntityId });
        }
        return withSharedViewContext(
          toolName,
          response.result,
          selectionRef.current,
        );
      } catch (toolError) {
        if (
          signal.aborted ||
          (toolError instanceof Error && toolError.name === "AbortError")
        ) {
          setInvestigationActivity({ status: "idle" });
          throw toolError;
        }
        const message =
          toolError instanceof Error
            ? toolError.message
            : "Copilot operation failed.";
        setError(message);
        setInvestigationActivity({
          status: "rejected",
          actor: "agent",
          toolName,
          queryId: readQueryId(input),
          targetEntityId: requestedFocusEntityId,
          baseRevision,
          resultRevision: baseRevision,
          summary: message,
        });
        return {
          ok: false,
          error: { code: "OPERATION_UNAVAILABLE", message, retryable: true },
        };
      }
    },
    [fixture],
  );

  const totalDefinitions = useMemo(
    () => createCaseToolDefinitions(fixture, runAgentTool),
    [fixture, runAgentTool],
  );
  const availableDefinitions = useMemo(
    () => createCaseToolDefinitions(fixture, runAgentTool, snapshot.state),
    [fixture, runAgentTool, snapshot.state],
  );

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function register() {
      const result = await registerCaseTools(totalDefinitions, controller);
      if (!active) {
        return;
      }
      setRegistrationOutcomes(result.outcomes);
      if (!result.supported) {
        setAgentStatus({ state: "unavailable", count: 0 });
      } else {
        setAgentStatus({
          state:
            result.registered === totalDefinitions.length
              ? "available"
              : "partial",
          count: result.registered,
        });
      }
    }
    void register();
    return () => {
      active = false;
      controller.abort();
    };
  }, [totalDefinitions]);

  const runManualTool = useCallback(
    async (toolName: CaseToolName, input: Record<string, unknown>) => {
      const investigation = isInvestigationTool(toolName);
      const requestedExecution = resolveInvestigationExecution(
        fixture,
        snapshotRef.current.state,
        toolName,
        input,
      );
      const requestedFocusEntityId = readRequestedFocusEntityId(
        fixture,
        toolName,
        input,
        snapshotRef.current.state,
      );
      const baseRevision =
        typeof input.expectedRevision === "number"
          ? input.expectedRevision
          : snapshotRef.current.state.revision;
      setBusy(true);
      setError(null);
      if (investigation) {
        setInvestigationActivity({
          status: "running",
          actor: "analyst",
          toolName,
          queryId: requestedExecution?.queryId ?? readQueryId(input),
          targetEntityId: requestedFocusEntityId,
          baseRevision,
        });
        if (requestedFocusEntityId) {
          setAgentFocusEntityId(null);
          setSelection({ kind: "entity", id: requestedFocusEntityId });
        }
      }
      try {
        const startedAt = performance.now();
        if (investigation) {
          await waitForOperation(toolName);
        }
        const response = await executeTool(
          fixture.id,
          toolName,
          "analyst_control",
          input,
        );
        setSnapshot(response.snapshot);
        if (
          toolName === "release_next_synthetic_signal" &&
          response.result.ok
        ) {
          const releasedCount =
            response.snapshot.state.releasedStreamStageIds.length;
          const stage = fixture.stream.stages[releasedCount - 1];
          const event = stage?.events.at(-1);
          if (stage) {
            expansionSequence.current += 1;
            setSyntheticExpansion({
              stageId: stage.id,
              revision: response.snapshot.state.revision,
              token: expansionSequence.current,
            });
          }
          if (event) {
            setAgentFocusEntityId(null);
            setSelection({ kind: "event", id: event.id });
          }
        }
        if (!response.result.ok) setError(operationErrorMessage(response));
        if (investigation) {
          const receipt = response.snapshot.receipts.at(-1);
          const completedExecution =
            readResponseInvestigationExecution(response) ?? requestedExecution;
          const summary =
            receipt?.resultSummary ??
            (response.result.ok
              ? "Investigation result attached to the case."
              : response.result.error.message);
          const receiptView = createInvestigationReceiptView({
            actor: "analyst",
            toolName,
            targetEntityId:
              completedExecution?.targetEntityId ?? requestedFocusEntityId,
            baseRevision,
            resultRevision: response.snapshot.state.revision,
            durationMs: Math.round(performance.now() - startedAt),
            summary,
            data: response.result.ok ? response.result.data : null,
          });
          setInvestigationActivity({
            status: response.result.ok ? "completed" : "rejected",
            actor: "analyst",
            toolName,
            queryId: completedExecution?.queryId ?? readQueryId(input),
            targetEntityId:
              completedExecution?.targetEntityId ?? requestedFocusEntityId,
            baseRevision,
            resultRevision: response.snapshot.state.revision,
            summary,
            receipt: receiptView,
          });
          if (response.result.ok) {
            setInvestigationResult({
              actor: "analyst",
              toolName,
              queryId: completedExecution?.queryId ?? readQueryId(input),
              targetEntityId:
                completedExecution?.targetEntityId ?? requestedFocusEntityId,
              baseRevision,
              resultRevision: response.snapshot.state.revision,
              summary,
              data: response.result.data,
              receipt: receiptView,
            });
          }
        }
      } catch (toolError) {
        const message =
          toolError instanceof Error ? toolError.message : "Operation failed.";
        setError(message);
        if (investigation) {
          setInvestigationActivity({
            status: "rejected",
            actor: "analyst",
            toolName,
            queryId: readQueryId(input),
            targetEntityId: requestedFocusEntityId,
            baseRevision,
            resultRevision: baseRevision,
            summary: message,
          });
        }
      } finally {
        setBusy(false);
      }
    },
    [fixture],
  );

  const handleReset = useCallback(async () => {
    setStreamPlaying(false);
    setBusy(true);
    setError(null);
    setInvestigationActivity({ status: "idle" });
    setInvestigationResult(null);
    setSyntheticExpansion(null);
    setAgentDrawerOpen(false);
    try {
      const response = await resetCase(fixture.id);
      setSnapshot(response.snapshot);
      setSelection(initialSelection);
      setAgentFocusEntityId(null);
      setBackendReady(true);
      setWorkbenchEpoch((current) => current + 1);
      window.requestAnimationFrame(() => {
        mainRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
      });
    } catch (resetError) {
      setError(
        resetError instanceof Error
          ? resetError.message
          : "The demo could not be reset.",
      );
    } finally {
      setBusy(false);
    }
  }, [fixture.id, initialSelection]);

  const releaseNextSignal = useCallback(async () => {
    try {
      await runManualTool("release_next_synthetic_signal", {
        expectedRevision: snapshotRef.current.state.revision,
      });
    } finally {
      setStreamPlaying(false);
    }
  }, [runManualTool]);

  useEffect(() => {
    if (!streamPlaying) return;
    if (releasedStageCount >= fixture.stream.stages.length) {
      return;
    }
    const timer = window.setTimeout(() => {
      void releaseNextSignal();
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [
    fixture.stream.stages.length,
    releasedStageCount,
    releaseNextSignal,
    streamPlaying,
  ]);

  const selectAsAnalyst = useCallback((next: TraceSelection) => {
    setAgentFocusEntityId(null);
    setSelection(next);
  }, []);

  const latestReceipt = snapshot.receipts.at(-1) ?? null;
  const latestAuthorizationReceipt =
    [...snapshot.receipts]
      .reverse()
      .find(
        (receipt) =>
          (receipt.toolName === "authorize_response_action" ||
            receipt.toolName === "authorize_response_bundle") &&
          receipt.status === "completed",
      ) ?? null;
  const latestStage = fixture.stream.stages[releasedStageCount - 1] ?? null;
  const liveAnnouncement = latestStage
    ? `New telemetry: ${latestStage.title}.`
    : "";
  const operationBusy =
    busy || !backendReady || investigationActivity.status === "running";
  const displayedInvestigationActivity =
    investigationActivity.status === "idle"
      ? {
          ...investigationActivity,
          availableToolCount: availableDefinitions.length,
          totalToolCount: totalDefinitions.length,
        }
      : investigationActivity;
  return (
    <PlatformShell
      activeView="case"
      agentStatus={agentStatus}
      fixture={fixture}
      mainRef={mainRef}
      onOpenAgent={() => setAgentDrawerOpen(true)}
      onReset={() => void handleReset()}
    >
      <div className="case-view">
        <p className="sr-only" aria-live="polite">
          {liveAnnouncement}
        </p>

        <div className="investigation-cockpit">
          <div className="workbench-grid">
            <EvidenceMap
              actionDock={
                <AnalystActionDock
                  busy={operationBusy}
                  fixture={fixture}
                  onExecute={runManualTool}
                  onReleaseSignal={() => setStreamPlaying(true)}
                  state={snapshot.state}
                  streamPlaying={streamPlaying}
                />
              }
              investigationActivity={displayedInvestigationActivity}
              investigationResult={investigationResult}
              agentFocusEntityId={agentFocusEntityId}
              commandBar={
                <CaseCommandBar
                  agentStatus={agentStatus}
                  busy={operationBusy}
                  fixture={fixture}
                  onExecute={runManualTool}
                  onReleaseSignal={() => setStreamPlaying(true)}
                  onReset={() => void handleReset()}
                  onSelect={selectAsAnalyst}
                  selection={selection}
                  state={snapshot.state}
                  streamPlaying={streamPlaying}
                />
              }
              fixture={fixture}
              investigationDock={
                <InvestigationDeck
                  activity={displayedInvestigationActivity}
                  busy={operationBusy}
                  fixture={fixture}
                  onExecute={runManualTool}
                  onSelect={selectAsAnalyst}
                  receipts={snapshot.receipts}
                  result={investigationResult}
                  selection={selection}
                  state={snapshot.state}
                />
              }
              key={`${fixture.id}-workbench-${workbenchEpoch}`}
              latestAuthorizationReceipt={latestAuthorizationReceipt}
              latestReceipt={latestReceipt}
              onSelect={selectAsAnalyst}
              receipts={snapshot.receipts}
              selection={selection}
              state={snapshot.state}
              syntheticExpansion={syntheticExpansion}
            >
              <CaseInspector
                investigationActivity={displayedInvestigationActivity}
                agentAvailable={agentStatus.state === "available"}
                error={error}
                fixture={fixture}
                latestReceipt={latestReceipt}
                onSelect={selectAsAnalyst}
                selection={selection}
                state={snapshot.state}
              />
            </EvidenceMap>
          </div>
        </div>
      </div>

      <AgentDrawer
        definitions={totalDefinitions}
        onClose={() => setAgentDrawerOpen(false)}
        open={agentDrawerOpen}
        outcomes={registrationOutcomes}
        receipts={snapshot.receipts}
      />
    </PlatformShell>
  );
}

function operationErrorMessage(response: ToolApiResponse): string {
  if (response.result.ok) return "";
  if (
    response.result.error.code === "STALE_STATE" ||
    response.result.error.code === "CONCURRENT_UPDATE"
  ) {
    return `Case advanced to r${response.snapshot.state.revision}. Review the current evidence and rerun this step.`;
  }
  return response.result.error.message;
}

function readFocusEntityId(response: ToolApiResponse): string | null {
  if (
    !response.result.ok ||
    response.result.data === null ||
    typeof response.result.data !== "object"
  ) {
    return null;
  }
  const value = (response.result.data as { focusEntityId?: unknown })
    .focusEntityId;
  return typeof value === "string" ? value : null;
}

function readRequestedFocusEntityId(
  fixture: CaseFixture,
  toolName: CaseToolName,
  input: Record<string, unknown>,
  state?: CaseSnapshot["state"],
): string | null {
  const directTarget =
    typeof input.entityId === "string"
      ? input.entityId
      : typeof input.fromEntityId === "string"
        ? input.fromEntityId
        : null;
  if (
    toolName === "run_investigation_query" &&
    typeof input.queryId === "string"
  ) {
    return (
      fixture.investigationQueries.find((query) => query.id === input.queryId)
        ?.targetEntityId ?? null
    );
  }
  if (
    toolName === "run_investigation_plan" &&
    typeof input.planId === "string"
  ) {
    return (
      resolveInvestigationExecution(
        fixture,
        state ?? createInitialCaseState(fixture),
        toolName,
        input,
      )?.targetEntityId ?? null
    );
  }
  if (
    directTarget &&
    getAllEntities(fixture).some((entity) => entity.id === directTarget)
  ) {
    return directTarget;
  }
  if (
    (toolName === "propose_response_action" ||
      toolName === "simulate_response_action") &&
    typeof input.actionId === "string"
  ) {
    return (
      fixture.responseActions.find((action) => action.id === input.actionId)
        ?.targetEntityId ?? null
    );
  }
  if (
    toolName === "prepare_response_bundle" &&
    typeof input.bundleId === "string"
  ) {
    return (
      getResponseBundles(fixture).find((bundle) => bundle.id === input.bundleId)
        ?.targetEntityIds[0] ?? null
    );
  }
  if (
    toolName === "request_next_observation" &&
    typeof input.stageId === "string"
  ) {
    return (
      fixture.stream.stages
        .find((stage) => stage.id === input.stageId)
        ?.events.at(-1)
        ?.entityIds.at(-1) ?? null
    );
  }
  return null;
}

function resolveInvestigationExecution(
  fixture: CaseFixture,
  state: CaseSnapshot["state"],
  toolName: CaseToolName,
  input: Record<string, unknown>,
): { queryId: string; targetEntityId: string } | null {
  if (toolName === "run_investigation_query") {
    const queryId = readQueryId(input);
    const query = fixture.investigationQueries.find(
      (candidate) => candidate.id === queryId,
    );
    return query
      ? { queryId: query.id, targetEntityId: query.targetEntityId }
      : null;
  }
  if (
    toolName !== "run_investigation_plan" ||
    typeof input.planId !== "string"
  ) {
    return null;
  }
  const plan = getInvestigationPlans(fixture).find(
    (candidate) => candidate.id === input.planId,
  );
  const query = plan?.queryIds
    .map((queryId) =>
      fixture.investigationQueries.find(
        (candidate) => candidate.id === queryId,
      ),
    )
    .find(
      (candidate) =>
        candidate !== undefined &&
        !state.attachedEnrichmentIds.includes(candidate.resultArtifactId),
    );
  return query
    ? { queryId: query.id, targetEntityId: query.targetEntityId }
    : null;
}

function readResponseInvestigationExecution(
  response: ToolApiResponse,
): { queryId: string; targetEntityId: string } | null {
  if (
    !response.result.ok ||
    response.result.data === null ||
    typeof response.result.data !== "object" ||
    Array.isArray(response.result.data)
  ) {
    return null;
  }
  const data = response.result.data as {
    queryId?: unknown;
    targetEntityId?: unknown;
  };
  return typeof data.queryId === "string" &&
    typeof data.targetEntityId === "string"
    ? { queryId: data.queryId, targetEntityId: data.targetEntityId }
    : null;
}

function readQueryId(input: Record<string, unknown>): string | null {
  return typeof input.queryId === "string" ? input.queryId : null;
}

function waitForOperation(
  toolName: CaseToolName,
  signal?: AbortSignal,
): Promise<void> {
  const duration = operationLatencyMs(toolName);
  if (duration === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Operation aborted.", "AbortError"));
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, duration);
    function abort() {
      window.clearTimeout(timer);
      reject(new DOMException("Operation aborted.", "AbortError"));
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function operationLatencyMs(toolName: CaseToolName): number {
  if (toolName === "run_investigation_plan") return 1_700;
  if (toolName === "run_investigation_query") return 1_250;
  if (toolName === "request_next_observation") return 520;
  if (toolName === "calculate_reachability") return 1_100;
  if (toolName === "prepare_response_bundle") return 760;
  if (
    toolName === "query_related_activity" ||
    toolName === "find_first_occurrence" ||
    toolName === "compare_timepoints" ||
    toolName === "search_events"
  ) {
    return 720;
  }
  if (toolName.startsWith("enrich_")) return 1_050;
  return 0;
}

function requireInitialEventId(fixture: CaseFixture): string {
  const eventId = fixture.primaryTraceEventIds[0] ?? fixture.events[0]?.id;
  if (!eventId) throw new Error(`Case ${fixture.id} has no selectable event.`);
  return eventId;
}

function getInitialSelection(fixture: CaseFixture): TraceSelection {
  const initialState = createInitialCaseState(fixture);
  return getSelectionForState(fixture, initialState, {
    kind: "event",
    id: requireInitialEventId(fixture),
  });
}

function getSelectionForState(
  fixture: CaseFixture,
  state: CaseSnapshot["state"],
  fallback: TraceSelection,
): TraceSelection {
  const targetEntityId = getDerivedNextStep(fixture, state).targetEntityId;
  return targetEntityId ? { kind: "entity", id: targetEntityId } : fallback;
}

function withSharedViewContext(
  toolName: CaseToolName,
  result: ToolApiResponse["result"],
  selection: TraceSelection,
): ToolApiResponse["result"] {
  if (
    toolName !== "get_case_context" ||
    !result.ok ||
    result.data === null ||
    typeof result.data !== "object" ||
    Array.isArray(result.data)
  ) {
    return result;
  }
  return {
    ...result,
    data: {
      ...result.data,
      sharedView: {
        selection,
        meaning: "Current human or agent visual focus; not evidence state.",
      },
    },
  };
}
