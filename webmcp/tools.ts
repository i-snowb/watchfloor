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
  attempts?: number;
}

export interface ToolRegistrationReadiness {
  ready: boolean;
  criticalToolNames: string[];
  missingCriticalToolNames: string[];
}

export interface RegistrationResult {
  supported: boolean;
  registered: number;
  outcomes: ToolRegistrationOutcome[];
  readiness: ToolRegistrationReadiness;
}

const maxRegistrationAttempts = 2;

const criticalToolNames = new Set<CaseToolName>([
  "get_case_context",
  "list_investigation_skills",
  "prepare_investigation_query",
  "run_investigation_query",
  "attach_discovery_stage",
  "calculate_reachability",
  "simulate_control",
  // The public containment operation is intentionally named by its bounded
  // side effect: it prepares a package; it does not execute containment.
  "prepare_response_bundle",
  "generate_case_report",
]);

function getRegistrationReadiness(
  definitions: readonly WebMcpToolDefinition[],
  outcomes: readonly ToolRegistrationOutcome[],
): ToolRegistrationReadiness {
  const criticalToolNamesForCase = definitions
    .map((definition) => definition.name)
    .filter((name) => criticalToolNames.has(name as CaseToolName));
  const registered = new Set(
    outcomes
      .filter((outcome) => outcome.status === "registered")
      .map((outcome) => outcome.name),
  );
  const missingCriticalToolNames = criticalToolNamesForCase.filter(
    (name) => !registered.has(name),
  );
  return {
    ready: missingCriticalToolNames.length === 0,
    criticalToolNames: criticalToolNamesForCase,
    missingCriticalToolNames,
  };
}

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
      properties,
      required,
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
    ...includeTools(availableQueries.length > 0, "list_investigation_skills"),
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
    ...includeTools(fixture.stream.stages.length > 0, "attach_discovery_stage"),
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
      "Return observed case telemetry added after a bounded stream cursor.",
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
      "Search the bounded case event set by entity, source category, and exact action.",
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
            "list_investigation_skills",
            "List approved investigation skills",
            "Return the case-scoped, versioned allowlist of approved investigation playbooks. Each skill maps to one immutable bounded query contract; this does not execute a query or authorize an action.",
            {},
            [],
            true,
            handler,
          ),
        ]
      : []),
    ...(availableQueries.length > 0
      ? [
          definition(
            "prepare_investigation_query",
            "Prepare approved investigation skill",
            "Load the immutable KQL contract for one released, approved investigation skill into the shared console. List skills first when choosing a playbook. This prepares visible query text only; it does not retrieve evidence or execute a response action.",
            {
              expectedRevision: revision,
              queryId: {
                ...visibleArtifactId,
                description:
                  "Approved skill ID / case query ID returned by list_investigation_skills or get_case_context. The current shared state determines availability.",
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
            "Run approved investigation skill",
            "Run the exact KQL prepared from an approved investigation skill across available case sources, then attach the bounded result and source records. Call prepare_investigation_query first for the same queryId and use its returned queryText.",
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
            "Run investigation plan",
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
            "Attach bounded identity context for one available case entity without changing observed events.",
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
            "Attach bounded network inventory context for one available indicator.",
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
            "Attach bounded IAM trust and effective-privilege context for one available cloud role.",
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
            "Attach bounded object, secret, or workload context for one available resource.",
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
            "Attach bounded ownership and EDR control context for an available endpoint.",
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
            "Attach bounded archive analysis for an available file entity without executing or uploading it.",
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
            "Calculate candidate risk segments after the analyst records the evidence disposition.",
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
            "Apply one allowlisted control to a copy of the case graph and return modeled segment changes. No control is executed.",
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
            "attach_discovery_stage",
            "Add verified discovery to case",
            "Add the next provenance-backed entities, relationships, and observations after its required query results are attached. The operation cannot create arbitrary evidence or authorize a response.",
            {
              expectedRevision: revision,
              stageId: {
                ...visibleArtifactId,
                description:
                  "Discovery ID returned by get_case_context. Only the next ready discovery is accepted.",
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
            "Publish a revision-bound recommendation for one case-defined response action. No control executes.",
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
            "Model the case-defined effect of a proposed response action. No endpoint, identity, credential, or workload is modified.",
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
            "Prepare and model a case-defined response package in one shared revision. Analyst authorization remains required and no external control executes.",
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
      "Assemble the visible evidence, disposition, limitations, approved response records, and modeled effects into a draft report. Analyst approval remains required.",
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
    const outcomes = definitions.map((tool) => ({
      name: tool.name,
      status: "unavailable" as const,
      error: "WebMCP is unavailable in this browser context.",
      attempts: 0,
    }));
    return {
      supported: false,
      registered: 0,
      outcomes,
      readiness: getRegistrationReadiness(definitions, outcomes),
    };
  }

  const outcomes: ToolRegistrationOutcome[] = [];
  let registered = 0;
  for (const tool of definitions) {
    if (controller.signal.aborted) break;
    let attempts = 0;
    let failure: unknown = null;
    let completed = false;
    while (attempts < maxRegistrationAttempts && !controller.signal.aborted) {
      attempts += 1;
      try {
        await modelContext.registerTool(tool, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) break;
        registered += 1;
        outcomes.push({
          name: tool.name,
          status: "registered",
          error: null,
          attempts,
        });
        completed = true;
        break;
      } catch (error) {
        failure = error;
      }
    }
    if (controller.signal.aborted) break;
    if (!completed) {
      outcomes.push({
        name: tool.name,
        status: "failed",
        error:
          failure instanceof Error
            ? failure.message.replace(/\s+/g, " ").slice(0, 160)
            : "Tool registration failed.",
        attempts,
      });
    }
  }
  return {
    supported: true,
    registered,
    outcomes,
    readiness: getRegistrationReadiness(definitions, outcomes),
  };
}
