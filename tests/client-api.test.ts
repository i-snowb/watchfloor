import assert from "node:assert/strict";
import test from "node:test";
import { executeTool, loadCase } from "../lib/client-api";

test("operation transport retries reuse the same idempotency key", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: string[] = [];
  globalThis.fetch = async (_input, init) => {
    bodies.push(String(init?.body));
    if (bodies.length === 1) throw new TypeError("connection reset");
    return Response.json({ result: { ok: true }, snapshot: {} });
  };

  try {
    await executeTool(
      "case-endpoint-0448",
      "get_case_context",
      "webmcp_callback",
      {},
      "webmcp-stable-request",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(bodies.length, 2);
  const [firstBody, secondBody] = bodies;
  assert.ok(firstBody && secondBody);
  assert.deepEqual(JSON.parse(firstBody), JSON.parse(secondBody));
  assert.equal(JSON.parse(firstBody).requestId, "webmcp-stable-request");
});

test("non-JSON service failures produce bounded analyst-facing copy", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("Internal Server Error: implementation detail", {
      status: 500,
      headers: { "content-type": "text/plain" },
    });

  try {
    await assert.rejects(
      () => loadCase("case-endpoint-0448"),
      (error: unknown) => {
        assert.equal(error instanceof Error, true);
        if (!(error instanceof Error)) return false;
        assert.equal(
          error.message,
          "The case service is temporarily unavailable. Try again shortly.",
        );
        assert.equal(error.message.includes("implementation detail"), false);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("successful non-JSON responses fail closed", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("ok", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });

  try {
    await assert.rejects(
      () => loadCase("case-endpoint-0448"),
      /service returned an invalid response/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
