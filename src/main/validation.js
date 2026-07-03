"use strict";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function object(value, label = "payload") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value;
}

function text(value, label, max = 4000, required = false) {
  const result = String(value ?? "").trim();
  if (required && !result) throw new TypeError(`${label} is required.`);
  if (result.length > max) throw new TypeError(`${label} is too long.`);
  return result;
}

function id(value, label = "id") {
  const result = text(value, label, 200, true);
  if (!/^[A-Za-z0-9:_-]+$/.test(result)) throw new TypeError(`${label} is invalid.`);
  return result;
}

function dates(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 366) throw new TypeError("dates must contain 1 to 366 values.");
  const result = [...new Set(value.map(String))].sort();
  if (result.some((date) => !DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))) throw new TypeError("dates must use valid YYYY-MM-DD values.");
  return result;
}

function formData(value) {
  object(value, "formData");
  const result = {};
  for (const [name, field] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(name)) throw new TypeError("A form field name is invalid.");
    object(field, `formData.${name}`);
    result[name] = { value: text(field.value, name, 2000), type: text(field.type || "text", `${name}.type`, 64, true) };
  }
  if (!Object.keys(result).length) throw new TypeError("At least one form field is required.");
  return result;
}

function bookingInput(value) {
  value = object(value);
  const resourceId = Number(value.resourceId);
  if (!Number.isInteger(resourceId) || resourceId < 1) throw new TypeError("resourceId must be a positive integer.");
  return { resourceId, dates: dates(value.dates), formData: formData(value.formData), approved: Boolean(value.approved), sendEmail: Boolean(value.sendEmail), note: text(value.note, "note") };
}

function bookingPatch(value) {
  value = object(value);
  const result = {};
  if (value.resourceId !== undefined) {
    result.resourceId = Number(value.resourceId);
    if (!Number.isInteger(result.resourceId) || result.resourceId < 1) throw new TypeError("resourceId must be a positive integer.");
  }
  if (value.dates !== undefined) result.dates = dates(value.dates);
  if (value.formData !== undefined) result.formData = formData(value.formData);
  if (value.status !== undefined) {
    result.status = text(value.status, "status", 20, true);
    if (!["approved", "pending"].includes(result.status)) throw new TypeError("status must be approved or pending.");
  }
  if (value.note !== undefined) result.note = text(value.note, "note");
  if (value.trashed !== undefined) result.trashed = Boolean(value.trashed);
  result.sendEmail = Boolean(value.sendEmail);
  return result;
}

function range(value) {
  value = object(value);
  const start = text(value.start, "start", 10, true);
  const end = text(value.end, "end", 10, true);
  if (!DATE.test(start) || !DATE.test(end) || start > end) throw new TypeError("Invalid date range.");
  return { start, end };
}

function settings(value) {
  value = object(value);
  return { apiBaseUrl: text(value.apiBaseUrl, "apiBaseUrl", 500, true), username: text(value.username, "username", 200, true), password: value.password === undefined ? undefined : text(value.password, "password", 500, true), timezone: text(value.timezone || "Europe/Bucharest", "timezone", 100, true) };
}

module.exports = { bookingInput, bookingPatch, dates, formData, id, object, range, settings, text };
