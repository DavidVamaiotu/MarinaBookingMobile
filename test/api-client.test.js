"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MarinaApiClient, normalizeBaseUrl, normalizeBooking } = require("../src/main/api-client");

test("production API URLs require HTTPS and the exact REST namespace", () => {
  assert.throws(() => normalizeBaseUrl("http://example.com/wp-json/marina-booking/v1"), /HTTPS/);
  assert.throws(() => normalizeBaseUrl("https://example.com/wp-json/other/v1"), /must end/);
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
