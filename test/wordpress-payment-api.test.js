"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const source = readFileSync(path.join(__dirname, "..", "wordpress-plugin", "marina-booking-api-v1.0.2", "marina-booking-api.php"), "utf8");

test("WordPress bridge v1.0.5 exposes idempotent deposit and payment-request routes", () => {
  assert.match(source, /Version: 1\.0\.5/);
  assert.match(source, /'\/bookings\/\(\?P<id>\\\\d\+\)\/payment'/);
  assert.match(source, /'\/bookings\/\(\?P<id>\\\\d\+\)\/deposit'/);
  assert.match(source, /'\/bookings\/\(\?P<id>\\\\d\+\)\/payment-request'/);
  assert.match(source, /set_booking_deposit_operation/);
  assert.match(source, /execute_idempotent/);
});

test("deposit mutation checks the expected note and writes cost plus remark together", () => {
  assert.match(source, /hash_equals\( \$current_note, \$expected_note \)/);
  assert.match(source, /WHERE booking_id = %d AND remark = %s/);
  assert.match(source, /0 === \$updated/);
  assert.match(source, /START TRANSACTION/);
  assert.match(source, /Rest: ' \. self::format_note_amount\( \$balance \)/);
});

test("payment request delegates to Booking Calendar and increments only after success", () => {
  const sendIndex = source.indexOf("wpbc_send_email_payment_request(");
  const incrementIndex = source.indexOf("pay_request = COALESCE(pay_request, 0) + 1", sendIndex);
  assert.ok(sendIndex > 0);
  assert.ok(incrementIndex > sendIndex);
  assert.match(source, /marina_booking_api_client_email_missing/);
  assert.match(source, /marina_booking_api_payment_email_disabled/);
  assert.match(source, /'counter_updated' => 1 === \$updated/);
});

test("known server failures release their idempotency reservation for same-key retry", () => {
  assert.match(source, /release_idempotency_reservation\( \$id \)/);
  assert.match(source, /'state' => 'processing'/);
  assert.match(source, /catch \( Throwable \$exception \)[\s\S]*mark_idempotency_unknown/);
});
