const accessTokenHeader = "cf-access-jwt-assertion";
const maxAccessTokenBytes = 16_384;
const maxJwksBytes = 65_536;
const maxAnalystEmails = 32;
const clockSkewSeconds = 30;
const jwksCacheTtlMs = 5 * 60 * 1_000;
const jwksFetchTimeoutMs = 3_000;

type AuthenticationMode = "cloudflare_access" | "local" | "openai_sites";

export interface AccessBindings {
  WATCHFLOOR_AUTH_MODE?: AuthenticationMode | string;
  WATCHFLOOR_ACCESS_TEAM_DOMAIN?: string;
  WATCHFLOOR_ACCESS_AUD?: string;
  WATCHFLOOR_ANALYST_EMAILS?: string;
}

export interface RequestPrincipal {
  subject: string;
  email: string;
  issuer: string;
  audience: string;
  assurance:
    | "cloudflare_access_verified"
    | "local_development"
    | "openai_sites_authenticated";
  role: "analyst";
}

export type AuthenticationResult =
  | { ok: true; principal: RequestPrincipal }
  | {
      ok: false;
      status: 401 | 403 | 503;
      code:
        "AUTHENTICATION_REQUIRED" | "ACCESS_DENIED" | "ACCESS_NOT_CONFIGURED";
      message: string;
    };

interface AccessClaims {
  aud: string | string[];
  email: string;
  exp: number;
  iat?: number;
  iss: string;
  nbf?: number;
  sub: string;
}

interface AccessJwk extends JsonWebKey {
  alg?: string;
  kid: string;
  kty: string;
}

interface JwksDocument {
  keys: AccessJwk[];
}

interface CachedJwks {
  expiresAt: number;
  keys: AccessJwk[];
}

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const jwksCache = new Map<string, CachedJwks>();

export async function authenticateRequest(
  request: Request,
  bindings: AccessBindings,
  options: { fetcher?: Fetcher; nowSeconds?: number } = {},
): Promise<AuthenticationResult> {
  const mode = bindings.WATCHFLOOR_AUTH_MODE?.trim();

  if (mode === "local" && isLoopbackRequest(request)) {
    return {
      ok: true,
      principal: {
        subject: "local-development",
        email: "local@watchfloor.invalid",
        issuer: "local-development",
        audience: "local-development",
        assurance: "local_development",
        role: "analyst",
      },
    };
  }

  if (mode === "openai_sites") {
    return authenticateOpenAiSitesRequest(request);
  }

  if (mode !== "cloudflare_access") {
    return accessNotConfigured();
  }

  const config = readAccessConfig(bindings);
  if (!config) {
    return accessNotConfigured();
  }

  const token = request.headers.get(accessTokenHeader);
  if (!token) {
    return {
      ok: false,
      status: 401,
      code: "AUTHENTICATION_REQUIRED",
      message: "Cloudflare Access authentication is required.",
    };
  }

  try {
    const claims = await verifyAccessToken(token, config, {
      ...(options.fetcher ? { fetcher: options.fetcher } : {}),
      ...(options.nowSeconds !== undefined
        ? { nowSeconds: options.nowSeconds }
        : {}),
    });
    const email = claims.email.trim().toLowerCase();
    if (!config.analystEmails.has(email)) {
      return {
        ok: false,
        status: 403,
        code: "ACCESS_DENIED",
        message: "This identity is not authorized for analyst access.",
      };
    }
    return {
      ok: true,
      principal: {
        subject: claims.sub,
        email,
        issuer: config.issuer,
        audience: config.audience,
        assurance: "cloudflare_access_verified",
        role: "analyst",
      },
    };
  } catch {
    return {
      ok: false,
      status: 401,
      code: "AUTHENTICATION_REQUIRED",
      message: "Cloudflare Access authentication is required.",
    };
  }
}

export async function principalSessionId(
  principal: RequestPrincipal,
): Promise<string> {
  const material = new TextEncoder().encode(
    `${principal.issuer}\u0000${principal.audience}\u0000${principal.subject}\u0000${principal.email}`,
  );
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", material),
  );
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function authenticateOpenAiSitesRequest(
  request: Request,
): AuthenticationResult {
  if (new URL(request.url).protocol !== "https:") {
    return {
      ok: false,
      status: 401,
      code: "AUTHENTICATION_REQUIRED",
      message: "OpenAI Sites authentication is required.",
    };
  }
  const subject = request.headers.get("oai-authenticated-user-id")?.trim();
  const email = request.headers
    .get("oai-authenticated-user-email")
    ?.trim()
    .toLowerCase();
  if (
    !subject ||
    subject.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(subject) ||
    !email ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return {
      ok: false,
      status: 401,
      code: "AUTHENTICATION_REQUIRED",
      message: "OpenAI Sites authentication is required.",
    };
  }
  return {
    ok: true,
    principal: {
      subject,
      email,
      issuer: "openai-sites",
      audience: "watchfloor-site",
      assurance: "openai_sites_authenticated",
      role: "analyst",
    },
  };
}

function accessNotConfigured(): AuthenticationResult {
  return {
    ok: false,
    status: 503,
    code: "ACCESS_NOT_CONFIGURED",
    message: "Private access is not configured for this deployment.",
  };
}

export function isLoopbackRequest(request: Request): boolean {
  const url = new URL(request.url);
  return (
    url.protocol === "http:" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]" ||
      url.hostname === "::1")
  );
}

interface AccessConfig {
  analystEmails: Set<string>;
  audience: string;
  issuer: string;
}

function readAccessConfig(bindings: AccessBindings): AccessConfig | null {
  const teamDomain =
    bindings.WATCHFLOOR_ACCESS_TEAM_DOMAIN?.trim().toLowerCase();
  const audience = bindings.WATCHFLOOR_ACCESS_AUD?.trim();
  const emailList = bindings.WATCHFLOOR_ANALYST_EMAILS?.trim();
  if (!teamDomain || !audience || !emailList) return null;
  if (
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/.test(
      teamDomain,
    ) ||
    audience.length > 256
  ) {
    return null;
  }
  const emails = emailList
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (
    emails.length === 0 ||
    emails.length > maxAnalystEmails ||
    emails.some(
      (email) =>
        email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    )
  ) {
    return null;
  }
  return {
    analystEmails: new Set(emails),
    audience,
    issuer: `https://${teamDomain}`,
  };
}

async function verifyAccessToken(
  token: string,
  config: AccessConfig,
  options: { fetcher?: Fetcher; nowSeconds?: number },
): Promise<AccessClaims> {
  if (new TextEncoder().encode(token).byteLength > maxAccessTokenBytes) {
    throw new Error("Access token is too large.");
  }
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Access token is malformed.");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error("Access token is malformed.");
  }
  const header = readJsonRecord(
    JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedHeader))),
  );
  const claims = readAccessClaims(
    readJsonRecord(
      JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload))),
    ),
  );
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new Error("Access token algorithm is invalid.");
  }
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const issuer = claims.iss.replace(/\/$/, "");
  if (
    issuer !== config.issuer ||
    !audienceIncludes(claims.aud, config.audience) ||
    claims.exp < now - clockSkewSeconds ||
    (claims.nbf !== undefined && claims.nbf > now + clockSkewSeconds) ||
    (claims.iat !== undefined && claims.iat > now + clockSkewSeconds)
  ) {
    throw new Error("Access token claims are invalid.");
  }
  const keys = await getJwks(config.issuer, options.fetcher ?? fetch);
  let key = keys.find((candidate) => candidate.kid === header.kid);
  if (!key) {
    jwksCache.delete(config.issuer);
    key = (await getJwks(config.issuer, options.fetcher ?? fetch)).find(
      (candidate) => candidate.kid === header.kid,
    );
  }
  if (!key || key.kty !== "RSA" || (key.alg && key.alg !== "RS256")) {
    throw new Error("Access signing key is unavailable.");
  }
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    key,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    Uint8Array.from(decodeBase64Url(encodedSignature)).buffer,
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!verified) throw new Error("Access token signature is invalid.");
  return claims;
}

async function getJwks(issuer: string, fetcher: Fetcher): Promise<AccessJwk[]> {
  const cached = jwksCache.get(issuer);
  if (cached && cached.expiresAt > Date.now()) return cached.keys;
  const response = await fetcher(`${issuer}/cdn-cgi/access/certs`, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(jwksFetchTimeoutMs),
  });
  if (!response.ok) throw new Error("Access signing keys are unavailable.");
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxJwksBytes) {
    throw new Error("Access signing keys response is too large.");
  }
  const parsed = readJsonRecord(JSON.parse(text));
  if (!Array.isArray(parsed.keys)) {
    throw new Error("Access signing keys response is invalid.");
  }
  const document: JwksDocument = {
    keys: parsed.keys.filter(isJsonWebKey),
  };
  if (document.keys.length === 0 || document.keys.length > 32) {
    throw new Error("Access signing keys response is invalid.");
  }
  jwksCache.set(issuer, {
    expiresAt: Date.now() + jwksCacheTtlMs,
    keys: document.keys,
  });
  return document.keys;
}

function readAccessClaims(value: Record<string, unknown>): AccessClaims {
  if (
    (typeof value.aud !== "string" &&
      (!Array.isArray(value.aud) ||
        value.aud.some((entry) => typeof entry !== "string"))) ||
    typeof value.email !== "string" ||
    typeof value.exp !== "number" ||
    typeof value.iss !== "string" ||
    typeof value.sub !== "string" ||
    (value.iat !== undefined && typeof value.iat !== "number") ||
    (value.nbf !== undefined && typeof value.nbf !== "number")
  ) {
    throw new Error("Access token claims are invalid.");
  }
  return value as unknown as AccessClaims;
}

function readJsonRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a JSON object.");
  }
  return value as Record<string, unknown>;
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Base64url value is invalid.");
  }
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function audienceIncludes(
  audience: string | string[],
  expected: string,
): boolean {
  return typeof audience === "string"
    ? audience === expected
    : audience.includes(expected);
}

function isJsonWebKey(value: unknown): value is AccessJwk {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as AccessJwk).kid === "string" &&
    typeof (value as AccessJwk).kty === "string"
  );
}
