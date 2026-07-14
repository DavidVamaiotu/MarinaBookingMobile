"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");

test("desktop packaged builds use the GitHub auto updater", () => {
  const main = read("electron-main.js");
  const builder = read("electron-builder.yml");
  assert.match(main, /app\.isPackaged/);
  assert.match(main, /autoUpdater\.checkForUpdates/);
  assert.match(main, /autoUpdater\.quitAndInstall/);
  assert.match(builder, /repo: MarinaBookingDesktop/);
  assert.match(builder, /releaseType: release/);
});

test("mobile release builds verify a checksum before opening the APK installer", () => {
  const bridge = read("mobile", "mobile-bridge.js");
  const plugin = read("android", "app", "src", "main", "java", "ro", "marinapark", "booking", "mobile", "AutoUpdaterPlugin.java");
  const manifest = read("android", "app", "src", "main", "AndroidManifest.xml");
  assert.match(bridge, /AutoUpdater\.checkAndInstall/);
  assert.match(plugin, /HASH_NAME = APK_NAME \+ "\.sha256"/);
  assert.ok(plugin.indexOf("sha256(apk)") < plugin.indexOf("openInstaller(apk)"));
  assert.match(plugin, /BuildConfig\.DEBUG/);
  assert.match(manifest, /REQUEST_INSTALL_PACKAGES/);
});

test("desktop and Android release versions stay aligned", () => {
  const pkg = JSON.parse(read("package.json"));
  const gradle = read("android", "app", "build.gradle");
  assert.equal(gradle.match(/versionName\s+"([^"]+)"/)[1], pkg.version);
});
