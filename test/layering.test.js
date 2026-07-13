"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const stylesSource = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

test("menus and side panels stay above the sticky timeline columns", () => {
  assert.match(stylesSource, /\.timeline-scale\{z-index:40\}/);
  assert.match(stylesSource, /\.timeline-unit\{z-index:30;/);
  assert.match(stylesSource, /\.side-panel,\.diagnostics\{position:fixed;z-index:70;/);
});
