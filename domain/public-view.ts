import type { CaseFixture, CaseSnapshot } from "./types";
import type { CaseToolName } from "./operations";

/**
 * A server-produced case projection that contains only evidence available at
 * the represented revision. Full scenario fixtures must never cross a client
 * boundary.
 */
export interface PublicCaseFixture extends CaseFixture {
  readonly publicProjection: true;
  readonly projectionRevision: number;
}

export interface PublicCaseSnapshot extends CaseSnapshot {
  readonly publicProjection: true;
}

export interface PublicCaseView {
  readonly fixture: PublicCaseFixture;
  readonly snapshot: PublicCaseSnapshot;
  readonly toolNames: readonly CaseToolName[];
}
