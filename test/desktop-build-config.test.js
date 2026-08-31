"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPublicConfig } = require("../scripts/build-desktop");

test("desktop build keeps only configured public Marina values", () => {
  assert.deepEqual(buildPublicConfig({
    MARINA_INTEGRATION_ENABLED: "true",
    MARINA_API_BASE_URL: "https://booking.husi.ro",
    MARINA_OAUTH_CLIENT_ID: "desktop-client",
    MARINA_OAUTH_SCOPES: "resources:read bookings:read",
    MARINA_ROOMS_WORKSPACE_ID: "2",
    MARINA_CAMPING_WORKSPACE_ID: "",
    MARINA_PRIVATE_TOKEN: "must-not-be-packaged"
  }), {
    MARINA_INTEGRATION_ENABLED: "true",
    MARINA_API_BASE_URL: "https://booking.husi.ro",
    MARINA_OAUTH_CLIENT_ID: "desktop-client",
    MARINA_OAUTH_SCOPES: "resources:read bookings:read",
    MARINA_ROOMS_WORKSPACE_ID: "2"
  });
});
