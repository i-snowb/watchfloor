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

test("recording view keeps controls out of the graph and preserves the timeline", async () => {
  const styles = await readFile(graphStylesPath, "utf8");

  assert.match(
    styles,
    /height: calc\(100dvh - \(var\(--platform-header-height\) \+ 115px\)\);/,
  );
  assert.doesNotMatch(
    styles,
    /@media \(min-width: 701px\) and \(max-width: 1180px\),\s*\(min-width: 981px\) and \(max-height: 800px\)/,
  );
  assert.match(
    styles,
    /@media \(min-width: 701px\) and \(max-width: 1180px\) and \(min-height: 1001px\)/,
  );
  assert.doesNotMatch(
    styles,
    /@media \(min-width: 701px\) and \(max-width: 1180px\) \{/,
  );
  const compactDesktopRules = styles.slice(
    styles.indexOf("@media (min-width: 981px) and (max-height: 800px)"),
    styles.indexOf("/* Persistent case feedback"),
  );
  assert.match(
    compactDesktopRules,
    /\.case-context-rail \{[\s\S]*grid-template-columns: minmax\(180px, 0\.24fr\) minmax\(0, 0\.76fr\);[\s\S]*overflow: hidden;/,
  );
  assert.match(
    compactDesktopRules,
    /\.case-context-rail:has\(\.command-owner-analyst\) \{[\s\S]*overflow: hidden;[\s\S]*z-index: 5;/,
  );
  assert.match(
    compactDesktopRules,
    /\.case-context-rail:has\(\.command-owner-analyst\)[\s\S]*> \.map-command-dock \{[\s\S]*max-height: var\(--context-row-height\);[\s\S]*overflow: auto;/,
  );
  assert.match(
    compactDesktopRules,
    /\.case-command-copy[\s\S]*p \{[\s\S]*display: none;/,
  );
  assert.match(
    compactDesktopRules,
    /\.case-command-label \{[\s\S]*grid-column: 1;[\s\S]*width: auto;/,
  );
  assert.match(
    compactDesktopRules,
    /\.case-command-copy \{[\s\S]*grid-column: 2;[\s\S]*width: auto;/,
  );
  assert.match(
    compactDesktopRules,
    /\.case-command-control \{[\s\S]*grid-column: 3;[\s\S]*width: auto;/,
  );
  assert.match(
    compactDesktopRules,
    /\.case-command-decision-actions \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
  );
  assert.match(
    styles,
    /\.case-timeline-dock \.timeline-controls \{[\s\S]*min-height: calc\(var\(--timeline-row-height\) - 2px\);/,
  );
  assert.match(
    styles,
    /\.case-timeline-dock \.timeline-tracks,[\s\S]*grid-template-rows: calc\(var\(--timeline-row-height\) - 30px\) 28px;/,
  );
  const constrainedRules = styles.slice(
    styles.indexOf("Codex and other split-pane desktop shells"),
  );
  assert.match(
    constrainedRules,
    /\.case-context-rail:has\(\.command-owner-analyst\),[\s\S]*overflow: hidden;/,
  );
  assert.match(
    constrainedRules,
    /\.evidence-stage-frame:has\(\.query-console\[open\]\)[\s\S]*> \.evidence-map-viewport \{[\s\S]*width: 100% !important;/,
  );
  assert.match(
    constrainedRules,
    /\.case-context-rail:has\(\.query-console\[open\]\)[\s\S]*> \.map-command-dock[\s\S]*position: static !important;/,
  );
  assert.match(
    constrainedRules,
    /grid-template-rows:[\s\S]*auto clamp\(360px, calc\(100dvh - 300px\), 460px\)[\s\S]*var\(--timeline-row-height\) !important;/,
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
  const constrainedRules = styles.slice(
    styles.indexOf("Codex and other split-pane desktop shells"),
  );
  assert.match(
    constrainedRules,
    /\.platform-shell-case \.platform-main \{[\s\S]*overflow-x: hidden;[\s\S]*overflow-y: auto;/,
  );
  assert.match(
    constrainedRules,
    /\.case-context-rail > \.threat-priority-rail,[\s\S]*> \.map-command-dock \{[\s\S]*max-height: min\(42dvh, 320px\);[\s\S]*overflow: auto;/,
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

test("command-only case context uses the full constrained pane", async () => {
  const [styles, source] = await Promise.all([
    readFile(graphStylesPath, "utf8"),
    readFile(evidenceMapPath, "utf8"),
  ]);

  assert.match(source, /case-context-rail-command-only/);
  assert.match(
    styles,
    /\.case-view \.case-context-rail-command-only \{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/,
  );
  assert.match(
    styles,
    /\.case-context-rail-command-only[\s\S]*> \.map-command-dock \{[\s\S]*grid-column: 1;/,
  );
});

test("threat and command rails cannot occupy the same constrained grid cell", async () => {
  const [styles, source] = await Promise.all([
    readFile(graphStylesPath, "utf8"),
    readFile(evidenceMapPath, "utf8"),
  ]);
  const constrainedRules = styles.slice(
    styles.indexOf("Codex and other split-pane desktop shells"),
  );

  assert.match(source, /case-context-rail-with-threats/);
  assert.match(
    constrainedRules,
    /\.case-context-rail-with-threats > \.threat-priority-rail \{[\s\S]*grid-column: 1;[\s\S]*grid-row: 1;/,
  );
  assert.match(
    constrainedRules,
    /\.case-context-rail-with-threats:has\(\.command-owner-analyst\)[\s\S]*> \.map-command-dock,[\s\S]*\.case-context-rail-with-threats:has\(\.query-console\[open\]\)[\s\S]*> \.map-command-dock \{[\s\S]*grid-column: 2 !important;/,
  );
  assert.match(
    constrainedRules,
    /@media \(min-width: 701px\) and \(max-width: 820px\) \{[\s\S]*\.case-context-rail-with-threats \{[\s\S]*grid-template-columns: minmax\(0, 1fr\);[\s\S]*grid-template-rows: auto auto;/,
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
