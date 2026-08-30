"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  clampTraceCamera,
  fitTraceCamera,
  fitTraceCameraToBounds,
  zoomTraceCameraAt,
  type TraceCamera,
  type TraceBounds,
  type TracePoint,
  type TraceSize,
} from "@/lib/trace-camera";
import type { CaseFixture } from "@/domain/types";

export type TraceSelection =
  | { kind: "event"; id: string }
  | { kind: "join"; id: string }
  | { kind: "entity"; id: string }
  | { kind: "model"; id: string };

export function selectionContainsEntity(
  fixture: CaseFixture,
  selection: TraceSelection,
  entityId: string,
): boolean {
  if (selection.kind === "entity") return selection.id === entityId;
  if (selection.kind === "event") {
    return (
      [
        ...fixture.events,
        ...fixture.stream.stages.flatMap((stage) => stage.events),
      ]
        .find((event) => event.id === selection.id)
        ?.entityIds.includes(entityId) ?? false
    );
  }
  if (selection.kind === "join") {
    const join = [
      ...fixture.joins,
      ...fixture.stream.stages.flatMap((stage) => stage.joins),
    ].find((candidate) => candidate.id === selection.id);
    return join?.fromEntityId === entityId || join?.toEntityId === entityId;
  }
  const priorityRoute = fixture.impact.threatOverlay?.priorityRoute;
  if (priorityRoute?.id === selection.id) {
    return priorityRoute.entityIds.includes(entityId);
  }
  return (
    fixture.reachability.paths
      .find((path) => path.id === selection.id)
      ?.entityIds.includes(entityId) ?? false
  );
}

interface TraceMoveSample extends TracePoint {
  time: number;
}

interface TraceDragState {
  pointerId: number;
  start: TracePoint;
  camera: TraceCamera;
  moved: boolean;
  samples: TraceMoveSample[];
}

const initialTraceCamera: TraceCamera = { x: 0, y: 0, scale: 1 };

export function useTraceCamera(
  selection: TraceSelection,
  worldRevision: string | number,
  viewportBottomInset = 0,
  minimumReadableScale = 1,
) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<TraceCamera>(initialTraceCamera);
  const dragRef = useRef<TraceDragState | null>(null);
  const inertiaFrameRef = useRef<number | null>(null);
  const focusTimerRef = useRef<number | null>(null);
  const wheelCommitTimerRef = useRef<number | null>(null);
  const wheelGeometryRef = useRef<{
    bounds: DOMRect;
    viewport: TraceSize;
    world: TraceSize;
  } | null>(null);
  const sizesRef = useRef<{
    viewport: TraceSize;
    world: TraceSize;
  } | null>(null);
  const initializedRef = useRef(false);
  const worldRevisionRef = useRef(worldRevision);
  const selectionWorldRevisionRef = useRef(worldRevision);
  const reducedMotionRef = useRef(false);
  const lastSelectionRef = useRef(`${selection.kind}:${selection.id}`);
  const [camera, setCamera] = useState(initialTraceCamera);
  const [dragging, setDragging] = useState(false);
  const [focusing, setFocusing] = useState(false);

  const measureSizes = useCallback((): {
    viewport: TraceSize;
    world: TraceSize;
  } | null => {
    const viewport = viewportRef.current;
    const plane = planeRef.current;
    if (!viewport || !plane) return null;
    return {
      viewport: {
        width: viewport.clientWidth,
        height: Math.max(1, viewport.clientHeight - viewportBottomInset),
      },
      world: { width: plane.offsetWidth, height: plane.offsetHeight },
    };
  }, [viewportBottomInset]);

  const applyCamera = useCallback((next: TraceCamera) => {
    cameraRef.current = next;
    if (planeRef.current) {
      const pixelRatio = window.devicePixelRatio || 1;
      const x = Math.round(next.x * pixelRatio) / pixelRatio;
      const y = Math.round(next.y * pixelRatio) / pixelRatio;
      planeRef.current.style.transformOrigin = "0 0";
      planeRef.current.style.transform = `translate(${x}px, ${y}px) scale(${next.scale})`;
    }
  }, []);

  const commitCamera = useCallback(
    (next: TraceCamera) => {
      applyCamera(next);
      setCamera(next);
    },
    [applyCamera],
  );

  const cancelInertia = useCallback(() => {
    if (inertiaFrameRef.current !== null) {
      window.cancelAnimationFrame(inertiaFrameRef.current);
      inertiaFrameRef.current = null;
    }
  }, []);

  const constrainCamera = useCallback((next: TraceCamera): TraceCamera => {
    const sizes = sizesRef.current;
    return sizes ? clampTraceCamera(next, sizes.viewport, sizes.world) : next;
  }, []);

  const fit = useCallback(() => {
    cancelInertia();
    const sizes = sizesRef.current ?? measureSizes();
    if (!sizes) return;
    const activeBounds = measureActiveTraceBounds(planeRef.current);
    commitCamera(
      activeBounds
        ? fitTraceCameraToBounds(
            sizes.viewport,
            sizes.world,
            activeBounds,
            undefined,
            minimumReadableScale,
          )
        : fitTraceCamera(sizes.viewport, sizes.world),
    );
  }, [cancelInertia, commitCamera, measureSizes, minimumReadableScale]);

  const zoomAt = useCallback(
    (scale: number, point: TracePoint) => {
      cancelInertia();
      const sizes = sizesRef.current ?? measureSizes();
      if (!sizes) return;
      commitCamera(
        zoomTraceCameraAt(
          cameraRef.current,
          scale,
          point,
          sizes.viewport,
          sizes.world,
          minimumReadableScale,
        ),
      );
    },
    [cancelInertia, commitCamera, measureSizes, minimumReadableScale],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      zoomAt(cameraRef.current.scale * factor, {
        x: viewport.clientWidth / 2,
        y: viewport.clientHeight / 2,
      });
    },
    [zoomAt],
  );

  const panBy = useCallback(
    (x: number, y: number) => {
      cancelInertia();
      commitCamera(
        constrainCamera({
          ...cameraRef.current,
          x: cameraRef.current.x + x,
          y: cameraRef.current.y + y,
        }),
      );
    },
    [cancelInertia, commitCamera, constrainCamera],
  );

  const startInertia = useCallback(
    (velocityX: number, velocityY: number) => {
      if (reducedMotionRef.current || Math.hypot(velocityX, velocityY) < 0.08) {
        commitCamera(cameraRef.current);
        return;
      }
      cancelInertia();
      let lastTime = performance.now();
      let elapsed = 0;
      let xVelocity = velocityX;
      let yVelocity = velocityY;

      const step = (time: number) => {
        const frameTime = Math.min(32, time - lastTime);
        lastTime = time;
        elapsed += frameTime;
        const decay = Math.pow(0.9, frameTime / 16.67);
        xVelocity *= decay;
        yVelocity *= decay;

        const candidate = {
          ...cameraRef.current,
          x: cameraRef.current.x + xVelocity * frameTime,
          y: cameraRef.current.y + yVelocity * frameTime,
        };
        const next = constrainCamera(candidate);
        if (next.x !== candidate.x) xVelocity = 0;
        if (next.y !== candidate.y) yVelocity = 0;
        applyCamera(next);

        if (elapsed >= 420 || Math.hypot(xVelocity, yVelocity) < 0.02) {
          inertiaFrameRef.current = null;
          commitCamera(next);
          return;
        }
        inertiaFrameRef.current = window.requestAnimationFrame(step);
      };

      inertiaFrameRef.current = window.requestAnimationFrame(step);
    },
    [applyCamera, cancelInertia, commitCamera, constrainCamera],
  );

  const endPointer = useCallback(
    (withInertia: boolean) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      setDragging(false);
      if (!withInertia || !drag.moved || drag.samples.length < 2) {
        commitCamera(cameraRef.current);
        return;
      }
      const latest = drag.samples.at(-1)!;
      const earliest =
        drag.samples.find((sample) => latest.time - sample.time <= 120) ??
        drag.samples[0]!;
      const duration = Math.max(16, latest.time - earliest.time);
      startInertia(
        (latest.x - earliest.x) / duration,
        (latest.y - earliest.y) / duration,
      );
    },
    [commitCamera, startInertia],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !event.isPrimary || dragRef.current) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("button, a, input, textarea, select, summary")
      ) {
        return;
      }
      cancelInertia();
      setFocusing(false);
      dragRef.current = {
        pointerId: event.pointerId,
        start: { x: event.clientX, y: event.clientY },
        camera: cameraRef.current,
        moved: false,
        samples: [
          { x: event.clientX, y: event.clientY, time: performance.now() },
        ],
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    },
    [cancelInertia],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - drag.start.x;
      const deltaY = event.clientY - drag.start.y;
      if (Math.hypot(deltaX, deltaY) > 4) drag.moved = true;
      applyCamera(
        constrainCamera({
          ...drag.camera,
          x: drag.camera.x + deltaX,
          y: drag.camera.y + deltaY,
        }),
      );
      drag.samples.push({
        x: event.clientX,
        y: event.clientY,
        time: performance.now(),
      });
      if (drag.samples.length > 6) drag.samples.shift();
    },
    [applyCamera, constrainCamera],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const pointerId = dragRef.current?.pointerId;
      endPointer(true);
      if (
        pointerId === event.pointerId &&
        event.currentTarget.hasPointerCapture(event.pointerId)
      ) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [endPointer],
  );

  const onPointerCancel = useCallback(() => endPointer(false), [endPointer]);
  const onLostPointerCapture = useCallback(
    () => endPointer(false),
    [endPointer],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      const distance = event.shiftKey ? 160 : 48;
      if (event.key === "ArrowLeft") panBy(distance, 0);
      else if (event.key === "ArrowRight") panBy(-distance, 0);
      else if (event.key === "ArrowUp") panBy(0, distance);
      else if (event.key === "ArrowDown") panBy(0, -distance);
      else if (event.key === "+" || event.key === "=") zoomBy(1.19);
      else if (event.key === "-") zoomBy(0.84);
      else if (event.key === "0" || event.key === "Escape") fit();
      else return;
      event.preventDefault();
    },
    [fit, panBy, zoomBy],
  );

  useEffect(() => {
    applyCamera(cameraRef.current);
  }, [applyCamera]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      reducedMotionRef.current = media.matches;
      if (media.matches) cancelInertia();
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [cancelInertia]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      cancelInertia();
      if (!wheelGeometryRef.current) {
        const sizes = sizesRef.current ?? measureSizes();
        if (!sizes) return;
        wheelGeometryRef.current = {
          bounds: viewport.getBoundingClientRect(),
          ...sizes,
        };
      }
      const geometry = wheelGeometryRef.current;
      applyCamera(
        zoomTraceCameraAt(
          cameraRef.current,
          cameraRef.current.scale * Math.exp(-event.deltaY * 0.0015),
          {
            x: event.clientX - geometry.bounds.left,
            y: event.clientY - geometry.bounds.top,
          },
          geometry.viewport,
          geometry.world,
          minimumReadableScale,
        ),
      );
      if (wheelCommitTimerRef.current !== null) {
        window.clearTimeout(wheelCommitTimerRef.current);
      }
      wheelCommitTimerRef.current = window.setTimeout(() => {
        wheelCommitTimerRef.current = null;
        wheelGeometryRef.current = null;
        setCamera(cameraRef.current);
      }, 90);
    };
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", handleWheel);
      if (wheelCommitTimerRef.current !== null) {
        window.clearTimeout(wheelCommitTimerRef.current);
        wheelCommitTimerRef.current = null;
      }
      wheelGeometryRef.current = null;
    };
  }, [applyCamera, cancelInertia, measureSizes, minimumReadableScale]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const plane = planeRef.current;
    if (!viewport || !plane) return;
    const updateBounds = () => {
      const sizes = measureSizes();
      if (!sizes) return;
      const previousSizes = sizesRef.current;
      sizesRef.current = sizes;
      wheelGeometryRef.current = null;
      const viewportChanged =
        previousSizes !== null &&
        (Math.abs(previousSizes.viewport.width - sizes.viewport.width) > 8 ||
          Math.abs(previousSizes.viewport.height - sizes.viewport.height) > 8);
      const worldChanged = worldRevisionRef.current !== worldRevision;
      worldRevisionRef.current = worldRevision;
      if (!initializedRef.current || viewportChanged || worldChanged) {
        initializedRef.current = true;
        const activeBounds = measureActiveTraceBounds(plane);
        commitCamera(
          activeBounds
            ? fitTraceCameraToBounds(
                sizes.viewport,
                sizes.world,
                activeBounds,
                undefined,
                minimumReadableScale,
              )
            : fitTraceCamera(sizes.viewport, sizes.world),
        );
      } else {
        commitCamera(
          clampTraceCamera(cameraRef.current, sizes.viewport, sizes.world),
        );
      }
    };
    const observer = new ResizeObserver(updateBounds);
    observer.observe(viewport);
    observer.observe(plane);
    const frame = window.requestAnimationFrame(updateBounds);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [commitCamera, measureSizes, minimumReadableScale, worldRevision]);

  useEffect(() => {
    const plane = planeRef.current;
    if (!plane) return;
    const hideDuplicatePaths = () => {
      const paths = plane.querySelectorAll<SVGElement>(
        'svg [data-trace-join-id][role="button"]',
      );
      for (const path of paths) {
        if (path.tabIndex !== -1) path.tabIndex = -1;
        if (path.getAttribute("aria-hidden") !== "true") {
          path.setAttribute("aria-hidden", "true");
        }
      }
    };
    hideDuplicatePaths();
    const observer = new MutationObserver(hideDuplicatePaths);
    observer.observe(plane, {
      attributes: true,
      attributeFilter: ["role", "tabindex"],
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [worldRevision]);

  useEffect(() => {
    const selectionKey = `${selection.kind}:${selection.id}`;
    if (selectionWorldRevisionRef.current !== worldRevision) {
      selectionWorldRevisionRef.current = worldRevision;
      lastSelectionRef.current = selectionKey;
      return;
    }
    if (selectionKey === lastSelectionRef.current) return;
    lastSelectionRef.current = selectionKey;
    cancelInertia();
    const frame = window.requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      const plane = planeRef.current;
      if (!viewport || !plane) return;
      const target = findTraceTarget(plane, selection);
      if (!target) return;
      const viewportBounds = viewport.getBoundingClientRect();
      const targetBounds = target.getBoundingClientRect();
      const next = constrainCamera({
        ...cameraRef.current,
        x:
          cameraRef.current.x +
          viewportBounds.left +
          viewportBounds.width / 2 -
          (targetBounds.left + targetBounds.width / 2),
        y:
          cameraRef.current.y +
          viewportBounds.top +
          viewportBounds.height * 0.15 -
          (targetBounds.top + targetBounds.height / 2),
      });
      setFocusing(true);
      window.requestAnimationFrame(() => commitCamera(next));
      if (focusTimerRef.current !== null) {
        window.clearTimeout(focusTimerRef.current);
      }
      focusTimerRef.current = window.setTimeout(
        () => setFocusing(false),
        reducedMotionRef.current ? 0 : 240,
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [cancelInertia, commitCamera, constrainCamera, selection, worldRevision]);

  useEffect(
    () => () => {
      cancelInertia();
      if (focusTimerRef.current !== null) {
        window.clearTimeout(focusTimerRef.current);
      }
    },
    [cancelInertia],
  );

  const focusTarget = useCallback((nextSelection: TraceSelection) => {
    const plane = planeRef.current;
    const target = plane ? findTraceTarget(plane, nextSelection) : null;
    target?.focus({ preventScroll: true });
  }, []);

  return {
    camera,
    dragging,
    focusing,
    viewportRef,
    planeRef,
    fit,
    focusTarget,
    zoomBy,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
    onKeyDown,
  };
}

function measureActiveTraceBounds(
  plane: HTMLElement | null,
): TraceBounds | null {
  if (!plane) return null;
  const elements = plane.querySelectorAll<HTMLElement>(
    ".evidence-entity, .evidence-edge-label",
  );
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const element of elements) {
    if (element.offsetWidth === 0 || element.offsetHeight === 0) continue;
    minX = Math.min(minX, element.offsetLeft);
    minY = Math.min(minY, element.offsetTop);
    maxX = Math.max(maxX, element.offsetLeft + element.offsetWidth);
    maxY = Math.max(maxY, element.offsetTop + element.offsetHeight);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function findTraceTarget(
  plane: HTMLDivElement,
  selection: TraceSelection,
): HTMLElement | null {
  const elements = plane.querySelectorAll<HTMLElement>(
    "[data-trace-event-id], [data-trace-entity-id], [data-trace-entity-ids], [data-trace-join-id], [data-trace-model-id]",
  );
  return (
    Array.from(elements).find((element) => {
      if (selection.kind === "event") {
        return element.dataset.traceEventId === selection.id;
      }
      if (selection.kind === "join") {
        return element.dataset.traceJoinId === selection.id;
      }
      if (selection.kind === "model") {
        return element.dataset.traceModelId === selection.id;
      }
      return (
        element.dataset.traceEntityId === selection.id ||
        element.dataset.traceEntityIds?.split(" ").includes(selection.id)
      );
    }) ?? null
  );
}
