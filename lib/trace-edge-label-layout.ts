import { TRACE_NODE_HEIGHT, TRACE_NODE_WIDTH } from "./trace-geometry";

// Trace labels stack a humanized relation and a join reference. Reserve the
// widest supported natural relation chip, including padding and borders. This
// intentionally exceeds the current CSS cap so a later responsive override
// cannot make collision checks understate the rendered label.
export const TRACE_EDGE_LABEL_WIDTH = 224;
export const TRACE_EDGE_LABEL_HEIGHT = 44;

export interface TraceEdgeLabelNode {
  entityId: string;
  x: number;
  y: number;
}

export interface TraceEdgeLabelEdge {
  id: string;
  fromEntityId: string;
  toEntityId: string;
}

export interface TraceEdgeLabelPlacement {
  x: number;
  y: number;
}

interface Rectangle {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Places trace relationship labels beside their edge instead of directly over
 * its midpoint. Candidates are deterministic and smallest-offset first so the
 * graph retains its compact causal reading while labels stay out of cards.
 */
export function layoutTraceEdgeLabels(
  edges: readonly TraceEdgeLabelEdge[],
  nodes: readonly TraceEdgeLabelNode[],
  graphWidth: number,
  graphHeight: number,
): ReadonlyMap<string, TraceEdgeLabelPlacement> {
  const nodeById = new Map(nodes.map((node) => [node.entityId, node]));
  const candidatesByEdge = edges.flatMap((edge, index) => {
    const from = nodeById.get(edge.fromEntityId);
    const to = nodeById.get(edge.toEntityId);
    if (!from || !to) return [];
    const candidates = traceLabelCandidates(from, to).filter((candidate) => {
      const rectangle = traceLabelRectangle(candidate);
      return (
        rectangle.left >= 0 &&
        rectangle.top >= 0 &&
        rectangle.right <= graphWidth &&
        rectangle.bottom <= graphHeight &&
        !nodes.some((node) =>
          traceLabelRectanglesIntersect(rectangle, nodeRectangle(node)),
        )
      );
    });
    return candidates.length > 0 ? [{ edge, index, candidates }] : [];
  });
  const placements = new Map<string, TraceEdgeLabelPlacement>();
  let bestPlacements = new Map<string, TraceEdgeLabelPlacement>();
  const occupiedLabels: Rectangle[] = [];
  const orderedEdges = [...candidatesByEdge].sort(
    (first, second) =>
      first.candidates.length - second.candidates.length ||
      first.index - second.index,
  );

  const placeNext = (index: number): boolean => {
    if (index === orderedEdges.length) return true;
    const candidateEdge = orderedEdges[index]!;
    for (const candidate of candidateEdge.candidates) {
      const rectangle = traceLabelRectangle(candidate);
      if (
        occupiedLabels.some((occupied) =>
          traceLabelRectanglesIntersect(rectangle, occupied),
        )
      ) {
        continue;
      }
      placements.set(candidateEdge.edge.id, candidate);
      occupiedLabels.push(rectangle);
      if (placements.size > bestPlacements.size) {
        bestPlacements = new Map(placements);
      }
      if (placeNext(index + 1)) return true;
      occupiedLabels.pop();
      placements.delete(candidateEdge.edge.id);
    }
    return false;
  };

  const placedEveryLabel = placeNext(0);
  const resolvedPlacements = placedEveryLabel ? placements : bestPlacements;

  return new Map(
    edges.flatMap((edge) => {
      const placement = resolvedPlacements.get(edge.id);
      return placement ? [[edge.id, placement] as const] : [];
    }),
  );
}

function traceLabelCandidates(
  from: TraceEdgeLabelNode,
  to: TraceEdgeLabelNode,
): readonly TraceEdgeLabelPlacement[] {
  const fromCenter = {
    x: from.x + TRACE_NODE_WIDTH / 2,
    y: from.y + TRACE_NODE_HEIGHT / 2,
  };
  const toCenter = {
    x: to.x + TRACE_NODE_WIDTH / 2,
    y: to.y + TRACE_NODE_HEIGHT / 2,
  };
  const deltaX = toCenter.x - fromCenter.x;
  const deltaY = toCenter.y - fromCenter.y;
  const distance = Math.max(1, Math.hypot(deltaX, deltaY));
  const direction = { x: deltaX / distance, y: deltaY / distance };
  const perpendicular = { x: -deltaY / distance, y: deltaX / distance };
  const midpoint = {
    x: (fromCenter.x + toCenter.x) / 2,
    y: (fromCenter.y + toCenter.y) / 2,
  };

  const perpendicularOffsets = [0, 72, -72, 112, -112, 160, -160, 208, -208];
  const parallelOffsets = [0, -80, 80, -150, 150, -220, 220];
  const candidates = parallelOffsets.flatMap((parallelOffset) =>
    perpendicularOffsets.map((perpendicularOffset) => ({
      x:
        midpoint.x +
        direction.x * parallelOffset +
        perpendicular.x * perpendicularOffset,
      y:
        midpoint.y +
        direction.y * parallelOffset +
        perpendicular.y * perpendicularOffset,
    })),
  );
  return candidates.filter(
    (candidate, index) =>
      candidates.findIndex(
        (other) => other.x === candidate.x && other.y === candidate.y,
      ) === index,
  );
}

function nodeRectangle(node: TraceEdgeLabelNode): Rectangle {
  return {
    left: node.x,
    top: node.y,
    right: node.x + TRACE_NODE_WIDTH,
    bottom: node.y + TRACE_NODE_HEIGHT,
  };
}

export function traceLabelRectangle(
  placement: TraceEdgeLabelPlacement,
): Rectangle {
  return {
    left: placement.x - TRACE_EDGE_LABEL_WIDTH / 2,
    top: placement.y - TRACE_EDGE_LABEL_HEIGHT / 2,
    right: placement.x + TRACE_EDGE_LABEL_WIDTH / 2,
    bottom: placement.y + TRACE_EDGE_LABEL_HEIGHT / 2,
  };
}

export function traceLabelRectanglesIntersect(
  first: Rectangle,
  second: Rectangle,
): boolean {
  return (
    first.left < second.right &&
    first.right > second.left &&
    first.top < second.bottom &&
    first.bottom > second.top
  );
}
