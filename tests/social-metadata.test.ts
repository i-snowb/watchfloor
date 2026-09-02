import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

test("the social preview uses the optimized 1200 by 630 asset", async () => {
  const [layoutSource, preview] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    stat(new URL("../public/og.jpg", import.meta.url)),
  ]);

  assert.match(layoutSource, /url: "\/og\.jpg"/);
  assert.match(
    layoutSource,
    /https:\/\/watchfloor-sandbox\.watchfloor-webmcp\.workers\.dev/,
  );
  assert.match(layoutSource, /width: 1200/);
  assert.match(layoutSource, /height: 630/);
  assert.match(layoutSource, /images: \["\/og\.jpg"\]/);
  assert.ok(
    preview.size < 150_000,
    `Expected the social preview to remain below 150 KB, received ${preview.size} bytes.`,
  );
});
