import type { ReferenceCase } from "@/domain/reference-cases";

export type ReferenceToolName =
  | "get_reference_case"
  | "inspect_reference_entity"
  | "inspect_reference_event"
  | "inspect_reference_relationship"
  | "focus_reference_entity"
  | "run_reference_query"
  | "run_reference_investigation_plan";

export type ReferenceToolFailure = {
  ok: false;
  error: { code: string; message: string; retryable: boolean };
};

export type ReferenceToolSuccess = {
  ok: true;
  data: Record<string, unknown>;
};

export type ReferenceToolResult = ReferenceToolFailure | ReferenceToolSuccess;

export function createReferenceToolDefinitions(
  dossier: ReferenceCase,
  execute: (
    toolName: ReferenceToolName,
    input: Record<string, unknown>,
    actor: "agent",
    signal?: AbortSignal,
  ) => Promise<ReferenceToolResult>,
): WebMcpToolDefinition[] {
  const create = (
    name: ReferenceToolName,
    title: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[],
    readOnly: boolean,
  ): WebMcpToolDefinition => ({
    name,
    title,
    description,
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
    annotations: { readOnlyHint: readOnly, untrustedContentHint: true },
    execute: async (input, context) => {
      const validation = validateReferenceToolInput(name, input);
      if (validation) return validation;
      return execute(name, input, "agent", context?.signal);
    },
  });
  return [
    create(
      "get_reference_case",
      "Read reference case",
      "Return Tier 1 observations, the evidence scope, available queries, and current session-local results.",
      {},
      [],
      true,
    ),
    create(
      "inspect_reference_entity",
      "Inspect reference entity",
      "Return one typed entity and its evidence relationships.",
      {
        entityId: {
          type: "string",
          enum: dossier.entities.map((entity) => entity.id),
        },
      },
      ["entityId"],
      true,
    ),
    create(
      "inspect_reference_event",
      "Inspect reference event",
      "Return one observed event from the dossier.",
      {
        eventId: {
          type: "string",
          enum: dossier.events.map((event) => event.id),
        },
      },
      ["eventId"],
      true,
    ),
    create(
      "inspect_reference_relationship",
      "Inspect reference relationship",
      "Return one correlation with evidence IDs and its explicit limitation.",
      {
        relationshipId: {
          type: "string",
          enum: dossier.joins.map((join) => join.id),
        },
      },
      ["relationshipId"],
      true,
    ),
    create(
      "focus_reference_entity",
      "Focus shared evidence entity",
      "Move the shared reference view to one dossier entity without changing evidence.",
      {
        entityId: {
          type: "string",
          enum: dossier.entities.map((entity) => entity.id),
        },
      },
      ["entityId"],
      true,
    ),
    create(
      "run_reference_query",
      "Run reference query",
      "Run one bounded canonical query, return its exact source records, and add the result to this session-local brief.",
      {
        queryId: {
          type: "string",
          enum: dossier.queries.map((query) => query.id),
        },
      },
      ["queryId"],
      false,
    ),
    create(
      "run_reference_investigation_plan",
      "Run reference investigation plan",
      "Execute all currently defined dossier queries in stable order and add the evidence insights to this session-local brief.",
      {},
      [],
      false,
    ),
  ];
}

export function validateReferenceToolInput(
  toolName: ReferenceToolName,
  input: Record<string, unknown>,
): ReferenceToolFailure | null {
  const expectedField =
    toolName === "inspect_reference_entity" ||
    toolName === "focus_reference_entity"
      ? "entityId"
      : toolName === "inspect_reference_event"
        ? "eventId"
        : toolName === "inspect_reference_relationship"
          ? "relationshipId"
          : toolName === "run_reference_query"
            ? "queryId"
            : null;
  const fields = Object.keys(input);
  if (
    (expectedField === null && fields.length > 0) ||
    (expectedField !== null &&
      (fields.length !== 1 || typeof input[expectedField] !== "string"))
  ) {
    return referenceFailure(
      "INVALID_INPUT",
      expectedField
        ? `${toolName} requires exactly one string field: ${expectedField}.`
        : `${toolName} does not accept input fields.`,
    );
  }
  return null;
}

export function referenceSuccess(
  data: Record<string, unknown>,
): ReferenceToolSuccess {
  return { ok: true, data };
}

export function referenceFailure(
  code: string,
  message: string,
  retryable = false,
): ReferenceToolFailure {
  return { ok: false, error: { code, message, retryable } };
}
