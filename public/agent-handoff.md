# TRACE//LAB agent handoff

## Purpose

Use this page as a structured incident workspace. Page tools can retrieve case context, prepare and run bounded queries, attach verified discoveries, calculate modeled reach, simulate response controls, and prepare a report. Each operation records a case revision.

## Starting condition

1. Open a case from `/alerts`, or remain on the case already under review.
2. Use the case menu to reset it only when you need a clean investigation run.
3. Inspect the registered page tools and list the approved investigation skills before selecting an operation.

## Agent instruction

```text
Inspect the registered page tools, then investigate the case currently open.

Read the case context and list the approved investigation skills. Prepare and run one approved query at a time, show its exact KQL before execution, and inspect the raw returned records. Add verified discoveries only when their prerequisites are satisfied. Keep observed evidence, modeled impact, simulated controls, and approvals distinct. Pause at every analyst-only decision or authorization. Do not imply external execution.
```

## Analyst responsibilities

The analyst must manually record the case disposition, approve any response bundle, and approve the final report. Page tools do not make those decisions and do not execute external controls.

## Operating conventions

- Treat page-tool output as shared case state, not as an authoritative conclusion.
- Use the current case revision for each operation.
- Select skills only from the case-scoped approved catalog. Each skill loads an immutable bounded query contract.
- Review observed records before progressing into modeled reach or response planning.
- Stop and ask the analyst when a required decision or approval gate appears.
