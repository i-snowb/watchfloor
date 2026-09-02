export const priorityCaseId = "case-endpoint-0448";

export const starterInstruction = `Open ${priorityCaseId} through the registered page tools. Start with get_case_context. Then prepare and run one approved investigation query. Show the analyst the returned KQL before execution, inspect the returned raw records, and stop at the next analyst decision. Use the expectedRevision returned by the current case state; do not invent IDs or revisions.`;

export const starterSteps = [
  "Open the priority endpoint case.",
  "Call get_case_context, then prepare and run one approved query.",
  "Show the KQL and raw records, then stop for the next analyst decision.",
] as const;
