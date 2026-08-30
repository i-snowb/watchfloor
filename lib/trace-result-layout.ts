import {
  TRACE_NODE_HEIGHT,
  TRACE_NODE_WIDTH,
  TRACE_RESULT_PACKET_GAP,
  TRACE_RESULT_PACKET_HEIGHT,
  TRACE_RESULT_PACKET_WIDTH,
} from "./trace-geometry";

export interface TraceLayoutNode {
  entityId: string;
  x: number;
  y: number;
}

export interface TraceResultPlacement {
  x: number;
  y: number;
  edge: "above" | "below" | "left" | "right";
}

interface Rectangle {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function layoutTraceResultPackets(
  targetEntityIds: readonly string[],
  nodes: readonly TraceLayoutNode[],
  visibleEntityIds: ReadonlySet<string>,
  graphWidth: number,
  graphHeight: number,
): ReadonlyMap<string, TraceResultPlacement> {
  const visibleNodes = nodes.filter((node) =>
    visibleEntityIds.has(node.entityId),
  );
  const nodeById = new Map(nodes.map((node) => [node.entityId, node]));
  const occupiedPackets: Rectangle[] = [];
  const placements = new Map<string, TraceResultPlacement>();

  for (const entityId of targetEntityIds) {
    const target = nodeById.get(entityId);
    if (!target) continue;
    const candidates: TraceResultPlacement[] = [
      {
        x: target.x + 12,
        y: target.y + TRACE_NODE_HEIGHT + TRACE_RESULT_PACKET_GAP,
        edge: "below",
      },
      {
        x: target.x + 12,
        y: target.y - TRACE_RESULT_PACKET_HEIGHT - TRACE_RESULT_PACKET_GAP,
        edge: "above",
      },
      {
        x: target.x + TRACE_NODE_WIDTH + TRACE_RESULT_PACKET_GAP,
        y: target.y + 12,
        edge: "right",
      },
      {
        x: target.x - TRACE_RESULT_PACKET_WIDTH - TRACE_RESULT_PACKET_GAP,
        y: target.y + 12,
        edge: "left",
      },
    ];
    const placement = candidates.find((candidate) => {
      const packet = packetRectangle(candidate);
      return (
        packet.left >= 0 &&
        packet.top >= 0 &&
        packet.right <= graphWidth &&
        packet.bottom <= graphHeight &&
        !visibleNodes.some(
          (node) =>
            node.entityId !== entityId &&
            rectanglesIntersect(packet, {
              left: node.x,
              top: node.y,
              right: node.x + TRACE_NODE_WIDTH,
              bottom: node.y + TRACE_NODE_HEIGHT,
            }),
        ) &&
        !occupiedPackets.some((occupied) =>
          rectanglesIntersect(packet, occupied),
        )
      );
    }) ?? {
      x: Math.max(
        0,
        Math.min(graphWidth - TRACE_RESULT_PACKET_WIDTH, target.x + 12),
      ),
      y: Math.max(
        0,
        Math.min(
          graphHeight - TRACE_RESULT_PACKET_HEIGHT,
          target.y + TRACE_NODE_HEIGHT + TRACE_RESULT_PACKET_GAP,
        ),
      ),
      edge: "below" as const,
    };
    placements.set(entityId, placement);
    occupiedPackets.push(packetRectangle(placement));
  }

  return placements;
}

function packetRectangle(placement: TraceResultPlacement): Rectangle {
  return {
    left: placement.x,
    top: placement.y,
    right: placement.x + TRACE_RESULT_PACKET_WIDTH,
    bottom: placement.y + TRACE_RESULT_PACKET_HEIGHT,
  };
}

function rectanglesIntersect(a: Rectangle, b: Rectangle): boolean {
  return (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  );
}
