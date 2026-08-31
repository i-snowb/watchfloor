import assert from "node:assert/strict";
import test from "node:test";
import nextConfig, { securityHeaders } from "../next.config";
import { jsonResponse, readJsonObject } from "../server/http";

test("JSON responses include the shared security headers", () => {
  const response = jsonResponse(
    new Request("https://private.example.com/api/test"),
    null,
    { ok: true },
  );
  assert.equal(
    response.headers.get("content-security-policy"),
    "frame-ancestors 'none'",
  );
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("permissions-policy") ?? "", /camera=\(\)/);
});

test("Next applies the same security policy to every page and asset", async () => {
  const entries = await nextConfig.headers?.();
  assert.deepEqual(entries, [
    { source: "/:path*", headers: [...securityHeaders] },
  ]);
});

test("body reader preserves valid object and exact 16 KiB inputs", async () => {
  assert.deepEqual(
    await readJsonObject(jsonRequest(JSON.stringify({ value: "ok" }))),
    { value: "ok" },
  );
  const exact = JSON.stringify({ x: "a".repeat(16_376) });
  assert.equal(Buffer.byteLength(exact), 16_384);
  const parsed = await readJsonObject(jsonRequest(exact));
  assert.equal((parsed.x as string).length, 16_376);
});

test("declared oversized input rejects before reading the stream", async () => {
  let pulled = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulled = true;
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  const request = streamRequest(stream, { "content-length": "16385" });
  await assert.rejects(readJsonObject(request), /REQUEST_TOO_LARGE/);
  assert.equal(pulled, false);
});

test("streamed oversized input is cancelled at the application boundary", async () => {
  let pull = 0;
  let cancelled = false;
  const chunks = [new Uint8Array(8_000), new Uint8Array(9_000)];
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[pull];
      pull += 1;
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    readJsonObject(streamRequest(stream)),
    /REQUEST_TOO_LARGE/,
  );
  assert.equal(cancelled, true);
  assert.equal(pull, 2);
});

test("UTF-8 bytes, not JavaScript character count, enforce the limit", async () => {
  const exact = JSON.stringify({ x: "é".repeat(8_188) });
  assert.equal(Buffer.byteLength(exact), 16_384);
  await readJsonObject(jsonRequest(exact));

  const oversized = JSON.stringify({ x: "é".repeat(8_189) });
  await assert.rejects(
    readJsonObject(jsonRequest(oversized)),
    /REQUEST_TOO_LARGE/,
  );
});

function jsonRequest(body: string): Request {
  return new Request("https://private.example.com/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function streamRequest(
  body: ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
): Request {
  return new Request("https://private.example.com/api/test", {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}
