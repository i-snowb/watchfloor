"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getAppliedStreamStages,
  getAllEntities,
  getVisibleEntities,
  getVisibleEnrichments,
  getVisibleEvents,
  getVisibleJoins,
} from "@/domain/incident-stream";
import { getDerivedNextStep, getResponseBundles } from "@/domain/operations";
import type {
  CaseFixture,
  CaseState,
  Entity,
  EvidenceJoin,
  EvidenceView,
  OperationReceipt,
} from "@/domain/types";
import { formatUtcTime, humanizeEntityKind } from "@/lib/format";
import { useTraceCamera, type TraceSelection } from "./trace-interaction";
import { EntityGlyph } from "./entity-glyph";
import type {
  InvestigationActivity,
  InvestigationResultView,
} from "./investigation-activity";
import { AgentNowRail } from "./agent-now-rail";
import { InvestigationDrawer } from "./investigation-drawer";
import {
  buildCausalPhasePlanes,
  buildDirectionalImpactEnvelope,
  buildEvidenceReplayPlan,
  buildImpactLayout,
  findReplayStepForEntity,
  getCausalVisualState,
  getReplayEntityIds,
  type CausalPhasePlane,
  type DirectionalImpactEnvelope,
} from "./evidence-visualization";

interface EvidenceMapProps {
  fixture: CaseFixture;
  state: CaseState;
  selection: TraceSelection;
  onSelect: (selection: TraceSelection) => void;
  actionDock?: ReactNode;
  investigationActivity: InvestigationActivity;
  investigationResult?: InvestigationResultView | null;
  agentFocusEntityId?: string | null;
  latestReceipt?: OperationReceipt | null;
  latestAuthorizationReceipt?: OperationReceipt | null;
  receipts?: readonly OperationReceipt[];
  commandBar?: ReactNode;
  investigationDock?: ReactNode;
  syntheticExpansion?: {
    stageId: string;
    revision: number;
    token: number;
  } | null;
  children?: ReactNode;
}

interface MapEdge {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  label: string;
  truth: "correlated" | "modeled";
  join: EvidenceJoin | null;
  pathIds: readonly string[];
  blocked: boolean;
}

const nodeWidth = 220;
const nodeHeight = 136;

export function EvidenceMap({
  fixture,
  state,
  selection,
  onSelect,
  actionDock,
  investigationActivity,
  investigationResult = null,
  agentFocusEntityId = null,
  latestReceipt = null,
  latestAuthorizationReceipt = null,
  receipts = [],
  commandBar,
  investigationDock,
  syntheticExpansion = null,
  children,
}: EvidenceMapProps) {
  const [view, setView] = useState<EvidenceView>(
    fixture.presentation.defaultEvidenceView,
  );
  const modeledViewActivated = useRef(state.reachabilityAttached);
  const previousRevision = useRef(state.revision);
  const replayRevision = useRef(state.revision);
  const replayCaseId = useRef<string | null>(null);
  const [replayCursor, setReplayCursor] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [replayPulseJoinId, setReplayPulseJoinId] = useState<string | null>(
    null,
  );
  const [activeExpansion, setActiveExpansion] = useState<{
    token: number;
    joinIds: ReadonlySet<string>;
    entityIds: ReadonlySet<string>;
  } | null>(null);

  useEffect(() => {
    if (state.revision < previousRevision.current) {
      setView(fixture.presentation.defaultEvidenceView);
    } else if (!modeledViewActivated.current && state.reachabilityAttached) {
      setView("impact");
    } else if (modeledViewActivated.current && !state.reachabilityAttached) {
      setView(fixture.presentation.defaultEvidenceView);
    }
    modeledViewActivated.current = state.reachabilityAttached;
    previousRevision.current = state.revision;
  }, [
    fixture.presentation.defaultEvidenceView,
    state.reachabilityAttached,
    state.revision,
  ]);
  const visibleEntities = useMemo(
    () => getVisibleEntities(fixture, state),
    [fixture, state],
  );
  const visibleEvents = useMemo(
    () => getVisibleEvents(fixture, state),
    [fixture, state],
  );
  const visibleJoins = useMemo(
    () => getVisibleJoins(fixture, state),
    [fixture, state],
  );
  const replayPlan = useMemo(
    () => buildEvidenceReplayPlan(visibleEntities, visibleJoins),
    [visibleEntities, visibleJoins],
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!reducedMotion) return;
    const frame = window.requestAnimationFrame(() => {
      setReplayPlaying(false);
      setReplayCursor(replayPlan.joins.length);
      setReplayPulseJoinId(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [reducedMotion, replayPlan.joins.length]);

  useEffect(() => {
    const reset =
      replayCaseId.current !== fixture.id ||
      state.revision < replayRevision.current;
    replayCaseId.current = fixture.id;
    replayRevision.current = state.revision;
    if (!reset) return;
    const initialCursor = reducedMotion
      ? replayPlan.joins.length
      : Math.min(2, replayPlan.joins.length);
    setReplayCursor(initialCursor);
    setReplayPlaying(!reducedMotion && initialCursor < replayPlan.joins.length);
    setReplayPulseJoinId(null);
    setActiveExpansion(null);
  }, [fixture.id, reducedMotion, replayPlan.joins.length, state.revision]);

  useEffect(() => {
    if (!replayPlaying || reducedMotion) return;
    if (replayCursor >= replayPlan.joins.length) return;
    const timer = window.setTimeout(
      () => {
        const nextCursor = replayCursor + 1;
        setReplayCursor(nextCursor);
        setReplayPulseJoinId(replayPlan.joins[nextCursor - 1]?.id ?? null);
        if (nextCursor >= replayPlan.joins.length) setReplayPlaying(false);
      },
      replayCursor === 0 ? 420 : 520,
    );
    return () => window.clearTimeout(timer);
  }, [reducedMotion, replayCursor, replayPlan.joins, replayPlaying]);

  useEffect(() => {
    if (!replayPulseJoinId) return;
    const timer = window.setTimeout(() => setReplayPulseJoinId(null), 230);
    return () => window.clearTimeout(timer);
  }, [replayPulseJoinId]);

  useEffect(() => {
    if (!syntheticExpansion) return;
    const stage = fixture.stream.stages.find(
      (candidate) => candidate.id === syntheticExpansion.stageId,
    );
    if (!stage || syntheticExpansion.revision !== state.revision) return;
    let timer: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      setReplayPlaying(false);
      setReplayCursor(replayPlan.joins.length);
      setActiveExpansion({
        token: syntheticExpansion.token,
        joinIds: new Set(stage.joins.map((join) => join.id)),
        entityIds: new Set(stage.events.flatMap((event) => event.entityIds)),
      });
      timer = window.setTimeout(() => setActiveExpansion(null), 1_800);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [fixture, replayPlan.joins.length, state.revision, syntheticExpansion]);

  useEffect(() => {
    if (investigationActivity.status !== "running") return;
    const targetEntityId = investigationActivity.targetEntityId;
    const frame = window.requestAnimationFrame(() => {
      setReplayPlaying(false);
      if (!targetEntityId) return;
      setReplayCursor((current) =>
        Math.max(current, findReplayStepForEntity(replayPlan, targetEntityId)),
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [investigationActivity, replayPlan]);

  const selectEvidence = useCallback(
    (nextSelection: TraceSelection) => {
      setReplayPlaying(false);
      onSelect(nextSelection);
    },
    [onSelect],
  );
  const selectEdge = useCallback(
    (edge: MapEdge) => {
      const modelId = edge.pathIds[0] ?? null;
      if (view === "impact" && modelId) {
        selectEvidence({ kind: "model", id: modelId });
      } else if (edge.join) {
        selectEvidence({ kind: "join", id: edge.join.id });
      }
    },
    [selectEvidence, view],
  );
  const stages = useMemo(
    () => getAppliedStreamStages(fixture, state),
    [fixture, state],
  );
  const tracePositions = useMemo(
    () =>
      new Map(fixture.presentation.nodes.map((node) => [node.entityId, node])),
    [fixture],
  );
  const visibleEntityIds = new Set(visibleEntities.map((entity) => entity.id));
  const eventBackedEntityIds = new Set(
    visibleEvents.flatMap((event) => event.entityIds),
  );
  const renderedVisibleEntities = visibleEntities.filter(
    (entity) =>
      !fixture.impact.atRiskEntityIds.includes(entity.id) ||
      eventBackedEntityIds.has(entity.id) ||
      state.reachabilityAttached,
  );
  const renderedVisibleEntityIds = new Set(
    renderedVisibleEntities.map((entity) => entity.id),
  );
  const traceEligibleEntities = renderedVisibleEntities.filter(
    (entity) =>
      !fixture.impact.atRiskEntityIds.includes(entity.id) ||
      fixture.impact.observedEntityIds.includes(entity.id),
  );
  const modeledOnlyEntities = state.reachabilityAttached
    ? getAllEntities(fixture).filter(
        (entity) =>
          fixture.impact.atRiskEntityIds.includes(entity.id) &&
          !renderedVisibleEntityIds.has(entity.id),
      )
    : [];
  const replayEntityIds = getReplayEntityIds(
    replayPlan,
    replayCursor,
    traceEligibleEntities.map((entity) => entity.id),
  );
  const replayedEntities = traceEligibleEntities.filter((entity) =>
    replayEntityIds.has(entity.id),
  );
  const mapEntities =
    view === "trace"
      ? replayedEntities
      : [...renderedVisibleEntities, ...modeledOnlyEntities];
  const mapEntityIds = new Set(mapEntities.map((entity) => entity.id));
  const severedPathIds = new Set(
    state.responseActions.flatMap((actionState) => {
      if (actionState.status !== "authorized_in_demo") return [];
      return (
        fixture.responseActions.find(
          (definition) => definition.id === actionState.actionId,
        )?.seversPathIds ?? []
      );
    }),
  );
  const predictedPathIds = new Set(
    state.counterfactualAttached ? fixture.counterfactual.severedPathIds : [],
  );
  const replayedJoins = replayPlan.joins.slice(0, replayCursor);
  const edges = buildEdges(
    fixture,
    view === "trace" ? replayedJoins : visibleJoins,
    view === "impact" && state.reachabilityAttached,
  );
  const impactLayout = buildImpactLayout(fixture, [
    ...renderedVisibleEntities,
    ...modeledOnlyEntities,
  ]);
  const positions =
    view === "impact" && state.reachabilityAttached
      ? impactLayout.positions
      : tracePositions;
  const phasePlanes = useMemo(() => buildCausalPhasePlanes(fixture), [fixture]);
  const impactEnvelope = buildDirectionalImpactEnvelope(impactLayout);
  const selectionFocus =
    view === "impact" &&
    selection.kind === "entity" &&
    (selection.id === fixture.reachability.sourceEntityId ||
      !fixture.reachability.paths.some((path) =>
        path.entityIds.includes(selection.id),
      ))
      ? {
          active: false,
          edgeIds: new Set<string>(),
          entityIds: new Set<string>(),
        }
      : buildSelectionFocus(selection, edges, fixture, visibleEvents);
  const authorizedActions = state.responseActions.flatMap((actionState) => {
    if (actionState.status !== "authorized_in_demo") return [];
    const definition = fixture.responseActions.find(
      (candidate) => candidate.id === actionState.actionId,
    );
    return definition ? [definition] : [];
  });
  const authorizedActionByTarget = new Map(
    authorizedActions.map((action) => [action.targetEntityId, action]),
  );
  const authorizedTargets = new Set(authorizedActionByTarget.keys());
  const latestAuthorizedActions = (() => {
    if (
      latestAuthorizationReceipt?.status !== "completed" ||
      latestAuthorizationReceipt.resultRevision !== state.revision
    ) {
      return [];
    }
    if (latestAuthorizationReceipt.toolName === "authorize_response_bundle") {
      const bundleId = state.authorizedResponseBundleIds.at(-1);
      const bundle = getResponseBundles(fixture).find(
        (candidate) => candidate.id === bundleId,
      );
      return authorizedActions.filter((action) =>
        bundle?.actionIds.includes(action.id),
      );
    }
    if (latestAuthorizationReceipt.toolName === "authorize_response_action") {
      const action = authorizedActions.find((candidate) =>
        latestAuthorizationReceipt.resultSummary.startsWith(candidate.title),
      );
      return action ? [action] : [];
    }
    return [];
  })();
  const latestAuthorizedAction = latestAuthorizedActions[0] ?? null;
  const latestAuthorizedPathIds = new Set(
    latestAuthorizedActions.flatMap((action) => action.seversPathIds),
  );
  const allRequiredActionsAuthorized =
    fixture.conclusion.requiredActionIds.length > 0 &&
    fixture.conclusion.requiredActionIds.every(
      (actionId) =>
        state.responseActions.find((action) => action.actionId === actionId)
          ?.status === "authorized_in_demo",
    );
  const authorizedActionCount = state.responseActions.filter(
    (action) => action.status === "authorized_in_demo",
  ).length;
  const allAttachedQueries = fixture.investigationQueries.filter((query) =>
    state.attachedEnrichmentIds.includes(query.resultArtifactId),
  );
  const attachedQueries = allAttachedQueries.filter((query) =>
    mapEntityIds.has(query.targetEntityId),
  );
  const attachedFindingCount = allAttachedQueries.length;
  const visibleEnrichmentById = new Map(
    getVisibleEnrichments(fixture, state).map((artifact) => [
      artifact.id,
      artifact,
    ]),
  );
  const findingStatusCounts = allAttachedQueries.reduce(
    (counts, query) => {
      const status = visibleEnrichmentById.get(query.resultArtifactId)?.status;
      if (status === "supporting") counts.supporting += 1;
      if (status === "disputed") counts.disputed += 1;
      return counts;
    },
    { supporting: 0, disputed: 0 },
  );
  const attachedQueriesByTarget = new Map<string, typeof attachedQueries>();
  for (const query of attachedQueries) {
    const targetQueries = attachedQueriesByTarget.get(query.targetEntityId);
    if (targetQueries) targetQueries.push(query);
    else attachedQueriesByTarget.set(query.targetEntityId, [query]);
  }
  const nextStep = getDerivedNextStep(fixture, state);
  const nextGapEntityId =
    nextStep.phase === "inspect" ? nextStep.targetEntityId : null;
  const findingsSectionId = `${fixture.id}-attached-findings`;
  const openFindings = useCallback(() => {
    setDrawerOpen(true);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const heading = document.getElementById("attached-findings-heading");
        heading?.focus({ preventScroll: true });
        heading?.scrollIntoView({
          behavior: "auto",
          block: "start",
        });
      });
    });
  }, []);
  const activeWorkQuery =
    selection.kind === "entity"
      ? (fixture.investigationQueries.find(
          (query) =>
            query.targetEntityId === selection.id &&
            !state.attachedEnrichmentIds.includes(query.resultArtifactId) &&
            (query.requiresStageId === null ||
              state.releasedStreamStageIds.includes(query.requiresStageId)),
        ) ?? null)
      : null;
  const impactHeadline =
    allRequiredActionsAuthorized || state.lifecycle === "closed_in_demo"
      ? fixture.impact.containedHeadline
      : authorizedActionCount > 0
        ? `${authorizedActionCount}/${fixture.responseActions.length} controls approved · ${severedPathIds.size} modeled risk segment${severedPathIds.size === 1 ? "" : "s"} severed`
        : state.reachabilityAttached
          ? fixture.impact.modeledHeadline
          : fixture.impact.initialHeadline;
  const {
    camera,
    dragging,
    focusing,
    fit,
    focusTarget,
    onKeyDown,
    onLostPointerCapture,
    onPointerCancel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    planeRef,
    viewportRef,
    zoomBy,
  } = useTraceCamera(
    selection,
    state.revision * 2 + (view === "impact" ? 1 : 0),
    82,
  );
  const focusFromDrawer = useCallback(
    (nextSelection: TraceSelection) => {
      selectEvidence(nextSelection);
      setDrawerOpen(false);
      window.requestAnimationFrame(() => {
        viewportRef.current?.scrollIntoView({
          behavior: "auto",
          block: "start",
        });
        window.requestAnimationFrame(() => focusTarget(nextSelection));
      });
    },
    [focusTarget, selectEvidence, viewportRef],
  );
  const fittedView = useRef(view);
  const fittedRevision = useRef(state.revision);
  useEffect(() => {
    const reset = state.revision < fittedRevision.current;
    const viewChanged = view !== fittedView.current;
    fittedRevision.current = state.revision;
    fittedView.current = view;
    if (!reset && !viewChanged) return;
    const frame = window.requestAnimationFrame(fit);
    return () => window.cancelAnimationFrame(frame);
  }, [fit, state.revision, view]);
  const activeExpansionStage = activeExpansion
    ? (fixture.stream.stages.find(
        (stage) => stage.id === syntheticExpansion?.stageId,
      ) ?? null)
    : null;
  const agentTargetPosition =
    investigationActivity.status !== "idle" &&
    investigationActivity.targetEntityId
      ? positions.get(investigationActivity.targetEntityId)
      : null;
  const latestAuthorizedTargetPosition = latestAuthorizedAction
    ? positions.get(latestAuthorizedAction.targetEntityId)
    : null;
  const activeGraphHeight =
    view === "impact"
      ? fixture.presentation.graphHeight
      : Math.max(
          460,
          Math.min(
            fixture.presentation.graphHeight,
            Math.max(
              ...mapEntities.map((entity) => positions.get(entity.id)?.y ?? 0),
            ) +
              nodeHeight +
              64,
          ),
        );
  const evidenceTimeline = (
    <TraceSequenceRail
      activeQuery={activeWorkQuery}
      activity={investigationActivity}
      cursor={replayCursor}
      entities={visibleEntities}
      fixture={fixture}
      joins={replayPlan.joins}
      onNext={() => {
        const next = Math.min(replayPlan.joins.length, replayCursor + 1);
        setReplayPlaying(false);
        setReplayCursor(next);
        setReplayPulseJoinId(replayPlan.joins[next - 1]?.id ?? null);
      }}
      onPrevious={() => {
        setReplayPlaying(false);
        setReplayCursor(Math.max(0, replayCursor - 1));
      }}
      onRestart={() => {
        setReplayPlaying(false);
        setReplayCursor(0);
        setReplayPulseJoinId(null);
      }}
      onSelect={selectEvidence}
      onStep={(step) => {
        setReplayPlaying(false);
        setReplayCursor(step);
        setReplayPulseJoinId(replayPlan.joins[step - 1]?.id ?? null);
      }}
      onToggle={() => {
        if (replayCursor >= replayPlan.joins.length) {
          setReplayCursor(0);
          setReplayPulseJoinId(null);
          setReplayPlaying(true);
        } else {
          setReplayPlaying((playing) => !playing);
        }
      }}
      playing={replayPlaying}
      receipts={receipts}
      selection={selection}
    />
  );

  return (
    <section
      className={`trace-panel evidence-map evidence-map-${view}`}
      aria-labelledby="evidence-map-heading"
    >
      <header className="trace-panel-header evidence-map-header">
        <div className="case-map-identity">
          <p>
            <span className={`severity severity-${fixture.severity}`}>
              {fixture.severity}
            </span>
            <span>Tier 1 handoff</span>
            <span>{formatLifecycle(state.lifecycle)}</span>
          </p>
          <h1 id="evidence-map-heading">{fixture.title}</h1>
        </div>
        <AgentNowRail
          activity={investigationActivity}
          fixture={fixture}
          latestReceipt={latestReceipt}
          result={investigationResult}
          state={state}
        />
        <button
          aria-controls={findingsSectionId}
          aria-expanded={drawerOpen}
          className="case-findings-trigger"
          onClick={openFindings}
          type="button"
        >
          <span>Findings</span>
          <strong>{attachedFindingCount}</strong>
          <small>
            {attachedFindingCount === 0
              ? `Awaiting bounded evidence · r${state.revision}`
              : `${findingStatusCounts.supporting} supporting · ${findingStatusCounts.disputed} disputed · r${state.revision}`}
          </small>
        </button>
        <div className="evidence-view-switch" aria-label="Evidence view">
          <button
            aria-pressed={view === "trace"}
            onClick={() => setView("trace")}
            type="button"
          >
            Causal trace
          </button>
          <button
            aria-pressed={view === "impact"}
            onClick={() => setView("impact")}
            type="button"
          >
            Impact map
          </button>
        </div>
        <div className="evidence-line-legend" aria-label="Path truth legend">
          <span>
            <i className="line-correlated" /> Correlated
          </span>
          {state.reachabilityAttached ? (
            <span>
              <i className="line-modeled" /> Possible
            </span>
          ) : null}
          {state.counterfactualAttached ? (
            <span>
              <i className="line-predicted" /> Simulated
            </span>
          ) : null}
          {severedPathIds.size > 0 ? (
            <span>
              <i className="line-severed" /> Severed
            </span>
          ) : null}
        </div>
        <span className="evidence-line-key-compact">
          Solid correlated · dashed modeled or simulated
        </span>
        <div className="trace-camera-tools" aria-label="Graph view controls">
          <span>{Math.round(camera.scale * 100)}%</span>
          <button
            aria-label="Zoom out"
            onClick={() => zoomBy(0.84)}
            type="button"
          >
            −
          </button>
          <button
            aria-label="Zoom in"
            onClick={() => zoomBy(1.19)}
            type="button"
          >
            +
          </button>
          <button onClick={fit} type="button">
            Fit
          </button>
        </div>
      </header>

      <div className="evidence-stage-frame">
        {actionDock ? (
          <div className="map-command-dock">{actionDock}</div>
        ) : null}
        {investigationDock &&
        (activeWorkQuery || investigationActivity.status === "running") ? (
          <div className="map-investigation-dock">{investigationDock}</div>
        ) : null}
        <button className="map-skip-link" onClick={openFindings} type="button">
          Skip map to findings
        </button>
        <div
          aria-describedby="evidence-map-help"
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight + - 0 Escape"
          aria-label="Interactive directional evidence and impact map"
          className={`trace-scroll trace-viewport evidence-map-viewport ${dragging ? "trace-viewport-dragging" : ""} ${focusing ? "trace-viewport-focusing" : ""}`}
          onKeyDown={onKeyDown}
          onLostPointerCapture={onLostPointerCapture}
          onPointerCancel={onPointerCancel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          ref={viewportRef}
          role="region"
          tabIndex={0}
        >
          <div
            className="trace-field-grid evidence-map-grid"
            aria-hidden="true"
          />
          {view === "impact" ? (
            <section
              className="impact-readout map-impact-readout"
              aria-label="Blast radius summary"
            >
              <p aria-live="polite" className="visually-hidden">
                {impactAnnouncement(
                  fixture,
                  state,
                  authorizedActionCount,
                  severedPathIds.size,
                )}
              </p>
              <div>
                <span>Impact state</span>
                <strong>{impactHeadline}</strong>
                {authorizedActionCount > 0 ? (
                  <small className="containment-status">
                    {severedPathIds.size} modeled segment
                    {severedPathIds.size === 1 ? "" : "s"} severed · no external
                    action executed
                  </small>
                ) : null}
              </div>
              <dl>
                <div>
                  <dt>Observed</dt>
                  <dd>
                    {
                      fixture.impact.observedEntityIds.filter((id) =>
                        visibleEntityIds.has(id),
                      ).length
                    }
                  </dd>
                </div>
                <div>
                  <dt>Modeled reach</dt>
                  <dd
                    className={
                      state.reachabilityAttached ? undefined : "not-modeled"
                    }
                  >
                    {state.reachabilityAttached
                      ? fixture.impact.atRiskEntityIds.length
                      : "Not modeled"}
                  </dd>
                </div>
                <div>
                  <dt>Risk paths</dt>
                  <dd
                    className={
                      state.reachabilityAttached ? undefined : "not-modeled"
                    }
                  >
                    {state.reachabilityAttached
                      ? fixture.reachability.paths.length
                      : "Not modeled"}
                  </dd>
                </div>
                <div>
                  <dt>Controls</dt>
                  <dd>
                    {authorizedActionCount}/{fixture.responseActions.length}
                  </dd>
                </div>
              </dl>
            </section>
          ) : null}
          <div
            className="causal-plane evidence-map-plane"
            ref={planeRef}
            style={{
              height: activeGraphHeight,
              minHeight: activeGraphHeight,
              minWidth: fixture.presentation.graphWidth,
              width: fixture.presentation.graphWidth,
            }}
          >
            <CausalField phasePlanes={phasePlanes} />
            {view === "impact" && state.reachabilityAttached ? (
              <ImpactEnvelope
                contained={severedPathIds.size > 0}
                height={activeGraphHeight}
                segments={impactEnvelope}
                width={fixture.presentation.graphWidth}
              />
            ) : null}
            <svg
              aria-label="Directed case relationships"
              className="evidence-map-lines"
              height={activeGraphHeight}
              viewBox={`0 0 ${fixture.presentation.graphWidth} ${activeGraphHeight}`}
              width={fixture.presentation.graphWidth}
            >
              <defs>
                <marker
                  id="map-arrow-correlated"
                  markerHeight="7"
                  markerWidth="9"
                  orient="auto"
                  refX="8"
                  refY="3.5"
                >
                  <path d="M0 0L9 3.5L0 7Z" />
                </marker>
                <marker
                  id="map-arrow-modeled"
                  markerHeight="7"
                  markerWidth="9"
                  orient="auto"
                  refX="8"
                  refY="3.5"
                >
                  <path d="M0 0L9 3.5L0 7Z" />
                </marker>
                <marker
                  id="map-arrow-severed"
                  markerHeight="7"
                  markerWidth="9"
                  orient="auto"
                  refX="8"
                  refY="3.5"
                >
                  <path d="M0 0L9 3.5L0 7Z" />
                </marker>
                <marker
                  id="map-arrow-blocked"
                  markerHeight="7"
                  markerWidth="9"
                  orient="auto"
                  refX="8"
                  refY="3.5"
                >
                  <path d="M0 0L9 3.5L0 7Z" />
                </marker>
              </defs>
              {edges.map((edge) => {
                const from = positions.get(edge.fromEntityId);
                const to = positions.get(edge.toEntityId);
                if (
                  !from ||
                  !to ||
                  !mapEntityIds.has(edge.fromEntityId) ||
                  !mapEntityIds.has(edge.toEntityId)
                )
                  return null;
                const severed =
                  edge.pathIds.length > 0 &&
                  edge.pathIds.every((id) => severedPathIds.has(id));
                const severing =
                  severed &&
                  edge.pathIds.some((id) => latestAuthorizedPathIds.has(id));
                const predicted =
                  !severed &&
                  edge.pathIds.length > 0 &&
                  edge.pathIds.every((id) => predictedPathIds.has(id));
                const expanding =
                  activeExpansion?.joinIds.has(edge.id) ?? false;
                const replaying = replayPulseJoinId === edge.id;
                const selected =
                  selection.kind === "join" && selection.id === edge.id;
                const related = selectionFocus.edgeIds.has(edge.id);
                const dimmed = selectionFocus.active && !related;
                const geometry = edgeGeometry(
                  from.x,
                  from.y,
                  to.x,
                  to.y,
                  view === "impact",
                );
                const marker = edge.blocked
                  ? "url(#map-arrow-blocked)"
                  : severed
                    ? "url(#map-arrow-severed)"
                    : edge.truth === "modeled"
                      ? "url(#map-arrow-modeled)"
                      : "url(#map-arrow-correlated)";
                return (
                  <path
                    aria-label={`${edge.label}: ${edge.fromEntityId} to ${edge.toEntityId}`}
                    className={`evidence-line evidence-line-${edge.truth} ${edge.blocked ? "evidence-line-blocked" : ""} ${predicted ? "evidence-line-predicted" : ""} ${severed ? "evidence-line-severed" : ""} ${severing ? "evidence-line-severing" : ""} ${expanding ? "evidence-line-expanding" : ""} ${replaying ? "evidence-line-replaying" : ""} ${selected ? "evidence-line-selected" : ""} ${related ? "evidence-line-related" : ""} ${dimmed ? "evidence-line-dimmed" : ""}`}
                    d={geometry.path}
                    data-trace-join-id={edge.join?.id}
                    key={edge.id}
                    markerEnd={marker}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectEdge(edge);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectEdge(edge);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  />
                );
              })}
            </svg>

            {edges.map((edge) => {
              const modelId = edge.pathIds[0] ?? null;
              const showTraceLabel = view === "trace" && edge.join !== null;
              const showImpactLabel =
                view === "impact" &&
                state.reachabilityAttached &&
                modelId !== null;
              if (!showTraceLabel && !showImpactLabel) return null;
              const from = positions.get(edge.fromEntityId);
              const to = positions.get(edge.toEntityId);
              if (
                !from ||
                !to ||
                !mapEntityIds.has(edge.fromEntityId) ||
                !mapEntityIds.has(edge.toEntityId)
              )
                return null;
              const severed =
                edge.pathIds.length > 0 &&
                edge.pathIds.every((id) => severedPathIds.has(id));
              const predicted =
                !severed &&
                edge.pathIds.length > 0 &&
                edge.pathIds.every((id) => predictedPathIds.has(id));
              const related = selectionFocus.edgeIds.has(edge.id);
              const dimmed = selectionFocus.active && !related;
              const geometry = edgeGeometry(
                from.x,
                from.y,
                to.x,
                to.y,
                view === "impact",
              );
              const label = severed
                ? "Modeled segment severed"
                : predicted
                  ? "Simulated severance · not authorized"
                  : edge.blocked
                    ? "Attempt prevented"
                    : edge.truth === "modeled"
                      ? "Possible · not observed"
                      : (edge.join?.id.replace(/^JOIN-[A-Z]+-/, "J") ??
                        "Correlated");
              return (
                <button
                  aria-pressed={
                    showImpactLabel
                      ? selection.kind === "model" && selection.id === modelId
                      : selection.kind === "join" &&
                        selection.id === edge.join?.id
                  }
                  className={`evidence-edge-label ${edge.blocked ? "evidence-edge-label-blocked" : ""} ${showImpactLabel ? "evidence-edge-label-impact" : ""} ${predicted ? "evidence-edge-label-predicted" : ""} ${severed ? "evidence-edge-label-severed" : ""} ${related ? "evidence-edge-label-related" : ""} ${dimmed ? "evidence-edge-label-dimmed" : ""}`}
                  data-trace-join-id={
                    showTraceLabel ? edge.join?.id : undefined
                  }
                  data-trace-model-id={showImpactLabel ? modelId : undefined}
                  key={`label-${edge.id}`}
                  onClick={() => {
                    selectEdge(edge);
                  }}
                  style={{
                    left: geometry.label.x,
                    top: geometry.label.y,
                  }}
                  type="button"
                >
                  <span>{label}</span>
                  <strong>{edge.label}</strong>
                </button>
              );
            })}

            {mapEntities.map((entity) => {
              const position = positions.get(entity.id);
              const action = authorizedActionByTarget.get(entity.id);
              if (!position || !action) return null;
              const entering = latestAuthorizedActions.some(
                (candidate) => candidate.id === action.id,
              );
              return (
                <span
                  aria-hidden="true"
                  className={`containment-perimeter ${entering ? "containment-perimeter-enter" : ""}`}
                  key={`containment-${entity.id}`}
                  style={{
                    left: position.x + nodeWidth / 2,
                    top: position.y + nodeHeight / 2,
                  }}
                >
                  <i />
                  <b>{authorizedEntityStateLabel(action.id)}</b>
                </span>
              );
            })}

            {mapEntities.map((entity) => {
              const position = positions.get(entity.id);
              if (!position) return null;
              const entityEvents = visibleEvents.filter((event) =>
                event.entityIds.includes(entity.id),
              );
              const selected =
                (selection.kind === "entity" || selection.kind === "model") &&
                selection.id === entity.id;
              const observed = fixture.impact.observedEntityIds.includes(
                entity.id,
              );
              const atRisk =
                state.reachabilityAttached &&
                fixture.impact.atRiskEntityIds.includes(entity.id);
              const containedAction = authorizedActionByTarget.get(entity.id);
              const contained = authorizedTargets.has(entity.id);
              const containmentEntering = latestAuthorizedActions.some(
                (action) => action.targetEntityId === entity.id,
              );
              const containedLabel = containedAction
                ? authorizedEntityStateLabel(containedAction.id)
                : null;
              const modeledOnly =
                fixture.impact.atRiskEntityIds.includes(entity.id) && !observed;
              const evidenceState = entityEvidenceState(
                entity,
                entityEvents,
                atRisk,
              );
              const causalState = getCausalVisualState({
                contained,
                disputed: fixture.investigationQueries.some((query) => {
                  if (query.targetEntityId !== entity.id) return false;
                  return (
                    visibleEnrichmentById.get(query.resultArtifactId)
                      ?.status === "disputed"
                  );
                }),
                modeled: modeledOnly,
                prevented: evidenceState.includes("prevented"),
              });
              const related = selectionFocus.entityIds.has(entity.id);
              const dimmed = selectionFocus.active && !related;
              const expanding =
                activeExpansion?.entityIds.has(entity.id) ?? false;
              const impactPosition = impactLayout.positions.get(entity.id);
              const investigationRunning =
                investigationActivity.status === "running" &&
                investigationActivity.targetEntityId === entity.id;
              const nextGap = nextGapEntityId === entity.id;
              return (
                <button
                  aria-label={`${containedLabel ?? (modeledOnly ? "Possible, not observed" : "Observed")} ${humanizeEntityKind(entity.kind)} ${entity.label}${impactPosition?.hop === null || view !== "impact" ? "" : `, modeled hop ${impactPosition?.hop}`}`}
                  aria-pressed={selected}
                  className={`evidence-entity evidence-entity-${position.lane} evidence-kind-${entity.kind} causal-state-${causalState} ${observed ? "evidence-entity-observed" : ""} ${atRisk ? "evidence-entity-at-risk" : ""} ${contained ? "evidence-entity-contained" : ""} ${containmentEntering ? "evidence-entity-containment-enter" : ""} ${modeledOnly ? "evidence-entity-modeled-only" : ""} ${expanding ? "evidence-entity-expanding" : ""} ${agentFocusEntityId === entity.id ? "evidence-entity-agent" : ""} ${investigationRunning ? `evidence-entity-query-running evidence-entity-query-${investigationActivity.actor}` : ""} ${nextGap ? "evidence-entity-next-gap" : ""} ${selected ? "evidence-entity-active-pivot" : ""} ${related ? "evidence-entity-related" : ""} ${dimmed ? "evidence-entity-dimmed" : ""}`}
                  data-control-state={containedAction?.id}
                  data-entity-kind={entity.kind}
                  data-impact-hop={
                    view === "impact" ? impactPosition?.hop : undefined
                  }
                  data-impact-role={
                    view === "impact" ? impactPosition?.role : undefined
                  }
                  data-causal-state={causalState}
                  data-trace-entity-id={modeledOnly ? undefined : entity.id}
                  data-trace-model-id={modeledOnly ? entity.id : undefined}
                  key={entity.id}
                  onClick={() =>
                    selectEvidence({
                      kind: modeledOnly ? "model" : "entity",
                      id: entity.id,
                    })
                  }
                  style={{ left: position.x, top: position.y }}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={`causal-entity-plinth causal-entity-plinth-${causalState}`}
                  />
                  <span className="evidence-entity-glyph">
                    <EntityGlyph
                      entity={entity}
                      kind={entity.kind}
                      state={causalState}
                    />
                  </span>
                  <span className="evidence-entity-copy">
                    <small>
                      {humanizeEntityKind(entity.kind)} · {position.lane}
                    </small>
                    <strong>{entity.label}</strong>
                    <span>{entity.summary}</span>
                  </span>
                  <span className="evidence-entity-state">
                    {containedLabel
                      ? containedLabel
                      : modeledOnly
                        ? "Possible · not observed"
                        : evidenceState}
                  </span>
                  {expanding ? <i>New fixture telemetry</i> : null}
                  {investigationRunning ? (
                    <b>
                      {investigationActivity.actor === "agent"
                        ? "Copilot querying"
                        : "Analyst query"}
                    </b>
                  ) : agentFocusEntityId === entity.id ? (
                    <b>Copilot focus</b>
                  ) : nextGap && investigationActivity.status === "idle" ? (
                    <b>Next evidence gap</b>
                  ) : null}
                </button>
              );
            })}

            {agentTargetPosition &&
            investigationActivity.status === "running" ? (
              <span
                aria-hidden="true"
                className={`query-scan-aperture query-scan-${investigationActivity.actor}`}
                style={{
                  left: agentTargetPosition.x + nodeWidth / 2,
                  top: agentTargetPosition.y + nodeHeight / 2,
                }}
              >
                <i />
                <i />
                <i />
              </span>
            ) : null}

            {[...attachedQueriesByTarget.entries()].map(
              ([targetEntityId, targetQueries]) => {
                const position = positions.get(targetEntityId);
                if (!position) return null;
                const target = mapEntities.find(
                  (entity) => entity.id === targetEntityId,
                );
                const query = targetQueries.at(-1);
                if (!query) return null;
                const recent =
                  investigationActivity.status === "completed" &&
                  investigationActivity.queryId === query.id;
                const artifact = visibleEnrichmentById.get(
                  query.resultArtifactId,
                );
                const receipt = [...receipts]
                  .reverse()
                  .find(
                    (candidate) =>
                      candidate.status === "completed" &&
                      isQueryExecutionReceipt(candidate) &&
                      candidate.title === query.title,
                  );
                return (
                  <div
                    className="query-result-stack"
                    key={`query-results-${targetEntityId}`}
                    style={{
                      left: position.x + 12,
                      top: position.y + nodeHeight + 16,
                    }}
                  >
                    <button
                      aria-label={`Open ${targetQueries.length} ${targetQueries.length === 1 ? "finding" : "findings"} for ${target?.label ?? targetEntityId}`}
                      className={`query-result-packet ${recent ? "query-result-packet-new" : ""}`}
                      onClick={() => {
                        selectEvidence({
                          kind: "entity",
                          id: targetEntityId,
                        });
                        openFindings();
                      }}
                      type="button"
                    >
                      <span>
                        {artifact?.status ?? "Evidence"} ·{" "}
                        {receipt?.reportedSurface === "webmcp_callback"
                          ? "WebMCP"
                          : "Analyst"}
                      </span>
                      <strong>{artifact?.title ?? query.title}</strong>
                      <small>
                        {targetQueries.length > 1
                          ? `${targetQueries.length} findings attached · r${receipt?.resultRevision ?? state.revision}`
                          : `${query.matchedRecordCount} matched · ${query.returnedRecordCount} returned · r${receipt?.resultRevision ?? state.revision}`}
                      </small>
                    </button>
                  </div>
                );
              },
            )}

            {agentTargetPosition &&
            investigationActivity.status !== "idle" &&
            investigationActivity.status !== "completed" ? (
              <div
                className={`agent-target-callout agent-target-${investigationActivity.status}`}
                style={{
                  left: agentTargetPosition.x,
                  top: agentTargetPosition.y - 20,
                }}
              >
                <span>
                  {investigationActivity.actor === "agent"
                    ? "Copilot"
                    : "Analyst"}
                </span>
                <code>{investigationActivity.toolName}</code>
                <small>
                  {investigationActivity.status === "running"
                    ? `Querying r${investigationActivity.baseRevision}`
                    : "Rejected · no state change"}
                </small>
              </div>
            ) : null}

            {latestAuthorizedAction && latestAuthorizedTargetPosition ? (
              <div
                className="containment-action-callout"
                role="status"
                style={{
                  left: latestAuthorizedTargetPosition.x + nodeWidth / 2,
                  top: latestAuthorizedTargetPosition.y + nodeHeight + 18,
                }}
              >
                <span>Analyst approval recorded</span>
                <strong>{latestAuthorizedAction.title}</strong>
                <small>Recorded only · no external control executed</small>
              </div>
            ) : null}
          </div>

          {activeExpansionStage ? (
            <div className="synthetic-expansion-status" role="status">
              <span>Synthetic telemetry</span>
              <strong>{activeExpansionStage.title}</strong>
              <small>
                {activeExpansion?.joinIds.size ?? 0} correlated boundary added ·
                r{syntheticExpansion?.revision}
              </small>
            </div>
          ) : null}

          {view === "impact" && state.reachabilityAttached ? (
            <div className="impact-model-caveat">
              <span>Reachability model</span>
              <strong>{fixture.reachability.caveat}</strong>
            </div>
          ) : null}

          <div className="trace-camera-status" id="evidence-map-help">
            <span>Click inspect</span>
            <span>Drag pan</span>
            <span>⌘/Ctrl + wheel zoom</span>
          </div>
          {latestReceipt ? (
            <div
              className={`trace-operation-seam trace-operation-${latestReceipt.reportedSurface}`}
            >
              <span>
                {latestReceipt.reportedSurface === "webmcp_callback"
                  ? "Copilot"
                  : "Analyst"}
              </span>
              <code>{latestReceipt.toolName}</code>
              <small>
                r{latestReceipt.baseRevision}→r{latestReceipt.resultRevision}
              </small>
              <strong>{latestReceipt.resultSummary}</strong>
            </div>
          ) : null}
        </div>
        <div className="case-timeline-dock">{evidenceTimeline}</div>
      </div>

      <div
        className="evidence-map-mobile"
        aria-label="Case entities and directional relationships"
      >
        <p className="evidence-map-mobile-label">Entities</p>
        {mapEntities.map((entity) => {
          const modeledOnly = !renderedVisibleEntityIds.has(entity.id);
          const entityEvents = visibleEvents.filter((event) =>
            event.entityIds.includes(entity.id),
          );
          const atRisk = fixture.impact.atRiskEntityIds.includes(entity.id);
          const containedAction = authorizedActionByTarget.get(entity.id);
          const selected = modeledOnly
            ? selection.kind === "model" && selection.id === entity.id
            : selection.kind === "entity" && selection.id === entity.id;
          return (
            <button
              aria-pressed={selected}
              key={`mobile-${entity.id}`}
              onClick={() =>
                selectEvidence({
                  kind: modeledOnly ? "model" : "entity",
                  id: entity.id,
                })
              }
              type="button"
            >
              <EntityGlyph kind={entity.kind} />
              <span>
                <small>{humanizeEntityKind(entity.kind)}</small>
                <strong>{entity.label}</strong>
                <em>
                  {containedAction
                    ? authorizedEntityStateLabel(containedAction.id)
                    : modeledOnly
                      ? "Possible · not observed"
                      : entityEvidenceState(entity, entityEvents, atRisk)}
                </em>
              </span>
            </button>
          );
        })}
        <p className="evidence-map-mobile-label">Relationships</p>
        {edges
          .filter(
            (edge) =>
              mapEntityIds.has(edge.fromEntityId) &&
              mapEntityIds.has(edge.toEntityId),
          )
          .map((edge) => {
            const from = mapEntities.find(
              (entity) => entity.id === edge.fromEntityId,
            );
            const to = mapEntities.find(
              (entity) => entity.id === edge.toEntityId,
            );
            const severed =
              edge.pathIds.length > 0 &&
              edge.pathIds.every((id) => severedPathIds.has(id));
            const predicted =
              !severed &&
              edge.pathIds.length > 0 &&
              edge.pathIds.every((id) => predictedPathIds.has(id));
            const stateLabel = edge.blocked
              ? "Attempt prevented"
              : severed
                ? "Modeled segment severed · analyst approved"
                : predicted
                  ? "Simulated severance · not authorized"
                  : edge.truth;
            return (
              <button
                aria-pressed={
                  edge.join
                    ? selection.kind === "join" && selection.id === edge.join.id
                    : selection.kind === "model" &&
                      selection.id === edge.pathIds[0]
                }
                key={edge.id}
                onClick={() => {
                  if (edge.join) {
                    selectEvidence({ kind: "join", id: edge.join.id });
                  } else if (edge.pathIds[0]) {
                    selectEvidence({ kind: "model", id: edge.pathIds[0] });
                  }
                }}
                type="button"
              >
                <span>
                  <small>{stateLabel}</small>
                  <strong>
                    {from?.label ?? edge.fromEntityId} →{" "}
                    {to?.label ?? edge.toEntityId}
                  </strong>
                  <em>{edge.label}</em>
                </span>
              </button>
            );
          })}
      </div>

      <InvestigationDrawer
        commandBar={commandBar}
        fixture={fixture}
        findingsSectionId={findingsSectionId}
        onSelect={focusFromDrawer}
        onOpenChange={setDrawerOpen}
        open={drawerOpen}
        queryControls={investigationDock}
        receipts={receipts}
        selectionDetails={children}
        state={state}
      />

      <footer className="evidence-coverage">
        <div className="evidence-coverage-label">
          <span>
            {view === "impact" ? "Impact boundary" : "Evidence boundary"}
          </span>
          <small>Solid correlated · dashed modeled or simulated</small>
        </div>
        <p>
          {view === "impact" && state.reachabilityAttached
            ? `${fixture.reachability.caveat} ${fixture.counterfactual.caveat}`
            : fixture.presentation.coverageNotes[
                Math.min(
                  stages.length,
                  fixture.presentation.coverageNotes.length - 1,
                )
              ]}
        </p>
        <code>
          {visibleEvents.length} events · {visibleJoins.length} joins
        </code>
      </footer>
    </section>
  );
}

function isQueryExecutionReceipt(receipt: OperationReceipt): boolean {
  return (
    receipt.toolName === "run_investigation_query" ||
    receipt.toolName === "run_investigation_plan"
  );
}

function TraceSequenceRail({
  activeQuery,
  activity,
  fixture,
  joins,
  entities,
  selection,
  onSelect,
  cursor,
  playing,
  onToggle,
  onRestart,
  onPrevious,
  onNext,
  onStep,
  receipts,
}: {
  activeQuery: CaseFixture["investigationQueries"][number] | null;
  activity: InvestigationActivity;
  fixture: CaseFixture;
  joins: readonly EvidenceJoin[];
  entities: readonly Entity[];
  selection: TraceSelection;
  onSelect: (selection: TraceSelection) => void;
  cursor: number;
  playing: boolean;
  onToggle: () => void;
  onRestart: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onStep: (step: number) => void;
  receipts: readonly OperationReceipt[];
}) {
  const entityLabels = new Map(
    entities.map((entity) => [entity.id, entity.label]),
  );
  const orderedJoins = joins;
  const currentJoin = orderedJoins[Math.max(0, cursor - 1)] ?? null;
  const entityByLabel = new Map(
    entities.map((entity) => [entity.label, entity.id]),
  );
  const investigationReceipts = receipts.filter(
    (receipt) =>
      receipt.status === "completed" &&
      (receipt.toolName === "run_investigation_query" ||
        receipt.toolName === "run_investigation_plan" ||
        receipt.toolName === "query_related_activity" ||
        receipt.toolName === "find_first_occurrence" ||
        receipt.toolName === "request_next_observation" ||
        receipt.toolName === "release_next_synthetic_signal" ||
        receipt.toolName === "calculate_reachability" ||
        receipt.toolName === "simulate_control" ||
        receipt.toolName === "prepare_response_bundle" ||
        receipt.toolName === "authorize_response_bundle" ||
        receipt.toolName.startsWith("enrich_")),
  );

  return (
    <section
      className="evidence-replay investigation-timeline"
      aria-label="Case evidence and investigation timeline"
    >
      <header className="evidence-replay-controls timeline-controls">
        <div>
          <span>Evidence replay</span>
          <strong>
            {String(cursor).padStart(2, "0")} /{" "}
            {String(orderedJoins.length).padStart(2, "0")}
          </strong>
          <small>Fixture sequence · replay does not alter evidence</small>
        </div>
        <div className="replay-buttons">
          <button
            aria-label="Restart evidence replay"
            onClick={onRestart}
            type="button"
          >
            Restart
          </button>
          <button
            aria-label="Previous evidence step"
            disabled={cursor === 0}
            onClick={onPrevious}
            type="button"
          >
            ←
          </button>
          <button
            aria-label={
              playing ? "Pause evidence replay" : "Play evidence replay"
            }
            aria-pressed={playing}
            className="replay-toggle"
            onClick={onToggle}
            type="button"
          >
            {playing
              ? "Pause"
              : cursor >= orderedJoins.length
                ? "Replay"
                : "Play"}
          </button>
          <button
            aria-label="Next evidence step"
            disabled={cursor >= orderedJoins.length}
            onClick={onNext}
            type="button"
          >
            →
          </button>
        </div>
      </header>

      <div className="timeline-tracks">
        <div className="timeline-track-labels" aria-hidden="true">
          <span>Evidence</span>
          <span>Work</span>
        </div>
        <ol
          className="trace-sequence-rail timeline-observed-track"
          aria-label="Correlated attack sequence"
        >
          {orderedJoins.map((join, index) => {
            const blocked = fixture.impact.blockedJoinIds.includes(join.id);
            const revealed = index < cursor;
            const current = index === cursor - 1;
            const selected =
              selection.kind === "join" && selection.id === join.id;
            return (
              <li
                className={`${revealed ? "sequence-step-revealed" : "sequence-step-pending"} ${current ? "sequence-step-current" : ""}`}
                key={join.id}
              >
                <button
                  aria-current={current ? "step" : undefined}
                  className={`${blocked ? "sequence-step-blocked" : ""} ${selected ? "sequence-step-selected" : ""}`}
                  onClick={() => {
                    onStep(index + 1);
                    onSelect({ kind: "join", id: join.id });
                  }}
                  type="button"
                >
                  <span>{formatUtcTime(join.timestamp)}</span>
                  <div>
                    <small>{blocked ? "Prevented" : "Correlated"}</small>
                    <strong>{humanizeRelation(join.relation)}</strong>
                    <em>
                      {entityLabels.get(join.fromEntityId) ?? join.fromEntityId}{" "}
                      → {entityLabels.get(join.toEntityId) ?? join.toEntityId}
                    </em>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
        <ol
          className="timeline-query-track"
          aria-label="Analyst and copilot investigation queries"
        >
          {investigationReceipts.map((receipt) => {
            const targetEntityId = receipt.target
              ? (entityByLabel.get(receipt.target) ?? null)
              : null;
            return (
              <li key={receipt.id}>
                <button
                  disabled={!targetEntityId}
                  onClick={() =>
                    targetEntityId &&
                    onSelect({ kind: "entity", id: targetEntityId })
                  }
                  type="button"
                >
                  <span>
                    {receipt.reportedSurface === "webmcp_callback"
                      ? "Copilot"
                      : "Analyst"}
                  </span>
                  <strong>{receipt.title}</strong>
                  <small>
                    {formatUtcTime(receipt.occurredAt)} · r
                    {receipt.baseRevision}→r{receipt.resultRevision}
                  </small>
                </button>
              </li>
            );
          })}
          {activeQuery ? (
            <li className="timeline-query-ready">
              <button
                onClick={() =>
                  onSelect({ kind: "entity", id: activeQuery.targetEntityId })
                }
                type="button"
              >
                <span>
                  {activity.status === "running" &&
                  activity.queryId === activeQuery.id
                    ? activity.actor === "agent"
                      ? "Copilot scanning"
                      : "Analyst request"
                    : "Ready"}
                </span>
                <strong>{activeQuery.title}</strong>
                <small>
                  {activity.status === "running" &&
                  activity.queryId === activeQuery.id
                    ? `${activeQuery.sourceScopes.length} bounded sources locked`
                    : "Result unknown until execution"}
                </small>
              </button>
            </li>
          ) : null}
          {investigationReceipts.length === 0 && !activeQuery ? (
            <li className="timeline-query-empty">
              Select a Tier 1 lead to begin.
            </li>
          ) : null}
        </ol>
      </div>
      <p aria-live="polite" className="sr-only">
        {currentJoin
          ? `Recorded evidence step ${cursor} of ${orderedJoins.length}: ${currentJoin.label}.`
          : `Evidence replay ready. ${orderedJoins.length} correlated joins.`}
      </p>
    </section>
  );
}

function CausalField({
  phasePlanes,
}: {
  phasePlanes: readonly CausalPhasePlane[];
}) {
  return (
    <div aria-hidden="true" className="causal-field">
      <div className="causal-field-floor" />
      <div className="causal-field-horizon" />
      {phasePlanes.map((plane) => (
        <span
          className={`causal-phase-plane causal-phase-${plane.lane}`}
          key={plane.lane}
          style={{ left: plane.x, width: plane.width }}
        >
          <i />
          <b>{plane.lane}</b>
        </span>
      ))}
    </div>
  );
}

function ImpactEnvelope({
  contained,
  height,
  segments,
  width,
}: {
  contained: boolean;
  height: number;
  segments: readonly DirectionalImpactEnvelope[];
  width: number;
}) {
  return (
    <svg
      aria-hidden="true"
      className={`impact-envelope ${contained ? "impact-envelope-contained" : ""}`}
      focusable="false"
      height="100%"
      preserveAspectRatio="none"
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
    >
      {segments.map((segment) => (
        <path
          className="impact-envelope-segment"
          d={segment.path}
          data-hop={segment.hop}
          key={segment.hop}
        />
      ))}
    </svg>
  );
}

function buildSelectionFocus(
  selection: TraceSelection,
  edges: readonly MapEdge[],
  fixture: CaseFixture,
  events: ReturnType<typeof getVisibleEvents>,
) {
  const entityIds = new Set<string>();
  const edgeIds = new Set<string>();
  const includeEntityNeighborhood = (entityId: string) => {
    entityIds.add(entityId);
    for (const edge of edges) {
      if (edge.fromEntityId !== entityId && edge.toEntityId !== entityId) {
        continue;
      }
      edgeIds.add(edge.id);
      entityIds.add(edge.fromEntityId);
      entityIds.add(edge.toEntityId);
    }
  };

  if (selection.kind === "entity") {
    includeEntityNeighborhood(selection.id);
  } else if (selection.kind === "join") {
    const edge = edges.find((candidate) => candidate.id === selection.id);
    if (edge) {
      edgeIds.add(edge.id);
      entityIds.add(edge.fromEntityId);
      entityIds.add(edge.toEntityId);
    }
  } else if (selection.kind === "event") {
    const event = events.find((candidate) => candidate.id === selection.id);
    for (const entityId of event?.entityIds ?? []) {
      includeEntityNeighborhood(entityId);
    }
  } else {
    const entity = getAllEntities(fixture).find(
      (candidate) => candidate.id === selection.id,
    );
    if (entity) {
      includeEntityNeighborhood(entity.id);
    } else {
      const path = fixture.reachability.paths.find(
        (candidate) => candidate.id === selection.id,
      );
      for (const entityId of path?.entityIds ?? []) entityIds.add(entityId);
      for (const edge of edges) {
        if (edge.pathIds.includes(selection.id)) edgeIds.add(edge.id);
      }
    }
  }

  return {
    active: entityIds.size > 0 || edgeIds.size > 0,
    entityIds,
    edgeIds,
  };
}

function humanizeRelation(value: string): string {
  return value.replaceAll("_", " ");
}

function authorizedEntityStateLabel(actionId: string): string {
  if (actionId === "contain_endpoint") return "Isolation approved";
  if (actionId === "block_network_indicator") return "Block approved";
  if (actionId === "disable_service_identity") return "Disable approved";
  if (actionId === "rotate_deployment_credential") return "Rotation approved";
  if (actionId === "rollback_workload_image") return "Rollback approved";
  return "Control approved";
}

function formatLifecycle(lifecycle: CaseState["lifecycle"]): string {
  if (lifecycle === "contained_in_demo") return "Response approved";
  if (lifecycle === "report_drafted") return "Report ready";
  if (lifecycle === "closed_in_demo") return "Closed";
  return "Investigating";
}

function impactAnnouncement(
  fixture: CaseFixture,
  state: CaseState,
  authorizedActionCount: number,
  severedSegmentCount: number,
): string {
  if (authorizedActionCount > 0) {
    return `Synthetic controls authorized: ${authorizedActionCount} of ${fixture.responseActions.length}. ${severedSegmentCount} risk segment${severedSegmentCount === 1 ? "" : "s"} severed. No external action executed.`;
  }
  if (state.counterfactualAttached) {
    const count = fixture.counterfactual.severedPathIds.length;
    return `${count} risk ${count === 1 ? "segment has" : "segments have"} predicted severance in the simulation. No control is authorized.`;
  }
  if (state.reachabilityAttached) {
    return `Reachability model attached: ${fixture.reachability.paths.length} candidate risk segments and ${fixture.impact.atRiskEntityIds.length} possible entities not observed.`;
  }
  return "No reachability model is attached. The map shows observed and correlated evidence only.";
}

function entityEvidenceState(
  entity: Entity,
  events: ReturnType<typeof getVisibleEvents>,
  atRisk: boolean,
): string {
  if (atRisk) return "Modeled at risk · not observed";
  if (
    events.some(
      (event) =>
        event.payload.kind === "edr_remote_service_attempt" &&
        event.payload.targetHostname === entity.label,
    )
  ) {
    return "Authentication observed · start prevented";
  }
  if (
    events.some(
      (event) =>
        event.payload.kind === "edr_process_start" &&
        (entity.kind === "file" || event.payload.hostname === entity.label),
    )
  ) {
    return entity.kind === "file" ? "Execution observed" : "Execution host";
  }
  if (events.some((event) => event.payload.kind === "cloud_secret_read")) {
    return entity.kind === "secret"
      ? "Credential read observed"
      : "Credential access observed";
  }
  if (events.some((event) => event.payload.kind === "windows_network_logon")) {
    return entity.kind === "endpoint"
      ? "Authentication observed"
      : "Out-of-scope logon observed";
  }
  if (
    events.filter((event) => event.payload.kind === "edr_network_connection")
      .length >= 2
  ) {
    return "2 TLS connections observed";
  }
  if (
    events.some((event) => event.payload.kind === "cloud_workload_inventory")
  ) {
    return "Recovery inventory observed";
  }
  return `${events.length} observed`;
}

function buildEdges(
  fixture: CaseFixture,
  visibleJoins: readonly EvidenceJoin[],
  reachabilityAttached: boolean,
): readonly MapEdge[] {
  const edges: MapEdge[] = visibleJoins.map((join) => ({
    id: join.id,
    fromEntityId: join.fromEntityId,
    toEntityId: join.toEntityId,
    label: join.label,
    truth: "correlated",
    join,
    pathIds: fixture.reachability.paths
      .filter((path) =>
        pathHasSegment(path.entityIds, join.fromEntityId, join.toEntityId),
      )
      .map((path) => path.id),
    blocked: fixture.impact.blockedJoinIds.includes(join.id),
  }));
  if (!reachabilityAttached) return edges;

  const modeledBySegment = new Map<string, MapEdge>();
  for (const path of fixture.reachability.paths) {
    for (let index = 0; index < path.entityIds.length - 1; index += 1) {
      const fromEntityId = path.entityIds[index];
      const toEntityId = path.entityIds[index + 1];
      if (!fromEntityId || !toEntityId) continue;
      const alreadyObserved = edges.some(
        (edge) =>
          edge.fromEntityId === fromEntityId && edge.toEntityId === toEntityId,
      );
      if (alreadyObserved) continue;
      const key = `${fromEntityId}->${toEntityId}`;
      const existing = modeledBySegment.get(key);
      if (existing) {
        modeledBySegment.set(key, {
          ...existing,
          pathIds: [...existing.pathIds, path.id],
        });
      } else {
        modeledBySegment.set(key, {
          id: `MODELED-${key}`,
          fromEntityId,
          toEntityId,
          label: "Possible path",
          truth: "modeled",
          join: null,
          pathIds: [path.id],
          blocked: false,
        });
      }
    }
  }
  return [...edges, ...modeledBySegment.values()];
}

function pathHasSegment(
  entityIds: readonly string[],
  fromEntityId: string,
  toEntityId: string,
): boolean {
  return entityIds.some(
    (entityId, index) =>
      entityId === fromEntityId && entityIds[index + 1] === toEntityId,
  );
}

function edgeGeometry(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radial: boolean,
): { path: string; label: { x: number; y: number } } {
  if (radial) {
    const fromCenter = {
      x: fromX + nodeWidth / 2,
      y: fromY + nodeHeight / 2,
    };
    const toCenter = {
      x: toX + nodeWidth / 2,
      y: toY + nodeHeight / 2,
    };
    const deltaX = toCenter.x - fromCenter.x;
    const deltaY = toCenter.y - fromCenter.y;
    const distance = Math.max(1, Math.hypot(deltaX, deltaY));
    const unitX = deltaX / distance;
    const unitY = deltaY / distance;
    const startScale =
      1 /
      Math.max(
        Math.abs(unitX) / (nodeWidth / 2),
        Math.abs(unitY) / (nodeHeight / 2),
      );
    const start = {
      x: fromCenter.x + unitX * startScale,
      y: fromCenter.y + unitY * startScale,
    };
    const end = {
      x: toCenter.x - unitX * startScale,
      y: toCenter.y - unitY * startScale,
    };
    const offset = Math.min(26, distance * 0.065);
    const control = {
      x: (start.x + end.x) / 2 - unitY * offset,
      y: (start.y + end.y) / 2 + unitX * offset,
    };
    return {
      path: `M ${start.x} ${start.y} Q ${control.x} ${control.y}, ${end.x} ${end.y}`,
      label: {
        x: start.x * 0.25 + control.x * 0.5 + end.x * 0.25,
        y: start.y * 0.25 + control.y * 0.5 + end.y * 0.25,
      },
    };
  }
  const startX = fromX + nodeWidth;
  const startY = fromY + nodeHeight / 2;
  const endX = toX;
  const endY = toY + nodeHeight / 2;
  const direction = endX >= startX ? 1 : -1;
  const bend = Math.max(55, Math.abs(endX - startX) * 0.42) * direction;
  return {
    path: `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`,
    label: {
      x: (fromX + toX) / 2 + nodeWidth / 2,
      y: (fromY + toY) / 2 + nodeHeight / 2,
    },
  };
}
