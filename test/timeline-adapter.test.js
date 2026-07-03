"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { mapState, toItem } = require("../src/shared/timeline-adapter");

test("timeline adapter maps resources to lanes and bookings to bars", () => {
  const resources = [{ id: 4, title: "Room 4", capacity: 2 }, { id: 5, title: "Room 5" }];
  const bookings = [{ localId: "server:10", serverId: 10, resourceId: 4, dates: ["2026-07-20", "2026-07-21"], startDate: "2026-07-20", endDate: "2026-07-21", formData: { name: { value: "John" } }, status: "approved", syncState: "queued", trashed: false }];
  const lanes = mapState(resources, bookings);
  assert.equal(lanes.length, 2);
  assert.equal(lanes[0].items.length, 1);
  assert.equal(lanes[1].items.length, 0);
  assert.equal(toItem(bookings[0]).key, "server:10");
  assert.equal(lanes[0].items[0].title, "John");
  assert.equal(lanes[0].items[0].syncState, "queued");
});

test("timeline adapter combines WordPress first and second name fields", () => {
  const item = toItem({ localId: "server:11", serverId: 11, resourceId: 4, dates: ["2026-07-20"], startDate: "2026-07-20", endDate: "2026-07-20", formData: { name: { value: "Ana" }, secondname: { value: "Popescu" } }, status: "pending", syncState: "synced" });
  assert.equal(item.title, "Ana Popescu");
});
