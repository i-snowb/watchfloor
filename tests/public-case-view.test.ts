import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createInitialCaseState } from "../domain/operations";
import {
  cloudIdentityScenario,
  endpointLateralScenario,
} from "../domain/scenarios";
import type { CaseState } from "../domain/types";
import {
  projectInitialPublicCaseView,
  projectPublicCaseView,
} from "../server/public-case-view";

test("public case tools are a fixture-independent platform manifest", () => {
  const cloudTools = projectInitialPublicCaseView(
    cloudIdentityScenario,
  ).toolNames;
  const endpointTools = projectInitialPublicCaseView(
    endpointLateralScenario,
  ).toolNames;

  assert.deepEqual(cloudTools, endpointTools);
  assert.equal(endpointTools.length, 24);
});

for (const fixture of [cloudIdentityScenario, endpointLateralScenario]) {
  test(`${fixture.id} initial public view withholds unreleased scenario content`, () => {
    const view = projectInitialPublicCaseView(fixture);
    const firstStage = fixture.stream.stages[0];
    const firstQueryWithRecords = fixture.investigationQueries.find(
      (query) => query.returnedRecords.length > 0,
    );

    assert.ok(firstStage);
    assert.ok(firstQueryWithRecords);
    assert.equal(view.fixture.publicProjection, true);
    assert.equal(view.snapshot.publicProjection, true);
    assert.equal(view.fixture.projectionRevision, 1);
    assert.equal(view.fixture.stream.stages.length, 1);
    assert.equal(view.fixture.stream.stages[0]?.id, firstStage.id);
    assert.equal(
      view.fixture.stream.stages[0]?.title,
      "Pending verified discovery",
    );
    assert.deepEqual(view.fixture.stream.stages[0]?.entities, []);
    assert.deepEqual(view.fixture.stream.stages[0]?.events, []);
    assert.deepEqual(view.fixture.stream.stages[0]?.joins, []);
    assert.deepEqual(view.fixture.stream.stages[0]?.enrichments, []);
    assert.deepEqual(view.fixture.stream.stages[0]?.responseActionIds, []);
    assert.deepEqual(
      view.fixture.stream.stages[0]?.admission.sourceRecordIds,
      [],
    );
    assert.equal(
      Number.isNaN(Date.parse(view.fixture.stream.stages[0]?.receivedAt ?? "")),
      false,
    );
    assert.deepEqual(view.fixture.responseActions, []);
    assert.deepEqual(view.snapshot.state.responseActions, []);
    assert.equal(view.fixture.conclusion.title, "Case report pending");
    assert.equal(
      view.fixture.investigationQueries.every(
        (query) => query.returnedRecords.length === 0,
      ),
      true,
    );

    const serialized = JSON.stringify(view);
    assert.equal(serialized.includes(firstStage.title), false);
    assert.equal(serialized.includes(firstStage.summary), false);
    assert.equal(
      serialized.includes(firstStage.admission.sourceRecordIds[0] ?? "\u0000"),
      false,
    );
    assert.equal(
      serialized.includes(firstStage.events[0]?.id ?? "\u0000"),
      false,
    );
    assert.equal(
      serialized.includes(
        firstQueryWithRecords.returnedRecords[0]?.id ?? "\u0000",
      ),
      false,
    );
    assert.equal(
      serialized.includes(fixture.conclusion.executiveSummary),
      false,
    );
  });

  test(`${fixture.id} public view releases query and stage content only after state transitions`, () => {
    const initial = createInitialCaseState(fixture);
    const firstQuery = fixture.investigationQueries.find(
      (query) =>
        query.requiresStageId === null && query.returnedRecords.length > 0,
    );
    const firstStage = fixture.stream.stages[0];
    const secondStage = fixture.stream.stages[1];
    assert.ok(firstQuery);
    assert.ok(firstStage);

    const afterQuery: CaseState = {
      ...initial,
      revision: initial.revision + 1,
      executedInvestigationQueryIds: [firstQuery.id],
      attachedEnrichmentIds: [firstQuery.resultArtifactId],
    };
    const queryView = projectPublicCaseView(fixture, {
      state: afterQuery,
      receipts: [],
    });
    const projectedQuery = queryView.fixture.investigationQueries.find(
      (query) => query.id === firstQuery.id,
    );
    assert.deepEqual(
      projectedQuery?.returnedRecords,
      firstQuery.returnedRecords,
    );
    assert.equal(
      queryView.fixture.stream.stages[0]?.title,
      "Pending verified discovery",
    );

    const afterStage: CaseState = {
      ...afterQuery,
      revision: afterQuery.revision + 1,
      executedInvestigationQueryIds: Array.from(
        new Set([
          ...afterQuery.executedInvestigationQueryIds,
          ...firstStage.admission.sourceQueryIds,
        ]),
      ),
      attachedEnrichmentIds: Array.from(
        new Set([
          ...afterQuery.attachedEnrichmentIds,
          ...firstStage.admission.requiredEnrichmentIds,
        ]),
      ),
      releasedStreamStageIds: [firstStage.id],
    };
    const stageView = projectPublicCaseView(fixture, {
      state: afterStage,
      receipts: [],
    });
    assert.equal(stageView.fixture.stream.stages[0]?.title, firstStage.title);
    assert.deepEqual(
      stageView.fixture.stream.stages[0]?.events,
      firstStage.events,
    );
    assert.deepEqual(
      stageView.fixture.stream.stages[0]?.joins,
      firstStage.joins,
    );
    assert.deepEqual(
      stageView.fixture.responseActions.map((action) => action.id),
      firstStage.responseActionIds,
    );
    assert.deepEqual(
      stageView.snapshot.state.responseActions.map((action) => action.actionId),
      stageView.fixture.responseActions.map((action) => action.id),
    );
    assert.deepEqual(stageView.toolNames, queryView.toolNames);

    if (secondStage) {
      assert.equal(stageView.fixture.stream.stages[1]?.id, secondStage.id);
      assert.equal(
        stageView.fixture.stream.stages[1]?.title,
        "Pending verified discovery",
      );
      const serialized = JSON.stringify(stageView);
      assert.equal(serialized.includes(secondStage.title), false);
      assert.equal(serialized.includes(secondStage.summary), false);
      assert.equal(
        serialized.includes(secondStage.events[0]?.id ?? "\u0000"),
        false,
      );
      assert.equal(
        serialized.includes(secondStage.responseActionIds[0] ?? "\u0000"),
        false,
      );
    }
  });
}

test("pending analyst telemetry keeps its unreleased stage out of snapshots and receipts", () => {
  const fixture = endpointLateralScenario;
  const initial = createInitialCaseState(fixture);
  const firstStage = fixture.stream.stages[0];
  const pendingStage = fixture.stream.stages[1];
  assert.ok(firstStage);
  assert.ok(pendingStage);

  const state: CaseState = {
    ...initial,
    revision: 20,
    releasedStreamStageIds: [firstStage.id],
    reachabilityAttached: true,
    counterfactualAttached: true,
    observationRequest: {
      stageId: pendingStage.id,
      rationale: "Release the next bounded telemetry observation for review.",
      targetEntityIds: pendingStage.events.flatMap((event) => event.entityIds),
      basedOnRevision: 19,
      requestedAt: "2026-08-27T09:43:20.000Z",
      releasedAt: null,
      status: "pending",
    },
  };
  const hiddenEventId = pendingStage.events[0]?.id;
  assert.ok(hiddenEventId);
  const view = projectPublicCaseView(fixture, {
    state,
    receipts: [
      {
        id: "RCP-ENDPOINT-0448-0020",
        requestId: "webmcp-pending-observation",
        sequence: 20,
        reportedSurface: "webmcp_callback",
        attributionAssurance: "server_channel_assigned",
        actorAssurance: "anonymous_sandbox",
        toolName: "request_next_observation",
        title: "Requested next observation",
        target: pendingStage.title,
        resultSummary: `${pendingStage.title} requested · analyst release required`,
        status: "completed",
        baseRevision: 19,
        resultRevision: 20,
        occurredAt: "2026-08-27T09:43:20.000Z",
        references: {
          eventIds: [hiddenEventId],
          entityIds: pendingStage.events.flatMap((event) => event.entityIds),
          relationshipIds: pendingStage.joins.map((join) => join.id),
          enrichmentIds: pendingStage.enrichments.map((item) => item.id),
          queryIds: pendingStage.admission.sourceQueryIds,
          recordIds: pendingStage.admission.sourceRecordIds,
          discoveryIds: [pendingStage.id],
          reportIds: [],
          actionIds: pendingStage.responseActionIds,
        },
      },
    ],
  });

  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes(pendingStage.title), false);
  assert.equal(serialized.includes(hiddenEventId), false);
  assert.equal(view.snapshot.receipts[0]?.target, "Pending verified discovery");
  assert.deepEqual(view.snapshot.receipts[0]?.references?.eventIds, []);
});

test("client entry points receive only server-produced public case views", async () => {
  const serverPages = [
    "../app/alerts/page.tsx",
    "../app/start/page.tsx",
    "../app/cases/[caseId]/page.tsx",
  ];
  const clientEntries = [
    "../components/alert-workspace.tsx",
    "../components/start-access.tsx",
    "../components/case-workbench.tsx",
  ];

  for (const relativePath of clientEntries) {
    const source = await readFile(
      new URL(relativePath, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /from ["']@\/domain\/scenarios/);
  }

  for (const relativePath of serverPages) {
    const source = await readFile(
      new URL(relativePath, import.meta.url),
      "utf8",
    );
    assert.match(source, /public-case-view-only/);
  }
});
