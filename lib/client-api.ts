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
  const data: unknown = await response.json();
  if (!response.ok) {
    const message =
      readErrorMessage(data) ?? `Request failed with ${response.status}.`;
    throw new HttpError(message);
  }
  return data as T;
}

class HttpError extends Error {}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function readErrorMessage(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  const error = (value as { error?: unknown }).error;
  if (error === null || typeof error !== "object") return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}
