"use strict";

const { readdirSync, statSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const files = ["electron-main.js", "preload.js", "app.js"];

function collect(directory) {
  for (const entry of readdirSync(path.join(root, directory))) {
    const relative = path.join(directory, entry);
    const metadata = statSync(path.join(root, relative));
    if (metadata.isDirectory()) collect(relative);
    else if (entry.endsWith(".js")) files.push(relative);
  }
}

for (const directory of ["scripts", path.join("src", "main"), path.join("src", "shared")]) collect(directory);
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
