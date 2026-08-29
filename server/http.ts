const sessionCookie = "trace_demo_session";
const sessionPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface DemoSession {
  id: string;
  isNew: boolean;
}

export function resolveDemoSession(request: Request): DemoSession {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const current = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookie}=`))
    ?.slice(sessionCookie.length + 1);

  if (current && sessionPattern.test(current)) {
    return { id: current, isNew: false };
  }
  return { id: crypto.randomUUID(), isNew: true };
}

export function jsonResponse(
  request: Request,
  session: DemoSession,
  data: unknown,
  status = 200,
): Response {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  if (session.isNew) {
    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    headers.append(
      "set-cookie",
      `${sessionCookie}=${session.id}; Path=/; Max-Age=86400; HttpOnly; SameSite=Strict${secure}`,
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
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) {
    throw new Error("REQUEST_TOO_LARGE");
  }
  const parsed: unknown = JSON.parse(body);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("INVALID_JSON_OBJECT");
  }
  return parsed as Record<string, unknown>;
}
