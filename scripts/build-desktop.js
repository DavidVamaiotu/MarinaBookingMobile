"use strict";

const { existsSync, readFileSync, unlinkSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const MarinaConfig = require("../src/shared/marina-config");

const root = path.resolve(__dirname, "..");
const configPath = path.join(root, "marina-build-config.json");

function buildPublicConfig(environment = process.env) {
  return Object.fromEntries(MarinaConfig.PUBLIC_CONFIG_KEYS
    .map((name) => [name, environment[name]])
    .filter(([, value]) => value !== undefined && value !== ""));
}

function run() {
  const hadExistingConfig = existsSync(configPath);
  const previousConfig = hadExistingConfig ? readFileSync(configPath) : null;
  let exitCode = 0;
  writeFileSync(configPath, `${JSON.stringify(buildPublicConfig(), null, 2)}\n`);
  try {
    const builder = process.platform === "win32" ? "electron-builder.cmd" : "electron-builder";
    const result = spawnSync(builder, process.argv.slice(2), {
      cwd: root,
      stdio: "inherit",
      shell: process.platform === "win32"
    });
    if (result.error) throw result.error;
    exitCode = result.status === 0 ? 0 : result.status || 1;
  } finally {
    if (hadExistingConfig) writeFileSync(configPath, previousConfig);
    else if (existsSync(configPath)) unlinkSync(configPath);
  }
  if (exitCode) process.exitCode = exitCode;
}

if (require.main === module) run();

module.exports = { buildPublicConfig };
