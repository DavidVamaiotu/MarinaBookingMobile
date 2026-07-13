"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

test("reservation and settings dialogs close without triggering required-field validation", () => {
  assert.match(indexSource, /id="closeCreateDialog" type="button"/);
  assert.match(indexSource, /id="cancelCreateDialog" type="button"/);
  assert.match(indexSource, /id="closeSettingsDialog" type="button"/);
  assert.match(appSource, /\$\("#closeCreateDialog"\)\.addEventListener\("click", \(\) => createDialog\.close\(\)\)/);
  assert.match(appSource, /\$\("#cancelCreateDialog"\)\.addEventListener\("click", \(\) => createDialog\.close\(\)\)/);
  assert.match(appSource, /\$\("#closeSettingsDialog"\)\.addEventListener\("click", \(\) => \{ settingsWorkspace = null; settingsDialog\.close\(\); \}\)/);
});
