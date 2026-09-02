import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  classifyPublicSessionAdmission,
  MAX_ACTIVE_PUBLIC_SESSIONS,
  PUBLIC_SESSION_ADMISSION_LIMIT,
  PUBLIC_SESSION_ADMISSION_WINDOW_MS,
  PUBLIC_SESSION_TTL_MS,
} from "../server/public-session-admission";

test("public lease admission cannot fill the active-session cap within one lease TTL", () => {
  const windowsPerLease = Math.ceil(
    PUBLIC_SESSION_TTL_MS / PUBLIC_SESSION_ADMISSION_WINDOW_MS,
  );
  const maximumAdmissionsWithinLease =
    windowsPerLease * PUBLIC_SESSION_ADMISSION_LIMIT;

  assert.equal(maximumAdmissionsWithinLease < MAX_ACTIVE_PUBLIC_SESSIONS, true);
  assert.equal(
    classifyPublicSessionAdmission(MAX_ACTIVE_PUBLIC_SESSIONS - 1, 0),
    "admit",
  );
  assert.equal(
    classifyPublicSessionAdmission(MAX_ACTIVE_PUBLIC_SESSIONS, 0),
    "capacity",
  );
  assert.equal(
    classifyPublicSessionAdmission(0, PUBLIC_SESSION_ADMISSION_LIMIT),
    "rate_limited",
  );
});

test("durable lease creation enforces global capacity and rolling admission in one conditional insert", async () => {
  const source = await readFile(
    new URL("../server/case-store.ts", import.meta.url),
    "utf8",
  );
  const leaseBoundary = source.slice(
    source.indexOf("async function ensureActiveSessionLease"),
  );

  assert.match(leaseBoundary, /COUNT\(\*\).*expires_at_ms > \?/s);
  assert.match(leaseBoundary, /COUNT\(\*\).*created_at_ms > \?/s);
  assert.match(leaseBoundary, /PUBLIC_SESSION_ADMISSION_WINDOW_MS/);
  assert.match(leaseBoundary, /PUBLIC_SESSION_ADMISSION_LIMIT/);
  assert.match(leaseBoundary, /ON CONFLICT \(session_id\) DO NOTHING/);
});

test("public mutation routes map lease admission failures without issuing a new session", async () => {
  for (const relativePath of [
    "../server/case-operation-route.ts",
    "../app/api/cases/[caseId]/reset/route.ts",
  ]) {
    const source = await readFile(
      new URL(relativePath, import.meta.url),
      "utf8",
    );
    assert.match(source, /PUBLIC_SESSION_ADMISSION_RATE_LIMITED/);
    assert.match(source, /PUBLIC_SANDBOX_AT_CAPACITY/);
    assert.match(source, /session\.isNew\s*\?\s*null\s*:\s*session/s);
    assert.match(source, /retry-after/);
  }
});
