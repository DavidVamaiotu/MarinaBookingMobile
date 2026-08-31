"use strict";

const RESERVATION_LINK_HOST = "booking.husi.ro";
const RESERVATION_LINK_PATH = "/open/reservation";
const RESERVATION_APP_PROTOCOL = "ro.marinapark.booking.mobile:";
const RESERVATION_APP_HOST = "reservation";
const RESERVATION_SOURCES = new Set(["rooms", "camping"]);

function parseReservationDeepLink(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    return null;
  }

  const isHttpsLink = url.protocol === "https:"
    && url.hostname === RESERVATION_LINK_HOST
    && url.pathname.replace(/\/+$/, "") === RESERVATION_LINK_PATH;
  const isAppLink = url.protocol === RESERVATION_APP_PROTOCOL
    && url.hostname === RESERVATION_APP_HOST;
  if (!isHttpsLink && !isAppLink) return null;

  const source = String(url.searchParams.get("source") || "").trim().toLowerCase();
  const bookingId = String(url.searchParams.get("booking_id") || "").trim();
  if (!RESERVATION_SOURCES.has(source)) return null;
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(bookingId)) return null;
  return { source, bookingId };
}

module.exports = {
  RESERVATION_LINK_HOST,
  RESERVATION_LINK_PATH,
  RESERVATION_APP_PROTOCOL,
  RESERVATION_APP_HOST,
  parseReservationDeepLink
};
