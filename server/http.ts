import {
  principalSessionId,
  type RequestPrincipal,
} from "@/server/request-auth";

const secureSessionCookie = "__Host-watchfloor_session";
const localSessionCookie = "watchfloor_session";

export interface DemoSession {
  cookieName: string;
  cookieValue: string;
  id: string;
  isNew: boolean;
  maxAgeSeconds: number;
}

export async function resolveDemoSession(
  request: Request,
  principal: RequestPrincipal,
): Promise<DemoSession> {
  const cookieName =
    new URL(request.url).protocol === "https:"
      ? secureSessionCookie
      : localSessionCookie;
  const cookieHeader = request.headers.get("cookie") ?? "";
  const current = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);

  if (principal.assurance === "anonymous_sandbox") {
    const cookieValue = isAnonymousSessionToken(current)
      ? current
      : createAnonymousSessionToken();
    return {
      cookieName,
      cookieValue,
      id: await anonymousSessionId(cookieValue),
      isNew: current !== cookieValue,
      maxAgeSeconds: 86_400,
    };
  }

  const id = await principalSessionId(principal);
  return {
    cookieName,
    cookieValue: id,
    id,
    isNew: current !== id,
    maxAgeSeconds: 28_800,
  };
}

/**
 * Issue a new anonymous sandbox identity without deleting the previous
 * session. This is intentionally unavailable to authenticated deployments,
 * whose session identity is derived from the verified principal.
 */
export async function createFreshAnonymousSession(
  request: Request,
  principal: RequestPrincipal,
): Promise<DemoSession | null> {
  if (principal.assurance !== "anonymous_sandbox") return null;
  const cookieValue = createAnonymousSessionToken();
  return {
    cookieName:
      new URL(request.url).protocol === "https:"
        ? secureSessionCookie
        : localSessionCookie,
    cookieValue,
    id: await anonymousSessionId(cookieValue),
    isNew: true,
    maxAgeSeconds: 86_400,
  };
}

export function jsonResponse(
  request: Request,
  session: DemoSession | null,
  data: unknown,
  status = 200,
): Response {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-security-policy": "frame-ancestors 'none'",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "origin-agent-cluster": "?1",
    "permissions-policy":
      "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    "referrer-policy": "no-referrer",
    "strict-transport-security": "max-age=31536000",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-permitted-cross-domain-policies": "none",
  });
  if (session?.isNew) {
    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    headers.append(
      "set-cookie",
      `${session.cookieName}=${session.cookieValue}; Path=/; Max-Age=${session.maxAgeSeconds}; HttpOnly; SameSite=Strict${secure}`,
    );
  }
  return new Response(JSON.stringify(data), { headers, status });
}

function createAnonymousSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function isAnonymousSessionToken(value: string | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

async function anonymousSessionId(token: string): Promise<string> {
  const material = new TextEncoder().encode(
    `watchfloor-anonymous-session-v1\u0000${token}`,
  );
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", material),
  );
  return `anon_${[...digest]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

export async function readJsonObject(
  request: Request,
  maxBytes = 16_384,
): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("REQUEST_TOO_LARGE");
  }
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  const reader = request.body?.getReader();
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel("REQUEST_TOO_LARGE");
        throw new Error("REQUEST_TOO_LARGE");
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const parsed: unknown = JSON.parse(body);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("INVALID_JSON_OBJECT");
  }
  return parsed as Record<string, unknown>;
}
