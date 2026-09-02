export interface RuntimeSmokeConfig {
  baseUrl: URL;
  authorization: string | null;
}

type Environment = Readonly<Record<string, string | undefined>>;

export function resolveRuntimeSmokeConfig(
  environment: Environment,
): RuntimeSmokeConfig {
  const baseUrl = parseHttpUrl(
    environment.TRACE_BASE_URL ?? "http://localhost:3000",
    "TRACE_BASE_URL",
  );
  const authorization = readAuthorization(environment);

  requireOriginOnly(baseUrl, "TRACE_BASE_URL");

  if (authorization === null) {
    validateUnauthenticatedTarget(baseUrl);
    return { baseUrl, authorization: null };
  }

  const trustedOriginValue = environment.TRACE_TRUSTED_ORIGIN;
  if (!trustedOriginValue) {
    throw new Error(
      "TRACE_TRUSTED_ORIGIN is required when TRACE_AUTH_HEADER is set.",
    );
  }
  const trustedOrigin = parseHttpUrl(
    trustedOriginValue,
    "TRACE_TRUSTED_ORIGIN",
  );
  if (
    trustedOrigin.protocol !== "https:" ||
    trustedOrigin.pathname !== "/" ||
    trustedOrigin.search ||
    trustedOrigin.hash
  ) {
    throw new Error(
      "TRACE_TRUSTED_ORIGIN must be an HTTPS origin without a path, query, or fragment.",
    );
  }
  if (baseUrl.protocol !== "https:") {
    throw new Error("TRACE_BASE_URL must use HTTPS when credentials are set.");
  }
  if (baseUrl.origin !== trustedOrigin.origin) {
    throw new Error(
      "TRACE_BASE_URL origin must exactly match TRACE_TRUSTED_ORIGIN when credentials are set.",
    );
  }

  return { baseUrl, authorization };
}

function requireOriginOnly(url: URL, variableName: string): void {
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      `${variableName} must be an origin without a path, query, or fragment.`,
    );
  }
}

function validateUnauthenticatedTarget(url: URL): void {
  const hostname = normalizedHostname(url);
  if (isLoopbackHostname(hostname)) return;
  if (url.protocol !== "https:") {
    throw new Error(
      "Remote TRACE_BASE_URL targets must use HTTPS; HTTP is allowed only for loopback development.",
    );
  }
  if (isNonPublicHost(hostname)) {
    throw new Error(
      "TRACE_BASE_URL must not target a private, link-local, multicast, or reserved address.",
    );
  }
}

function normalizedHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (isIP(hostname) === 4) return Number(hostname.split(".")[0]) === 127;
  return hostname === "::1";
}

function isNonPublicHost(hostname: string): boolean {
  if (
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home.arpa")
  ) {
    return true;
  }
  const addressFamily = isIP(hostname);
  if (addressFamily === 4) return isNonPublicIpv4(hostname);
  if (addressFamily === 6) return isNonPublicIpv6(hostname);
  return false;
}

function isNonPublicIpv4(hostname: string): boolean {
  const [a = 0, b = 0] = hostname.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isNonPublicIpv6(hostname: string): boolean {
  const value = hostname.toLowerCase();
  return (
    value === "::" ||
    value === "::1" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    /^fe[89ab]/.test(value) ||
    value.startsWith("ff") ||
    value.startsWith("2001:db8:")
  );
}

function readAuthorization(environment: Environment): string | null {
  const configured = environment.TRACE_AUTH_HEADER;
  const legacy = environment.TRACE_SITES_AUTHORIZATION;
  if (configured && legacy) {
    throw new Error(
      "Set only one of TRACE_AUTH_HEADER or TRACE_SITES_AUTHORIZATION.",
    );
  }
  return configured || legacy || null;
}

function parseHttpUrl(value: string, variableName: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variableName} must be an absolute HTTP(S) URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${variableName} must be an absolute HTTP(S) URL.`);
  }
  if (url.username || url.password) {
    throw new Error(`${variableName} must not contain URL credentials.`);
  }
  return url;
}
import { isIP } from "node:net";
