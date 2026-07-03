"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { BookingDatabase } = require("../src/main/database");
const { CommandQueue, backoffDelay } = require("../src/main/command-queue");

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

test("authentication failure pauses the outbound queue", async () => {
  const db = new BookingDatabase(":memory:");
  create(db);
  const api = { availability: async () => { throw Object.assign(new Error("Forbidden"), { auth: true, code: "forbidden" }); } };
  const queue = new CommandQueue({ database: db, api });
  await queue.execute(db.readyCommands()[0]);
  assert.equal(queue.authPaused, true);
  assert.equal(db.diagnostics().authPaused, true);
  db.close();
});
