"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("queue menu explicitly confirms discarding failed local work", () => {
  assert.match(htmlSource, /id="clearQueueIssues"[^>]*hidden>Anulează modificările eșuate<\/button>/);
  assert.match(appSource, /failedCount = state\.commands\.filter\(\(command\) => command\.status === "failed"\)\.length/);
  assert.match(appSource, /confirm\("Anulezi modificările locale eșuate și comenzile care depind de ele\?/);
  assert.match(appSource, /runApiAction\("clearFailedCommands"\)/);
});
