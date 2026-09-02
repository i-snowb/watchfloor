import type { PublicCaseFixture, PublicCaseSnapshot } from "./public-view";
import type { CaseToolName } from "./operations";
import type { CaseSnapshot } from "./types";

export interface ApiError {
  code: string;
  message: string;
  retryable: boolean;
  recovery?: {
    toolName: string;
    input: Record<string, unknown>;
    validForRevision: number;
  };
}

export type ToolApiResult =
  | {
      ok: true;
      requestId: string;
      caseId: string;
      revision: number;
      data: unknown;
    }
  | {
      ok: false;
      requestId: string;
      caseId: string;
      revision: number;
      error: ApiError;
    };

export interface CaseApiResponse {
  fixture: PublicCaseFixture;
  snapshot: PublicCaseSnapshot;
  toolNames: readonly CaseToolName[];
}

export interface ToolApiResponse extends CaseApiResponse {
  result: ToolApiResult;
}

/** Internal store response before the server applies the public projection. */
export interface StoredToolResponse {
  snapshot: CaseSnapshot;
  result: ToolApiResult;
}
