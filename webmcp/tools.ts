import {
  getInvestigationPlans,
  getResponseBundles,
  type CaseToolName,
} from "@/domain/operations";
import type { CaseFixture } from "@/domain/types";

export type WebMcpHandler = (
  toolName: CaseToolName,
  input: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<unknown>;

export interface ToolRegistrationOutcome {
  name: string;
  status: "registered" | "failed" | "unavailable";
  error: string | null;
}

export interface RegistrationResult {
  supported: boolean;
  registered: number;
  outcomes: ToolRegistrationOutcome[];
}

const stringId = {
  type: "string",
  minLength: 8,
  maxLength: 80,
  description: "Unique invocation ID for tracing and idempotent retry.",
};

const revision = {
  type: "integer",
  minimum: 1,
  description: "Current shared case revision.",
};

const visibleArtifactId = {
  type: "string",
  minLength: 3,
  maxLength: 120,
  pattern: "^[A-Za-z0-9][A-Za-z0-9:._-]*$",
  description: "Stable ID returned by a visible case read.",
};

const visibleResponseActionId = {
  type: "string",
  minLength: 3,
  maxLength: 80,
  pattern: "^[A-Za-z0-9][A-Za-z0-9:_-]*$",
  description: "Response action ID returned by the current case context.",
};

function definition(
  name: CaseToolName,
  title: string,
  description: string,
  properties: Record<string, unknown>,
  required: readonly string[],
  readOnly: boolean,
  handler: WebMcpHandler,
): WebMcpToolDefinition {
  return {
    name,
    title,
    description,
    inputSchema: {
      type: "object",
      properties: { requestId: stringId, ...properties },
      required: ["requestId", ...required],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: readOnly,
      untrustedContentHint: false,
    },
    execute: async (input, context) =>
      handler(name, input, context?.signal ?? new AbortController().signal),
  };
}

export function createCaseToolDefinitions(
  fixture: CaseFixture,
  handler: WebMcpHandler,
): WebMcpToolDefinition[] {
  // Registration is case-scoped, not revision-scoped. Availability remains
  // enforced by the operation layer using the current shared case state.
  const caseEnrichments = [
    ...fixture.enrichments,
    ...fixture.stream.stages.flatMap((stage) => stage.enrichments),
  ];
  const availableEnrichmentTools = new Set(
    caseEnrichments.map((artifact) => artifact.toolName),
  );
  const availableQueries = fixture.investigationQueries;
  const availablePlans = getInvestigationPlans(fixture);
  const supportsImpactModel =
    fixture.impact.atRiskEntityIds.length > 0 ||
    fixture.responseActions.length > 0;
  const availableResponseActions = fixture.responseActions;
  const availableBundles = getResponseBundles(fixture);
  const eventSourceCategories = [
    ...new Set(
      [
        ...fixture.events,
        ...fixture.stream.stages.flatMap((stage) => stage.events),
      ].map((event) => event.sourceCategory),
    ),
  ];
  const includeTools = (
    condition: boolean,
    ...tools: readonly CaseToolName[]
  ): readonly CaseToolName[] => (condition ? tools : []);
  const recommendedTools: readonly CaseToolName[] = [
    "inspect_entity",
    "inspect_relationship",
    "query_related_activity",
    ...includeTools(availableQueries.length > 0, "prepare_investigation_query"),
    ...includeTools(availableQueries.length > 0, "run_investigation_query"),
    ...includeTools(availablePlans.length > 0, "run_investigation_plan"),
    ...includeTools(
      availableEnrichmentTools.has("enrich_identity"),
      "enrich_identity",
    ),
    ...includeTools(
      availableEnrichmentTools.has("enrich_network_indicator"),
      "enrich_network_indicator",
    ),
    ...includeTools(
      availableEnrichmentTools.has("enrich_cloud_role"),
      "enrich_cloud_role",
    ),
    ...includeTools(
      availableEnrichmentTools.has("enrich_resource"),
      "enrich_resource",
    ),
    ...includeTools(
      availableEnrichmentTools.has("enrich_endpoint"),
      "enrich_endpoint",
    ),
    ...includeTools(availableEnrichmentTools.has("enrich_file"), "enrich_file"),
    ...includeTools(
      supportsImpactModel,
      "calculate_reachability",
      "simulate_control",
    ),
    ...includeTools(
      fixture.stream.stages.length > 0,
      "request_next_observation",
    ),
    "inspect_event",
    ...includeTools(
      availableResponseActions.length > 0,
      "propose_response_action",
      "simulate_response_action",
    ),
    ...includeTools(availableBundles.length > 0, "prepare_response_bundle"),
    "generate_case_report",
  ];
  return [
    definition(
      "get_case_context",
      "Read case context",
      "Return the case revision, Tier 1 observations and unresolved gaps, attached evidence, blockers, and available investigations.",
      {},
      [],
      true,
      handler,
    ),
    definition(
      "get_case_delta",
      "Read released case updates",
      "Return observed synthetic telemetry released after a bounded stream cursor.",
      {
        sinceCursor: {
          type: "integer",
          minimum: 0,
          maximum: fixture.stream.stages.length,
        },
      },
      ["sinceCursor"],
      true,
      handler,
    ),
    definition(
      "inspect_event",
      "Inspect observed event",
      "Return one released observed event with its visible entities and evidence joins.",
      { eventId: visibleArtifactId },
      ["eventId"],
      true,
      handler,
    ),
    definition(
      "inspect_entity",
      "Inspect entity",
      "Return one typed case entity with its related observed events and evidence joins.",
      { entityId: visibleArtifactId },
      ["entityId"],
      true,
      handler,
    ),
    definition(
      "inspect_relationship",
      "Inspect evidence join",
      "Return the exact match field, value, source events, endpoints, and limitation for one correlation.",
      { relationshipId: visibleArtifactId },
      ["relationshipId"],
      true,
      handler,
    ),
    definition(
      "focus_entity",
      "Focus entity in shared view",
      "Select one typed entity in the visible case inspector without changing observed evidence.",
      { entityId: visibleArtifactId },
      ["entityId"],
      true,
      handler,
    ),
    definition(
      "search_events",
      "Search observed events",
      "Search the bounded synthetic event set by entity, source category, and exact action.",
      {
        entityId: visibleArtifactId,
        sourceCategory: {
          type: "string",
          enum: eventSourceCategories,
        },
        action: { type: "string", minLength: 1, maxLength: 80 },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      [],
      true,
      handler,
    ),
    definition(
      "find_first_occurrence",
      "Find first occurrence",
      "Return the first observed event for one known entity.",
      { entityId: visibleArtifactId },
      ["entityId"],
      true,
      handler,
    ),
    definition(
      "compare_timepoints",
      "Compare observed timepoints",
      "Return the ordered observed events and entities between two known event boundaries.",
      {
        fromEventId: visibleArtifactId,
        toEventId: visibleArtifactId,
      },
      ["fromEventId", "toEventId"],
      true,
      handler,
    ),
    definition(
      "query_related_activity",
      "Query related activity",
      "Return observed events inside a bounded time window around an entity first occurrence.",
      {
        entityId: visibleArtifactId,
        beforeMinutes: { type: "integer", minimum: 0, maximum: 60 },
        afterMinutes: { type: "integer", minimum: 0, maximum: 60 },
      },
      ["entityId", "beforeMinutes", "afterMinutes"],
      true,
      handler,
    ),
    ...(availableQueries.length > 0
      ? [
          definition(
            "prepare_investigation_query",
            "Prepare investigation query",
            "Load one released, case-approved KQL query into the shared investigation console. This prepares the visible query only; it does not retrieve evidence or execute a response action.",
            {
              expectedRevision: revision,
              queryId: {
                ...visibleArtifactId,
                description:
                  "Case query ID. Read get_case_context before use; the current shared state determines availability.",
              },
            },
            ["expectedRevision", "queryId"],
            false,
            handler,
          ),
        ]
      : []),
    ...(availableQueries.length > 0
      ? [
          definition(
            "run_investigation_query",
            "Run bounded investigation query",
            "Run the exact KQL currently prepared in shared case state across released synthetic sources, then attach the bounded result and source records. Call prepare_investigation_query first for the same queryId and use its returned queryText.",
            {
              expectedRevision: revision,
              queryId: {
                ...visibleArtifactId,
                description:
                  "Case query ID. Read get_case_context before use; the current shared state determines availability.",
              },
              queryText: {
                type: "string",
                minLength: 40,
                maxLength: 1024,
                description:
                  "Exact KQL returned by prepare_investigation_query for the currently prepared queryId. The server rejects unprepared, modified, or unknown query text.",
              },
            },
            ["expectedRevision", "queryId", "queryText"],
            false,
            handler,
          ),
        ]
      : []),
    ...(availablePlans.length > 0
      ? [
          definition(
            "run_investigation_plan",
            "Run copilot investigation plan",
            "Run the plan's next unresolved bounded query after prepare_investigation_query has placed that exact query in the shared console. Use a specific investigation query when the analyst asks to test one named question.",
            {
              expectedRevision: revision,
              planId: {
                ...visibleArtifactId,
                description:
                  "Case plan ID. Read get_case_context before use; the current shared state determines availability.",
              },
            },
            ["expectedRevision", "planId"],
            false,
            handler,
          ),
        ]
      : []),
    definition(
      "propose_investigation_step",
      "Lead next investigation step",
      "Publish one revision-bound agent proposal into the shared case. The proposal guides work but does not execute an operation.",
      {
        expectedRevision: revision,
        phase: {
          type: "string",
          enum: ["inspect", "decide", "scope", "model", "respond"],
        },
        objective: { type: "string", minLength: 8, maxLength: 180 },
        recommendedTool: {
          type: "string",
          enum: recommendedTools,
        },
        entityId: visibleArtifactId,
      },
      ["expectedRevision", "phase", "objective", "recommendedTool"],
      false,
      handler,
    ),
    ...(availableEnrichmentTools.has("enrich_identity")
      ? [
          definition(
            "enrich_identity",
            "Attach identity baseline",
            "Attach bounded synthetic identity context for one released case entity without changing observed events.",
            {
              expectedRevision: revision,
              entityId: visibleArtifactId,
            },
            ["expectedRevision", "entityId"],
            false,
            handler,
          ),
        ]
      : []),
    ...(availableEnrichmentTools.has("enrich_network_indicator")
      ? [
          definition(
            "enrich_network_indicator",
            "Attach network context",
            "Attach bounded synthetic network inventory context for one released indicator.",
            {
              expectedRevision: revision,
              entityId: visibleArtifactId,
            },
            ["expectedRevision", "entityId"],
            false,
            handler,
          ),
        ]
      : []),
    ...(availableEnrichmentTools.has("enrich_cloud_role")
      ? [
          definition(
            "enrich_cloud_role",
            "Attach cloud role posture",
            "Attach bounded synthetic IAM trust and effective-privilege context for one released cloud role.",
            {
              expectedRevision: revision,
              entityId: visibleArtifactId,
            },
            ["expectedRevision", "entityId"],
            false,
            handler,
          ),
        ]
      : []),
    ...(availableEnrichmentTools.has("enrich_resource")
      ? [
          definition(
            "enrich_resource",
            "Attach resource context",
            "Attach bounded synthetic object, secret, or workload context for one released resource.",
            {
              expectedRevision: revision,
              entityId: visibleArtifactId,
            },
            ["expectedRevision", "entityId"],
            false,
            handler,
          ),
        ]
      : []),
    ...(availableEnrichmentTools.has("enrich_endpoint")
      ? [
          definition(
            "enrich_endpoint",
            "Attach endpoint posture",
            "Attach bounded synthetic ownership and EDR control context for a released endpoint.",
            {
              expectedRevision: revision,
              entityId: visibleArtifactId,
            },
            ["expectedRevision", "entityId"],
            false,
            handler,
          ),
        ]
      : []),
    ...(availableEnrichmentTools.has("enrich_file")
      ? [
          definition(
            "enrich_file",
            "Attach file analysis",
            "Attach bounded synthetic archive analysis for a released file entity without executing or uploading it.",
            {
              expectedRevision: revision,
              entityId: visibleArtifactId,
            },
            ["expectedRevision", "entityId"],
            false,
            handler,
          ),
        ]
      : []),
    ...(supportsImpactModel
      ? [
          definition(
            "calculate_reachability",
            "Calculate modeled reach",
            "Calculate deterministic candidate risk segments after the analyst records the evidence disposition.",
            {
              expectedRevision: revision,
              fromEntityId: {
                type: "string",
                enum: [fixture.reachability.sourceEntityId],
              },
              maxDepth: { type: "integer", minimum: 1, maximum: 8 },
            },
            ["expectedRevision", "fromEntityId", "maxDepth"],
            false,
            handler,
          ),
          definition(
            "simulate_control",
            "Simulate impact control",
            "Apply one allowlisted control to a copy of the synthetic graph and return modeled segment changes. No control is executed.",
            {
              expectedRevision: revision,
              control: {
                type: "string",
                enum: [fixture.counterfactual.control],
              },
            },
            ["expectedRevision", "control"],
            false,
            handler,
          ),
        ]
      : []),
    ...(fixture.stream.stages.length > 0
      ? [
          definition(
            "request_next_observation",
            "Request next observation",
            "Request the next fixture-defined telemetry boundary and publish the reason into shared case state. Analyst release remains required.",
            {
              expectedRevision: revision,
              stageId: {
                ...visibleArtifactId,
                description:
                  "Case stream stage ID. Read get_case_context before use; only the next released boundary is accepted.",
              },
              rationale: { type: "string", minLength: 8, maxLength: 240 },
            },
            ["expectedRevision", "stageId", "rationale"],
            false,
            handler,
          ),
        ]
      : []),
    ...(availableResponseActions.length > 0
      ? [
          definition(
            "propose_response_action",
            "Propose bounded response",
            "Publish a revision-bound recommendation for one fixture-defined response action. No control executes.",
            {
              expectedRevision: revision,
              actionId: {
                ...visibleResponseActionId,
                description:
                  "Case response action ID. Read get_case_context before use; the current shared state determines availability.",
              },
              reasoning: { type: "string", minLength: 8, maxLength: 240 },
            },
            ["expectedRevision", "actionId", "reasoning"],
            false,
            handler,
          ),
          definition(
            "simulate_response_action",
            "Simulate bounded response",
            "Model the fixture-defined effect of a proposed response action. No endpoint, identity, credential, or workload is modified.",
            {
              expectedRevision: revision,
              actionId: {
                ...visibleResponseActionId,
                description:
                  "Proposed case response action ID. Read get_case_context before use; only the active proposal is accepted.",
              },
            },
            ["expectedRevision", "actionId"],
            false,
            handler,
          ),
        ]
      : []),
    ...(availableBundles.length > 0
      ? [
          definition(
            "prepare_response_bundle",
            "Prepare response package",
            "Prepare and simulate a fixture-defined response package in one shared revision. Analyst authorization remains required and no external control executes.",
            {
              expectedRevision: revision,
              bundleId: {
                ...visibleArtifactId,
                description:
                  "Case response package ID. Read get_case_context before use; the current shared state determines availability.",
              },
            },
            ["expectedRevision", "bundleId"],
            false,
            handler,
          ),
        ]
      : []),
    definition(
      "generate_case_report",
      "Generate case evidence report",
      "Assemble the visible evidence, disposition, limitations, and approved simulated actions into a draft report. Analyst approval remains required.",
      { expectedRevision: revision },
      ["expectedRevision"],
      false,
      handler,
    ),
  ];
}

export async function registerCaseTools(
  definitions: WebMcpToolDefinition[],
  controller: AbortController,
  modelContext: DocumentModelContext | undefined = typeof document ===
  "undefined"
    ? undefined
    : document.modelContext,
): Promise<RegistrationResult> {
  if (!modelContext || typeof modelContext.registerTool !== "function") {
    return {
      supported: false,
      registered: 0,
      outcomes: definitions.map((tool) => ({
        name: tool.name,
        status: "unavailable",
        error: "WebMCP is unavailable in this browser context.",
      })),
    };
  }

  const outcomes: ToolRegistrationOutcome[] = [];
  let registered = 0;
  for (const tool of definitions) {
    if (controller.signal.aborted) break;
    try {
      await modelContext.registerTool(tool, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) break;
      registered += 1;
      outcomes.push({ name: tool.name, status: "registered", error: null });
    } catch (error) {
      if (controller.signal.aborted) break;
      outcomes.push({
        name: tool.name,
        status: "failed",
        error:
          error instanceof Error
            ? error.message.replace(/\s+/g, " ").slice(0, 160)
            : "Tool registration failed.",
      });
    }
  }
  return { supported: true, registered, outcomes };
}
