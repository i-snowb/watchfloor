import type { CaseApiResponse, ToolApiResponse } from "@/domain/api";
import type { CaseToolName, ToolSurface } from "@/domain/operations";
import {
  mutationIntentHeader,
  mutationIntentValue,
} from "@/server/request-security";

export async function loadCase(
  caseId: string,
  signal?: AbortSignal,
): Promise<CaseApiResponse> {
  return requestJson<CaseApiResponse>(
    `/api/cases/${encodeURIComponent(caseId)}`,
    {
      method: "GET",
      ...(signal ? { signal } : {}),
    },
  );
}

export async function executeTool(
  caseId: string,
  toolName: CaseToolName,
  reportedSurface: ToolSurface,
  input: Record<string, unknown>,
  requestId = `ui-${crypto.randomUUID()}`,
  signal?: AbortSignal,
): Promise<ToolApiResponse> {
  const channel =
    reportedSurface === "analyst_control" ? "analyst-operations" : "operations";
  const url = `/api/cases/${encodeURIComponent(caseId)}/${channel}`;
  const init: RequestInit = {
    method: "POST",
    body: JSON.stringify({ requestId, toolName, input }),
    headers: {
      "content-type": "application/json",
      [mutationIntentHeader]: mutationIntentValue,
    },
    ...(signal ? { signal } : {}),
  };

  try {
    return await requestJson<ToolApiResponse>(url, init);
  } catch (error) {
    if (signal?.aborted || isAbortError(error) || error instanceof HttpError) {
      throw error;
    }
    return requestJson<ToolApiResponse>(url, init);
  }
}

export async function resetCase(
  caseId: string,
  expectedRevision: number,
): Promise<CaseApiResponse> {
  return requestJson<CaseApiResponse>(
    `/api/cases/${encodeURIComponent(caseId)}/reset`,
    {
      method: "POST",
      body: JSON.stringify({
        requestId: `reset-${crypto.randomUUID()}`,
        expectedRevision,
      }),
      headers: {
        "content-type": "application/json",
        [mutationIntentHeader]: mutationIntentValue,
      },
    },
  );
}

export async function startFreshSandboxSession(): Promise<void> {
  await requestJson<{ session: { mode: string } }>("/api/session/new", {
    method: "POST",
    headers: {
      [mutationIntentHeader]: mutationIntentValue,
    },
  });
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: { accept: "application/json", ...init.headers },
  });
  const data = await readJsonBody(response);
  if (!response.ok) {
    const message =
      readErrorMessage(data) ?? fallbackErrorMessage(response.status);
    throw new HttpError(message);
  }
  if (data === null) {
    throw new HttpError("The service returned an invalid response.");
  }
  return data as T;
}

class HttpError extends Error {}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function readJsonBody(response: Response): Promise<unknown | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function fallbackErrorMessage(status: number): string {
  if (status === 429) {
    return "The public sandbox is temporarily limited. Try again shortly.";
  }
  if (status >= 500) {
    return "The case service is temporarily unavailable. Try again shortly.";
  }
  return `The request could not be completed (${status}).`;
}

function readErrorMessage(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  const error = (value as { error?: unknown }).error;
  if (error === null || typeof error !== "object") return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}
