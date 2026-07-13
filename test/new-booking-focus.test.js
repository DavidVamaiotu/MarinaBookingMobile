"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

test("a newly created reservation is centered and briefly highlighted in blue", () => {
  assert.match(appSource, /function revealCreatedBooking\(created, input, source = activeWorkspace\)/);
  assert.match(appSource, /setTimelineScrollTop\(row\.top/);
  assert.match(appSource, /setTimelineScrollLeft\(targetLeft\)/);
  assert.match(appSource, /newlyCreatedBookingId = booking\.localId/);
  assert.match(appSource, /revealCreatedBooking\(created, input, source\)/);
  assert.match(appSource, /async function waitForCreatedBooking\(created, input, source = activeWorkspace, timeoutMs = 15000\)/);
  assert.match(appSource, /await waitForCreatedBooking\(created, input, source\)/);
  assert.match(appSource, /if \(source !== activeWorkspace\) return false/);
  assert.match(stylesSource, /\.timeline-bar\.is-newly-created\{[^}]*#2479c7/);
  assert.match(stylesSource, /@keyframes new-booking-highlight/);
  assert.match(stylesSource, /prefers-reduced-motion:reduce/);
});
