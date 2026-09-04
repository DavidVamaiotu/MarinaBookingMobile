"use strict";

const { toStayDateTimes } = require("../shared/booking-calendar");

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

function object(value, label = "payload") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} trebuie să fie un obiect.`);
  return value;
}

function text(value, label, max = 4000, required = false) {
  const result = String(value ?? "").trim();
  if (required && !result) throw new TypeError(`${label} este obligatoriu.`);
  if (result.length > max) throw new TypeError(`${label} este prea lung.`);
  return result;
}

function id(value, label = "id") {
  const result = text(value, label, 200, true);
  if (!/^[A-Za-z0-9:_-]+$/.test(result)) throw new TypeError(`${label} este invalid.`);
  return result;
}

function marinaBookingId(value, label = "providerId") {
  const result = text(value, label, 128, true);
  if (!/^[A-Za-z0-9._:-]+$/.test(result)) throw new TypeError(`${label} este invalid.`);
  return result;
}

function dates(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 366) throw new TypeError("Datele trebuie să conțină între 1 și 366 de valori.");
  const result = [...new Set(value.map(String))].sort();
  if (result.some((date) => !DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))) throw new TypeError("Datele trebuie să folosească valori valide în formatul AAAA-LL-ZZ.");
  return result;
}

function availabilityDates(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 366) throw new TypeError("Datele trebuie să conțină între 1 și 366 de valori.");
  const result = [...new Set(value.map(String))];
  if (result.some((date) => (!DATE.test(date) && !DATE_TIME.test(date)) || Number.isNaN(Date.parse(`${date.replace(" ", "T")}Z`)))) {
    throw new TypeError("Datele de disponibilitate trebuie să folosească formatul AAAA-LL-ZZ sau AAAA-LL-ZZ HH:mm:ss.");
  }
  return result;
}

function formData(value) {
  object(value, "formData");
  const result = {};
  for (const [name, field] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(name)) throw new TypeError("Numele unui câmp de formular este invalid.");
    object(field, `formData.${name}`);
    result[name] = { value: text(field.value, name, 2000), type: text(field.type || "text", `${name}.type`, 64, true) };
  }
  if (!Object.keys(result).length) throw new TypeError("Este necesar cel puțin un câmp de formular.");
  if (Object.keys(result).length > 80) throw Object.assign(new TypeError(`Rezervarea conține ${Object.keys(result).length} câmpuri; limita acceptată este 80.`), { code: "form_data_too_many_fields", fieldCount: Object.keys(result).length, maxFields: 80 });
  return result;
}

function facilityIds(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) throw new TypeError("facilityIds trebuie să fie o listă cu cel mult 64 de valori.");
  const result = value.map(Number);
  if (result.some((facilityId) => !Number.isSafeInteger(facilityId) || facilityId < 1)) throw new TypeError("facilityIds trebuie să conțină doar numere întregi pozitive.");
  if (new Set(result).size !== result.length) throw new TypeError("facilityIds nu poate conține valori duplicate.");
  return result.sort((a, b) => a - b);
}

function bookingInput(value) {
  value = object(value);
  const resourceId = Number(value.resourceId);
  if (!Number.isInteger(resourceId) || resourceId < 1) throw new TypeError("resourceId trebuie să fie un număr întreg pozitiv.");
  const bookingDates = dates(value.dates);
  return { resourceId, dates: bookingDates, apiDates: toStayDateTimes(bookingDates), formData: formData(value.formData), facilityIds: facilityIds(value.facilityIds), bookingFormType: text(value.bookingFormType, "bookingFormType", 80), approved: Boolean(value.approved), sendEmail: Boolean(value.sendEmail), note: text(value.note, "note"), quoteId: value.quoteId === undefined ? "" : text(value.quoteId, "quoteId", 200) };
}

function quoteInput(value) {
  value = object(value);
  const resourceId = Number(value.resourceId);
  if (!Number.isInteger(resourceId) || resourceId < 1) throw new TypeError("resourceId trebuie să fie un număr întreg pozitiv.");
  const sourceResourceId = value.sourceResourceId === undefined ? undefined : Number(value.sourceResourceId);
  if (sourceResourceId !== undefined && (!Number.isInteger(sourceResourceId) || sourceResourceId < 1)) throw new TypeError("sourceResourceId trebuie să fie un număr întreg pozitiv.");
  const mode = text(value.mode || "fast", "mode", 4, true);
  if (!["fast", "full"].includes(mode)) throw new TypeError("modul trebuie să fie fast sau full.");
  return {
    resourceId,
    sourceResourceId,
    dates: dates(value.dates),
    formData: formData(value.formData),
    facilityIds: facilityIds(value.facilityIds),
    bookingFormType: text(value.bookingFormType, "bookingFormType", 80),
    mode,
    forceFresh: Boolean(value.forceFresh)
  };
}

function bookingPatch(value) {
  value = object(value);
  const result = {};
  if (value.resourceId !== undefined) {
    result.resourceId = Number(value.resourceId);
    if (!Number.isInteger(result.resourceId) || result.resourceId < 1) throw new TypeError("resourceId trebuie să fie un număr întreg pozitiv.");
  }
  if (value.dates !== undefined) result.dates = dates(value.dates);
  if (value.formData !== undefined) result.formData = formData(value.formData);
  if (value.facilityIds !== undefined) result.facilityIds = facilityIds(value.facilityIds);
  if (value.bookingFormType !== undefined) result.bookingFormType = text(value.bookingFormType, "bookingFormType", 80);
  if (value.quoteId !== undefined) result.quoteId = text(value.quoteId, "quoteId", 200);
  if (value.status !== undefined) {
    result.status = text(value.status, "status", 20, true);
    if (!["approved", "pending"].includes(result.status)) throw new TypeError("status trebuie să fie approved sau pending.");
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
  if (!DATE.test(start) || !DATE.test(end) || start > end) throw new TypeError("Intervalul de date este invalid.");
  return { start, end };
}

function deposit(value, { requireNote = true } = {}) {
  value = object(value);
  const amount = Number(value.deposit);
  if (!Number.isFinite(amount) || amount < 0 || Math.abs(Math.round(amount * 100) - amount * 100) > 0.000001) throw new TypeError("Avansul nu poate fi negativ și trebuie să aibă cel mult două zecimale.");
  const total = Number(value.total);
  if (!Number.isFinite(total) || total <= 0 || amount > total) throw new TypeError("Costul verificat trebuie să fie pozitiv și cel puțin egal cu avansul.");
  const note = String(value.note ?? "");
  if ((requireNote && !note) || note.length > 20000) throw new TypeError("Nota rezervării este obligatorie și trebuie să aibă cel mult 20000 de caractere.");
  return { deposit: amount, total, note };
}

function marinaPaymentRequest(value) {
  value = object(value);
  const bookingId = id(value.bookingId, "bookingId");
  const idempotencyKey = text(value.idempotencyKey, "Idempotency-Key", 36, true);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) throw new TypeError("Idempotency-Key trebuie să fie un UUID v4 valid.");
  if (value.send_email !== true || value.payment_type !== "deposit" || value.payment_reason !== "Avans rezervare") {
    throw new TypeError("Cererea de plată Marina este invalidă.");
  }
  return { send_email: true, payment_type: "deposit", payment_reason: "Avans rezervare", idempotencyKey, bookingId };
}

function sagaInvoiceSettings(value) {
  value = object(value, "sagaInvoiceSettings");
  const result = {
    name: text(value.name, "Denumirea furnizorului", 200),
    cif: text(value.cif, "Codul fiscal al furnizorului", 100),
    regCom: text(value.regCom, "Numărul Registrului Comerțului", 100),
    address: text(value.address, "Adresa furnizorului", 500),
    city: text(value.city, "Localitatea furnizorului", 120),
    county: text(value.county, "Județul furnizorului", 120),
    phone: text(value.phone, "Telefonul furnizorului", 80),
    email: text(value.email, "Emailul furnizorului", 320),
    iban: text(value.iban, "IBAN-ul furnizorului", 100),
    country: text(value.country || "RO", "Țara furnizorului", 10, true),
    vatRate: text(value.vatRate ?? "11", "Cota TVA", 12, true)
  };
  const vatRate = Number(result.vatRate);
  if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) throw new TypeError("Cota TVA trebuie să fie între 0 și 100%.");
  result.vatRate = String(vatRate);
  return result;
}

function sagaInvoiceImport(value) {
  value = object(value, "sagaInvoiceImport");
  const xml = text(value.xml, "XML-ul facturii", 2_000_000, true);
  if (!/^<\?xml[\s\S]*<Facturi>[\s\S]*<Factura>[\s\S]*<\/Factura>[\s\S]*<\/Facturi>\s*$/i.test(xml)) throw new TypeError("XML-ul facturii SAGA este invalid.");
  const filename = text(value.filename, "Numele fișierului", 240, true);
  if (!/^F_[^/\\]+\.xml$/i.test(filename)) throw new TypeError("Numele fișierului SAGA este invalid.");
  return {
    xml,
    filename,
    codFiscal: text(value.codFiscal, "Codul fiscal SAGA", 100, true)
  };
}

module.exports = { availabilityDates, bookingInput, bookingPatch, dates, deposit, facilityIds, formData, id, marinaBookingId, marinaPaymentRequest, object, quoteInput, range, sagaInvoiceImport, sagaInvoiceSettings, text };
