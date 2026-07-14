(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PaymentRequest = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const REASON = /^[A-Za-z]{6}$/;
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const DAY_MS = 86_400_000;

  function validDate(value) {
    if (!DATE.test(String(value || ""))) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  function nightsBetween(startDate, endDate) {
    if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
      throw new TypeError("Perioada rezervării este invalidă.");
    }
    const difference = Math.round((new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / DAY_MS);
    return difference > 0 ? difference : 1;
  }

  function validate(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Datele cererii de plată sunt invalide.");
    const reason = String(input.reason || "");
    const startDate = String(input.start_date || "");
    const endDate = String(input.end_date || "");
    const nights = Number(input.nights);
    if (!REASON.test(reason)) throw new TypeError("Identificatorul plății trebuie să conțină exact 6 litere.");
    const expectedNights = nightsBetween(startDate, endDate);
    if (!Number.isInteger(nights) || nights !== expectedNights) throw new TypeError("Numărul de nopți nu corespunde perioadei rezervării.");
    return { reason, nights, start_date: startDate, end_date: endDate };
  }

  function generateReason(cryptoApi = globalThis.crypto) {
    if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") throw new Error("Nu s-a putut genera identificatorul sigur al plății.");
    let result = "";
    while (result.length < 6) {
      const bytes = new Uint8Array(6 - result.length);
      cryptoApi.getRandomValues(bytes);
      for (const byte of bytes) {
        if (byte >= 208) continue;
        result += LETTERS[byte % LETTERS.length];
      }
    }
    return result;
  }

  function fromBooking(booking, reason = generateReason()) {
    const dates = [...new Set((booking?.dates || []).map((value) => String(value).slice(0, 10)).filter(validDate))].sort();
    const startDate = validDate(booking?.startDate) ? booking.startDate : dates[0];
    const endDate = validDate(booking?.endDate) ? booking.endDate : dates[dates.length - 1];
    return validate({ reason, nights: nightsBetween(startDate, endDate), start_date: startDate, end_date: endDate });
  }

  return { fromBooking, generateReason, nightsBetween, validDate, validate };
});
