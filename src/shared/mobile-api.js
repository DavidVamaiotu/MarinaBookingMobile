"use strict";

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

function createOperationSignature({ source, apiBaseUrl, resourceId, dates, formData, bookingFormType, approved }) {
  return JSON.stringify(canonicalValue({
    source,
    apiBaseUrl,
    resourceId: Number(resourceId),
    dates,
    formData,
    bookingFormType: String(bookingFormType || ""),
    approved: Boolean(approved)
  }));
}

function marinaStayPeriod(dates) {
  const values = [...new Set(dates || [])]
    .map((value) => String(value || "").slice(0, 10))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort();
  if (!values.length) return null;
  return {
    start_date: values[0],
    // Parkline includes the checkout date. Marina's date-only end_date is the
    // final priced night, so leave the checkout half-day available.
    end_date: values.length > 1 ? values.at(-2) : values[0]
  };
}

function marinaAvailabilityPeriod(dates) {
  const values = [...new Set(dates || [])]
    .map((value) => String(value || "").slice(0, 10))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort();
  if (!values.length) return null;
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Bucharest", timeZoneName: "longOffset" });
  const timestamp = (date, time) => {
    const zone = formatter.formatToParts(new Date(`${date}T12:00:00Z`)).find((part) => part.type === "timeZoneName")?.value || "GMT+02:00";
    return `${date}T${time}${zone.replace(/^GMT/, "") || "+00:00"}`;
  };
  return {
    start_at: timestamp(values[0], "15:00:01"),
    end_at: timestamp(values.at(-1), "12:00:02")
  };
}

function marinaCheckoutDate(endDate) {
  const value = String(endDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

const marinaBucharestDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Bucharest",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
const marinaBucharestOffsetFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Bucharest",
  timeZoneName: "longOffset"
});

function marinaDatePart(value) {
  const source = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) return source;
  if (source.includes("T")) {
    const parsed = new Date(source);
    if (Number.isFinite(parsed.getTime())) {
      const parts = Object.fromEntries(marinaBucharestDateFormatter.formatToParts(parsed).map((part) => [part.type, part.value]));
      return `${parts.year}-${parts.month}-${parts.day}`;
    }
  }
  return source.slice(0, 10);
}

function marinaAddDays(value, count) {
  const date = new Date(`${marinaDatePart(value)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function marinaDateRange(start, end) {
  const values = [];
  for (let cursor = marinaDatePart(start); /^\d{4}-\d{2}-\d{2}$/.test(cursor) && cursor <= marinaDatePart(end) && values.length < 366; cursor = marinaAddDays(cursor, 1)) values.push(cursor);
  return values;
}

function marinaTimedEndDatePart(value) {
  if (value === undefined || value === null || String(value) === "") return undefined;
  const date = marinaDatePart(value);
  const parsed = new Date(String(value || ""));
  if (!String(value || "").includes("T") || !Number.isFinite(parsed.getTime())) return date;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Bucharest",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(parsed).map((part) => [part.type, part.value]));
  return parts.hour === "00" && parts.minute === "00" && parts.second === "00" ? marinaAddDays(date, -1) : date;
}

function marinaBookingPeriods(booking) {
  for (const value of [booking?.periods, booking?.booking_periods, booking?.bookingPeriods, booking?.allocations, booking?.segments]) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function marinaBookingResourceId(booking, periods = marinaBookingPeriods(booking)) {
  const firstPeriod = periods[0] || {};
  return String(booking?.resource_id ?? booking?.resourceId ?? booking?.resource?.id ?? firstPeriod.resource_id ?? firstPeriod.resourceId ?? firstPeriod.resource?.id ?? "");
}

function marinaBookingIsTrashed(booking) {
  const status = String(booking?.status || "pending").toLowerCase();
  const trashValue = booking?.trash ?? booking?.trashed;
  const explicitTrash = trashValue === true || trashValue === 1 || ["1", "true", "trash", "trashed"].includes(String(trashValue || "").trim().toLowerCase());
  return explicitTrash || ["trash", "cancelled", "canceled", "deleted"].includes(status);
}

function marinaBookingDates(booking, resource = {}) {
  const periods = marinaBookingPeriods(booking);
  const bookingMode = String(resource?.bookingMode ?? resource?.booking_mode ?? "date_range");
  const resourceUsesDateRange = ["date_range", "full_day"].includes(bookingMode);
  const periodDates = periods.flatMap((period) => {
    const startDate = period?.start_date ?? period?.startDate;
    const endDate = period?.end_date ?? period?.endDate;
    if (startDate && endDate) return marinaDateRange(startDate, marinaCheckoutDate(endDate));
    const periodStart = period?.start_at ?? period?.startAt ?? period?.starts_at ?? period?.startsAt ?? period?.from;
    const periodEnd = period?.end_at ?? period?.endAt ?? period?.ends_at ?? period?.endsAt ?? period?.to;
    return marinaDateRange(
      periodStart,
      resourceUsesDateRange && periodEnd
        ? marinaDatePart(periodEnd)
        : marinaTimedEndDatePart(periodEnd) ?? periodStart
    );
  });
  const topLevelStartDate = booking?.start_date ?? booking?.startDate;
  const topLevelEndDate = booking?.end_date ?? booking?.endDate;
  const flattenedTimedEnd = booking?.end_at ?? booking?.endAt ?? booking?.ends_at ?? booking?.endsAt ?? booking?.to;
  const flattenedDateRange = !periods.length && resourceUsesDateRange;
  const start = topLevelStartDate ?? booking?.start_at ?? booking?.startAt ?? booking?.starts_at ?? booking?.startsAt ?? booking?.from;
  const end = topLevelEndDate
    ? marinaCheckoutDate(topLevelEndDate)
    : flattenedDateRange && flattenedTimedEnd
      ? marinaCheckoutDate(marinaDatePart(flattenedTimedEnd))
      : marinaTimedEndDatePart(flattenedTimedEnd) ?? start;
  return [...new Set(periodDates.length ? periodDates : marinaDateRange(start, end))].sort();
}

function marinaBookingQueryRange(range = {}) {
  const boundary = (value, endOfDay = false) => {
    const date = marinaDatePart(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Object.assign(new Error("Intervalul calendarului Marina este invalid."), { code: "marina_invalid_range", permanent: true });
    const timeZoneName = marinaBucharestOffsetFormatter.formatToParts(new Date(`${date}T12:00:00Z`)).find((part) => part.type === "timeZoneName")?.value || "GMT+02:00";
    const offset = timeZoneName.replace(/^GMT/, "") || "+00:00";
    return `${date}T${endOfDay ? "23:59:59" : "00:00:00"}${offset}`;
  };
  return { from: boundary(range.start), to: boundary(range.end, true) };
}

function normalizeMobilePriceQuote(payload, headers = {}) {
  const mode = String(payload?.mode || "");
  const total = Number(payload?.total);
  const deposit = Number(payload?.deposit);
  const balance = Number(payload?.balance);
  if (!["fast", "full"].includes(mode) || ![total, deposit, balance].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error("Endpoint-ul de prețuri a returnat un calcul invalid.");
  }
  return {
    ...payload,
    mode,
    total,
    deposit,
    balance,
    valid: payload.valid !== false,
    diagnostics: {
      serverMode: headers["X-Marina-Price-Mode"] || headers["x-marina-price-mode"] || null,
      serverCache: headers["X-Marina-Price-Cache"] || headers["x-marina-price-cache"] || null
    }
  };
}

function serverIdFromPayload(payload) {
  const value = Number(payload?.booking_id ?? payload?.id ?? payload?.booking?.booking_id ?? payload?.booking?.id);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function retryDelayMs(attempt, retryAfterSeconds = null, random = Math.random) {
  const retryAfter = Number(retryAfterSeconds);
  if (retryAfterSeconds !== null && retryAfterSeconds !== "" && Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(5000, retryAfter * 1000);
  const base = Math.min(5000, 500 * (2 ** Math.max(0, attempt - 1)));
  return Math.round(base * (0.75 + random() * 0.5));
}

function scopeMobileData(resources, bookings, source) {
  const scopedBookings = bookings || [];
  const referenced = new Set(scopedBookings.map((booking) => Number(booking.resourceId)));
  const scopedResources = (resources || []).filter((resource) => {
    const id = Number(resource.id);
    return resource.active !== false || referenced.has(id);
  });
  return { resources: scopedResources, bookings: scopedBookings };
}

module.exports = { canonicalValue, createOperationSignature, marinaAvailabilityPeriod, marinaBookingDates, marinaBookingIsTrashed, marinaBookingPeriods, marinaBookingQueryRange, marinaBookingResourceId, marinaCheckoutDate, marinaStayPeriod, normalizeMobilePriceQuote, retryDelayMs, scopeMobileData, serverIdFromPayload };
