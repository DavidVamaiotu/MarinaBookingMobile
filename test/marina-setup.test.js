"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("the app exposes only Rooms and Camping as Marina workspaces", () => {
  const html = read("index.html");
  const app = read("app.js");
  const preload = read("preload.js");
  const main = read("electron-main.js");
  const mobile = read("mobile/mobile-bridge.js");

  assert.match(html, /data-workspace="rooms"/);
  assert.match(html, /data-workspace="camping"/);
  assert.doesNotMatch(html, /data-workspace="marina"/);
  assert.match(app, /new Set\(\["rooms", "camping"\]\)/);
  assert.match(preload, /new Set\(\["rooms", "camping"\]\)/);
  assert.match(mobile, /new Set\(\["rooms", "camping"\]\)/);
  assert.match(main, /createMarinaWorkspaceContexts/);
  assert.match(main, /workspaceSlug: source/);
  assert.match(main, /workspaceId: marinaConfig\.workspaceIds\[source\]/);
  assert.doesNotMatch(main, /BookingService|CommandQueue|MarinaApiClient|Migration/);
  assert.match(main, /MarinaOAuthController/);
  assert.match(main, /MarinaBookingProvider/);
});
