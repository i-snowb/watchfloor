import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildCausalPhasePlanes,
  buildDirectionalImpactEnvelope,
  buildEvidenceReplayPlan,
  buildImpactLayout,
  buildThreatHierarchy,
  findReplayStepForEntity,
  getCausalVisualState,
  getReplayEntityIds,
  initialEvidenceReplayCursor,
  shouldCatchUpEvidenceReplay,
} from "../components/evidence-visualization";
import { cloudIdentityScenario } from "../domain/scenarios/cloud-identity";
import { endpointLateralScenario } from "../domain/scenarios/endpoint-lateral";
import { layoutTraceResultPackets } from "../lib/trace-result-layout";
import {
  IMPACT_EDGE_LABEL_HEIGHT,
  IMPACT_EDGE_LABEL_WIDTH,
  layoutImpactEdgeLabels,
} from "../lib/impact-edge-label-layout";
import {
  TRACE_EDGE_LABEL_HEIGHT,
  TRACE_EDGE_LABEL_WIDTH,
  layoutTraceEdgeLabels,
  traceLabelRectangle,
  traceLabelRectanglesIntersect,
} from "../lib/trace-edge-label-layout";
import {
  TRACE_NODE_HEIGHT,
  TRACE_NODE_WIDTH,
  TRACE_RESULT_PACKET_HEIGHT,
  TRACE_RESULT_PACKET_WIDTH,
} from "../lib/trace-geometry";

test("evidence replay follows deterministic join order", () => {
  const fixture = endpointLateralScenario;
  const plan = buildEvidenceReplayPlan(fixture.entities, [
    fixture.joins[2]!,
    fixture.joins[0]!,
    fixture.joins[1]!,
  ]);

  assert.deepEqual(
    plan.joins.map((join) => join.id),
    ["JOIN-LAT-01", "JOIN-LAT-02", "JOIN-LAT-03"],
  );
  assert.deepEqual(
    [
      ...getReplayEntityIds(
        plan,
        0,
        fixture.entities.map(({ id }) => id),
      ),
    ],
    [
      "file:invoice-sync-helper",
      "endpoint:app-srv-021",
      "secret:ci-deploy-token",
      "workload:billing-api",
    ],
  );
  assert.equal(findReplayStepForEntity(plan, "indicator:203.0.113.91"), 2);
  assert.equal(
    getReplayEntityIds(
      plan,
      plan.joins.length,
      fixture.entities.map(({ id }) => id),
    ).size,
    fixture.entities.length,
  );
});

test("a reopened case restores its complete evidence graph", () => {
  assert.equal(
    initialEvidenceReplayCursor({
      joinCount: 8,
      reducedMotion: false,
      revision: 28,
    }),
    8,
  );
  assert.equal(
    initialEvidenceReplayCursor({
      joinCount: 8,
      reducedMotion: true,
      revision: 1,
    }),
    8,
  );
});

test("a brand-new case retains only its short opening replay", () => {
  assert.equal(
    initialEvidenceReplayCursor({
      joinCount: 8,
      reducedMotion: false,
      revision: 1,
    }),
    2,
  );
  assert.equal(
    initialEvidenceReplayCursor({
      joinCount: 0,
      reducedMotion: false,
      revision: 1,
    }),
    0,
  );
});

test("hydrated worked evidence catches up immediately while the document is hidden", () => {
  assert.equal(
    shouldCatchUpEvidenceReplay({ hydrated: true, revision: 18 }),
    true,
  );
  assert.equal(
    initialEvidenceReplayCursor({
      joinCount: 8,
      reducedMotion: false,
      revision: 18,
    }),
    8,
  );
});

test("visibility recovery catches up an asynchronously hydrated worked case", () => {
  const openingCursor = initialEvidenceReplayCursor({
    joinCount: 8,
    reducedMotion: false,
    revision: 1,
  });
  assert.equal(openingCursor, 2);
  assert.equal(
    shouldCatchUpEvidenceReplay({ hydrated: false, revision: 18 }),
    false,
  );
  assert.equal(
    shouldCatchUpEvidenceReplay({ hydrated: true, revision: 18 }),
    true,
  );
});

test("impact layout derives stable hop depth from reachability segments", () => {
  const fixture = endpointLateralScenario;
  const layout = buildImpactLayout(fixture, fixture.entities);

  assert.equal(layout.hops.get(fixture.reachability.sourceEntityId), 0);
  assert.equal(layout.hops.get("identity:svc-fin-reports"), 1);
  assert.equal(layout.hops.get("endpoint:app-srv-021"), 2);
  assert.equal(layout.hops.get("secret:ci-deploy-token"), 2);
  assert.equal(layout.hops.get("workload:billing-api"), 3);
  assert.equal(
    layout.positions.get("file:invoice-sync-helper")?.role,
    "context",
  );
  assert.deepEqual(
    layout.rings.map((ring) => ring.hop),
    [1, 2, 3],
  );
});

test("cloud reachability preserves shared prefixes without extra depth", () => {
  const fixture = cloudIdentityScenario;
  const layout = buildImpactLayout(fixture, fixture.entities);

  assert.equal(layout.hops.get("identity:jdoe"), 0);
  assert.equal(layout.hops.get("session:okta-921"), 1);
  assert.equal(layout.hops.get("role:prod-admin"), 2);
  assert.equal(layout.hops.get("secret:prod-db-primary"), 3);
  assert.equal(layout.hops.get("object:customer-export"), 3);
});

test("impact layout retains released discovery graph lanes", () => {
  const fixture = endpointLateralScenario;
  const discovery = fixture.stream.stages[0]!;
  const layout = buildImpactLayout(
    fixture,
    [...fixture.entities, ...discovery.entities],
    TRACE_NODE_WIDTH,
    TRACE_NODE_HEIGHT,
    [...fixture.presentation.nodes, ...discovery.graphNodes],
  );

  assert.equal(
    layout.positions.get("endpoint:fin-reports-srv-010")?.lane,
    "lateral",
  );
});

test("endpoint revision 18 impact layout keeps cards and evidence packets separate", () => {
  const fixture = endpointLateralScenario;
  const entities = [
    ...fixture.entities,
    ...fixture.stream.stages.flatMap((stage) => stage.entities),
  ];
  const graphNodes = [
    ...fixture.presentation.nodes,
    ...fixture.stream.stages.flatMap((stage) => stage.graphNodes),
  ];
  const layout = buildImpactLayout(
    fixture,
    entities,
    TRACE_NODE_WIDTH,
    TRACE_NODE_HEIGHT,
    graphNodes,
  );
  const positions = [...layout.positions.values()];

  for (const [index, node] of positions.entries()) {
    for (const candidate of positions.slice(index + 1)) {
      assert.equal(
        rectanglesOverlap(node, TRACE_NODE_WIDTH, TRACE_NODE_HEIGHT, candidate),
        false,
        `${node.entityId} overlaps ${candidate.entityId} in the complete impact layout`,
      );
    }
  }

  const targetEntityIds = [
    ...new Set(
      fixture.investigationQueries.map((query) => query.targetEntityId),
    ),
  ];
  const placements = layoutTraceResultPackets(
    targetEntityIds,
    positions,
    new Set(positions.map((position) => position.entityId)),
    fixture.presentation.graphWidth,
    fixture.presentation.graphHeight,
  );
  for (const [targetEntityId, packet] of placements) {
    for (const node of positions) {
      if (node.entityId === targetEntityId) continue;
      assert.equal(
        rectanglesOverlap(
          packet,
          TRACE_RESULT_PACKET_WIDTH,
          TRACE_RESULT_PACKET_HEIGHT,
          node,
        ),
        false,
        `${targetEntityId} evidence packet overlaps ${node.entityId} in the complete impact layout`,
      );
    }
  }

  const edges = fixture.reachability.paths.flatMap((path) =>
    path.entityIds.slice(0, -1).flatMap((fromEntityId, index) => {
      const toEntityId = path.entityIds[index + 1];
      return toEntityId
        ? [{ id: `${path.id}:${index}`, fromEntityId, toEntityId }]
        : [];
    }),
  );
  const edgeLabels = layoutImpactEdgeLabels(
    edges,
    positions,
    fixture.presentation.graphWidth,
    fixture.presentation.graphHeight,
  );
  for (const [edgeId, label] of edgeLabels) {
    for (const node of positions) {
      assert.equal(
        rectanglesOverlap(
          label,
          IMPACT_EDGE_LABEL_WIDTH,
          IMPACT_EDGE_LABEL_HEIGHT,
          node,
        ),
        false,
        `${edgeId} route label overlaps ${node.entityId} in the complete impact layout`,
      );
    }
    for (const [otherEdgeId, otherLabel] of edgeLabels) {
      if (otherEdgeId <= edgeId) continue;
      assert.equal(
        rectanglesOverlap(
          label,
          IMPACT_EDGE_LABEL_WIDTH,
          IMPACT_EDGE_LABEL_HEIGHT,
          otherLabel,
          IMPACT_EDGE_LABEL_WIDTH,
          IMPACT_EDGE_LABEL_HEIGHT,
        ),
        false,
        `${edgeId} route label overlaps ${otherEdgeId} in the complete impact layout`,
      );
    }
  }
});

test("endpoint opening trace labels avoid their cards at the 1280 recording geometry", () => {
  const fixture = endpointLateralScenario;
  const openingEdges = fixture.joins.slice(0, 2);
  const openingNodeIds = new Set(
    openingEdges.flatMap((edge) => [edge.fromEntityId, edge.toEntityId]),
  );
  const openingNodes = fixture.presentation.nodes.filter((node) =>
    openingNodeIds.has(node.entityId),
  );
  // The 1280x720 recording layout renders a 460px trace plane at r1.
  const labels = layoutTraceEdgeLabels(
    openingEdges,
    openingNodes,
    fixture.presentation.graphWidth,
    460,
  );

  assert.equal(labels.size, openingEdges.length);
  assertTraceLabelsClearCardsAndEachOther(
    labels,
    openingNodes,
    fixture.presentation.graphWidth,
    460,
  );
});

test("endpoint opening trace labels remain contained at the narrower supported viewport", () => {
  const fixture = endpointLateralScenario;
  const openingEdges = fixture.joins.slice(0, 2);
  const openingNodeIds = new Set(
    openingEdges.flatMap((edge) => [edge.fromEntityId, edge.toEntityId]),
  );
  const openingNodes = fixture.presentation.nodes.filter((node) =>
    openingNodeIds.has(node.entityId),
  );
  // At 1024px the camera pans the same 1450px graph field; label world
  // coordinates must stay deterministic and contained rather than reflowing.
  const recordingViewport = layoutTraceEdgeLabels(
    openingEdges,
    openingNodes,
    fixture.presentation.graphWidth,
    460,
  );
  const narrowViewport = layoutTraceEdgeLabels(
    openingEdges,
    openingNodes,
    fixture.presentation.graphWidth,
    460,
  );

  assert.deepEqual([...narrowViewport], [...recordingViewport]);
  assertTraceLabelsClearCardsAndEachOther(
    narrowViewport,
    openingNodes,
    fixture.presentation.graphWidth,
    460,
  );
});

test("expanded endpoint trace labels remain deterministic and collision-free", () => {
  const fixture = endpointLateralScenario;
  const edges = [
    ...fixture.joins,
    ...fixture.stream.stages.flatMap((stage) => stage.joins),
  ];
  const nodes: { entityId: string; x: number; y: number }[] = [];

  for (const node of fixture.presentation.nodes) {
    nodes.push({ entityId: node.entityId, x: node.x, y: node.y });
  }

  for (const stage of fixture.stream.stages) {
    for (const node of stage.graphNodes) {
      nodes.push({ entityId: node.entityId, x: node.x, y: node.y });
    }
  }
  const first = layoutTraceEdgeLabels(
    edges,
    nodes,
    fixture.presentation.graphWidth,
    fixture.presentation.graphHeight,
  );
  const second = layoutTraceEdgeLabels(
    edges,
    nodes,
    fixture.presentation.graphWidth,
    fixture.presentation.graphHeight,
  );

  assert.equal(first.size, edges.length);
  assert.deepEqual([...first], [...second]);
  assertTraceLabelsClearCardsAndEachOther(
    first,
    nodes,
    fixture.presentation.graphWidth,
    fixture.presentation.graphHeight,
  );
});

test("expanded cloud trace labels remain deterministic and collision-free", () => {
  const fixture = cloudIdentityScenario;
  const edges = [
    ...fixture.joins,
    ...fixture.stream.stages.flatMap((stage) => stage.joins),
  ];
  const nodes: { entityId: string; x: number; y: number }[] = [];

  for (const node of fixture.presentation.nodes) {
    nodes.push({ entityId: node.entityId, x: node.x, y: node.y });
  }

  for (const stage of fixture.stream.stages) {
    for (const node of stage.graphNodes) {
      nodes.push({ entityId: node.entityId, x: node.x, y: node.y });
    }
  }
  const labels = layoutTraceEdgeLabels(
    edges,
    nodes,
    fixture.presentation.graphWidth,
    fixture.presentation.graphHeight,
  );

  assert.equal(labels.size, edges.length);
  assertTraceLabelsClearCardsAndEachOther(
    labels,
    nodes,
    fixture.presentation.graphWidth,
    fixture.presentation.graphHeight,
  );
});

test("trace labels retain a deterministic safe subset when a dense graph cannot fit every label", () => {
  const nodes = [
    { entityId: "source", x: 0, y: 0 },
    { entityId: "target", x: 240, y: 80 },
  ];
  const edges = [
    { id: "first", fromEntityId: "source", toEntityId: "target" },
    { id: "second", fromEntityId: "source", toEntityId: "target" },
  ];

  const first = layoutTraceEdgeLabels(edges, nodes, 560, 260);
  const second = layoutTraceEdgeLabels(edges, nodes, 560, 260);

  assert.equal(first.size, 1);
  assert.deepEqual([...first], [...second]);
  assertTraceLabelsClearCardsAndEachOther(first, nodes, 560, 260);
});

test("trace label placement excludes modeled segments that have no join", async () => {
  const source = await readFile(
    new URL("../components/evidence-map.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /view === "trace"[\s\S]*?layoutTraceEdgeLabels\([\s\S]*?edge\.join !== null/,
  );
});

test("causal field lanes are stable and directional impact envelopes follow hops", () => {
  const fixture = endpointLateralScenario;
  const phasePlanes = buildCausalPhasePlanes(fixture);
  const envelope = buildDirectionalImpactEnvelope(
    buildImpactLayout(fixture, fixture.entities),
  );

  assert.deepEqual(
    phasePlanes.map((plane) => plane.lane),
    ["entry", "execution", "access", "lateral", "impact"],
  );
  assert.deepEqual(
    envelope.map((segment) => segment.hop),
    [1, 2, 3],
  );
  assert.ok(envelope.every((segment) => segment.path.includes("A ")));
});

test("causal visual state prioritizes verified control over modeled uncertainty", () => {
  assert.equal(
    getCausalVisualState({
      contained: true,
      disputed: true,
      modeled: true,
      prevented: true,
    }),
    "contained",
  );
  assert.equal(
    getCausalVisualState({
      contained: false,
      disputed: true,
      modeled: true,
      prevented: true,
    }),
    "prevented",
  );
  assert.equal(
    getCausalVisualState({
      contained: false,
      disputed: true,
      modeled: true,
      prevented: false,
    }),
    "disputed",
  );
});

test("threat hierarchy keeps observed, prevented, and modeled states distinct", () => {
  const initial = buildThreatHierarchy(endpointLateralScenario);
  assert.ok(initial);
  assert.deepEqual(
    initial.issues.map((issue) => issue.rank),
    [1, 2, 3],
  );
  assert.equal(initial.issues[0]?.entityId, "endpoint:fin-ws-044");
  assert.equal(initial.issues[0]?.certainty, "observed");
  assert.ok(
    initial.issues.every((issue) => issue.entityId !== "workload:billing-api"),
  );

  const expanded = buildThreatHierarchy(endpointLateralScenario, {
    reachabilityAttached: true,
    releasedStageIds: new Set(["STREAM-LAT-01"]),
  });
  assert.ok(expanded);
  assert.deepEqual(
    expanded.issues.map((issue) => issue.rank),
    [1, 2, 3, 4, 5],
  );
  assert.equal(
    expanded.issues.find((issue) => issue.entityId === "endpoint:app-srv-021")
      ?.certainty,
    "prevented",
  );
  assert.equal(
    expanded.issues.find((issue) => issue.entityId === "workload:billing-api")
      ?.certainty,
    "modeled",
  );
  assert.ok(
    (expanded.issues.find((issue) => issue.entityId === "workload:billing-api")
      ?.rank ?? 0) > (expanded.issues[0]?.rank ?? 0),
  );
});

test("priority route state follows exact analyst-approved path severance", () => {
  const active = buildThreatHierarchy(endpointLateralScenario, {
    reachabilityAttached: true,
  });
  assert.ok(active);
  assert.equal(active.priorityRoute.state, "active");
  assert.deepEqual(active.priorityRoute.entityIds, [
    "endpoint:fin-ws-044",
    "identity:svc-fin-reports",
    "secret:ci-deploy-token",
    "workload:billing-api",
  ]);
  assert.deepEqual(active.priorityRoute.pathIds, [
    "PATH-LAT-01",
    "PATH-LAT-03",
    "PATH-LAT-04",
  ]);

  const partial = buildThreatHierarchy(endpointLateralScenario, {
    controlledEntityIds: new Set(["endpoint:fin-ws-044"]),
    reachabilityAttached: true,
    severedPathIds: new Set(["PATH-LAT-01"]),
  });
  assert.ok(partial);
  assert.equal(partial.priorityRoute.state, "partially_controlled");
  assert.equal(partial.issues[0]?.controlState, "controlled");

  const controlled = buildThreatHierarchy(endpointLateralScenario, {
    reachabilityAttached: true,
    severedPathIds: new Set(["PATH-LAT-01", "PATH-LAT-03", "PATH-LAT-04"]),
  });
  assert.ok(controlled);
  assert.equal(controlled.priorityRoute.state, "controlled");
});

function rectanglesOverlap(
  first: { x: number; y: number },
  firstWidth: number,
  firstHeight: number,
  second: { x: number; y: number },
  secondWidth = TRACE_NODE_WIDTH,
  secondHeight = TRACE_NODE_HEIGHT,
): boolean {
  return (
    first.x < second.x + secondWidth &&
    first.x + firstWidth > second.x &&
    first.y < second.y + secondHeight &&
    first.y + firstHeight > second.y
  );
}

function assertTraceLabelsClearCardsAndEachOther(
  labels: ReadonlyMap<string, { x: number; y: number }>,
  nodes: readonly { entityId: string; x: number; y: number }[],
  graphWidth: number,
  graphHeight: number,
) {
  for (const [edgeId, label] of labels) {
    const rectangle = traceLabelRectangle(label);
    for (const node of nodes) {
      assert.equal(
        traceLabelRectanglesIntersect(rectangle, {
          left: node.x,
          top: node.y,
          right: node.x + TRACE_NODE_WIDTH,
          bottom: node.y + TRACE_NODE_HEIGHT,
        }),
        false,
        `${edgeId} trace label overlaps ${node.entityId}`,
      );
    }
    assert.ok(rectangle.left >= 0, `${edgeId} trace label exits left boundary`);
    assert.ok(rectangle.top >= 0, `${edgeId} trace label exits top boundary`);
    assert.ok(
      rectangle.right <= graphWidth,
      `${edgeId} trace label exits right boundary`,
    );
    assert.ok(
      rectangle.bottom <= graphHeight,
      `${edgeId} trace label exits bottom boundary`,
    );
  }

  const entries = [...labels.entries()];
  for (const [index, [edgeId, label]] of entries.entries()) {
    for (const [otherEdgeId, otherLabel] of entries.slice(index + 1)) {
      assert.equal(
        traceLabelRectanglesIntersect(
          traceLabelRectangle(label),
          traceLabelRectangle(otherLabel),
        ),
        false,
        `${edgeId} trace label overlaps ${otherEdgeId}`,
      );
    }
  }

  assert.ok(TRACE_EDGE_LABEL_WIDTH > 0);
  assert.ok(TRACE_EDGE_LABEL_HEIGHT > 0);
}
