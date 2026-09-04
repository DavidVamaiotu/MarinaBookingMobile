(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MarinaSyncResponse = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function invalidResponse(label) {
    return Object.assign(new Error(`API-ul Marina a returnat un răspuns invalid pentru ${label}.`), {
      code: "marina_invalid_response",
      permanent: true
    });
  }

  function collection(payload, keys = [], label = "sincronizare") {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    for (const key of keys) {
      if (Array.isArray(payload?.[key])) return payload[key];
      if (Array.isArray(payload?.data?.[key])) return payload.data[key];
    }
    throw invalidResponse(label);
  }

  function validateRecord(record, kind) {
    if (!record || typeof record !== "object" || Array.isArray(record)) throw invalidResponse(kind);
    if (kind === "rezervări") {
      if (!String(record.providerId || "").trim() || !String(record.providerResourceId || "").trim() || !Array.isArray(record.dates) || !record.dates.length) throw invalidResponse(kind);
    } else if (kind === "resurse") {
      if (!String(record.providerId || "").trim()) throw invalidResponse(kind);
    } else if (kind === "facilități" && (!Number.isSafeInteger(record.id) || record.id < 1)) {
      throw invalidResponse(kind);
    }
    return record;
  }

  return { collection, invalidResponse, validateRecord };
});
