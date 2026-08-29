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

const nodeWidth = 220;
const nodeHeight = 152;
const packetWidth = 196;
const packetHeight = 96;
const gap = 16;

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
      { x: target.x + 12, y: target.y + nodeHeight + gap, edge: "below" },
      { x: target.x + 12, y: target.y - packetHeight - gap, edge: "above" },
      { x: target.x + nodeWidth + gap, y: target.y + 12, edge: "right" },
      { x: target.x - packetWidth - gap, y: target.y + 12, edge: "left" },
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
              right: node.x + nodeWidth,
              bottom: node.y + nodeHeight,
            }),
        ) &&
        !occupiedPackets.some((occupied) =>
          rectanglesIntersect(packet, occupied),
        )
      );
    }) ?? {
      x: Math.max(0, Math.min(graphWidth - packetWidth, target.x + 12)),
      y: Math.max(
        0,
        Math.min(graphHeight - packetHeight, target.y + nodeHeight + gap),
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
    right: placement.x + packetWidth,
    bottom: placement.y + packetHeight,
  };
}

function rectanglesIntersect(a: Rectangle, b: Rectangle): boolean {
  return (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  );
}
