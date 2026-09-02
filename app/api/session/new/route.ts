import { env } from "cloudflare:workers";
import {
  jsonResponse,
  createFreshAnonymousSession,
  resolveDemoSession,
} from "@/server/http";
import { authenticateRequest } from "@/server/request-auth";
import { enforcePublicMutationRateLimits } from "@/server/request-limits";
import { requireMutationIntent } from "@/server/request-security";

export async function POST(request: Request): Promise<Response> {
  const mutationIntent = requireMutationIntent(request);
  if (!mutationIntent.ok) {
    return jsonResponse(
      request,
      null,
      { error: { code: mutationIntent.code, message: mutationIntent.message } },
      403,
    );
  }

  const authentication = await authenticateRequest(request, env);
  if (!authentication.ok) {
    return jsonResponse(
      request,
      null,
      {
        error: {
          code: authentication.code,
          message: authentication.message,
        },
      },
      authentication.status,
    );
  }
  if (authentication.principal.assurance !== "anonymous_sandbox") {
    return jsonResponse(
      request,
      null,
      {
        error: {
          code: "SESSION_RENEWAL_UNAVAILABLE",
          message:
            "Fresh sessions are available only in the anonymous public sandbox.",
        },
      },
      403,
    );
  }

  // Apply the existing edge limits to this state-changing session operation.
  // The IP key remains stable even though the browser session identity changes.
  const currentSession = await resolveDemoSession(
    request,
    authentication.principal,
  );
  const rateLimit = await enforcePublicMutationRateLimits(
    request,
    currentSession,
    authentication.principal,
    env,
  );
  if (!rateLimit.ok) {
    const response = jsonResponse(
      request,
      currentSession,
      { error: { code: rateLimit.code, message: rateLimit.message } },
      rateLimit.status,
    );
    if (rateLimit.retryAfterSeconds) {
      response.headers.set("retry-after", String(rateLimit.retryAfterSeconds));
    }
    return response;
  }

  const freshSession = await createFreshAnonymousSession(
    request,
    authentication.principal,
  );
  if (!freshSession) {
    return jsonResponse(
      request,
      null,
      {
        error: {
          code: "SESSION_RENEWAL_UNAVAILABLE",
          message: "Fresh session unavailable.",
        },
      },
      403,
    );
  }
  return jsonResponse(request, freshSession, {
    session: {
      mode: "anonymous_sandbox",
      maxAgeSeconds: freshSession.maxAgeSeconds,
      message:
        "A fresh isolated sandbox session is ready. The prior session was not deleted.",
    },
  });
}
