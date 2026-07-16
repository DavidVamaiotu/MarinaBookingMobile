"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MarinaApiClient, apiBookings, normalizeBaseUrl, normalizeBooking, normalizePriceQuote } = require("../src/main/api-client");

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

test("deposit and payment-request mutations use dedicated idempotent routes", async () => {
  const requests = [];
  const client = new MarinaApiClient({
    getConfig: async () => ({ apiBaseUrl: "https://example.com", username: "api", password: "secret" }),
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, headers: new Headers(), text: async () => '{"booking_id":44,"sent":true}' };
    }
  });
  await client.deposit_update(44, { deposit: 40, total: 100, expected_note: "Avans: 30, Cost: 100, Rest: 70" }, "deposit-key");
  await client.payment_request(44, { reason: "Avans" }, "email-key");
  assert.equal(requests[0].url, "https://example.com/wp-json/marina-booking/v1/bookings/44/deposit");
  assert.equal(requests[0].options.method, "PATCH");
  assert.equal(requests[0].options.headers["Idempotency-Key"], "deposit-key");
  assert.equal(requests[1].url, "https://example.com/wp-json/marina-booking/v1/bookings/44/payment-request");
  assert.equal(requests[1].options.headers["Idempotency-Key"], "email-key");
});

test("price previews use the read-only native pricing endpoint without an idempotency key", async () => {
  let request;
  const client = new MarinaApiClient({
    getConfig: async () => ({ apiBaseUrl: "https://example.com", username: "api", password: "secret" }),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, headers: new Headers({ "X-Marina-Price-Mode": "FAST", "X-Marina-Price-Cache": "HIT" }), text: async () => JSON.stringify({ mode: "fast", total: 960, deposit: 288, balance: 672 }) };
    }
  });
  const result = await client.price({ mode: "fast", resource_id: 14, dates: ["2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25"], form_data: { visitors: { value: "1", type: "selectbox-one" } } });
  assert.equal(request.url, "https://example.com/wp-json/marina-booking/v1/prices/calculate");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers["Idempotency-Key"], undefined);
  assert.equal(JSON.parse(request.options.body).resource_id, 14);
  assert.deepEqual(result, { mode: "fast", total: 960, deposit: 288, balance: 672, valid: true, diagnostics: { serverMode: "FAST", serverCache: "HIT" } });
});

test("price preview responses fail closed when required totals are missing or invalid", () => {
  assert.throws(() => normalizePriceQuote({ mode: "fast", total: 960, deposit: 288 }), /calcul invalid/);
  assert.throws(() => normalizePriceQuote({ mode: "fast", total: "not-a-number", deposit: 0, balance: 0 }), /calcul invalid/);
  assert.throws(() => normalizePriceQuote({ mode: "unknown", total: 810, deposit: 243, balance: 567 }), /calcul invalid/);
  assert.deepEqual(normalizePriceQuote({ mode: "full", total: "810", deposit: "243", balance: "567" }), { mode: "full", total: 810, deposit: 243, balance: 567, valid: true });
});

test("price requests support caller cancellation", async () => {
  const controller = new AbortController();
  const client = new MarinaApiClient({
    getConfig: async () => ({ apiBaseUrl: "https://example.com", username: "api", password: "secret" }),
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      const rejectAbort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      if (options.signal.aborted) rejectAbort();
      else options.signal.addEventListener("abort", rejectAbort, { once: true });
    })
  });
  const pending = client.price({ mode: "fast" }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => error.code === "request_cancelled" && error.cancelled === true);
});

test("mutations refuse to send when the configured endpoint changed while queued", async () => {
  let calls = 0;
  const client = new MarinaApiClient({
    getConfig: async () => ({ apiBaseUrl: "https://site-b.example/wp-json/marina-booking/v1", username: "api", password: "secret" }),
    fetchImpl: async () => { calls += 1; return { ok: true, status: 200, headers: new Headers(), text: async () => "{}" }; }
  });
  await assert.rejects(client.availability(14, ["2026-07-20 15:00:01"], { expectedApiBaseUrl: "https://site-a.example/wp-json/marina-booking/v1" }), (error) => error.code === "endpoint_changed");
  assert.equal(calls, 0);
});

test("in-flight mutations cannot commit after the configured endpoint changes", async () => {
  let apiBaseUrl = "https://site-a.example/wp-json/marina-booking/v1";
  let releaseResponse;
  let markStarted;
  const responseReleased = new Promise((resolve) => { releaseResponse = resolve; });
  const requestStarted = new Promise((resolve) => { markStarted = resolve; });
  const client = new MarinaApiClient({
    getConfig: async () => ({ apiBaseUrl, username: "api", password: "secret" }),
    fetchImpl: async () => {
      markStarted();
      await responseReleased;
      return { ok: true, status: 201, headers: new Headers(), text: async () => '{"booking_id":88}' };
    }
  });
  const pending = client.create({ external_id: "safe-create" }, "safe-create", { expectedApiBaseUrl: apiBaseUrl });
  await requestStarted;
  apiBaseUrl = "https://site-b.example/wp-json/marina-booking/v1";
  releaseResponse();
  await assert.rejects(pending, (error) => error.code === "endpoint_changed" && error.unknownOutcome === true);
});

test("HTTP 200 WordPress error envelopes fail closed with authentication diagnostics", async () => {
  const client = new MarinaApiClient({
    getConfig: async () => ({ apiBaseUrl: "https://example.com", username: "api", password: "expired" }),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => JSON.stringify({ code: "rest_not_logged_in", message: "Cookie expirat.", data: { status: 401 } })
    })
  });
  await assert.rejects(
    client.status(7, { status: "approved" }, "status-key"),
    (error) => error.code === "rest_not_logged_in" && error.status === 401 && error.auth === true && error.unknownOutcome === false
  );
});

test("WordPress idempotency reservations still in progress are retryable", async () => {
  const client = new MarinaApiClient({
    getConfig: async () => ({ apiBaseUrl: "https://example.com", username: "api", password: "secret" }),
    fetchImpl: async () => ({
      ok: false,
      status: 409,
      headers: new Headers(),
      text: async () => JSON.stringify({ code: "marina_booking_api_request_in_progress", message: "În curs.", data: { status: 409, retry_after: 2 } })
    })
  });
  await assert.rejects(client.note(7, { note: "Test" }, "note-key"), (error) => error.code === "marina_booking_api_request_in_progress" && error.temporary === true && error.permanent === false && error.retryAfter === 2);
});

test("malformed and empty HTTP 200 mutation responses are never treated as synchronized", async () => {
  const bodies = ["<html>proxy failure</html>", ""];
  const client = new MarinaApiClient({
    getConfig: async () => ({ apiBaseUrl: "https://example.com", username: "api", password: "secret" }),
    fetchImpl: async () => ({ ok: true, status: 200, headers: new Headers(), text: async () => bodies.shift() })
  });
  await assert.rejects(client.note(7, { note: "Test" }, "note-key"), (error) => error.code === "invalid_json_response" && error.unknownOutcome === true);
  await assert.rejects(client.trash(7, { trash: true }, "trash-key"), (error) => error.code === "empty_api_response" && error.unknownOutcome === true);
});

test("unknown booking and resource response shapes fail closed", async () => {
  assert.throws(() => apiBookings({ unexpected: true }), (error) => error.code === "invalid_bookings_response");
  const client = new MarinaApiClient({
    getConfig: async () => ({ apiBaseUrl: "https://example.com", username: "api", password: "secret" }),
    fetchImpl: async () => ({ ok: true, status: 200, headers: new Headers(), text: async () => '{"unexpected":true}' })
  });
  await assert.rejects(client.resources(), (error) => error.code === "invalid_resources_response");
  await assert.rejects(client.bookings("2026-07-01", "2026-07-31"), (error) => error.code === "invalid_bookings_response");
});

test("partial availability and malformed resource records fail closed", async () => {
  const payloads = [
    { unexpected: true },
    { resources: [{ id: 4, title: "Camera 4" }, { id: 4, title: "Duplicat" }] }
  ];
  const client = new MarinaApiClient({
    getConfig: async () => ({ apiBaseUrl: "https://example.com", username: "api", password: "secret" }),
    fetchImpl: async () => ({ ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(payloads.shift()) })
  });
  await assert.rejects(client.availability(4, ["2026-07-20"]), (error) => error.code === "invalid_availability_response");
  await assert.rejects(client.resources(), (error) => error.code === "invalid_resource_record");
});

test("incomplete booking records fail before cache reconciliation", async () => {
  const client = new MarinaApiClient({
    getConfig: async () => ({ apiBaseUrl: "https://example.com", username: "api", password: "secret" }),
    fetchImpl: async () => ({ ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify({ bookings: [{ booking_id: 7, booking_type: 4, dates: [] }] }) })
  });
  await assert.rejects(client.bookings("2026-07-01", "2026-07-31"), (error) => error.code === "invalid_booking_record");
});

test("API booking responses normalize form fields and dates", () => {
  const booking = normalizeBooking({ booking_id: "7", external_id: "create-7", booking_type: "4", dates: [{ date: "2026-07-20 00:00:00" }], form_data: { name: { value: "Jane", type: "text" } }, status: "approved", remark: "Note" });
  assert.equal(booking.serverId, 7);
  assert.equal(booking.externalId, "create-7");
  assert.equal(booking.resourceId, 4);
  assert.deepEqual(booking.dates, ["2026-07-20"]);
  assert.equal(booking.formData.name.value, "Jane");
  assert.equal(booking.note, "Note");
});

test("impossible or partially malformed booking dates cannot shorten timeline reservations", () => {
  assert.throws(
    () => normalizeBooking({ booking_id: 7, booking_type: 4, dates: [{ date: "2026-07-20" }, { date: "2026-02-31" }] }),
    (error) => error.code === "invalid_booking_record"
  );
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

test("booking pagination continues beyond the former 5000-row limit", async () => {
  let calls = 0;
  const client = new MarinaApiClient({
    getConfig: async () => ({ apiBaseUrl: "https://example.com/wp-json/marina-booking/v1", username: "api", password: "secret" }),
    fetchImpl: async (url) => {
      calls += 1;
      const page = Number(new URL(url).searchParams.get("page"));
      const count = page <= 50 ? 100 : 1;
      const bookings = Array.from({ length: count }, (_, index) => ({
        booking_id: (page - 1) * 100 + index + 1,
        booking_type: 4,
        dates: [{ date: "2026-07-20" }]
      }));
      return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify({ bookings }) };
    }
  });
  const bookings = await client.bookings("2026-03-01", "2026-11-30");
  assert.equal(bookings.length, 5001);
  assert.equal(calls, 51);
});
