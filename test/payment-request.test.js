"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const PaymentRequest = require("../src/shared/payment-request");

test("payment request derives the Booking Calendar period and nights", () => {
  assert.deepEqual(PaymentRequest.fromBooking({ dates: ["2026-07-20", "2026-07-21", "2026-07-22"] }, "aBcDeF"), {
    reason: "aBcDeF",
    nights: 2,
    start_date: "2026-07-20",
    end_date: "2026-07-22"
  });
  assert.equal(PaymentRequest.nightsBetween("2026-07-20", "2026-07-20"), 1);
});

test("payment reason is six random ASCII letters", () => {
  const cryptoApi = { getRandomValues(bytes) { bytes.set([0, 25, 26, 51, 52, 207]); return bytes; } };
  assert.equal(PaymentRequest.generateReason(cryptoApi), "AZazAz");
  assert.match(PaymentRequest.generateReason(cryptoApi), /^[A-Za-z]{6}$/);
});

test("payment request rejects missing dates, malformed reasons, and mismatched nights", () => {
  assert.throws(() => PaymentRequest.fromBooking({ dates: [] }, "aBcDeF"), /Perioada rezervării este invalidă/);
  assert.throws(() => PaymentRequest.validate({ reason: "ABC123", nights: 2, start_date: "2026-07-20", end_date: "2026-07-22" }), /exact 6 litere/);
  assert.throws(() => PaymentRequest.validate({ reason: "aBcDeF", nights: 3, start_date: "2026-07-20", end_date: "2026-07-22" }), /nu corespunde/);
  assert.throws(() => PaymentRequest.validate({ reason: "aBcDeF", nights: 2, start_date: "2026-02-30", end_date: "2026-03-02" }), /invalidă/);
});

test("advance-payment UI generates the reason and sends the complete API payload", () => {
  const app = readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const html = readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(app, /PaymentRequest\.fromBooking\(booking\)/);
  assert.match(app, /requestPayment", booking\.localId, \{ \.\.\.paymentRequest, source \}/);
  assert.doesNotMatch(html, /paymentReason/);
  assert.match(html, /src\/shared\/payment-request\.js/);
  const mobileBuild = readFileSync(path.join(__dirname, "..", "scripts", "build-mobile-web.js"), "utf8");
  assert.match(mobileBuild, /payment-request\.js/);
});
