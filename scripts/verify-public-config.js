"use strict";

const MarinaConfig = require("../src/shared/marina-config");

const config = MarinaConfig.createConfig(process.env);
if (!config.configured) {
  console.error("Marina release configuration is incomplete. Set MARINA_OAUTH_CLIENT_ID and MARINA_INTEGRATION_ENABLED=true.");
  process.exit(1);
}
