"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const validate = require("../src/main/validation");
const { BookingDatabase } = require("../src/main/database");

test("typed IPC validators reject malformed booking intent", () => {
  assert.throws(() => validate.bookingInput({ resourceId: "x", dates: [], formData: {} }));
  assert.throws(() => validate.bookingPatch({ status: "deleted" }));
  assert.throws(() => validate.range({ start: "2026-08-01", end: "2026-07-01" }));
  assert.throws(() => validate.deposit({ deposit: 40, total: 30, note: "Avans: 10, Cost: 30, Rest: 20" }));
  assert.deepEqual(validate.deposit({ deposit: 0, total: 100, note: "Avans: 30, Cost: 100, Rest: 70" }), { deposit: 0, total: 100, note: "Avans: 30, Cost: 100, Rest: 70" });
  assert.throws(() => validate.deposit({ deposit: -1, total: 100, note: "Avans: 30, Cost: 100, Rest: 70" }), /nu poate fi negativ/);
  assert.deepEqual(validate.deposit({ deposit: 40, total: 100, note: "Info\nAvans: 30, Cost: 100, Rest: 70" }), { deposit: 40, total: 100, note: "Info\nAvans: 30, Cost: 100, Rest: 70" });
  assert.deepEqual(validate.paymentRequest({ reason: "aBcDeF", nights: 2, start_date: "2026-07-20", end_date: "2026-07-22" }), { reason: "aBcDeF", nights: 2, start_date: "2026-07-20", end_date: "2026-07-22" });
  assert.throws(() => validate.paymentRequest({ reason: "123456", nights: 2, start_date: "2026-07-20", end_date: "2026-07-22" }), /exact 6 litere/);
  assert.equal(validate.bookingInput({ resourceId: 4, dates: ["2026-07-20"], formData: { name: { value: "A", type: "text" } } }).resourceId, 4);
});

test("renderer has no persistent credential storage and settings never return a password", () => {
  const root = path.join(__dirname, "..");
  const renderer = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert.doesNotMatch(renderer, /localStorage|sessionStorage|indexedDB/);
  const db = new BookingDatabase(":memory:");
  db.saveSettings({ apiBaseUrl: "https://example.com/wp-json/marina-booking/v1", username: "api", timezone: "Europe/Bucharest", password: "must-not-save" });
  assert.equal("password" in db.getSettings(), false);
  assert.doesNotMatch(JSON.stringify(db.getSettings()), /must-not-save/);
  db.close();
});

test("preload exposes a narrow bridge and no generic IPC primitive", () => {
  const preload = fs.readFileSync(path.join(__dirname, "..", "preload.js"), "utf8");
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  assert.doesNotMatch(preload, /send:\s*ipcRenderer\.send|invoke:\s*ipcRenderer\.invoke/);
});
