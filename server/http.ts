import {
  principalSessionId,
  type RequestPrincipal,
} from "@/server/request-auth";

const secureSessionCookie = "__Host-watchfloor_session";
const localSessionCookie = "watchfloor_session";

export interface DemoSession {
  cookieName: string;
  id: string;
  isNew: boolean;
}

export async function resolveDemoSession(
  request: Request,
  principal: RequestPrincipal,
): Promise<DemoSession> {
  const id = await principalSessionId(principal);
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

  return { cookieName, id, isNew: current !== id };
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
    "permissions-policy":
      "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  if (session?.isNew) {
    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    headers.append(
      "set-cookie",
      `${session.cookieName}=${session.id}; Path=/; Max-Age=28800; HttpOnly; SameSite=Strict${secure}`,
    );
  }
  return new Response(JSON.stringify(data), { headers, status });
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
