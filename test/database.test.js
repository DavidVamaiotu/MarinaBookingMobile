"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { BookingDatabase } = require("../src/main/database");

function input(name = "Guest") {
  return { resourceId: 4, dates: ["2026-07-20", "2026-07-21"], formData: { name: { value: name, type: "text" } }, approved: false };
}

test("queue and optimistic booking survive restart and sending commands recover", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "marina-queue-"));
  const filename = path.join(dir, "queue.sqlite");
  const first = new BookingDatabase(filename);
  const created = first.optimisticCreate(input());
  const command = first.readyCommands()[0];
  first.markSending(command.id);
  first.close();

  const second = new BookingDatabase(filename);
  assert.equal(second.bookingRow(created.booking.localId).syncState, "queued");
  assert.equal(second.readyCommands().length, 1);
  assert.equal(second.commandRows()[0].errorCode, "restart_recovery");
  second.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("commands remain ordered per booking and resource", () => {
  const db = new BookingDatabase(":memory:");
  const created = db.optimisticCreate(input());
  db.optimisticUpdate(created.booking.localId, { note: "one" }, "note");
  const first = db.readyCommands();
  assert.equal(first.length, 1);
  assert.equal(first[0].type, "create");
  db.markCommand(first[0].id, "synced");
  assert.equal(db.readyCommands()[0].type, "note");
  db.close();
});

test("safe queued edits and notes coalesce but creates never coalesce", () => {
  const db = new BookingDatabase(":memory:");
  const first = db.optimisticCreate(input("One"));
  db.optimisticCreate(input("Two"));
  db.optimisticUpdate(first.booking.localId, { note: "draft" }, "note");
  db.optimisticUpdate(first.booking.localId, { note: "final" }, "note");
  db.optimisticUpdate(first.booking.localId, { dates: ["2026-07-22"] }, "edit");
  db.optimisticUpdate(first.booking.localId, { dates: ["2026-07-23"] }, "edit");
  const commands = db.commandRows();
  assert.equal(commands.filter((item) => item.type === "create").length, 2);
  assert.equal(commands.filter((item) => item.type === "note").length, 1);
  assert.equal(commands.find((item) => item.type === "note").payload.note, "final");
  assert.equal(commands.filter((item) => item.type === "edit").length, 1);
  assert.deepEqual(commands.find((item) => item.type === "edit").payload.dates, ["2026-07-23"]);
  db.close();
});

test("optimistic status, note, trash and edit update local state immediately", () => {
  const db = new BookingDatabase(":memory:");
  const { booking } = db.optimisticCreate(input());
  db.optimisticUpdate(booking.localId, { status: "approved" }, "status");
  db.optimisticUpdate(booking.localId, { note: "Late arrival" }, "note");
  db.optimisticUpdate(booking.localId, { trashed: true }, "trash");
  db.optimisticUpdate(booking.localId, { dates: ["2026-07-23", "2026-07-24"] }, "edit");
  const current = db.bookingRow(booking.localId);
  assert.equal(current.status, "approved");
  assert.equal(current.note, "Late arrival");
  assert.equal(current.trashed, true);
  assert.deepEqual(current.dates, ["2026-07-23", "2026-07-24"]);
  assert.equal(current.syncState, "queued");
  db.close();
});

test("remote refresh does not overwrite an optimistic overlay", () => {
  const db = new BookingDatabase(":memory:");
  db.upsertRemoteBooking({ serverId: 12, resourceId: 4, dates: ["2026-07-20"], formData: { name: { value: "Remote", type: "text" } }, status: "pending", note: "" });
  db.optimisticUpdate("server:12", { note: "Local note" }, "note");
  db.upsertRemoteBooking({ serverId: 12, resourceId: 4, dates: ["2026-07-20"], formData: { name: { value: "Remote", type: "text" } }, status: "approved", note: "Old note" });
  assert.equal(db.bookingRow("server:12").note, "Local note");
  db.close();
});
