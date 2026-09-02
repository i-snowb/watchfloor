import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export interface PublicReleaseMetadata {
  releaseId: string;
  sourceCommit: string;
  sourceRepository: string;
}

type Environment = Readonly<Record<string, string | undefined>>;
type Command = (program: string, arguments_: readonly string[]) => string;

type RequiredVariable =
  | "WATCHFLOOR_RELEASE_ID"
  | "WATCHFLOOR_SOURCE_COMMIT"
  | "WATCHFLOOR_SOURCE_REPOSITORY";

const commitPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const releaseIdPattern = /^[a-z][a-z0-9._-]{7,119}$/;
const publicRepositoryHosts = new Set([
  "github.com",
  "gitlab.com",
  "bitbucket.org",
]);

export function resolvePublicReleaseMetadata(
  environment: Environment,
): PublicReleaseMetadata {
  const releaseId = required(environment, "WATCHFLOOR_RELEASE_ID");
  const sourceCommit = required(
    environment,
    "WATCHFLOOR_SOURCE_COMMIT",
  ).toLowerCase();
  const sourceRepository = normalizePublicRepository(
    required(environment, "WATCHFLOOR_SOURCE_REPOSITORY"),
    "WATCHFLOOR_SOURCE_REPOSITORY",
  );

  if (!commitPattern.test(sourceCommit)) {
    throw new Error(
      "WATCHFLOOR_SOURCE_COMMIT must be the full 40- or 64-character lowercase Git commit ID.",
    );
  }
  if (!releaseIdPattern.test(releaseId)) {
    throw new Error(
      "WATCHFLOOR_RELEASE_ID must be 8 to 120 lowercase letters, digits, dots, underscores, or hyphens, starting with a letter.",
    );
  }
  if (!releaseId.includes(sourceCommit.slice(0, 12))) {
    throw new Error(
      "WATCHFLOOR_RELEASE_ID must include the first 12 characters of WATCHFLOOR_SOURCE_COMMIT.",
    );
  }

  return { releaseId, sourceCommit, sourceRepository };
}

/**
 * Ensures the public release metadata identifies the exact, clean source that
 * is about to be deployed. It does not contact a forge or Cloudflare.
 */
export function assertPublicReleaseIsPublishable(
  metadata: PublicReleaseMetadata,
  command: Command = runCommand,
): void {
  const head = command("git", ["rev-parse", "HEAD"]).trim().toLowerCase();
  if (!commitPattern.test(head)) {
    throw new Error("The public deployment must run from a Git commit.");
  }
  if (head !== metadata.sourceCommit) {
    throw new Error(
      "WATCHFLOOR_SOURCE_COMMIT must exactly match the current Git HEAD.",
    );
  }
  if (command("git", ["status", "--porcelain=v1"]).trim()) {
    throw new Error(
      "Refuse public deployment from a dirty working tree. Commit the reviewed source first.",
    );
  }

  const remotes = command("git", ["remote"])
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
  if (remotes.length === 0) {
    throw new Error(
      "Refuse public deployment without a configured public Git remote.",
    );
  }
  const expectedRepository = repositoryIdentity(metadata.sourceRepository);
  const matchingRemotes = remotes.filter((remote) => {
    const urls = command("git", ["remote", "get-url", "--all", remote])
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    return urls.some((url) => repositoryIdentity(url) === expectedRepository);
  });
  if (matchingRemotes.length === 0) {
    throw new Error(
      "WATCHFLOOR_SOURCE_REPOSITORY must match a configured Git remote.",
    );
  }
  const remoteTrackingRefs = command("git", [
    "branch",
    "--remotes",
    "--contains",
    "HEAD",
  ])
    .split(/\r?\n/)
    .map((ref) => ref.trim().replace(/^\*\s*/, ""))
    .filter((ref) => !ref.includes(" -> "));
  const pushedToMatchingRemote = matchingRemotes.some((remote) =>
    remoteTrackingRefs.some((ref) => ref.startsWith(`${remote}/`)),
  );
  if (!pushedToMatchingRemote) {
    throw new Error(
      "Refuse public deployment until HEAD is contained in a remote-tracking branch for the declared repository.",
    );
  }
}

export function createPublicDeployArguments(
  metadata: PublicReleaseMetadata,
): readonly string[] {
  return [
    "wrangler",
    "deploy",
    "--config",
    "wrangler.public.json",
    "--strict",
    "--var",
    "WATCHFLOOR_AUTH_MODE:anonymous_sandbox",
    "--var",
    `WATCHFLOOR_RELEASE_ID:${metadata.releaseId}`,
    "--var",
    `WATCHFLOOR_SOURCE_COMMIT:${metadata.sourceCommit}`,
    "--var",
    `WATCHFLOOR_SOURCE_REPOSITORY:${metadata.sourceRepository}`,
  ];
}

export function runPublicDeploy(
  environment: Environment = process.env,
  command: Command = runCommand,
): void {
  const metadata = validatePublicRelease(environment, command);
  const args = createPublicDeployArguments(metadata);
  execFileSync("npx", args, { stdio: "inherit" });
}

export function validatePublicRelease(
  environment: Environment = process.env,
  command: Command = runCommand,
): PublicReleaseMetadata {
  const sourceCommit = command("git", ["rev-parse", "HEAD"])
    .trim()
    .toLowerCase();
  const suppliedCommit = environment.WATCHFLOOR_SOURCE_COMMIT?.trim();
  if (suppliedCommit && suppliedCommit.toLowerCase() !== sourceCommit) {
    throw new Error(
      "WATCHFLOOR_SOURCE_COMMIT must exactly match the current Git HEAD.",
    );
  }
  const metadata = resolvePublicReleaseMetadata({
    ...environment,
    WATCHFLOOR_SOURCE_COMMIT: sourceCommit,
  });
  assertPublicReleaseIsPublishable(metadata, command);
  return metadata;
}

function required(
  environment: Environment,
  variableName: RequiredVariable,
): string {
  const value = environment[variableName]?.trim();
  if (!value) {
    throw new Error(
      `Missing ${variableName}. Public deployment requires release provenance.`,
    );
  }
  return value;
}

function normalizePublicRepository(
  value: string,
  variableName: string,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `${variableName} must be an absolute HTTPS repository URL.`,
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !publicRepositoryHosts.has(url.hostname.toLowerCase())
  ) {
    throw new Error(
      `${variableName} must be a credential-free HTTPS GitHub, GitLab, or Bitbucket repository URL.`,
    );
  }
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  if (
    segments.length < 2 ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(
      `${variableName} must identify a public repository path, not a host root.`,
    );
  }
  url.pathname = `/${segments.join("/").replace(/\.git$/i, "")}`;
  return url.toString().replace(/\/$/, "");
}

function repositoryIdentity(value: string): string | null {
  try {
    if (/^git@[^:]+:.+$/i.test(value)) {
      const [, host, path] = value.match(/^git@([^:]+):(.+)$/i) ?? [];
      return host && path
        ? `${host.toLowerCase()}/${path.replace(/\.git$/i, "").replace(/\/$/, "")}`
        : null;
    }
    const url = new URL(value);
    if (!publicRepositoryHosts.has(url.hostname.toLowerCase())) return null;
    const path = url.pathname
      .replace(/^\/+/, "")
      .replace(/\.git$/i, "")
      .replace(/\/$/, "");
    return path ? `${url.hostname.toLowerCase()}/${path}` : null;
  } catch {
    return null;
  }
}

function runCommand(program: string, arguments_: readonly string[]): string {
  return execFileSync(program, arguments_, { encoding: "utf8" });
}

const entrypoint = process.argv[1];
if (entrypoint && pathToFileURL(entrypoint).href === import.meta.url) {
  if (process.argv.includes("--deploy")) {
    runPublicDeploy();
  } else {
    validatePublicRelease();
  }
}
