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

  if (authorization === null) {
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
