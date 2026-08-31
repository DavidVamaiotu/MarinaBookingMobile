"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

function sourceBetween(start, end) {
  return appSource.slice(appSource.indexOf(start), appSource.indexOf(end));
}

test("non-editor booking overlays close before queued synchronization finishes", () => {
  const depositSave = sourceBetween('$("#saveDeposit").addEventListener("click"', "async function queuePaymentEmail");
  const statusSave = sourceBetween('$("#bookingMenuStatus").addEventListener("click"', '$("#bookingMenuTrash").addEventListener("click"');

  assert.match(depositSave, /closeBookingOverlays\(\);\s*await runApiAction\("updateDeposit"/);
  assert.match(statusSave, /closeBookingOverlays\(\);\s*await runApiAction\("setStatus"/);
});
