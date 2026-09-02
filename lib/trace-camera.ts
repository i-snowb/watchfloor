export interface TraceCamera {
  x: number;
  y: number;
  scale: number;
}

export interface TracePoint {
  x: number;
  y: number;
}

export interface TraceSize {
  width: number;
  height: number;
}

export interface TraceBounds extends TracePoint, TraceSize {}

export const TRACE_MIN_SCALE = 0.58;
export const TRACE_MAX_SCALE = 1.7;
export const TRACE_CAMERA_MARGIN = 32;
export const TRACE_CASE_READABLE_SCALE = 0.8;
export const TRACE_ACTIVE_EVIDENCE_FIT_SCALE = 1.35;
export const TRACE_QUERY_OVERLAY_MIN_BLOCKING_HEIGHT = 120;

export function clampTraceScale(scale: number): number {
  return Math.min(TRACE_MAX_SCALE, Math.max(TRACE_MIN_SCALE, scale));
}

export function clampTraceCamera(
  camera: TraceCamera,
  viewport: TraceSize,
  world: TraceSize,
  margin = TRACE_CAMERA_MARGIN,
): TraceCamera {
  const scale = clampTraceScale(camera.scale);
  const scaledWidth = world.width * scale;
  const scaledHeight = world.height * scale;

  return {
    x: clampAxis(camera.x, viewport.width, scaledWidth, margin),
    y: clampAxis(camera.y, viewport.height, scaledHeight, margin),
    scale,
  };
}

export function fitTraceCamera(
  viewport: TraceSize,
  world: TraceSize,
  margin = TRACE_CAMERA_MARGIN,
): TraceCamera {
  const availableWidth = Math.max(1, viewport.width - margin * 2);
  const availableHeight = Math.max(1, viewport.height - margin * 2);
  const scale = clampTraceScale(
    Math.min(1, availableWidth / world.width, availableHeight / world.height),
  );

  return clampTraceCamera(
    {
      x: (viewport.width - world.width * scale) / 2,
      y: margin,
      scale,
    },
    viewport,
    world,
    margin,
  );
}

export function fitTraceCameraToBounds(
  viewport: TraceSize,
  world: TraceSize,
  bounds: TraceBounds,
  margin = TRACE_CAMERA_MARGIN,
  minimumReadableScale = 1,
  fitWithinViewport = false,
  maximumFitScale = minimumReadableScale,
): TraceCamera {
  if (bounds.width <= 0 || bounds.height <= 0) {
    return fitTraceCamera(viewport, world, margin);
  }
  const availableWidth = Math.max(1, viewport.width - margin * 2);
  const availableHeight = Math.max(1, viewport.height - margin * 2);
  const naturalScale = Math.min(
    maximumFitScale,
    availableWidth / bounds.width,
    availableHeight / bounds.height,
  );
  // A normal fit favors the requested readable scale. The interactive case
  // map opts into full containment so a short fixed-height workspace does not
  // crop active evidence; its global floor still prevents unusably tiny cards.
  const scale = clampTraceScale(
    fitWithinViewport
      ? Math.max(TRACE_MIN_SCALE, naturalScale)
      : Math.max(minimumReadableScale, naturalScale),
  );
  const scaledBoundsHeight = bounds.height * scale;
  const y =
    scaledBoundsHeight > availableHeight
      ? (viewport.height - scaledBoundsHeight) / 2 - bounds.y * scale
      : margin - bounds.y * scale;

  return clampTraceCamera(
    {
      x: (viewport.width - bounds.width * scale) / 2 - bounds.x * scale,
      y,
      scale,
    },
    viewport,
    world,
    margin,
  );
}

/**
 * A compact query summary can overlap the map without hiding enough evidence
 * to justify shrinking its working width. Reserve a side band only when an
 * overlay covers a material vertical span of the graph viewport.
 */
export function blocksTraceCameraBand(
  viewport: TraceSize,
  overlay: TraceBounds,
): boolean {
  if (overlay.width <= 0 || overlay.height <= 0) return false;
  const overlapHeight = Math.max(
    0,
    Math.min(viewport.height, overlay.y + overlay.height) -
      Math.max(0, overlay.y),
  );
  const requiredHeight = Math.min(
    TRACE_QUERY_OVERLAY_MIN_BLOCKING_HEIGHT,
    viewport.height * 0.34,
  );
  return overlapHeight >= requiredHeight;
}

export function zoomTraceCameraAt(
  camera: TraceCamera,
  nextScale: number,
  pointer: TracePoint,
  viewport: TraceSize,
  world: TraceSize,
  minimumScale = TRACE_MIN_SCALE,
): TraceCamera {
  const scale = clampTraceScale(Math.max(minimumScale, nextScale));
  const worldX = (pointer.x - camera.x) / camera.scale;
  const worldY = (pointer.y - camera.y) / camera.scale;

  return clampTraceCamera(
    {
      x: pointer.x - worldX * scale,
      y: pointer.y - worldY * scale,
      scale,
    },
    viewport,
    world,
  );
}

function clampAxis(
  position: number,
  viewportLength: number,
  worldLength: number,
  margin: number,
): number {
  if (worldLength <= viewportLength - margin * 2) {
    const center = (viewportLength - worldLength) / 2;
    return Math.min(center + margin, Math.max(center - margin, position));
  }
  const minimum = viewportLength - worldLength - margin;
  return Math.min(margin, Math.max(minimum, position));
}
