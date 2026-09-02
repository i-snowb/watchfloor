export const queueHandoffPrompt = `Inspect the registered page tools, then review and prioritize the incident queue.

Call list_case_queue first. Open only a case returned by the queue results. After the route changes, wait for the case surface to register, then call get_case_context. Follow the nextAgentAction returned by each successful write. If analystGate is present, stop and tell the analyst what must be reviewed. Do not invent case IDs, query IDs, stage IDs, response IDs, or revisions.`;
