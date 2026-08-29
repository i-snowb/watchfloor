import type {
  CaseFixture,
  CaseGraphNode,
  Entity,
  EvidenceJoin,
} from "@/domain/types";

export interface EvidenceReplayPlan {
  joins: readonly EvidenceJoin[];
  initialEntityIds: ReadonlySet<string>;
}

export interface ImpactNodePosition extends CaseGraphNode {
  hop: number | null;
  role: "source" | "reachable" | "context";
}

export interface ImpactRing {
  hop: number;
  radiusX: number;
  radiusY: number;
}

export interface ImpactLayout {
  center: { x: number; y: number };
  hops: ReadonlyMap<string, number>;
  positions: ReadonlyMap<string, ImpactNodePosition>;
  rings: readonly ImpactRing[];
}

export type CausalVisualState =
  "observed" | "modeled" | "disputed" | "prevented" | "contained";

export interface CausalPhasePlane {
  lane: CaseGraphNode["lane"];
  x: number;
  width: number;
}

export interface DirectionalImpactEnvelope {
  hop: number;
  path: string;
}

const traceLanes = [
  "entry",
  "execution",
  "access",
  "lateral",
  "impact",
] as const;

export function buildCausalPhasePlanes(
  fixture: CaseFixture,
): readonly CausalPhasePlane[] {
  const lanes = traceLanes.filter((lane) =>
    fixture.presentation.nodes.some((node) => node.lane === lane),
  );
  if (lanes.length === 0) return [];
  const padding = 24;
  const usableWidth = fixture.presentation.graphWidth - padding * 2;
  return lanes.map((lane, index) => ({
    lane,
    x: Math.round(padding + (usableWidth / lanes.length) * index),
    width: Math.round(usableWidth / lanes.length),
  }));
}

export function getCausalVisualState({
  contained,
  disputed,
  modeled,
  prevented,
}: {
  contained: boolean;
  disputed: boolean;
  modeled: boolean;
  prevented: boolean;
}): CausalVisualState {
  if (contained) return "contained";
  if (prevented) return "prevented";
  if (disputed) return "disputed";
  if (modeled) return "modeled";
  return "observed";
}

export function buildEvidenceReplayPlan(
  entities: readonly Entity[],
  joins: readonly EvidenceJoin[],
): EvidenceReplayPlan {
  const orderedJoins = [...joins].sort(
    (left, right) =>
      left.sequence - right.sequence || left.id.localeCompare(right.id),
  );
  const joinedEntityIds = new Set(
    orderedJoins.flatMap((join) => [join.fromEntityId, join.toEntityId]),
  );
  const initialEntityIds = new Set<string>();
  const firstSource = orderedJoins[0]?.fromEntityId;
  if (firstSource) initialEntityIds.add(firstSource);
  for (const entity of entities) {
    if (!joinedEntityIds.has(entity.id)) initialEntityIds.add(entity.id);
  }
  if (orderedJoins.length === 0) {
    for (const entity of entities) initialEntityIds.add(entity.id);
  }
  return { joins: orderedJoins, initialEntityIds };
}

export function getReplayEntityIds(
  plan: EvidenceReplayPlan,
  step: number,
  allEntityIds: readonly string[],
): ReadonlySet<string> {
  if (step >= plan.joins.length) return new Set(allEntityIds);
  const entityIds = new Set(plan.initialEntityIds);
  for (const join of plan.joins.slice(0, Math.max(0, step))) {
    entityIds.add(join.fromEntityId);
    entityIds.add(join.toEntityId);
  }
  return entityIds;
}

export function findReplayStepForEntity(
  plan: EvidenceReplayPlan,
  entityId: string,
): number {
  if (plan.initialEntityIds.has(entityId)) return 0;
  const index = plan.joins.findIndex(
    (join) => join.fromEntityId === entityId || join.toEntityId === entityId,
  );
  return index === -1 ? plan.joins.length : index + 1;
}

export function buildImpactLayout(
  fixture: CaseFixture,
  entities: readonly Entity[],
  nodeWidth = 202,
  nodeHeight = 104,
  graphNodes: readonly CaseGraphNode[] = fixture.presentation.nodes,
): ImpactLayout {
  const { graphWidth, graphHeight } = fixture.presentation;
  const sourceId = fixture.reachability.sourceEntityId;
  const adjacency = buildReachabilityAdjacency(fixture);
  const hops = new Map<string, number>([[sourceId, 0]]);
  const queue = [sourceId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const nextHop = (hops.get(current) ?? 0) + 1;
    for (const target of adjacency.get(current) ?? []) {
      if (hops.has(target)) continue;
      hops.set(target, nextHop);
      queue.push(target);
    }
  }

  const tracePositions = new Map(
    graphNodes.map((node) => [node.entityId, node]),
  );
  const center = {
    x: Math.round(graphWidth * 0.48),
    y: Math.round(graphHeight * 0.52),
  };
  const positions = new Map<string, ImpactNodePosition>();
  const sourceTrace = tracePositions.get(sourceId);
  positions.set(sourceId, {
    entityId: sourceId,
    hop: 0,
    lane: sourceTrace?.lane ?? "entry",
    role: "source",
    x: center.x - nodeWidth / 2,
    y: center.y - nodeHeight / 2,
  });

  const maxHop = Math.max(0, ...hops.values());
  const rings = Array.from({ length: maxHop }, (_, index) => {
    const hop = index + 1;
    return {
      hop,
      radiusX: Math.min(graphWidth * 0.44, 145 + hop * 150),
      radiusY: Math.min(graphHeight * 0.43, 82 + hop * 64),
    };
  });

  for (const ring of rings) {
    const atHop = entities
      .filter((entity) => hops.get(entity.id) === ring.hop)
      .sort((left, right) => {
        const leftOrder = tracePositions.get(left.id)?.y ?? 0;
        const rightOrder = tracePositions.get(right.id)?.y ?? 0;
        return leftOrder - rightOrder || left.id.localeCompare(right.id);
      });
    atHop.forEach((entity, index) => {
      const angle = fanAngle(index, atHop.length);
      const trace = tracePositions.get(entity.id);
      positions.set(entity.id, {
        entityId: entity.id,
        hop: ring.hop,
        lane: trace?.lane ?? "impact",
        role: "reachable",
        x: clamp(
          center.x + ring.radiusX * Math.cos(angle) - nodeWidth / 2,
          16,
          graphWidth - nodeWidth - 16,
        ),
        y: clamp(
          center.y + ring.radiusY * Math.sin(angle) - nodeHeight / 2,
          16,
          graphHeight - nodeHeight - 16,
        ),
      });
    });
  }

  const context = entities
    .filter((entity) => !hops.has(entity.id))
    .sort((left, right) => {
      const leftPosition = tracePositions.get(left.id);
      const rightPosition = tracePositions.get(right.id);
      return (
        (leftPosition?.y ?? 0) - (rightPosition?.y ?? 0) ||
        left.id.localeCompare(right.id)
      );
    });
  context.forEach((entity, index) => {
    const trace = tracePositions.get(entity.id);
    positions.set(entity.id, {
      entityId: entity.id,
      hop: null,
      lane: trace?.lane ?? "entry",
      role: "context",
      x: 34 + (index % 2) * 34,
      y: 168 + index * Math.min(128, nodeHeight + 22),
    });
  });

  return { center, hops, positions, rings };
}

export function buildDirectionalImpactEnvelope(
  layout: ImpactLayout,
): readonly DirectionalImpactEnvelope[] {
  const limit = (56 * Math.PI) / 180;
  return layout.rings.map((ring, index) => {
    const inner = layout.rings[index - 1];
    const innerX = inner?.radiusX ?? 24;
    const innerY = inner?.radiusY ?? 16;
    const start = polar(layout.center, innerX, innerY, -limit);
    const outerStart = polar(layout.center, ring.radiusX, ring.radiusY, -limit);
    const outerEnd = polar(layout.center, ring.radiusX, ring.radiusY, limit);
    const end = polar(layout.center, innerX, innerY, limit);
    return {
      hop: ring.hop,
      path: [
        `M ${start.x} ${start.y}`,
        `L ${outerStart.x} ${outerStart.y}`,
        `A ${ring.radiusX} ${ring.radiusY} 0 0 1 ${outerEnd.x} ${outerEnd.y}`,
        `L ${end.x} ${end.y}`,
        `A ${innerX} ${innerY} 0 0 0 ${start.x} ${start.y}`,
        "Z",
      ].join(" "),
    };
  });
}

function buildReachabilityAdjacency(
  fixture: CaseFixture,
): ReadonlyMap<string, readonly string[]> {
  const adjacency = new Map<string, string[]>();
  for (const path of fixture.reachability.paths) {
    for (let index = 0; index < path.entityIds.length - 1; index += 1) {
      const from = path.entityIds[index];
      const to = path.entityIds[index + 1];
      if (!from || !to) continue;
      const targets = adjacency.get(from) ?? [];
      if (!targets.includes(to)) targets.push(to);
      adjacency.set(from, targets);
    }
  }
  return adjacency;
}

function fanAngle(index: number, count: number): number {
  if (count <= 1) return 0;
  const limit = (56 * Math.PI) / 180;
  return -limit + (index / (count - 1)) * limit * 2;
}

function polar(
  center: ImpactLayout["center"],
  radiusX: number,
  radiusY: number,
  angle: number,
) {
  return {
    x: Math.round(center.x + radiusX * Math.cos(angle)),
    y: Math.round(center.y + radiusY * Math.sin(angle)),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
