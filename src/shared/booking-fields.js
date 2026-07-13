(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BookingFields = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const GROUPS = Object.freeze({
    firstName: ["name", "firstname", "first_name", "given_name", "prenume"],
    lastName: ["secondname", "lastname", "last_name", "surname", "family_name", "nume"],
    email: ["email", "email_address", "emailaddress", "mail"],
    phone: ["phone", "phone_number", "phonenumber", "telephone", "tel", "mobile", "telefon"],
    adults: ["visitors", "adults", "adult", "numar_adulti", "numaradulti"],
    children: ["children", "kids", "child", "numar_copii", "numarcopii"],
    details: ["details", "detail", "detalii", "observations", "observation", "observatii", "observatie", "comments", "comment", "message", "mesaj", "mentions", "mentiuni", "special_requests", "specialrequests", "customer_note", "customer_notes"]
  });

  function normalizeName(name) {
    return String(name || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function normalizedAliases(names) {
    return new Set(names.flatMap((name) => GROUPS[name] || [name]).map(normalizeName));
  }

  function matchesName(name, ...aliases) {
    const normalized = normalizeName(name);
    const accepted = normalizedAliases(aliases);
    if (accepted.has(normalized)) return true;
    const withoutResourceSuffix = normalized.replace(/\d+$/, "");
    return withoutResourceSuffix !== normalized && accepted.has(withoutResourceSuffix);
  }

  function entries(booking, ...aliases) {
    return Object.entries(booking?.formData || {}).filter(([name]) => matchesName(name, ...aliases));
  }

  function entry(booking, ...aliases) {
    const matches = entries(booking, ...aliases);
    return matches.find(([, field]) => String(field?.value ?? "").trim()) || matches[0] || null;
  }

  function value(booking, ...aliases) {
    const match = entry(booking, ...aliases);
    return String(match?.[1]?.value ?? "").trim();
  }

  function assign(formData, canonicalName, aliases, nextValue, defaultType = "text") {
    const recognized = Object.keys(formData || {}).filter((name) => matchesName(name, canonicalName, ...aliases));
    const targets = recognized.length ? recognized : [canonicalName];
    for (const name of targets) {
      formData[name] = {
        ...(formData[name] || {}),
        value: String(nextValue ?? ""),
        type: formData[name]?.type || defaultType
      };
    }
    return formData;
  }

  function isDetailsField(name, field = {}) {
    if (matchesName(name, "details")) return true;
    return /^(textarea|multiline|textareafield)$/.test(normalizeName(field?.type));
  }

  function detailsValue(booking) {
    const named = value(booking, "details");
    if (named) return named;
    const match = Object.entries(booking?.formData || {}).find(([name, field]) => isDetailsField(name, field) && String(field?.value ?? "").trim());
    return String(match?.[1]?.value ?? "").trim();
  }

  return { GROUPS, assign, detailsValue, entries, entry, isDetailsField, matchesName, normalizeName, value };
});
