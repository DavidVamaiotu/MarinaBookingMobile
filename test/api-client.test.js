"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MarinaApiClient, apiBookings, normalizeBaseUrl, normalizeBooking } = require("../src/main/api-client");

test("API URLs accept a site origin or full endpoint and normalize the namespace", () => {
  assert.throws(() => normalizeBaseUrl("http://example.com/wp-json/marina-booking/v1"), /HTTPS/);
  assert.equal(normalizeBaseUrl(" https://www.marinapark.ro/ "), "https://www.marinapark.ro/wp-json/marina-booking/v1");
  assert.equal(normalizeBaseUrl("https://www.marinapark.ro/wp-json/marina-booking/v1/"), "https://www.marinapark.ro/wp-json/marina-booking/v1");
  assert.equal(normalizeBaseUrl("https://example.com/wordpress"), "https://example.com/wordpress/wp-json/marina-booking/v1");
  assert.equal(normalizeBaseUrl("https://example.com/wordpress/?ignored=true#ignored"), "https://example.com/wordpress/wp-json/marina-booking/v1");
  assert.equal(normalizeBaseUrl("http://localhost:8080/wp-json/marina-booking/v1/"), "http://localhost:8080/wp-json/marina-booking/v1");
});

test("API client sends Basic auth and idempotency keys only from the main process", async () => {
  let request;
  const client = new MarinaApiClient({
    getConfig: async () => ({ apiBaseUrl: "https://example.com/wp-json/marina-booking/v1", username: "api", password: "secret" }),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 201, headers: new Headers(), text: async () => '{"booking_id":123}' };
    }
  });
  await client.create({ external_id: "uuid-12345678" }, "command-key-12345678");
  assert.equal(request.options.headers["Idempotency-Key"], "command-key-12345678");
  assert.match(request.options.headers.Authorization, /^Basic /);
  assert.equal(JSON.parse(request.options.body).external_id, "uuid-12345678");
});

test("API booking responses normalize form fields and dates", () => {
  const booking = normalizeBooking({ booking_id: "7", booking_type: "4", dates: [{ date: "2026-07-20 00:00:00" }], form_data: { name: { value: "Jane", type: "text" } }, status: "approved", remark: "Note" });
  assert.equal(booking.serverId, 7);
  assert.equal(booking.resourceId, 4);
  assert.deepEqual(booking.dates, ["2026-07-20"]);
  assert.equal(booking.formData.name.value, "Jane");
  assert.equal(booking.note, "Note");
});

test("v1.0.2 object-keyed booking lists map to bookings with date approval", () => {
  const rows = apiBookings({ result: { bookings: { 6637: {
    booking_id: "6637",
    booking_type: "27",
    status: "",
    trash: "0",
    dates: [
      { booking_date: "2026-07-03 15:00:01", approved: "1" },
      { booking_date: "2026-07-04 00:00:00", approved: "1" }
    ],
    form_data: { name: "Ana", secondname: "Popescu", email: "ana@example.com", _all_: {}, _all_fields_: {} },
    remark: "Late arrival"
  } } } });
  assert.equal(rows.length, 1);
  const booking = normalizeBooking(rows[0]);
  assert.equal(booking.serverId, 6637);
  assert.equal(booking.resourceId, 27);
  assert.deepEqual(booking.dates, ["2026-07-03", "2026-07-04"]);
  assert.equal(booking.status, "approved");
  assert.equal(booking.trashed, false);
  assert.equal(booking.formData.secondname.value, "Popescu");
  assert.equal("_all_" in booking.formData, false);
});
