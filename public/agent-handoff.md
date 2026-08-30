# TRACE//LAB agent handoff

## Purpose

Use this page as a structured incident workspace. Page tools can retrieve case context, prepare and run bounded queries, attach verified discoveries, calculate modeled reach, simulate response controls, and prepare a report. Each operation records a case revision.

## Starting condition

1. Open a case from `/alerts`, or remain on the case already under review.
2. Use the case menu to reset it only when you need a clean investigation run.
3. Inspect the registered page tools and call `get_case_context` before selecting an operation.

## Agent instruction

```text
Inspect the registered page tools, then investigate the case currently open.

Call get_case_context first. If nextAgentAction is present, call exactly that tool with its supplied input. Continue from the nextAgentAction returned by each successful write. Do not invent case IDs, query IDs, stage IDs, response IDs, or revisions.

If analystGate is present, stop and tell the analyst what must be reviewed. Resume by reading case context after the analyst acts. Keep observed evidence, modeled impact, simulated controls, and approvals distinct. Do not imply external execution.
```

The case context supplies the current revision and safe arguments for the next agent-owned operation. A successful write returns a refreshed handoff. The agent should not need a case-specific script.

## Analyst responsibilities

The analyst must manually record the case disposition, approve any response bundle, and approve the final report. Page tools do not make those decisions and do not execute external controls.

## Operating conventions

- Treat page-tool output as shared case state, not as an authoritative conclusion.
- Use only the supplied `nextAgentAction.input` for the current case revision.
- Select skills only from the case-scoped approved catalog. Each skill loads an immutable bounded query contract.
- Review observed records before progressing into modeled reach or response planning.
- Stop and ask the analyst when a required decision or approval gate appears.
