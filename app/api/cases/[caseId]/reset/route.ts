import { getCaseFixture } from "@/domain/scenarios";
import { resetCase } from "@/server/case-store";
import { jsonResponse, resolveDemoSession } from "@/server/http";

interface RouteContext {
  params: Promise<{ caseId: string }>;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { caseId } = await context.params;
  const fixture = getCaseFixture(caseId);
  const session = resolveDemoSession(request);
  if (!fixture) {
    return jsonResponse(
      request,
      session,
      { error: { code: "CASE_NOT_FOUND", message: "Case was not found." } },
      404,
    );
  }

  try {
    const snapshot = await resetCase(session.id, fixture);
    return jsonResponse(request, session, { snapshot });
  } catch {
    return jsonResponse(
      request,
      session,
      {
        error: {
          code: "RESET_UNAVAILABLE",
          message: "The demo could not be reset.",
        },
      },
      503,
    );
  }
}
