import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CaseAuthorityHandoff } from "../components/case-authority-handoff";
import { buildAgentHandoffPrompt } from "../components/agent-handoff-prompt";
import type { AgentStatus } from "../components/platform-shell";
import { AnalystActionDock } from "../components/analyst-action-dock";
import { createInitialCaseState } from "../domain/operations";
import { endpointLateralScenario as fixture } from "../domain/scenarios";

function render(state = createInitialCaseState(fixture)): string {
  return renderToStaticMarkup(
    createElement(CaseAuthorityHandoff, {
      fixture,
      state,
      agentStatus: { state: "available", count: 29, total: 29 },
    }),
  );
}

test("authority disclosure stays compact while exposing every withheld control", () => {
  const html = render();

  assert.match(html, /Authority/);
  assert.match(html, /TRACE investigates and models/);
  assert.match(html, /You approve case decisions/);
  assert.match(html, /Analyst decision controls/);
  assert.match(html, /record evidence disposition/);
  assert.match(html, /release telemetry/);
  assert.match(html, /authorize response action/);
  assert.match(html, /authorize response package/);
  assert.match(html, /approve case report/);
  assert.match(html, /Next · agent handoff/);
  assert.match(html, /Helper behavior and prevalence/);
});

test("handoff line changes to the analyst when the evidence decision is ready", () => {
  const state = structuredClone(createInitialCaseState(fixture));
  state.responseBundle = {
    id: "BUNDLE-ENDPOINT-0001",
    bundleId: "containment",
    actionIds: [],
    reasoning: "Analyst review is required for the prepared response package.",
    basedOnRevision: state.revision,
    reportedSurface: "webmcp_callback",
    preparedAt: "2026-08-28T14:05:20.000Z",
  };

  const html = render(state);
  assert.match(html, /Next · analyst decision/);
  assert.match(html, /Approve the prepared containment package/);
});

test("unavailable TRACE status keeps the authority strip focused on analyst work", () => {
  const html = renderToStaticMarkup(
    createElement(CaseAuthorityHandoff, {
      fixture,
      state: createInitialCaseState(fixture),
      agentStatus: { state: "unavailable", count: 0 },
    }),
  );

  assert.match(html, /Analyst review mode/);
  assert.match(html, /Next · analyst investigation/);
});

test("partial and checking tool surfaces do not advertise an agent handoff", () => {
  const nonReadyStatuses: AgentStatus[] = [
    { state: "checking" as const, count: 0 },
    { state: "partial" as const, count: 4, total: 5 },
  ];
  for (const agentStatus of nonReadyStatuses) {
    const html = renderToStaticMarkup(
      createElement(CaseAuthorityHandoff, {
        fixture,
        state: createInitialCaseState(fixture),
        agentStatus,
      }),
    );

    assert.match(html, /Analyst review mode/);
    assert.match(html, /Next · analyst investigation/);
    assert.doesNotMatch(html, /Next · agent handoff/);
  }
});

test("agent handoff prompt starts from current context and stops at analyst gates", () => {
  const prompt = buildAgentHandoffPrompt("case-endpoint-0448");

  assert.match(prompt, /case-endpoint-0448/);
  assert.match(prompt, /get_case_context first/);
  assert.match(prompt, /If analystGate is present, stop/);
});

test("telemetry release gate shows the agent rationale and bounded scope", () => {
  const state = structuredClone(createInitialCaseState(fixture));
  state.observationRequest = {
    stageId: "STREAM-LAT-02",
    rationale: "Release the bounded telemetry needed to verify recovery scope.",
    targetEntityIds: ["workload:billing-api"],
    basedOnRevision: 19,
    requestedAt: "2026-08-28T14:06:08.000Z",
    releasedAt: null,
    status: "pending",
  };

  const html = renderToStaticMarkup(
    createElement(AnalystActionDock, {
      fixture,
      state,
      busy: false,
      streamPlaying: false,
      onExecute: async () => {},
      onReleaseSignal: () => {},
    }),
  );
  assert.match(html, /Release requested telemetry/);
  assert.match(
    html,
    /Release the bounded telemetry needed to verify recovery scope/,
  );
  assert.match(html, /Requested scope: Recovery scope confirmed/);
});
