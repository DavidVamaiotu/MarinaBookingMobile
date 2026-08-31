"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  RESERVATION_LINK_HOST,
  RESERVATION_LINK_PATH,
  parseReservationDeepLink
} = require("../src/shared/reservation-deep-link");

const root = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const bridgeSource = fs.readFileSync(path.join(root, "mobile", "mobile-bridge.js"), "utf8");
const manifestSource = fs.readFileSync(path.join(root, "android", "app", "src", "main", "AndroidManifest.xml"), "utf8");

test("reservation links accept the booking.husi.ro Rooms and Camping contract", () => {
  assert.equal(RESERVATION_LINK_HOST, "booking.husi.ro");
  assert.equal(RESERVATION_LINK_PATH, "/open/reservation");
  assert.deepEqual(parseReservationDeepLink("https://booking.husi.ro/open/reservation?source=rooms&booking_id=123"), { source: "rooms", bookingId: "123" });
  assert.deepEqual(parseReservationDeepLink("https://booking.husi.ro/open/reservation/?source=camping&booking_id=abc-123"), { source: "camping", bookingId: "abc-123" });
  assert.deepEqual(parseReservationDeepLink("ro.marinapark.booking.mobile://reservation?source=camping&booking_id=456"), { source: "camping", bookingId: "456" });
});

test("reservation links reject foreign hosts, invalid workspaces, and unsafe IDs", () => {
  assert.equal(parseReservationDeepLink("https://example.com/open/reservation?source=rooms&booking_id=123"), null);
  assert.equal(parseReservationDeepLink("http://booking.husi.ro/open/reservation?source=rooms&booking_id=123"), null);
  assert.equal(parseReservationDeepLink("https://booking.husi.ro/open/reservation?source=other&booking_id=123"), null);
  assert.equal(parseReservationDeepLink("https://booking.husi.ro/open/reservation?source=rooms&booking_id=../../123"), null);
  assert.equal(parseReservationDeepLink("https://booking.husi.ro/open/reservation?source=rooms"), null);
});

test("Android and the mobile bridge route reservation links separately from OAuth", () => {
  assert.match(manifestSource, /android:autoVerify="true"[\s\S]*android:scheme="https"[\s\S]*android:host="booking\.husi\.ro"[\s\S]*android:pathPrefix="\/open\/reservation"/);
  assert.match(manifestSource, /android:scheme="ro\.marinapark\.booking\.mobile"[\s\S]*android:host="oauth"[\s\S]*android:path="\/callback"/);
  assert.match(bridgeSource, /parseReservationDeepLink\(url\)/);
  assert.match(bridgeSource, /App\.getLaunchUrl\(\)/);
  assert.match(bridgeSource, /startsWith\("ro\.marinapark\.booking\.mobile:\/\/oauth\/callback"\)/);
});

test("an uncached linked booking is fetched directly and opened after workspace selection", () => {
  assert.match(bridgeSource, /getBookingByProviderId\(value, requestedSource = currentSource\)/);
  assert.match(bridgeSource, /marinaRequest\(`\/v1\/bookings\/\$\{encodeURIComponent\(bookingId\)\}`/);
  assert.match(appSource, /await switchWorkspace\(link\.source\)/);
  assert.match(appSource, /getBookingByProviderId\(link\.bookingId, link\.source\)/);
  assert.match(appSource, /setVisibleMonth\(booking\.dates\[0\]\)/);
  assert.match(appSource, /await openBookingDetails\(booking\.localId\)/);
});

test("a reservation link remains pending while OAuth is completed", () => {
  assert.match(appSource, /pendingReservationLink/);
  assert.match(appSource, /applyState\(await window\.marina\.connectMarina\(\)\)/);
  assert.match(appSource, /onStateChanged\(\(next\) => \{[\s\S]*processPendingReservationLink\(\)/);
});
