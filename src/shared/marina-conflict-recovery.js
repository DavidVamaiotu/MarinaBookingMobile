(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MarinaConflictRecovery = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  async function recoverBooking({ bookingId, fetchBooking, storeBooking }) {
    try {
      const payload = await fetchBooking(bookingId);
      const record = payload?.data?.booking || payload?.data || payload?.booking || payload;
      if (!record || typeof record !== "object" || Array.isArray(record)) return false;
      await storeBooking({ ...record, id: record.id ?? bookingId });
      return true;
    } catch {
      return false;
    }
  }

  return { recoverBooking };
});
