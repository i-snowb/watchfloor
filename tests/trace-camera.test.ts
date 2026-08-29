import assert from "node:assert/strict";
import test from "node:test";
import {
  clampTraceCamera,
  fitTraceCamera,
  fitTraceCameraToBounds,
  zoomTraceCameraAt,
} from "../lib/trace-camera";

test("trace camera gives a small world a bounded physical working range", () => {
  assert.deepEqual(
    clampTraceCamera(
      { x: -500, y: 400, scale: 1 },
      { width: 1000, height: 700 },
      { width: 600, height: 400 },
    ),
    { x: 152, y: 198, scale: 1 },
  );
});

test("trace camera clamps a large world to a bounded working margin", () => {
  const camera = clampTraceCamera(
    { x: -5000, y: 5000, scale: 1 },
    { width: 900, height: 600 },
    { width: 1200, height: 800 },
  );
  assert.deepEqual(camera, { x: -348, y: 48, scale: 1 });
});

test("pointer-centered zoom preserves the world point under the pointer", () => {
  const camera = { x: -120, y: -40, scale: 1 };
  const pointer = { x: 360, y: 240 };
  const zoomed = zoomTraceCameraAt(
    camera,
    1.4,
    pointer,
    { width: 900, height: 600 },
    { width: 1200, height: 800 },
  );
  assert.ok(
    Math.abs((pointer.x - zoomed.x) / zoomed.scale - 480) <
      Number.EPSILON * 512,
  );
  assert.ok(
    Math.abs((pointer.y - zoomed.y) / zoomed.scale - 280) <
      Number.EPSILON * 512,
  );
});

test("fit camera returns a bounded deterministic view", () => {
  assert.deepEqual(
    fitTraceCamera({ width: 900, height: 600 }, { width: 1200, height: 800 }),
    { x: 72, y: 48, scale: 0.63 },
  );
});

test("fit camera keeps a short evidence field near the top working margin", () => {
  assert.deepEqual(
    fitTraceCamera({ width: 1000, height: 700 }, { width: 600, height: 400 }),
    { x: 200, y: 102, scale: 1 },
  );
});

test("active evidence fit favors readable scale over unused world space", () => {
  const camera = fitTraceCameraToBounds(
    { width: 1000, height: 700 },
    { width: 1600, height: 980 },
    { x: 250, y: 180, width: 1200, height: 650 },
  );

  assert.equal(camera.scale, 0.84);
  assert.ok(
    camera.scale >
      fitTraceCamera({ width: 1000, height: 700 }, { width: 1600, height: 980 })
        .scale,
  );
  assert.equal(camera.x, -214);
  assert.ok(Math.abs(camera.y + 103.2) < Number.EPSILON * 128);
});

test("active evidence fit uses natural scale when the evidence fits", () => {
  assert.deepEqual(
    fitTraceCameraToBounds(
      { width: 1200, height: 800 },
      { width: 1600, height: 980 },
      { x: 320, y: 220, width: 840, height: 520 },
    ),
    { x: -140, y: -172, scale: 1 },
  );
});

test("active evidence fit falls back for invalid bounds", () => {
  assert.deepEqual(
    fitTraceCameraToBounds(
      { width: 900, height: 600 },
      { width: 1200, height: 800 },
      { x: 0, y: 0, width: 0, height: 0 },
    ),
    fitTraceCamera({ width: 900, height: 600 }, { width: 1200, height: 800 }),
  );
});
