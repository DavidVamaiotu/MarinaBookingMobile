"use strict";

const { existsSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const candidates = process.platform === "win32"
  ? [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Android", "Sdk")]
  : [path.join(os.homedir(), "Android", "Sdk"), "/opt/android-sdk"];
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || candidates.find((candidate) => candidate && existsSync(candidate));
const env = { ...process.env };
if (sdk) {
  env.ANDROID_HOME = sdk;
  env.ANDROID_SDK_ROOT = sdk;
}

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "mobile:sync"]);
run(process.platform === "win32" ? "gradlew.bat" : "./gradlew", ["assembleDebug"], path.join(root, "android"));
