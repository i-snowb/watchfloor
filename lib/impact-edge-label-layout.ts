import { TRACE_NODE_HEIGHT, TRACE_NODE_WIDTH } from "./trace-geometry";

export const IMPACT_EDGE_LABEL_WIDTH = 176;
export const IMPACT_EDGE_LABEL_HEIGHT = 40;

export interface ImpactEdgeLabelNode {
  entityId: string;
  x: number;
  y: number;
}

export interface ImpactEdgeLabelEdge {
  id: string;
  fromEntityId: string;
  toEntityId: string;
}

export interface ImpactEdgeLabelPlacement {
  x: number;
  y: number;
}

interface Rectangle {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function layoutImpactEdgeLabels(
  edges: readonly ImpactEdgeLabelEdge[],
  nodes: readonly ImpactEdgeLabelNode[],
  graphWidth: number,
  graphHeight: number,
): ReadonlyMap<string, ImpactEdgeLabelPlacement> {
  const nodeById = new Map(nodes.map((node) => [node.entityId, node]));
  const occupiedLabels: Rectangle[] = [];
  const placements = new Map<string, ImpactEdgeLabelPlacement>();

  for (const edge of edges) {
    const from = nodeById.get(edge.fromEntityId);
    const to = nodeById.get(edge.toEntityId);
    if (!from || !to) continue;
    const placement = labelCandidates(from, to).find((candidate) => {
      const rectangle = labelRectangle(candidate);
      return (
        rectangle.left >= 0 &&
        rectangle.top >= 0 &&
        rectangle.right <= graphWidth &&
        rectangle.bottom <= graphHeight &&
        !nodes.some((node) =>
          rectanglesIntersect(rectangle, nodeRectangle(node)),
        ) &&
        !occupiedLabels.some((occupied) =>
          rectanglesIntersect(rectangle, occupied),
        )
      );
    });
    if (!placement) continue;
    placements.set(edge.id, placement);
    occupiedLabels.push(labelRectangle(placement));
  }

  return placements;
}

function labelCandidates(
  from: ImpactEdgeLabelNode,
  to: ImpactEdgeLabelNode,
): readonly ImpactEdgeLabelPlacement[] {
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
  const perpendicular = { x: -deltaY / distance, y: deltaX / distance };
  const midpoint = {
    x: (fromCenter.x + toCenter.x) / 2,
    y: (fromCenter.y + toCenter.y) / 2,
  };

  return [170, -170, 228, -228, 112, -112].map((offset) => ({
    x: midpoint.x + perpendicular.x * offset,
    y: midpoint.y + perpendicular.y * offset,
  }));
}

function nodeRectangle(node: ImpactEdgeLabelNode): Rectangle {
  return {
    left: node.x,
    top: node.y,
    right: node.x + TRACE_NODE_WIDTH,
    bottom: node.y + TRACE_NODE_HEIGHT,
  };
}

function labelRectangle(placement: ImpactEdgeLabelPlacement): Rectangle {
  return {
    left: placement.x - IMPACT_EDGE_LABEL_WIDTH / 2,
    top: placement.y - IMPACT_EDGE_LABEL_HEIGHT / 2,
    right: placement.x + IMPACT_EDGE_LABEL_WIDTH / 2,
    bottom: placement.y + IMPACT_EDGE_LABEL_HEIGHT / 2,
  };
}

function rectanglesIntersect(first: Rectangle, second: Rectangle): boolean {
  return (
    first.left < second.right &&
    first.right > second.left &&
    first.top < second.bottom &&
    first.bottom > second.top
  );
}
