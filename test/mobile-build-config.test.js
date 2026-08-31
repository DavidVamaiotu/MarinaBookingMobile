"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildMobileDefines } = require("../scripts/build-mobile-web");

test("mobile build embeds normalized public Marina configuration", () => {
  const defines = buildMobileDefines({
    MARINA_INTEGRATION_ENABLED: "true",
    MARINA_API_BASE_URL: "https://booking.husi.ro/",
    MARINA_OAUTH_CLIENT_ID: " mobile-client ",
    MARINA_OAUTH_SCOPES: "bookings:write resources:read bookings:write",
    MARINA_ROOMS_WORKSPACE_ID: "2",
    MARINA_CAMPING_WORKSPACE_ID: "",
    MARINA_PRIVATE_TOKEN: "must-not-be-packaged"
  });

  assert.deepEqual(Object.fromEntries(Object.entries(defines).map(([name, value]) => [name, JSON.parse(value)])), {
    __MARINA_INTEGRATION_ENABLED__: "true",
    __MARINA_API_BASE_URL__: "https://booking.husi.ro",
    __MARINA_OAUTH_CLIENT_ID__: "mobile-client",
    __MARINA_OAUTH_SCOPES__: "bookings:write resources:read",
    __MARINA_ROOMS_WORKSPACE_ID__: "2",
    __MARINA_CAMPING_WORKSPACE_ID__: ""
  });
});
