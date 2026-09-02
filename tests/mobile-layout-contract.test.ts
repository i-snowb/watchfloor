import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const graphStylesPath = fileURLToPath(
  new URL("../app/graph-readability.css", import.meta.url),
);
const globalStylesPath = fileURLToPath(
  new URL("../app/globals.css", import.meta.url),
);
const convergenceStylesPath = fileURLToPath(
  new URL("../app/convergence.css", import.meta.url),
);
const evidenceMapPath = fileURLToPath(
  new URL("../components/evidence-map.tsx", import.meta.url),
);

test("small case views retain a bounded evidence plane and stacked controls", async () => {
  const styles = await readFile(graphStylesPath, "utf8");
  const mobileRules = styles.slice(styles.indexOf("@media (max-width: 700px)"));

  assert.match(
    mobileRules,
    /\.case-view \.evidence-map-header \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) !important;/,
  );
  assert.match(
    mobileRules,
    /\.case-view \.evidence-view-switch \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
  );
  assert.match(
    mobileRules,
    /\.case-view \.case-context-rail \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) !important;/,
  );
  assert.match(
    mobileRules,
    /\.case-view \.evidence-stage-frame > \.evidence-map-viewport \{[\s\S]*display: block !important;[\s\S]*overflow: hidden !important;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 980px\)[\s\S]*\.evidence-stage-frame:has\(\.query-console\[open\]\)[\s\S]*> \.evidence-map-viewport \{[\s\S]*width: 100% !important;/,
  );
  assert.match(mobileRules, /overflow-x: clip;/);
});

test("recording view keeps the timeline visible and gives KQL its own graph column", async () => {
  const styles = await readFile(graphStylesPath, "utf8");

  assert.match(
    styles,
    /height: calc\(100dvh - \(var\(--platform-header-height\) \+ 107px\)\);/,
  );
  assert.match(
    styles,
    /\.case-timeline-dock \.timeline-controls \{[\s\S]*min-height: calc\(var\(--timeline-row-height\) - 2px\);/,
  );
  assert.match(
    styles,
    /\.case-timeline-dock \.timeline-tracks,[\s\S]*grid-template-rows: calc\(var\(--timeline-row-height\) - 30px\) 28px;/,
  );
  assert.match(
    styles,
    /\.evidence-stage-frame:has\(\.query-console\[open\]\)[\s\S]*> \.evidence-map-viewport \{[\s\S]*width: calc\(100% - clamp\(420px, 42vw, 540px\)\) !important;/,
  );
  assert.match(
    styles,
    /\.case-context-rail:has\(\.query-console\[open\]\) \{[\s\S]*overflow: visible;/,
  );
  assert.match(
    styles,
    /\.evidence-stage-frame:has\(\.query-console\[open\]\)[\s\S]*\.case-context-rail[\s\S]*> \.map-command-dock \{[\s\S]*bottom: var\(--timeline-row-height\) !important;[\s\S]*top: var\(--context-row-height\) !important;/,
  );
  assert.match(
    styles,
    /\.query-console-editor[\s\S]*box-sizing: border-box;[\s\S]*max-width: 100%;/,
  );
  assert.match(
    styles,
    /\.query-console\[open\] \{[\s\S]*display: block;[\s\S]*height: 100%;[\s\S]*position: relative;/,
  );
  assert.match(
    styles,
    /\.query-console\[open\] \.query-console-body \{[\s\S]*bottom: 0;[\s\S]*overflow: auto;[\s\S]*position: absolute;[\s\S]*top: 47px;/,
  );
  assert.match(
    styles,
    /\.case-reset-dialog \{[\s\S]*max-height: min\(640px, calc\(100dvh - 32px\)\);[\s\S]*overflow-y: auto;/,
  );
});

test("viewport and touch graph controls retain navigation without motion", async () => {
  const [styles, globalStyles, convergenceStyles] = await Promise.all([
    readFile(graphStylesPath, "utf8"),
    readFile(globalStylesPath, "utf8"),
    readFile(convergenceStylesPath, "utf8"),
  ]);

  assert.match(globalStyles, /--platform-header-height: 60px;/);
  assert.match(convergenceStyles, /height: var\(--platform-header-height\);/);
  assert.match(
    convergenceStyles,
    /height: calc\(100dvh - var\(--platform-header-height\)\);/,
  );
  assert.doesNotMatch(convergenceStyles, /100dvh - 46px/);
  assert.match(
    styles,
    /height: calc\(100dvh - var\(--platform-header-height\)\);/,
  );
  assert.match(
    styles,
    /\.case-context-rail:has\(\.command-owner-analyst\) \{[\s\S]*overflow: visible;[\s\S]*z-index: 50;/,
  );
  assert.match(
    styles,
    /\.case-context-rail:has\(\.command-owner-analyst\)[\s\S]*> \.map-command-dock \{[\s\S]*max-height: none;[\s\S]*overflow: visible;/,
  );
  assert.match(
    styles,
    /@media \(hover: none\), \(pointer: coarse\) \{[\s\S]*\.trace-camera-tools \{[\s\S]*display: grid !important;/,
  );
  assert.match(
    styles,
    /\.trace-camera-tools button:not\(:last-child\),[\s\S]*display: inline-grid !important;/,
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.evidence-entity,[\s\S]*\.evidence-edge-label,[\s\S]*transition: none;/,
  );
});

test("trace relationship pills lead with an action and retain join provenance", async () => {
  const source = await readFile(evidenceMapPath, "utf8");

  assert.match(
    source,
    /humanizeRelation\(edge\.join\?\.relation \?\? "observed"\)/,
  );
  assert.match(source, /<small aria-hidden="true">\{joinReference\}<\/small>/);
  assert.match(
    source,
    /aria-label=\{`\$\{label\}: \$\{edge\.label\}\. \$\{edge\.fromEntityId\} to \$\{edge\.toEntityId\}\.`\}/,
  );
});

test("evidence cards expose complete title and summary copy", async () => {
  const styles = await readFile(graphStylesPath, "utf8");
  const titleRule = styles.match(
    /\.case-view \.evidence-entity-copy strong \{([\s\S]*?)\n\}/,
  )?.[1];
  const summaryRule = styles.match(
    /\.case-view \.evidence-entity-copy > span \{([\s\S]*?)\n\}/,
  )?.[1];

  assert.ok(titleRule);
  assert.ok(summaryRule);
  assert.match(titleRule, /overflow: visible;/);
  assert.doesNotMatch(titleRule, /line-clamp/);
  assert.match(summaryRule, /overflow: visible;/);
  assert.doesNotMatch(summaryRule, /line-clamp/);
});
