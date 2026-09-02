import { env } from "cloudflare:workers";
import { jsonResponse } from "@/server/http";

interface ReleaseBindings {
  WATCHFLOOR_RELEASE_ID?: string;
  WATCHFLOOR_SOURCE_COMMIT?: string;
  WATCHFLOOR_SOURCE_REPOSITORY?: string;
  WATCHFLOOR_VERSION?: WorkerVersionMetadata;
}

function publicReleaseValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= 256 ? trimmed : null;
}

export function GET(request: Request): Response {
  const release = env as Cloudflare.Env & ReleaseBindings;
  const workerVersion = release.WATCHFLOOR_VERSION;
  return jsonResponse(request, null, {
    product: "WATCH//FLOOR",
    deployment: "anonymous_sandbox",
    workerVersion: workerVersion
      ? {
          id: publicReleaseValue(workerVersion.id),
          tag: publicReleaseValue(workerVersion.tag),
          uploadedAt: publicReleaseValue(workerVersion.timestamp),
        }
      : null,
    releaseId: publicReleaseValue(release.WATCHFLOOR_RELEASE_ID),
    sourceCommit: publicReleaseValue(release.WATCHFLOOR_SOURCE_COMMIT),
    sourceRepository: publicReleaseValue(release.WATCHFLOOR_SOURCE_REPOSITORY),
    note: "A null source identity means the deployed release has not yet been linked to a published source commit.",
  });
}
