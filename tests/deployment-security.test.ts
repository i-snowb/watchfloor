import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the public Cloudflare profile is a separate bounded sandbox", async () => {
  const publicConfig = JSON.parse(
    await readFile(new URL("../wrangler.public.json", import.meta.url), "utf8"),
  );
  assert.equal(publicConfig.name, "watchfloor-sandbox");
  assert.equal(publicConfig.main, "worker.public.mjs");
  assert.deepEqual(publicConfig.rules, [
    {
      type: "ESModule",
      globs: ["dist/server/**/*.js", "server/public-retention.mjs"],
      fallthrough: false,
    },
    {
      type: "CompiledWasm",
      globs: ["dist/server/**/*.wasm"],
      fallthrough: false,
    },
    {
      type: "Text",
      globs: ["dist/server/**/*.txt"],
      fallthrough: false,
    },
    {
      type: "Data",
      globs: ["dist/server/**/*.bin"],
      fallthrough: false,
    },
  ]);
  assert.equal(publicConfig.workers_dev, true);
  assert.equal(publicConfig.preview_urls, false);
  assert.deepEqual(publicConfig.triggers?.crons, ["*/15 * * * *"]);
  assert.equal(publicConfig.vars?.WATCHFLOOR_AUTH_MODE, "anonymous_sandbox");
  assert.equal(publicConfig.version_metadata?.binding, "WATCHFLOOR_VERSION");
  for (const releaseVariable of [
    "WATCHFLOOR_RELEASE_ID",
    "WATCHFLOOR_SOURCE_COMMIT",
    "WATCHFLOOR_SOURCE_REPOSITORY",
  ]) {
    assert.equal(
      Object.hasOwn(publicConfig.vars ?? {}, releaseVariable),
      false,
    );
  }
  assert.equal(publicConfig.d1_databases?.length, 1);
  assert.equal(publicConfig.ratelimits?.length, 2);
  assert.equal(
    new Set(
      publicConfig.ratelimits.map(
        (item: { namespace_id: string }) => item.namespace_id,
      ),
    ).size,
    2,
  );
  assert.equal(publicConfig.observability?.enabled, true);
  assert.equal(publicConfig.observability?.logs?.enabled, true);
  assert.equal(publicConfig.observability?.logs?.invocation_logs, false);
  assert.equal(publicConfig.observability?.logs?.persist, true);
  assert.equal(publicConfig.observability?.logs?.head_sampling_rate, 0.1);
  assert.equal(publicConfig.observability?.traces?.enabled, true);
  assert.equal(publicConfig.observability?.traces?.persist, true);
  assert.equal(publicConfig.observability?.traces?.head_sampling_rate, 0.01);
});

test("Cloudflare static assets receive the same browser hardening policy", async () => {
  const headers = await readFile(
    new URL("../public/_headers", import.meta.url),
    "utf8",
  );
  assert.match(headers, /^\/\*$/m);
  assert.match(headers, /Content-Security-Policy: frame-ancestors 'none'/);
  assert.match(headers, /X-Frame-Options: DENY/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /Cross-Origin-Opener-Policy: same-origin/);
  assert.match(headers, /Cross-Origin-Resource-Policy: same-origin/);
  assert.match(headers, /Referrer-Policy: no-referrer/);
  assert.match(headers, /Strict-Transport-Security: max-age=31536000/);
  assert.match(headers, /Permissions-Policy: .*camera=\(\)/);
});

test("local Cloudflare secret files stay outside the public repository", async () => {
  const gitignore = await readFile(
    new URL("../.gitignore", import.meta.url),
    "utf8",
  );
  assert.match(gitignore, /^\.env\*$/m);
  assert.match(gitignore, /^\.dev\.vars\*$/m);
  assert.match(gitignore, /^\/\.wrangler\/$/m);
});
