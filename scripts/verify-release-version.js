"use strict";

const { readFileSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const tag = String(process.env.GITHUB_REF_NAME || process.argv[2] || "").replace(/^v/i, "");
const packageVersion = require(path.join(root, "package.json")).version;
const gradle = readFileSync(path.join(root, "android", "app", "build.gradle"), "utf8");
const androidVersion = gradle.match(/versionName\s+"([^"]+)"/)?.[1];

if (!tag) throw new Error("Release tag is required (for example v1.0.1).");
if (tag !== packageVersion || tag !== androidVersion) {
  throw new Error(`Release versions differ: tag=${tag}, package=${packageVersion}, android=${androidVersion || "missing"}.`);
}
console.log(`Release version ${tag} is consistent.`);
