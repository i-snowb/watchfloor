export function buildAgentHandoffPrompt(caseId: string): string {
  return `Inspect the registered page tools, then investigate ${caseId}.

Call get_case_context first. If nextAgentAction is present, call exactly that tool with its supplied input. Continue from the nextAgentAction returned by each successful write. Do not invent case IDs, query IDs, stage IDs, response IDs, or revisions.

If analystGate is present, stop and tell the analyst what must be reviewed. Resume by reading case context after the analyst acts. Keep observed evidence, modeled impact, simulated controls, and approvals distinct. Do not imply external execution.`;
}
