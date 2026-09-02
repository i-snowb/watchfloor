import assert from "node:assert/strict";
import test from "node:test";
import { resolveRuntimeSmokeConfig } from "../scripts/runtime-smoke-config";

test("runtime smoke permits unauthenticated localhost execution", () => {
  const config = resolveRuntimeSmokeConfig({
    TRACE_BASE_URL: "http://localhost:3000",
  });
  assert.equal(config.baseUrl.origin, "http://localhost:3000");
  assert.equal(config.authorization, null);
});

test("runtime smoke requires an exact HTTPS trusted origin for credentials", () => {
  const base = { TRACE_AUTH_HEADER: "credential-value" };
  assert.throws(
    () => resolveRuntimeSmokeConfig(base),
    /TRACE_TRUSTED_ORIGIN is required/,
  );
  assert.throws(
    () =>
      resolveRuntimeSmokeConfig({
        ...base,
        TRACE_BASE_URL: "http://localhost:3000",
        TRACE_TRUSTED_ORIGIN: "https://trusted.example",
      }),
    /TRACE_BASE_URL must use HTTPS/,
  );
  assert.throws(
    () =>
      resolveRuntimeSmokeConfig({
        ...base,
        TRACE_BASE_URL: "https://other.example",
        TRACE_TRUSTED_ORIGIN: "https://trusted.example",
      }),
    /must exactly match/,
  );
  assert.throws(
    () =>
      resolveRuntimeSmokeConfig({
        ...base,
        TRACE_BASE_URL: "https://trusted.example",
        TRACE_TRUSTED_ORIGIN: "https://trusted.example/api",
      }),
    /must be an HTTPS origin/,
  );
});

test("runtime smoke accepts credentials only for the configured trusted origin", () => {
  const config = resolveRuntimeSmokeConfig({
    TRACE_AUTH_HEADER: "credential-value",
    TRACE_BASE_URL: "https://trusted.example/",
    TRACE_TRUSTED_ORIGIN: "https://trusted.example",
  });
  assert.equal(config.baseUrl.origin, "https://trusted.example");
  assert.equal(config.authorization, "credential-value");
});
