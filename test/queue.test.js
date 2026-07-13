"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { BookingDatabase } = require("../src/main/database");
const { CommandQueue, backoffDelay } = require("../src/main/command-queue");
const { MarinaApiClient } = require("../src/main/api-client");

function create(db) {
  return db.optimisticCreate({ resourceId: 4, dates: ["2026-07-20"], formData: { name: { value: "Guest", type: "text" } }, approved: true });
}

test("exponential backoff is bounded and jittered", () => {
  assert.equal(backoffDelay(1, () => 0), 750);
  assert.equal(backoffDelay(2, () => 0.5), 2000);
  assert.equal(backoffDelay(20, () => 1), 375000);
});

test("unknown create reconciles by external_id and does not create twice", async () => {
  const db = new BookingDatabase(":memory:");
  create(db);
  let creates = 0;
  let lookups = 0;
  const api = {
    availability: async () => ({ available: true }),
    create: async () => { creates += 1; throw Object.assign(new Error("timeout"), { unknownOutcome: true, code: "timeout_unknown" }); },
    bookingByExternalId: async () => { lookups += 1; return { serverId: 991 }; }
  };
  const queue = new CommandQueue({ database: db, api });
  const command = db.readyCommands()[0];
  await queue.execute(command);
  assert.equal(creates, 1);
  assert.equal(lookups, 1);
  assert.equal(db.commandRows()[0].status, "synced");
  assert.equal(db.bookingRow(command.booking_local_id).serverId, 991);
  db.close();
});

test("availability rejection becomes a visible conflict", async () => {
  const db = new BookingDatabase(":memory:");
  create(db);
  const queue = new CommandQueue({ database: db, api: { availability: async () => ({ available: false }) } });
  await queue.execute(db.readyCommands()[0]);
  assert.equal(db.commandRows()[0].status, "conflict");
  assert.equal(db.commandRows()[0].errorCode, "availability_conflict");
  assert.equal(db.listBookings("2026-07-20", "2026-07-20")[0].syncState, "conflict");
  db.close();
});

test("unknown create with reliable external-id miss retries the same command key", async () => {
  const db = new BookingDatabase(":memory:");
  create(db);
  const api = {
    availability: async () => ({ available: true }),
    create: async () => { throw Object.assign(new Error("timeout"), { unknownOutcome: true, code: "timeout_unknown" }); },
    bookingByExternalId: async () => { throw Object.assign(new Error("not found"), { status: 404, code: "marina_booking_api_external_id_not_found" }); }
  };
  const queue = new CommandQueue({ database: db, api, random: () => 0 });
  const command = db.readyCommands()[0];
  await queue.execute(command);
  const stored = db.commandRows()[0];
  assert.equal(stored.status, "queued");
  assert.equal(stored.id, command.id);
  assert.equal(db.getCommand(command.id).idempotency_key, command.idempotency_key);
  db.close();
});

test("authentication failure pauses the queue and credential recovery requeues it", async () => {
  const db = new BookingDatabase(":memory:");
  create(db);
  const api = { availability: async () => { throw Object.assign(new Error("Forbidden"), { auth: true, code: "forbidden" }); } };
  const queue = new CommandQueue({ database: db, api });
  await queue.execute(db.readyCommands()[0]);
  assert.equal(queue.authPaused, true);
  assert.equal(db.diagnostics().authPaused, true);
  assert.equal(db.commandRows()[0].errorCode, "authentication_failed");
  queue.resumeAfterCredentials();
  assert.equal(queue.authPaused, false);
  assert.equal(db.diagnostics().authPaused, false);
  assert.equal(db.commandRows()[0].status, "queued");
  assert.equal(db.readyCommands().length, 1);
  db.close();
});

test("queue refuses a command captured for a different API endpoint", async () => {
  const db = new BookingDatabase(":memory:");
  db.saveSettings({ apiBaseUrl: "https://site-a.example/wp-json/marina-booking/v1", username: "a" });
  create(db);
  const command = db.readyCommands()[0];
  db.saveSettings({ apiBaseUrl: "https://site-b.example/wp-json/marina-booking/v1", username: "b" });
  let networkCalls = 0;
  const queue = new CommandQueue({ database: db, api: { availability: async () => { networkCalls += 1; return { available: true }; } } });
  await queue.execute(command);
  assert.equal(networkCalls, 0);
  assert.equal(db.getCommand(command.id).status, "needs_attention");
  assert.equal(db.getCommand(command.id).error_code, "endpoint_changed");
  db.close();
});

function remoteBooking(db) {
  return db.upsertRemoteBooking({ serverId: 44, externalId: null, resourceId: 4, dates: ["2026-07-20", "2026-07-21"], status: "pending", trashed: false, note: "Avans: 30, Cost: 100, Rest: 70", formData: { email: { value: "client@example.com", type: "email" } } });
}

test("payment email waits for its deposit update and uses stable command keys", async () => {
  const db = new BookingDatabase(":memory:");
  const booking = remoteBooking(db);
  const deposit = db.queueDepositUpdate(booking.localId, 40);
  const email = db.queuePaymentRequest(booking.localId, "Plată avans");
  assert.equal(email.dependsOnCommandId, deposit.commandId);
  assert.deepEqual(db.readyCommands().map((command) => command.type), ["deposit_update"]);
  const calls = [];
  const api = {
    deposit_update: async (_id, payload, key) => { calls.push({ type: "deposit", payload, key }); return { payload: { note: "Avans: 40, Cost: 100, Rest: 60" } }; },
    payment_request: async (_id, payload, key) => { calls.push({ type: "email", payload, key }); return { payload: { sent: true } }; }
  };
  const queue = new CommandQueue({ database: db, api });
  await queue.execute(db.readyCommands()[0]);
  assert.deepEqual(db.readyCommands().map((command) => command.type), ["payment_request"]);
  await queue.execute(db.readyCommands()[0]);
  assert.deepEqual(calls.map((call) => call.type), ["deposit", "email"]);
  assert.equal(calls[0].key, deposit.commandId);
  assert.equal(calls[1].key, email.commandId);
  db.close();
});

test("deposit conflict blocks its dependent payment email", async () => {
  const db = new BookingDatabase(":memory:");
  const booking = remoteBooking(db);
  db.queueDepositUpdate(booking.localId, 40);
  db.queuePaymentRequest(booking.localId, "");
  const queue = new CommandQueue({ database: db, api: { deposit_update: async () => { throw Object.assign(new Error("Nota s-a schimbat"), { status: 409, code: "note_conflict" }); } } });
  await queue.execute(db.readyCommands()[0]);
  assert.equal(db.commandRows().find((command) => command.type === "deposit_update").status, "conflict");
  assert.equal(db.readyCommands().length, 0);
  assert.equal(db.commandRows().find((command) => command.type === "payment_request").status, "queued");
  db.close();
});

test("an old endpoint response cannot be committed after settings change mid-request", async () => {
  const db = new BookingDatabase(":memory:");
  db.saveSettings({ apiBaseUrl: "https://site-a.example/wp-json/marina-booking/v1", username: "api" });
  const created = create(db);
  let releaseResponse;
  let markStarted;
  const responseReleased = new Promise((resolve) => { releaseResponse = resolve; });
  const requestStarted = new Promise((resolve) => { markStarted = resolve; });
  const api = new MarinaApiClient({
    getConfig: async () => ({ ...db.getSettings(), password: "secret" }),
    fetchImpl: async () => {
      markStarted();
      await responseReleased;
      return { ok: true, status: 201, headers: new Headers(), text: async () => '{"booking_id":88}' };
    }
  });
  const queue = new CommandQueue({ database: db, api, skipAvailabilityChecks: true });
  const execution = queue.execute(db.getCommand(created.commandId));
  await requestStarted;
  db.saveSettings({ apiBaseUrl: "https://site-b.example/wp-json/marina-booking/v1", username: "api" });
  queue.pauseForEndpointChange();
  releaseResponse();
  await execution;
  assert.equal(db.getCommand(created.commandId).status, "needs_attention");
  assert.equal(db.getCommand(created.commandId).error_code, "endpoint_changed");
  assert.equal(db.bookingRow(created.booking.localId).serverId, null);
  db.close();
});
