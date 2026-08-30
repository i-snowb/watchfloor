import assert from "node:assert/strict";
import test from "node:test";
import {
  clampTraceCamera,
  fitTraceCamera,
  fitTraceCameraToBounds,
  TRACE_CASE_READABLE_SCALE,
  zoomTraceCameraAt,
} from "../lib/trace-camera";

test("trace camera gives a small world a bounded physical working range", () => {
  assert.deepEqual(
    clampTraceCamera(
      { x: -500, y: 400, scale: 1 },
      { width: 1000, height: 700 },
      { width: 600, height: 400 },
    ),
    { x: 168, y: 182, scale: 1 },
  );
});

test("trace camera clamps a large world to a bounded working margin", () => {
  const camera = clampTraceCamera(
    { x: -5000, y: 5000, scale: 1 },
    { width: 900, height: 600 },
    { width: 1200, height: 800 },
  );
  assert.deepEqual(camera, { x: -332, y: 32, scale: 1 });
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

test("pointer-centered zoom respects a case readability floor", () => {
  let camera = { x: 0, y: 0, scale: 1 };
  for (let index = 0; index < 10; index += 1) {
    camera = zoomTraceCameraAt(
      camera,
      camera.scale * 0.7,
      { x: 500, y: 350 },
      { width: 1000, height: 700 },
      { width: 1320, height: 720 },
      0.82,
    );
  }
  assert.equal(camera.scale, 0.82);
});

test("fit camera returns a bounded deterministic view", () => {
  assert.deepEqual(
    fitTraceCamera({ width: 900, height: 600 }, { width: 1200, height: 800 }),
    { x: 48, y: 32, scale: 0.67 },
  );
});

test("fit camera keeps a short evidence field near the top working margin", () => {
  assert.deepEqual(
    fitTraceCamera({ width: 1000, height: 700 }, { width: 600, height: 400 }),
    { x: 200, y: 118, scale: 1 },
  );
});

test("active evidence fit favors readable scale over unused world space", () => {
  const camera = fitTraceCameraToBounds(
    { width: 1000, height: 700 },
    { width: 1600, height: 980 },
    { x: 250, y: 180, width: 1200, height: 650 },
  );

  assert.equal(camera.scale, 1);
  assert.ok(
    camera.scale >
      fitTraceCamera({ width: 1000, height: 700 }, { width: 1600, height: 980 })
        .scale,
  );
  assert.equal(camera.x, -350);
  assert.equal(camera.y, -148);
});

test("active evidence fit uses natural scale when the evidence fits", () => {
  assert.deepEqual(
    fitTraceCameraToBounds(
      { width: 1200, height: 800 },
      { width: 1600, height: 980 },
      { x: 320, y: 220, width: 840, height: 520 },
    ),
    { x: -140, y: -188, scale: 1 },
  );
});

test("case fit keeps room for graph expansion at the 1280 recording viewport", () => {
  const bounds = { x: 60, y: 10, width: 1240, height: 392 };
  const camera = fitTraceCameraToBounds(
    { width: 1020, height: 333 },
    { width: 1320, height: 720 },
    bounds,
    undefined,
    TRACE_CASE_READABLE_SCALE,
  );

  assert.equal(camera.scale, TRACE_CASE_READABLE_SCALE);
  assert.equal(camera.x, -34);
  assert.equal(camera.y, 24);
  assert.ok(camera.x + bounds.x * camera.scale > 0);
  assert.ok(camera.x + (bounds.x + bounds.width) * camera.scale < 1020);
  assert.ok(camera.y + bounds.y * camera.scale >= 32);
  assert.ok(camera.y + (bounds.y + bounds.height) * camera.scale <= 346);
});

test("case fit holds a readable scale with bounded panning at 1024", () => {
  const bounds = { x: 60, y: 10, width: 1240, height: 392 };
  const camera = fitTraceCameraToBounds(
    { width: 764, height: 381 },
    { width: 1320, height: 720 },
    bounds,
    undefined,
    TRACE_CASE_READABLE_SCALE,
  );

  assert.equal(camera.x, -162);
  assert.equal(camera.y, 24);
  assert.equal(camera.scale, TRACE_CASE_READABLE_SCALE);
  assert.ok(camera.x + bounds.x * camera.scale < 0);
  assert.ok(camera.x + (bounds.x + bounds.width) * camera.scale > 764);
  assert.ok(camera.y + bounds.y * camera.scale >= 32);
  assert.ok(camera.y + (bounds.y + bounds.height) * camera.scale < 346);
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
