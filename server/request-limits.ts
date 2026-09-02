import type { DemoSession } from "@/server/http";
import type { RequestPrincipal } from "@/server/request-auth";

interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface PublicRateLimitBindings {
  WATCHFLOOR_IP_LIMITER?: RateLimitBinding;
  WATCHFLOOR_SESSION_LIMITER?: RateLimitBinding;
}

export type MutationRateLimitResult =
  | { ok: true }
  | {
      ok: false;
      status: 429 | 503;
      code: "RATE_LIMITED" | "RATE_LIMIT_NOT_CONFIGURED";
      message: string;
      retryAfterSeconds?: number;
    };

export async function enforcePublicMutationRateLimits(
  request: Request,
  session: DemoSession,
  principal: RequestPrincipal,
  bindings: PublicRateLimitBindings,
): Promise<MutationRateLimitResult> {
  if (principal.assurance !== "anonymous_sandbox") return { ok: true };
  const ipLimiter = bindings.WATCHFLOOR_IP_LIMITER;
  const sessionLimiter = bindings.WATCHFLOOR_SESSION_LIMITER;
  const clientAddress = readCloudflareClientAddress(request);
  if (!ipLimiter || !sessionLimiter || !clientAddress) {
    return {
      ok: false,
      status: 503,
      code: "RATE_LIMIT_NOT_CONFIGURED",
      message: "The public sandbox limit is unavailable.",
    };
  }
  try {
    const [ip, browserSession] = await Promise.all([
      ipLimiter.limit({ key: `ip:${clientAddress}` }),
      sessionLimiter.limit({ key: `session:${session.id}` }),
    ]);
    if (!ip.success || !browserSession.success) {
      return {
        ok: false,
        status: 429,
        code: "RATE_LIMITED",
        message:
          "The public sandbox action limit was reached. Try again shortly.",
        retryAfterSeconds: 60,
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      status: 503,
      code: "RATE_LIMIT_NOT_CONFIGURED",
      message: "The public sandbox limit is unavailable.",
    };
  }
}

function readCloudflareClientAddress(request: Request): string | null {
  const value = request.headers.get("cf-connecting-ip")?.trim();
  if (!value || value.length > 64 || !/^[0-9A-Fa-f:.]+$/.test(value)) {
    return null;
  }
  return value.toLowerCase();
}
