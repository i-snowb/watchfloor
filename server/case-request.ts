import { env } from "cloudflare:workers";
import {
  jsonResponse,
  resolveDemoSession,
  type DemoSession,
} from "@/server/http";
import {
  authenticateRequest,
  type RequestPrincipal,
} from "@/server/request-auth";

export type CaseRequestAuthorization =
  | {
      ok: true;
      principal: RequestPrincipal;
      session: DemoSession;
    }
  | { ok: false; response: Response };

export async function authorizeCaseRequest(
  request: Request,
): Promise<CaseRequestAuthorization> {
  const authentication = await authenticateRequest(request, env);
  if (!authentication.ok) {
    return {
      ok: false,
      response: jsonResponse(
        request,
        null,
        {
          error: {
            code: authentication.code,
            message: authentication.message,
          },
        },
        authentication.status,
      ),
    };
  }
  return {
    ok: true,
    principal: authentication.principal,
    session: await resolveDemoSession(request, authentication.principal),
  };
}
