"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const validate = require("../src/main/validation");
const { MarinaStore } = require("../src/main/marina-store");

test("typed IPC validators reject malformed booking intent", () => {
  assert.throws(() => validate.bookingInput({ resourceId: "x", dates: [], formData: {} }));
  assert.throws(() => validate.bookingPatch({ status: "deleted" }));
  assert.throws(() => validate.range({ start: "2026-08-01", end: "2026-07-01" }));
  assert.throws(() => validate.deposit({ deposit: 40, total: 30, note: "Avans: 10, Cost: 30, Rest: 20" }));
  assert.deepEqual(validate.deposit({ deposit: 0, total: 100, note: "Avans: 30, Cost: 100, Rest: 70" }), { deposit: 0, total: 100, note: "Avans: 30, Cost: 100, Rest: 70" });
  assert.throws(() => validate.deposit({ deposit: -1, total: 100, note: "Avans: 30, Cost: 100, Rest: 70" }), /nu poate fi negativ/);
  assert.deepEqual(validate.deposit({ deposit: 40, total: 100, note: "Info\nAvans: 30, Cost: 100, Rest: 70" }), { deposit: 40, total: 100, note: "Info\nAvans: 30, Cost: 100, Rest: 70" });
  assert.deepEqual(validate.marinaPaymentRequest({
    send_email: true,
    payment_type: "deposit",
    payment_reason: "Avans rezervare",
    idempotencyKey: "123e4567-e89b-42d3-a456-426614174000", // gitleaks:allow — RFC 4122 example UUID fixture, not a credential
    bookingId: 91
  }), {
    send_email: true,
    payment_type: "deposit",
    payment_reason: "Avans rezervare",
    idempotencyKey: "123e4567-e89b-42d3-a456-426614174000", // gitleaks:allow — RFC 4122 example UUID fixture, not a credential
    bookingId: "91"
  });
  assert.throws(() => validate.marinaPaymentRequest({ reason: "aBcDeF", bookingId: 91 }), /Idempotency-Key/);
  assert.equal(validate.marinaBookingId("abc.123"), "abc.123");
  assert.throws(() => validate.marinaBookingId("../123"), /invalid/);
  assert.equal(validate.bookingInput({ resourceId: 4, dates: ["2026-07-20"], formData: { name: { value: "A", type: "text" } } }).resourceId, 4);
  assert.deepEqual(validate.quoteInput({ resourceId: 4, dates: ["2026-07-20"], formData: { name: { value: "A", type: "text" } }, facilityIds: [7, 4] }).facilityIds, [4, 7]);
  assert.deepEqual(validate.bookingPatch({ facilityIds: [] }).facilityIds, []);
  assert.throws(() => validate.bookingInput({ resourceId: 4, dates: ["2026-07-20"], formData: { name: { value: "A", type: "text" } }, facilityIds: [4, 4] }), /duplicate/);
});

test("Marina payment IPC validates the explicit API contract", () => {
  const electronMain = fs.readFileSync(path.join(__dirname, "..", "electron-main.js"), "utf8");
  assert.match(electronMain, /validate\.marinaPaymentRequest\(input\)/);
  assert.doesNotMatch(electronMain, /validate\.paymentRequest/);
});

test("renderer has no credential storage and Marina secrets stay opaque", () => {
  const root = path.join(__dirname, "..");
  const renderer = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert.doesNotMatch(renderer, /localStorage|sessionStorage|indexedDB/);
  const db = new MarinaStore(":memory:");
  db.setSecret("refresh", Buffer.from("encrypted-value"));
  assert.equal(Buffer.from(db.getSecret("refresh")).toString(), "encrypted-value");
  assert.equal(db.getMeta("password"), null);
  db.close();
});

test("preload exposes a narrow bridge and no generic IPC primitive", () => {
  const preload = fs.readFileSync(path.join(__dirname, "..", "preload.js"), "utf8");
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  assert.doesNotMatch(preload, /send:\s*ipcRenderer\.send|invoke:\s*ipcRenderer\.invoke/);
});
