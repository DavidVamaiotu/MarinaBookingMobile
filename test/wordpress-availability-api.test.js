"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pluginSource = fs.readFileSync(path.join(__dirname, "..", "wordpress-plugin", "marina-booking-api-v1.0.2", "marina-booking-api.php"), "utf8");

test("WordPress availability accepts a positive edited-booking exclusion", () => {
  assert.match(pluginSource, /get_param\( 'exclude_booking_id' \)/);
  assert.match(pluginSource, /marina_booking_api_invalid_exclude_booking_id/);
  assert.match(pluginSource, /self::raw_booking\( \$exclude_booking_id \)/);
});

test("WordPress availability uses Booking Calendar's native edit exclusion", () => {
  assert.match(pluginSource, /private static function dates_are_booked/);
  assert.match(pluginSource, /'skip_booking_id'\s*=> \$exclude_booking_id/);
  assert.match(pluginSource, /wpbc__where_to_save_booking/);
  assert.match(pluginSource, /'available'\s*=> ! \$is_booked/);
});
