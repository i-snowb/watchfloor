import assert from "node:assert/strict";
import test from "node:test";
import {
  createFreshAnonymousSession,
  resolveDemoSession,
} from "../server/http";
import {
  authenticateRequest,
  principalSessionId,
  type AccessBindings,
} from "../server/request-auth";

const now = 1_800_000_000;
const bindings: AccessBindings = {
  WATCHFLOOR_AUTH_MODE: "cloudflare_access",
  WATCHFLOOR_ACCESS_TEAM_DOMAIN: "watchfloor-test.cloudflareaccess.com",
  WATCHFLOOR_ACCESS_AUD: "watchfloor-private-audience",
  WATCHFLOOR_ANALYST_EMAILS: "analyst@example.com, reviewer@example.com",
};
const signerPromise = createSigner();

test("loopback development is explicit and produces a stable server session", async () => {
  const request = new Request("http://localhost:3000/api/cases/example");
  const denied = await authenticateRequest(request, {});
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.status, 503);

  const result = await authenticateRequest(request, {
    WATCHFLOOR_AUTH_MODE: "local",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.principal.assurance, "local_development");

  const expectedId = await principalSessionId(result.principal);
  const first = await resolveDemoSession(request, result.principal);
  assert.equal(first.id, expectedId);
  assert.equal(first.isNew, true);
  assert.equal(first.cookieName, "watchfloor_session");

  const forged = await resolveDemoSession(
    new Request(request.url, {
      headers: {
        cookie: "watchfloor_session=00000000-0000-4000-8000-000000000000",
      },
    }),
    result.principal,
  );
  assert.equal(forged.id, expectedId);
  assert.equal(forged.isNew, true);

  const returning = await resolveDemoSession(
    new Request(request.url, {
      headers: { cookie: `watchfloor_session=${expectedId}` },
    }),
    result.principal,
  );
  assert.equal(returning.isNew, false);
});

test("anonymous session recovery rotates only the browser session identity", async () => {
  const request = new Request("https://public.example/api/session/new");
  const authentication = await authenticateRequest(request, {
    WATCHFLOOR_AUTH_MODE: "anonymous_sandbox",
  });
  assert.equal(authentication.ok, true);
  if (!authentication.ok) return;

  const initial = await resolveDemoSession(request, authentication.principal);
  const fresh = await createFreshAnonymousSession(
    request,
    authentication.principal,
  );
  assert.ok(fresh);
  assert.equal(fresh.cookieName, "__Host-watchfloor_session");
  assert.equal(fresh.isNew, true);
  assert.equal(fresh.maxAgeSeconds, 86_400);
  assert.notEqual(fresh.cookieValue, initial.cookieValue);
  assert.notEqual(fresh.id, initial.id);

  const localAuthentication = await authenticateRequest(
    new Request("http://localhost:3000/api/session/new"),
    { WATCHFLOOR_AUTH_MODE: "local" },
  );
  assert.equal(localAuthentication.ok, true);
  if (!localAuthentication.ok) return;
  assert.equal(
    await createFreshAnonymousSession(request, localAuthentication.principal),
    null,
  );
});

test("local mode still rejects a non-loopback request and HTTPS host spoof", async () => {
  const bindings: AccessBindings = { WATCHFLOOR_AUTH_MODE: "local" };
  const remote = await authenticateRequest(
    new Request("http://private.example.com/api/cases/example"),
    bindings,
  );
  assert.equal(remote.ok, false);
  if (!remote.ok) assert.equal(remote.status, 503);

  const spoofed = await authenticateRequest(
    new Request("https://localhost/api/cases/example"),
    bindings,
  );
  assert.equal(spoofed.ok, false);
  if (!spoofed.ok) assert.equal(spoofed.status, 503);
});

test("OpenAI Sites mode requires the dispatcher identity headers", async () => {
  const sitesBindings: AccessBindings = {
    WATCHFLOOR_AUTH_MODE: "openai_sites",
  };
  const missing = await authenticateRequest(
    new Request("https://watchfloor.example/api/cases/example"),
    sitesBindings,
  );
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.status, 401);

  const result = await authenticateRequest(
    new Request("https://watchfloor.example/api/cases/example", {
      headers: {
        "oai-authenticated-user-id": "site-user-123",
        "oai-authenticated-user-email": "Analyst@Example.com",
      },
    }),
    sitesBindings,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.principal.subject, "site-user-123");
  assert.equal(result.principal.email, "analyst@example.com");
  assert.equal(result.principal.assurance, "openai_sites_authenticated");
});

test("anonymous sandbox issues opaque isolated browser sessions", async () => {
  const request = new Request("https://public.example/api/cases/example");
  const result = await authenticateRequest(request, {
    WATCHFLOOR_AUTH_MODE: "anonymous_sandbox",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.principal.role, "sandbox_analyst");
  assert.equal(result.principal.assurance, "anonymous_sandbox");

  const first = await resolveDemoSession(request, result.principal);
  const second = await resolveDemoSession(request, result.principal);
  assert.match(first.cookieValue, /^[A-Za-z0-9_-]{43}$/);
  assert.match(first.id, /^anon_[0-9a-f]{64}$/);
  assert.notEqual(first.cookieValue, first.id);
  assert.notEqual(first.id, second.id);
  assert.equal(first.maxAgeSeconds, 86_400);

  const returning = await resolveDemoSession(
    new Request(request.url, {
      headers: { cookie: `${first.cookieName}=${first.cookieValue}` },
    }),
    result.principal,
  );
  assert.equal(returning.id, first.id);
  assert.equal(returning.isNew, false);

  const rotated = await resolveDemoSession(
    new Request(request.url, {
      headers: { cookie: `${first.cookieName}=caller-selected-session` },
    }),
    result.principal,
  );
  assert.notEqual(rotated.id, first.id);
  assert.equal(rotated.isNew, true);
});

test("anonymous sandbox is HTTPS-only", async () => {
  const result = await authenticateRequest(
    new Request("http://public.example/api/cases/example"),
    { WATCHFLOOR_AUTH_MODE: "anonymous_sandbox" },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 503);
});

test("remote requests fail closed when Cloudflare Access is not configured", async () => {
  const result = await authenticateRequest(
    new Request("https://private.example.com/api/cases/example"),
    {},
  );
  assert.deepEqual(result, {
    ok: false,
    status: 503,
    code: "ACCESS_NOT_CONFIGURED",
    message: "Private access is not configured for this deployment.",
  });
});

test("a valid Cloudflare Access JWT establishes the allowlisted analyst", async () => {
  const signer = await signerPromise;
  const token = await signer.token({ email: "Analyst@Example.com" });
  const result = await authenticateRequest(
    new Request("https://private.example.com/api/cases/example", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    }),
    bindings,
    { fetcher: signer.fetcher, nowSeconds: now },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.principal.email, "analyst@example.com");
  assert.equal(result.principal.assurance, "cloudflare_access_verified");
  assert.equal(result.principal.role, "analyst");

  const first = await principalSessionId(result.principal);
  const second = await principalSessionId(result.principal);
  assert.equal(first, second);
});

test("session isolation includes the authenticated subject", async () => {
  const principal = {
    subject: "access-user-123",
    email: "analyst@example.com",
    issuer: "https://watchfloor-test.cloudflareaccess.com",
    audience: "watchfloor-private-audience",
    assurance: "cloudflare_access_verified" as const,
    role: "analyst" as const,
  };
  const first = await principalSessionId(principal);
  const second = await principalSessionId({
    ...principal,
    subject: "access-user-456",
  });
  assert.notEqual(first, second);
});

test("Access validation rejects a wrong audience, non-allowlisted email, and tampering", async () => {
  const signer = await signerPromise;
  const wrongAudience = await signer.token({ aud: "other-audience" });
  const audienceResult = await authenticateRequest(
    remoteRequest(wrongAudience),
    bindings,
    { fetcher: signer.fetcher, nowSeconds: now },
  );
  assert.equal(audienceResult.ok, false);
  if (!audienceResult.ok) assert.equal(audienceResult.status, 401);

  const outsider = await signer.token({ email: "outsider@example.com" });
  const outsiderResult = await authenticateRequest(
    remoteRequest(outsider),
    bindings,
    { fetcher: signer.fetcher, nowSeconds: now },
  );
  assert.equal(outsiderResult.ok, false);
  if (!outsiderResult.ok) assert.equal(outsiderResult.status, 403);

  const valid = await signer.token();
  const [header, payload, signature] = valid.split(".");
  assert.ok(header && payload && signature);
  const tamperedSignature = `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
  const tampered = `${header}.${payload}.${tamperedSignature}`;
  const tamperedResult = await authenticateRequest(
    remoteRequest(tampered),
    bindings,
    { fetcher: signer.fetcher, nowSeconds: now },
  );
  assert.equal(tamperedResult.ok, false);
  if (!tamperedResult.ok) assert.equal(tamperedResult.status, 401);
});

function remoteRequest(token: string): Request {
  return new Request("https://private.example.com/api/cases/example", {
    headers: { "Cf-Access-Jwt-Assertion": token },
  });
}

async function createSigner(): Promise<{
  fetcher: typeof fetch;
  token: (overrides?: Record<string, unknown>) => Promise<string>;
}> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const jwk = { ...publicJwk, alg: "RS256", kid: "watchfloor-test-key" };
  return {
    fetcher: async () => Response.json({ keys: [jwk] }),
    token: async (overrides = {}) => {
      const header = encodeJson({ alg: "RS256", kid: jwk.kid, typ: "JWT" });
      const payload = encodeJson({
        aud: bindings.WATCHFLOOR_ACCESS_AUD,
        email: "analyst@example.com",
        exp: now + 300,
        iat: now - 10,
        iss: `https://${bindings.WATCHFLOOR_ACCESS_TEAM_DOMAIN}`,
        sub: "access-user-123",
        ...overrides,
      });
      const signingInput = `${header}.${payload}`;
      const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        keyPair.privateKey,
        new TextEncoder().encode(signingInput),
      );
      return `${signingInput}.${Buffer.from(signature).toString("base64url")}`;
    },
  };
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
