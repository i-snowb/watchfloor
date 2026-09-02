import assert from "node:assert/strict";
import test from "node:test";
import {
  priorityCaseId,
  starterInstruction,
  starterSteps,
} from "../components/start-access-path";
import { getAgentHandoffPresentation } from "../components/agent-handoff-status";
import type { AgentStatus } from "../components/platform-shell";
import { getStartAccessPresentation } from "../components/start-access-status";

test("start access reports the live WebMCP registration state without claiming analyst authority", () => {
  assert.deepEqual(
    getStartAccessPresentation({ state: "checking", count: 0 }),
    {
      state: "checking",
      label: "Checking agent access",
      detail: "Registering page-level case access tools.",
    },
  );

  const connected = getStartAccessPresentation({
    state: "available",
    count: 2,
    total: 2,
  });
  assert.equal(connected.label, "TRACE ready · 2 tools available");
  assert.match(connected.detail, /waiting for an analyst task/);

  const limited = getStartAccessPresentation({
    state: "partial",
    count: 1,
    total: 2,
  });
  assert.equal(limited.label, "TRACE limited · 1/2 tools ready");

  const unavailable = getStartAccessPresentation({
    state: "unavailable",
    count: 0,
  });
  assert.equal(unavailable.label, "TRACE unavailable in this browser");
  assert.match(unavailable.detail, /WebMCP-capable browser/);
});

test("start handoff gives a bounded, revision-aware first evidence loop", () => {
  assert.equal(priorityCaseId, "case-endpoint-0448");
  assert.deepEqual(starterSteps, [
    "Open the priority endpoint case.",
    "Call get_case_context, then prepare and run one approved query.",
    "Show the KQL and raw records, then stop for the next analyst decision.",
  ]);
  assert.match(starterInstruction, /get_case_context/);
  assert.match(starterInstruction, /KQL/);
  assert.match(starterInstruction, /raw records/);
  assert.match(starterInstruction, /next analyst decision/);
  assert.match(starterInstruction, /expectedRevision/);
});

test("case handoff is ready only with the complete agent tool surface", () => {
  assert.equal(
    getAgentHandoffPresentation({ state: "available", count: 5 }).ready,
    true,
  );

  const nonReadyStatuses: AgentStatus[] = [
    { state: "checking" as const, count: 0 },
    { state: "partial" as const, count: 4, total: 5 },
    { state: "unavailable" as const, count: 0 },
  ];
  for (const status of nonReadyStatuses) {
    const presentation = getAgentHandoffPresentation(status);
    assert.equal(presentation.ready, false);
    assert.match(presentation.detail, /Continue the investigation directly/);
    assert.match(presentation.detail, /complete tool surface/);
  }
});
