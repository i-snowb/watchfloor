import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPublicReleaseIsPublishable,
  createPublicDeployArguments,
  resolvePublicReleaseMetadata,
  validatePublicRelease,
} from "../scripts/public-release-provenance";

const commit = "a".repeat(40);
const sourceRepository = "https://github.com/watchfloor-demo/watchfloor";

function environment(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Record<string, string | undefined> {
  return {
    WATCHFLOOR_RELEASE_ID: `watchfloor-${commit.slice(0, 12)}`,
    WATCHFLOOR_SOURCE_COMMIT: commit,
    WATCHFLOOR_SOURCE_REPOSITORY: sourceRepository,
    ...overrides,
  };
}

function cleanGit(
  overrides: Readonly<Record<string, string>> = {},
): (program: string, args: readonly string[]) => string {
  return (_program, args) => {
    const command = args.join(" ");
    if (command === "rev-parse HEAD") return overrides.head ?? `${commit}\n`;
    if (command === "status --porcelain=v1") return overrides.status ?? "";
    if (command === "remote") return overrides.remotes ?? "origin\n";
    if (
      command === "remote get-url --all origin" ||
      command === "remote get-url --all upstream"
    ) {
      return overrides.remoteUrl ?? `${sourceRepository}.git\n`;
    }
    if (command === "branch --remotes --contains HEAD") {
      return overrides.remoteBranches ?? "origin/main\n";
    }
    throw new Error(`Unexpected command: ${command}`);
  };
}

test("public release provenance requires complete deterministic metadata", () => {
  const metadata = resolvePublicReleaseMetadata(environment());
  assert.deepEqual(metadata, {
    releaseId: `watchfloor-${commit.slice(0, 12)}`,
    sourceCommit: commit,
    sourceRepository,
  });

  for (const variableName of [
    "WATCHFLOOR_RELEASE_ID",
    "WATCHFLOOR_SOURCE_COMMIT",
    "WATCHFLOOR_SOURCE_REPOSITORY",
  ]) {
    assert.throws(
      () => resolvePublicReleaseMetadata(environment({ [variableName]: "" })),
      new RegExp(`Missing ${variableName}`),
    );
  }
  assert.throws(
    () =>
      resolvePublicReleaseMetadata(
        environment({ WATCHFLOOR_SOURCE_COMMIT: "short-sha" }),
      ),
    /full 40- or 64-character lowercase Git commit ID/,
  );
  assert.throws(
    () =>
      resolvePublicReleaseMetadata(
        environment({ WATCHFLOOR_RELEASE_ID: "watchfloor-unrelated" }),
      ),
    /must include the first 12 characters/,
  );
  assert.throws(
    () =>
      resolvePublicReleaseMetadata(
        environment({
          WATCHFLOOR_SOURCE_REPOSITORY: "https://example.com/a/b",
        }),
      ),
    /GitHub, GitLab, or Bitbucket/,
  );
});

test("public release provenance binds metadata to a clean matching Git remote", () => {
  const metadata = resolvePublicReleaseMetadata(environment());
  assert.doesNotThrow(() =>
    assertPublicReleaseIsPublishable(metadata, cleanGit()),
  );
  assert.doesNotThrow(() =>
    assertPublicReleaseIsPublishable(
      metadata,
      cleanGit({
        remoteUrl: "git@github.com:watchfloor-demo/watchfloor.git\n",
        remoteBranches: "origin/main\n",
      }),
    ),
  );
  assert.doesNotThrow(() =>
    assertPublicReleaseIsPublishable(
      metadata,
      cleanGit({
        remotes: "upstream\n",
        remoteUrl: "https://github.com/watchfloor-demo/watchfloor.git\n",
        remoteBranches: "upstream/release\n",
      }),
    ),
  );
  assert.throws(
    () =>
      assertPublicReleaseIsPublishable(
        metadata,
        cleanGit({ status: " M demo/README.md\n" }),
      ),
    /dirty working tree/,
  );
  assert.throws(
    () => assertPublicReleaseIsPublishable(metadata, cleanGit({ remotes: "" })),
    /without a configured public Git remote/,
  );
  assert.throws(
    () =>
      assertPublicReleaseIsPublishable(
        metadata,
        cleanGit({ remoteUrl: "https://github.com/other/project.git\n" }),
      ),
    /must match a configured Git remote/,
  );
  assert.throws(
    () =>
      assertPublicReleaseIsPublishable(
        metadata,
        cleanGit({ remoteBranches: "upstream/main\n" }),
      ),
    /until HEAD is contained in a remote-tracking branch/,
  );
});

test("public deployment passes provenance through explicit non-secret Worker vars", () => {
  const metadata = resolvePublicReleaseMetadata(environment());
  assert.deepEqual(createPublicDeployArguments(metadata), [
    "wrangler",
    "deploy",
    "--config",
    "wrangler.public.json",
    "--strict",
    "--var",
    "WATCHFLOOR_AUTH_MODE:anonymous_sandbox",
    "--var",
    `WATCHFLOOR_RELEASE_ID:watchfloor-${commit.slice(0, 12)}`,
    "--var",
    `WATCHFLOOR_SOURCE_COMMIT:${commit}`,
    "--var",
    `WATCHFLOOR_SOURCE_REPOSITORY:${sourceRepository}`,
  ]);
});

test("final deployment derives the source commit and rejects a mismatched override", () => {
  const metadata = validatePublicRelease(
    environment({ WATCHFLOOR_SOURCE_COMMIT: undefined }),
    cleanGit(),
  );
  assert.equal(metadata.sourceCommit, commit);
  assert.throws(
    () =>
      validatePublicRelease(
        environment({ WATCHFLOOR_SOURCE_COMMIT: "b".repeat(40) }),
        cleanGit(),
      ),
    /must exactly match the current Git HEAD/,
  );
});
