import assert from "node:assert/strict";
import test from "node:test";
import { executeTool } from "../lib/client-api";

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
