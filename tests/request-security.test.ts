import assert from "node:assert/strict";
import test from "node:test";
import { enforcePublicMutationRateLimits } from "../server/request-limits";
import {
  mutationIntentHeader,
  mutationIntentValue,
  requireMutationIntent,
} from "../server/request-security";

test("mutation intent requires the exact same origin and custom header", () => {
  const valid = mutationRequest();
  assert.deepEqual(requireMutationIntent(valid), { ok: true });

  for (const request of [
    mutationRequest({ origin: "https://attacker.example" }),
    mutationRequest({ origin: "null" }),
    mutationRequest({ intent: "wrong" }),
    mutationRequest({ fetchSite: "cross-site" }),
  ]) {
    const result = requireMutationIntent(request);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "MUTATION_INTENT_REQUIRED");
  }
});

test("public mutation rate limits use both edge keys and fail closed", async () => {
  const keys: string[] = [];
  const limiter = {
    limit: async ({ key }: { key: string }) => {
      keys.push(key);
      return { success: true };
    },
  };
  const result = await enforcePublicMutationRateLimits(
    mutationRequest({ clientAddress: "203.0.113.10" }),
    {
      cookieName: "__Host-watchfloor_session",
      cookieValue: "a".repeat(43),
      id: `anon_${"b".repeat(64)}`,
      isNew: false,
      maxAgeSeconds: 86_400,
    },
    {
      subject: "anonymous-browser",
      email: "anonymous@watchfloor.invalid",
      issuer: "watchfloor-public-sandbox",
      audience: "watchfloor-public-sandbox",
      assurance: "anonymous_sandbox",
      role: "sandbox_analyst",
    },
    {
      WATCHFLOOR_IP_LIMITER: limiter,
      WATCHFLOOR_SESSION_LIMITER: limiter,
    },
  );
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(keys, ["ip:203.0.113.10", `session:anon_${"b".repeat(64)}`]);

  const missing = await enforcePublicMutationRateLimits(
    mutationRequest(),
    {
      cookieName: "__Host-watchfloor_session",
      cookieValue: "a".repeat(43),
      id: `anon_${"b".repeat(64)}`,
      isNew: true,
      maxAgeSeconds: 86_400,
    },
    {
      subject: "anonymous-browser",
      email: "anonymous@watchfloor.invalid",
      issuer: "watchfloor-public-sandbox",
      audience: "watchfloor-public-sandbox",
      assurance: "anonymous_sandbox",
      role: "sandbox_analyst",
    },
    {},
  );
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.status, 503);
});

function mutationRequest(
  overrides: {
    clientAddress?: string;
    fetchSite?: string;
    intent?: string;
    origin?: string;
  } = {},
): Request {
  return new Request("https://public.example/api/cases/example/operations", {
    method: "POST",
    headers: {
      "cf-connecting-ip": overrides.clientAddress ?? "203.0.113.7",
      "content-type": "application/json",
      origin: overrides.origin ?? "https://public.example",
      [mutationIntentHeader]: overrides.intent ?? mutationIntentValue,
      "sec-fetch-site": overrides.fetchSite ?? "same-origin",
    },
    body: "{}",
  });
}
