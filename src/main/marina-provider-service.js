"use strict";

const { EventEmitter } = require("node:events");
const { createHash, randomUUID } = require("node:crypto");
const MarinaConfig = require("../shared/marina-config");
const { customerFromFormData, fieldValue } = require("../shared/marina-customer");
const { MANUAL_DEPOSIT_FIELD, normalizeMarinaPayment } = require("../shared/marina-payment");
const { normalizeMarinaQuote } = require("../shared/marina-quote");
const { orderMarinaResources } = require("../shared/marina-resource-order");
const { marinaBookingIsTrashed } = require("../shared/mobile-api");
const PricingNote = require("../shared/pricing-note");

const REFRESH_INTERVAL_MS = 5 * 60_000;

function collection(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["data", ...keys]) if (Array.isArray(payload?.[key])) return payload[key];
  return [];
}

function entity(payload, keys = []) {
  if (payload?.data && !Array.isArray(payload.data)) return payload.data;
  for (const key of keys) if (payload?.[key] && typeof payload[key] === "object") return payload[key];
  return payload || {};
}

function noteBodies(payload) {
  return collection(payload, ["notes", "internal_notes"])
    .map((note) => String(note?.body ?? note?.note ?? note?.text ?? "").trim())
    .filter(Boolean);
}

function joinNoteValues(values) {
  return values
    .map((value) => String(value || "").trim())
    .filter((value, index, allValues) => value && allValues.indexOf(value) === index)
    .join("\n\n");
}

function noteText(booking) {
  const hasInternalNote = Object.prototype.hasOwnProperty.call(booking || {}, "internal_note");
  if (hasInternalNote) return joinNoteValues([booking?.internal_note]);
  const primaryNote = String(booking?.note || "").trim();
  return primaryNote || joinNoteValues(noteBodies(booking));
}

function externalId(value) {
  const id = value?.id ?? value?.booking_id ?? value?.resource_id;
  if (id === undefined || id === null || String(id).trim() === "") throw Object.assign(new Error("Răspunsul Marina nu conține identificatorul necesar."), { code: "marina_invalid_response", permanent: true });
  return String(id);
}

function uiId(providerId) {
  const digest = createHash("sha256").update(`marina:${providerId}`).digest();
  return (digest.readUInt32BE(0) & 0x7fffffff) || 1;
}

const BUCHAREST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Bucharest",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
const BUCHAREST_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Bucharest",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

function datePart(value) {
  const source = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) return source;
  if (source.includes("T")) {
    const parsed = new Date(source);
    if (Number.isFinite(parsed.getTime())) {
      const parts = Object.fromEntries(BUCHAREST_DATE_FORMATTER.formatToParts(parsed).map((part) => [part.type, part.value]));
      return `${parts.year}-${parts.month}-${parts.day}`;
    }
  }
  return source.slice(0, 10);
}
function timedEndDatePart(value) {
  if (value === undefined || value === null || String(value) === "") return undefined;
  const date = datePart(value);
  const parsed = new Date(String(value || ""));
  if (!String(value || "").includes("T") || !Number.isFinite(parsed.getTime())) return date;
  const parts = Object.fromEntries(BUCHAREST_TIME_FORMATTER.formatToParts(parsed).map((part) => [part.type, part.value]));
  return parts.hour === "00" && parts.minute === "00" && parts.second === "00" ? addDays(date, -1) : date;
}
function addDays(value, count) {
  const date = new Date(`${datePart(value)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
function dateRange(start, end) {
  const values = [];
  for (let cursor = datePart(start); /^\d{4}-\d{2}-\d{2}$/.test(cursor) && cursor <= datePart(end) && values.length < 366; cursor = addDays(cursor, 1)) values.push(cursor);
  return values;
}

function stayPeriod(dates) {
  const values = [...new Set(dates || [])].map(datePart).filter(Boolean).sort();
  if (!values.length) return null;
  return {
    start_date: values[0],
    // Parkline stores arrival through checkout. Marina stores priced nights
    // with an inclusive end_date, so the checkout day is not a priced night.
    end_date: values.length > 1 ? values.at(-2) : values[0],
    units: 1
  };
}

function stayAvailabilityPeriod(dates) {
  const values = [...new Set(dates || [])].map(datePart).filter(Boolean).sort();
  if (!values.length) return null;
  return {
    // Marina availability uses the same checkout-exclusive date contract as
    // quotes and creates. The checkout date is only a handoff boundary and
    // must not be sent as an occupied night.
    start_date: values[0],
    end_date: values.length > 1 ? values.at(-2) : values[0]
  };
}

const BUCHAREST_OFFSET_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Bucharest",
  timeZoneName: "longOffset"
});

function bucharestRangeBoundary(value, endOfDay = false) {
  const date = datePart(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Object.assign(new Error("Intervalul calendarului Marina este invalid."), { code: "marina_invalid_range", permanent: true });
  const timeZoneName = BUCHAREST_OFFSET_FORMATTER.formatToParts(new Date(`${date}T12:00:00Z`)).find((part) => part.type === "timeZoneName")?.value || "GMT+02:00";
  const offset = timeZoneName.replace(/^GMT/, "") || "+00:00";
  return `${date}T${endOfDay ? "23:59:59" : "00:00:00"}${offset}`;
}

function field(formData, name) { return String(formData?.[name]?.value ?? "").trim(); }

function numericProviderResourceId(resource) {
  const value = Number(resource?.providerId);
  if (!Number.isSafeInteger(value) || value < 1) throw Object.assign(new Error("Identificatorul resursei Marina este invalid."), { code: "marina_resource_id_invalid", permanent: true });
  return value;
}

function normalizeFacilityIds(values) {
  const ids = [...new Set((Array.isArray(values) ? values : []).map(Number))].sort((a, b) => a - b);
  if (ids.length > 64 || ids.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    throw Object.assign(new Error("Selecția facilităților Marina este invalidă."), { code: "marina_facility_ids_invalid", permanent: true });
  }
  return ids;
}

function normalizeFacility(facility) {
  const id = Number(facility?.id);
  if (!Number.isSafeInteger(id) || id < 1) throw Object.assign(new Error("API-ul Marina a returnat o facilitate invalidă."), { code: "marina_invalid_response", permanent: true });
  const priceMinor = Number(facility.price_per_night_minor ?? facility.pricePerNightMinor);
  return {
    id,
    name: String(facility.name || "").trim(),
    currency: String(facility.currency || "RON"),
    billingPeriod: String(facility.billing_period ?? facility.billingPeriod ?? "night"),
    pricePerNightMinor: Number.isSafeInteger(priceMinor) && priceMinor >= 0 ? priceMinor : 0,
    appliesToAllResources: facility.applies_to_all_resources === true || facility.appliesToAllResources === true,
    resourceIds: (facility.resource_ids ?? facility.resourceIds ?? []).map(String),
    active: facility.active !== false,
    version: facility.version ?? null
  };
}

function normalizeFacilitySnapshots(booking) {
  if (Array.isArray(booking?.facilities)) return booking.facilities.map((facility) => ({
    id: Number(facility.id ?? facility.facility_id),
    name: String(facility.name || ""),
    currency: String(facility.currency || "RON"),
    billingPeriod: String(facility.billing_period ?? facility.billingPeriod ?? "night"),
    pricePerNightMinor: Number(facility.price_per_night_minor ?? facility.pricePerNightMinor) || 0
  })).filter((facility) => Number.isSafeInteger(facility.id) && facility.id > 0);
  return normalizeFacilityIds(booking?.facility_ids).map((id) => ({ id }));
}

function quoteBody(input, resources) {
  const resource = resources.find((item) => Number(item.id) === Number(input.resourceId));
  if (!resource) throw Object.assign(new Error("Resursa Marina selectată nu mai este disponibilă."), { code: "marina_resource_missing", permanent: true });
  const period = stayPeriod(input.dates);
  if (!period) throw Object.assign(new Error("Cotația Marina necesită cel puțin o dată."), { code: "marina_quote_dates_missing", permanent: true });
  return {
    resource_id: numericProviderResourceId(resource),
    periods: [period],
    guests: {
      adults: Number(field(input.formData, "visitors")) || 1,
      children: Number(field(input.formData, "children")) || 0
    },
    facility_ids: normalizeFacilityIds(input.facilityIds)
  };
}

function sameDates(first = [], second = []) {
  const left = [...new Set(first || [])].map(datePart).sort();
  const right = [...new Set(second || [])].map(datePart).sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function pricingChanged(current, next) {
  const currentAdults = Number(field(current.formData, "visitors")) || 1;
  const nextAdults = Number(field(next.formData, "visitors")) || 1;
  const currentChildren = Number(field(current.formData, "children")) || 0;
  const nextChildren = Number(field(next.formData, "children")) || 0;
  const currentFacilities = normalizeFacilityIds(current.facilityIds ?? current.facilities?.map((facility) => facility.id));
  const nextFacilities = normalizeFacilityIds(next.facilityIds ?? next.facilities?.map((facility) => facility.id));
  return Number(current.resourceId) !== Number(next.resourceId)
    || !sameDates(current.dates, next.dates)
    || currentAdults !== nextAdults
    || currentChildren !== nextChildren
    || !sameDates(currentFacilities, nextFacilities);
}

function normalizeResource(resource) {
  const providerId = externalId(resource);
  return {
    id: uiId(providerId),
    provider: "marina",
    providerId,
    title: String(resource.title || resource.name || resource.label || `Marina ${providerId}`),
    capacity: Number(resource.capacity) || null,
    capacityMode: String(resource.capacity_mode ?? resource.capacityMode ?? "exclusive"),
    capacityUnitMode: String(resource.capacity_unit_mode ?? resource.capacityUnitMode ?? "per_booking"),
    baseCost: resource.base_cost ?? resource.baseCost ?? null,
    defaultForm: "marina",
    bookingMode: String(resource.booking_mode ?? resource.bookingMode ?? "date_range"),
    timezone: resource.timezone || "Europe/Bucharest",
    active: resource.active !== false,
    settings: resource.settings && typeof resource.settings === "object" ? { ...resource.settings } : {},
    version: resource.version ?? null
  };
}

function normalizedFormData(booking) {
  const customer = booking.customer || booking.guest || {};
  const guests = booking.guests || {};
  const source = booking.form_data || booking.formData || {};
  const result = {};
  const add = (name, value, type = "text") => { if (value !== undefined && value !== null && String(value) !== "") result[name] = { value: String(value), type }; };
  for (const [name, value] of Object.entries(source)) add(name, value?.value ?? value, value?.type || "text");
  for (const [name, value] of Object.entries(customer.custom_fields || {})) add(name, fieldValue(value), value?.type || "text");
  for (const [name, value] of Object.entries(customer.address || {})) add(`address_${name}`, fieldValue(value));
  for (const [name, value] of Object.entries(booking.custom_fields || {})) {
    if (name === "migration" || name === MANUAL_DEPOSIT_FIELD) continue;
    add(name, fieldValue(value), value?.type || "text");
  }
  add("name", customer.first_name ?? customer.firstName ?? booking.first_name ?? booking.name);
  add("secondname", customer.last_name ?? customer.lastName ?? booking.last_name ?? booking.secondname);
  add("email", customer.email ?? booking.email, "email");
  add("phone", customer.phone ?? booking.phone);
  add("visitors", guests.adults ?? booking.adults, "selectbox-one");
  add("children", guests.children ?? booking.children, "selectbox-one");
  return result;
}

function bookingPeriods(booking) {
  for (const value of [booking.periods, booking.booking_periods, booking.bookingPeriods, booking.allocations, booking.segments]) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function normalizeBooking(booking, resources) {
  const providerId = externalId(booking);
  const periods = bookingPeriods(booking);
  const firstPeriod = periods[0] || {};
  const providerResourceId = String(booking.resource_id ?? booking.resourceId ?? booking.resource?.id ?? firstPeriod.resource_id ?? firstPeriod.resourceId ?? firstPeriod.resource?.id ?? "");
  const resource = resources.find((item) => item.providerId === providerResourceId);
  const resourceUsesDateRange = ["date_range", "full_day"].includes(resource?.bookingMode);
  const periodDates = periods.flatMap((period) => {
    const startDate = period.start_date ?? period.startDate;
    const endDate = period.end_date ?? period.endDate;
    // Marina date-only end_date is always the final occupied night. The
    // calendar model also needs the following checkout day for half-day
    // positioning. List responses do not reliably include custom metadata,
    // so this must be derived from the period contract itself.
    if (startDate && endDate) return dateRange(startDate, addDays(endDate, 1));
    const periodStart = period.start_at ?? period.startAt ?? period.starts_at ?? period.startsAt ?? period.from;
    const periodEnd = period.end_at ?? period.endAt ?? period.ends_at ?? period.endsAt ?? period.to;
    return dateRange(
      periodStart,
      resourceUsesDateRange && periodEnd
        ? datePart(periodEnd)
        : timedEndDatePart(periodEnd) ?? periodStart
    );
  });
  const topLevelStartDate = booking.start_date ?? booking.startDate;
  const topLevelEndDate = booking.end_date ?? booking.endDate;
  const flattenedTimedEnd = booking.end_at ?? booking.endAt ?? booking.ends_at ?? booking.endsAt ?? booking.to;
  const flattenedDateRange = !periods.length && resourceUsesDateRange;
  const start = topLevelStartDate ?? booking.start_at ?? booking.startAt ?? booking.starts_at ?? booking.startsAt ?? booking.from;
  const end = topLevelEndDate
    ? addDays(topLevelEndDate, 1)
    : flattenedDateRange && flattenedTimedEnd
      ? addDays(datePart(flattenedTimedEnd), 1)
      : timedEndDatePart(flattenedTimedEnd) ?? start;
  const status = String(booking.status || "pending").toLowerCase();
  const facilities = normalizeFacilitySnapshots(booking);
  return {
    localId: `marina:${providerId}`,
    serverId: providerId,
    externalId: providerId,
    provider: "marina",
    providerId,
    providerResourceId,
    resourceId: resource?.id || uiId(providerResourceId),
    status: ["approved", "confirmed", "active", "completed"].includes(status) ? "approved" : "pending",
    providerStatus: status,
    trashed: marinaBookingIsTrashed(booking),
    note: noteText(booking),
    price: booking.price && typeof booking.price === "object" ? { ...booking.price } : null,
    facilities,
    facilityIds: facilities.map((facility) => facility.id),
    formData: normalizedFormData(booking),
    dates: periodDates.length ? [...new Set(periodDates)].sort() : dateRange(start, end),
    syncState: "synced",
    version: booking.version ?? booking.etag ?? null,
    serverUpdatedAt: booking.updated_at ?? booking.updatedAt ?? null
  };
}

function bookingBody(input, resources) {
  const quote = quoteBody(input, resources);
  const body = {
    ...quote,
    customer: customerFromFormData(input.formData),
    guests: quote.guests,
    custom_fields: {},
    internal_note: String(input.note || ""),
    send_email: Boolean(input.sendEmail)
  };
  if (input.quoteId) body.quote_id = String(input.quoteId);
  return body;
}

function bookingPatchBody(current, patch, resources) {
  const merged = { ...current, ...patch, formData: patch.formData || current.formData, dates: patch.dates || current.dates, facilityIds: patch.facilityIds ?? current.facilityIds };
  const body = {};
  if (pricingChanged(current, merged)) {
    const quote = quoteBody(merged, resources);
    body.resource_id = quote.resource_id;
    body.periods = quote.periods;
    body.guests = quote.guests;
    body.facility_ids = quote.facility_ids;
    if (patch.quoteId) body.quote_id = String(patch.quoteId);
  }
  const previousCustomer = customerFromFormData(current.formData);
  const nextCustomer = customerFromFormData(merged.formData);
  if (JSON.stringify(previousCustomer) !== JSON.stringify(nextCustomer)) body.customer = nextCustomer;
  if (String(current.note || "") !== String(merged.note || "")) body.internal_note = String(merged.note || "");
  if (Object.prototype.hasOwnProperty.call(patch, "sendEmail")) body.send_email = Boolean(patch.sendEmail);
  return body;
}

class MarinaBookingProvider extends EventEmitter {
  constructor({ config, oauth, api, cacheStore = null } = {}) {
    super();
    this.config = config;
    this.oauth = oauth;
    this.api = api;
    this.visibleRange = null;
    this.cacheStore = cacheStore;
    const loadedCache = cacheStore?.load?.() || {};
    const expectedWorkspaceSlug = config.workspaceSlug || api.workspaceSlug || "";
    const cached = !expectedWorkspaceSlug || loadedCache.workspaceSlug === undefined || loadedCache.workspaceSlug === expectedWorkspaceSlug ? loadedCache : {};
    this.resources = Array.isArray(cached.resources) ? cached.resources : [];
    this.facilities = Array.isArray(cached.facilities) ? cached.facilities : [];
    this.bookings = Array.isArray(cached.bookings) ? cached.bookings : [];
    this.lastSuccessfulSync = cached.lastSuccessfulSync || null;
    this.noteOverrides = new Map(Object.entries(cached.noteOverrides && typeof cached.noteOverrides === "object" ? cached.noteOverrides : {}));
    this.manualDepositOverrides = new Map(Object.entries(cached.manualDepositOverrides && typeof cached.manualDepositOverrides === "object" ? cached.manualDepositOverrides : {})
      .map(([providerId, minor]) => [providerId, Number(minor)])
      .filter(([, minor]) => Number.isInteger(minor) && minor >= 0));
    this.online = false;
    this.refreshInFlight = null;
    // Idempotency keys for booking mutations, kept per logical operation until the
    // outcome is definitive so a retry after an unknown-outcome failure reuses the
    // same key and the server can dedupe instead of creating a duplicate booking.
    this.mutationKeys = new Map();
    this.refreshTimer = null;
    this.noteRequests = new Map();
    oauth.on("changed", () => this.emitState());
  }

  start() {
    this.refreshTimer = setInterval(() => { if (this.visibleRange && this.oauth.status().connected) void this.refresh(this.visibleRange).catch(() => {}); }, REFRESH_INTERVAL_MS);
    this.refreshTimer.unref?.();
    if (this.oauth.status().connected && typeof this.oauth.refresh === "function") {
      void this.oauth.refresh().then(() => this.emitState()).catch(() => this.emitState());
    }
  }
  stop() { if (this.refreshTimer) clearInterval(this.refreshTimer); }

  settings() {
    const oauth = this.oauth.status();
    const capabilities = MarinaConfig.capabilities(oauth.effectiveScopes);
    return {
      provider: "marina",
      enabled: this.config.enabled,
      configured: this.config.configured,
      credentialsConfigured: oauth.connected,
      connected: oauth.connected,
      connecting: oauth.connecting,
      oauthClientConfigured: Boolean(this.config.clientId),
      oauthScopes: oauth.effectiveScopes.join(" "),
      capabilities,
      apiBaseUrl: this.config.apiBaseUrl,
      workspaceId: this.api.workspaceId ?? this.config.workspaceId ?? null,
      workspaceSlug: this.config.workspaceSlug || this.api.workspaceSlug || "",
      configurationError: this.config.configurationError,
      timezone: "Europe/Bucharest",
      connectionStatus: oauth.connected ? "connected" : oauth.connecting ? "connecting" : this.config.configured ? "disconnected" : "disabled"
    };
  }

  state(range = this.visibleRange) {
    const dates = range || { start: new Date().toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10) };
    const connected = this.oauth.status().connected;
    return {
      provider: "marina",
      resources: [...this.resources],
      facilities: [...this.facilities],
      bookings: this.bookings.filter((item) => item.dates.some((date) => date >= dates.start && date <= dates.end)),
      commands: [],
      diagnostics: { provider: "marina", online: this.online, authPaused: !connected, queued: 0, sending: 0, failed: 0, conflicts: 0, lastSuccessfulSync: this.lastSuccessfulSync },
      settings: this.settings(),
      range: dates
    };
  }
  emitState() { this.emit("state", this.state()); }

  persistCache(bookings = this.bookings) {
    this.cacheStore?.save?.({
      workspaceId: this.api.workspaceId ?? this.config.workspaceId ?? null,
      workspaceSlug: this.config.workspaceSlug || this.api.workspaceSlug || "",
      resources: this.resources,
      facilities: this.facilities,
      bookings,
      lastSuccessfulSync: this.lastSuccessfulSync,
      noteOverrides: Object.fromEntries(this.noteOverrides),
      manualDepositOverrides: Object.fromEntries(this.manualDepositOverrides)
    });
  }

  storeMutationBooking(booking, options = {}) {
    if (Object.prototype.hasOwnProperty.call(options, "noteOverride")) {
      this.noteOverrides.set(booking.providerId, String(options.noteOverride ?? ""));
      booking.note = String(options.noteOverride ?? "");
    }
    const index = this.bookings.findIndex((item) => item.localId === booking.localId);
    if (index === -1) this.bookings = [...this.bookings, booking];
    else this.bookings = this.bookings.map((item, itemIndex) => itemIndex === index ? booking : item);
    this.persistCache();
    this.emitState();
    return booking;
  }

  normalizeBookings(records, previousBookings = this.bookings) {
    const previous = new Map(previousBookings.map((booking) => [booking.providerId, booking]));
    return records.map((booking) => {
      const normalized = normalizeBooking(booking, this.resources);
      const cached = previous.get(normalized.providerId);
      if (this.noteOverrides.has(normalized.providerId)) {
        const override = this.noteOverrides.get(normalized.providerId);
        const responseHasNote = Object.prototype.hasOwnProperty.call(booking || {}, "internal_note")
          || Object.prototype.hasOwnProperty.call(booking || {}, "note");
        if (responseHasNote && normalized.note === override) this.noteOverrides.delete(normalized.providerId);
        else normalized.note = override;
      } else if (!normalized.note && cached?.note) normalized.note = cached.note;
      return normalized;
    });
  }

  fetchNotes(providerId) {
    const key = String(providerId);
    const existing = this.noteRequests.get(key);
    if (existing) return existing;
    const request = Promise.resolve(this.api.listNotes(providerId))
      .then((response) => noteBodies(response.payload))
      .finally(() => {
        if (this.noteRequests.get(key) === request) this.noteRequests.delete(key);
      });
    this.noteRequests.set(key, request);
    return request;
  }

  bookingSnapshot(booking) {
    const period = stayPeriod(booking.dates);
    return {
      id: booking.providerId,
      resource_id: Number(booking.providerResourceId),
      status: booking.providerStatus || booking.status,
      periods: period ? [period] : [],
      customer: customerFromFormData(booking.formData),
      guests: {
        adults: Number(field(booking.formData, "visitors")) || 1,
        children: Number(field(booking.formData, "children")) || 0
      },
      internal_note: booking.note || "",
      facilities: booking.facilities || [],
      facility_ids: normalizeFacilityIds(booking.facilityIds),
      version: booking.version
    };
  }

  async connect() { await this.oauth.connect(); return this.state(); }
  async disconnect() {
    await this.oauth.disconnect();
    this.resources = [];
    this.facilities = [];
    this.bookings = [];
    this.online = false;
    this.lastSuccessfulSync = null;
    this.noteOverrides.clear();
    this.manualDepositOverrides.clear();
    this.persistCache([]);
    return this.state();
  }

  async refresh(range) {
    this.visibleRange = range;
    if (!this.oauth.status().connected) return this.state(range); // Never probe protected endpoints before OAuth.
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      try {
        const capabilities = this.settings().capabilities;
        if (!capabilities.resourcesRead) {
          this.resources = [];
          this.facilities = [];
          this.bookings = [];
          this.online = true;
          this.emitState();
          return this.state(range);
        }
        const resourcesResponse = await this.api.resources();
        this.resources = orderMarinaResources(collection(resourcesResponse.payload, ["resources"]).map(normalizeResource), { ignoreLegacy32: this.config.workspaceSlug !== "camping" });
        const facilitiesResponse = typeof this.api.facilities === "function" ? await this.api.facilities() : { payload: { data: [] } };
        this.facilities = collection(facilitiesResponse.payload, ["facilities"]).map(normalizeFacility);
        const loaded = [];
        if (capabilities.bookingsRead) {
          let after = null;
          const from = bucharestRangeBoundary(range.start);
          const to = bucharestRangeBoundary(range.end, true);
          let pages = 0;
          do {
          const response = await this.api.bookings({ from, to, after, limit: 200 });
            loaded.push(...collection(response.payload, ["bookings"]));
            after = response.payload?.next_cursor ?? response.payload?.pagination?.next_cursor ?? response.payload?.meta?.next_cursor ?? null;
            if (after && ++pages > 50) throw Object.assign(new Error("Sincronizarea Marina a întâlnit prea multe pagini de rezervări."), { code: "marina_sync_page_limit", temporary: true });
          } while (after);
        }
        this.bookings = this.normalizeBookings(loaded);
        this.online = true;
        this.lastSuccessfulSync = new Date().toISOString();
        this.persistCache();
        const result = this.state(range);
        this.emit("state", result);
        return result;
      } catch (error) {
        this.online = Boolean(error.auth);
        this.emitState();
        throw error;
      } finally { this.refreshInFlight = null; }
    })();
    return this.refreshInFlight;
  }

  findBooking(localId) {
    const booking = this.bookings.find((item) => item.localId === String(localId));
    if (!booking) throw Object.assign(new Error("Rezervarea Marina nu mai există în cache-ul curent."), { code: "marina_booking_missing", permanent: true });
    return booking;
  }

  async details(localId) {
    const current = this.findBooking(localId);
    const bookingResponse = await this.api.booking(current.providerId);
    const detailedRecord = entity(bookingResponse.payload, ["booking"]);
    const detailed = normalizeBooking(detailedRecord, this.resources);
    const hasInternalNote = Object.prototype.hasOwnProperty.call(detailedRecord || {}, "internal_note");
    const hasNoteOverride = this.noteOverrides.has(current.providerId);
    const noteOverride = hasNoteOverride ? this.noteOverrides.get(current.providerId) : null;
    if (hasNoteOverride) {
      if (hasInternalNote && detailed.note === noteOverride) this.noteOverrides.delete(current.providerId);
      else detailed.note = noteOverride;
    }
    const notesPromise = hasNoteOverride || hasInternalNote || detailed.note || current.note
      ? Promise.resolve([])
      : this.fetchNotes(current.providerId).catch(() => []);
    const merge = (noteValues) => ({
      ...current,
      ...detailed,
      resourceId: detailed.providerResourceId ? detailed.resourceId : current.resourceId,
      providerResourceId: detailed.providerResourceId || current.providerResourceId,
      dates: detailed.dates.length ? detailed.dates : current.dates,
      note: joinNoteValues([
        detailed.note || (!hasInternalNote ? current.note : ""),
        ...(!hasInternalNote && !detailed.note && !current.note ? noteValues : [])
      ])
    });
    let merged = merge([]);
    this.bookings = this.bookings.map((booking) => booking.localId === merged.localId ? merged : booking);
    this.persistCache();
    this.emitState();
    const fetchedNotes = await notesPromise;
    const withNotes = merge(fetchedNotes);
    if (withNotes.note !== merged.note) {
      merged = withNotes;
      this.bookings = this.bookings.map((booking) => booking.localId === merged.localId ? merged : booking);
      this.persistCache();
      this.emitState();
    }
    return merged;
  }
  refreshAfterMutation() {
    if (!this.visibleRange) return this.state();
    const range = { ...this.visibleRange };
    const pending = this.refreshInFlight;
    void Promise.resolve(pending).catch(() => {}).then(() => this.refresh(range)).catch(() => {});
    return this.state();
  }

  async idempotentMutation(scope, run) {
    if (!this.mutationKeys) this.mutationKeys = new Map();
    let key = this.mutationKeys.get(scope);
    if (!key) {
      key = randomUUID();
      if (this.mutationKeys.size >= 50) this.mutationKeys.delete(this.mutationKeys.keys().next().value);
      this.mutationKeys.set(scope, key);
    }
    let result;
    try { result = await run(key); }
    catch (error) {
      this.settleMutationKey(scope, error);
      throw error;
    }
    this.settleMutationKey(scope, null);
    return result;
  }

  settleMutationKey(scope, error) {
    if (!this.mutationKeys?.has(scope)) return;
    // Keep the key while the outcome is unknown (network/timeout/5xx/429) so a retry
    // reuses it; discard once the server gave a definitive answer.
    const unknown = !error || error.status === undefined || error.status === 408 || error.status === 429 || error.status >= 500;
    if (!unknown) this.mutationKeys.delete(scope);
  }

  async create(input) {
    if (!input.quoteId) throw Object.assign(new Error("Rezervarea Marina necesită o cotație confirmată."), { code: "marina_quote_required", permanent: true });
    const finalQuote = normalizeMarinaQuote((await this.api.quote(quoteBody(input, this.resources))).payload, { mode: "full" });
    const body = bookingBody({ ...input, quoteId: finalQuote.quoteId }, this.resources);
    body.status = input.approved ? "approved" : "pending";
    const response = await this.idempotentMutation(JSON.stringify(["create", body]), (key) => this.api.createBooking(body, key));
    const created = entity(response.payload, ["booking"]);
    const createdRecord = { ...body, ...created };
    if (!String(createdRecord.note || createdRecord.internal_note || "").trim() && body.internal_note) createdRecord.internal_note = body.internal_note;
    const normalized = this.storeMutationBooking(normalizeBooking(createdRecord, this.resources));
    this.refreshAfterMutation();
    return normalized;
  }

  async update(localId, patch, type = "edit") {
    const booking = this.findBooking(localId);
    let response;
    let mutationBody;
    try {
      if (type === "status") {
        mutationBody = { status: patch.status, send_email: Boolean(patch.sendEmail) };
        response = await this.idempotentMutation(JSON.stringify(["status", booking.providerId, mutationBody, booking.version]), (key) => this.api.changeBookingStatus(booking.providerId, mutationBody, key, booking.version));
      }
      else if (type === "trash") {
        const trashed = Boolean(patch.trashed);
        mutationBody = { status: trashed ? "cancelled" : "pending", send_email: Boolean(patch.sendEmail) };
        response = trashed
          ? await this.idempotentMutation(JSON.stringify(["trash", trashed, booking.providerId, mutationBody, booking.version]), (key) => this.api.cancelBooking(booking.providerId, { send_email: mutationBody.send_email }, key, booking.version))
          : await this.idempotentMutation(JSON.stringify(["status", booking.providerId, mutationBody, booking.version]), (key) => this.api.changeBookingStatus(booking.providerId, mutationBody, key, booking.version));
      } else if (type === "note") {
        mutationBody = { internal_note: String(patch.note ?? "") };
        response = await this.idempotentMutation(JSON.stringify(["note", booking.providerId, mutationBody, booking.version]), (key) => this.api.updateBooking(booking.providerId, mutationBody, key, booking.version));
      }
      else {
        const merged = { ...booking, ...patch, formData: patch.formData || booking.formData, dates: patch.dates || booking.dates, facilityIds: patch.facilityIds ?? booking.facilityIds };
        const repricing = pricingChanged(booking, merged);
        if (repricing && !patch.quoteId) throw Object.assign(new Error("Modificarea prețului Marina necesită o cotație nouă."), { code: "marina_quote_required", permanent: true });
        const finalPatch = repricing
          ? { ...patch, quoteId: normalizeMarinaQuote((await this.api.quote(quoteBody(merged, this.resources))).payload, { mode: "full" }).quoteId }
          : patch;
        mutationBody = bookingPatchBody(booking, finalPatch, this.resources);
        response = await this.idempotentMutation(JSON.stringify(["edit", booking.providerId, mutationBody, booking.version]), (key) => this.api.updateBooking(booking.providerId, mutationBody, key, booking.version));
      }
    } catch (error) {
      if (error?.status === 412) {
        await Promise.allSettled([
          this.details(localId),
          booking.providerResourceId && typeof this.api.pricing === "function" ? this.api.pricing(booking.providerResourceId) : Promise.resolve()
        ]);
        throw Object.assign(new Error("Rezervarea Marina s-a schimbat între timp. Datele actualizate au fost încărcate; verificați din nou valorile înainte de salvare."), error, { code: "marina_stale_version", conflict: true, permanent: true });
      }
      throw error;
    }
    const returned = response?.payload?.data?.booking || response?.payload?.data || response?.payload?.booking || response?.payload || {};
    const returnedId = returned?.booking_id ?? returned?.id;
    const authoritative = returnedId !== undefined && String(returnedId) === booking.providerId ? returned : {};
    const hasNoteMutation = Object.prototype.hasOwnProperty.call(mutationBody || {}, "internal_note");
    const noteOverride = hasNoteMutation ? String(mutationBody.internal_note ?? "") : undefined;
    const normalized = this.storeMutationBooking(normalizeBooking({
      ...this.bookingSnapshot(booking),
      ...mutationBody,
      ...authoritative,
      ...(hasNoteMutation ? { internal_note: noteOverride } : {}),
      id: booking.providerId
    }, this.resources), hasNoteMutation ? { noteOverride } : {});
    this.refreshAfterMutation();
    return normalized;
  }

  async availability(resourceId, dates, { excludeBookingId } = {}) {
    const resource = this.resources.find((item) => Number(item.id) === Number(resourceId));
    const period = stayAvailabilityPeriod(dates);
    const body = { resource_id: numericProviderResourceId(resource), periods: [period], units: 1 };
    const response = await this.api.availabilityCheck(body);
    return entity(response.payload);
  }

  async quote(input) {
    const response = await this.api.quote(quoteBody(input, this.resources));
    return normalizeMarinaQuote(response.payload, { mode: input.mode || "full" });
  }
  clearQuoteCache() {}
  async payment(localId) {
    const booking = this.findBooking(localId);
    const response = await this.api.payment(booking.providerId);
    const snapshot = normalizeMarinaPayment(response?.payload, {
      bookingId: booking.providerId,
      fallbackNote: booking.note,
      fallbackEmail: field(booking.formData, "email")
    });
    if (this.noteOverrides.has(booking.providerId)) snapshot.note = this.noteOverrides.get(booking.providerId);
    if (this.manualDepositOverrides.has(booking.providerId)) {
      const minor = this.manualDepositOverrides.get(booking.providerId);
      const deposit = Number((minor / 100).toFixed(2));
      if (snapshot.deposit !== null && snapshot.deposit !== undefined && Math.abs(snapshot.deposit - deposit) < 0.005) {
        this.manualDepositOverrides.delete(booking.providerId);
        this.persistCache();
      } else {
        snapshot.manual_deposit = deposit;
        snapshot.deposit = deposit;
        if (Number.isFinite(snapshot.total)) snapshot.balance = Number((snapshot.total - deposit).toFixed(2));
      }
    }
    return snapshot;
  }
  async updateDeposit(localId, input = {}) {
    const booking = this.findBooking(localId);
    const deposit = Number(input.deposit);
    const total = Number(input.total);
    if (!Number.isFinite(deposit) || !Number.isFinite(total) || deposit < 0 || total <= 0 || deposit > total) {
      throw Object.assign(new Error("Avansul trebuie să fie între zero și costul rezervării."), { code: "invalid_deposit", permanent: true });
    }
    const latestResponse = await this.api.payment(booking.providerId);
    const latestRecord = latestResponse?.payload?.data?.booking || latestResponse?.payload?.data || latestResponse?.payload?.booking || latestResponse?.payload || {};
    const depositMinor = Math.round(deposit * 100);
    if (!Number.isSafeInteger(depositMinor)) {
      throw Object.assign(new Error("Avansul este prea mare."), { code: "invalid_deposit", permanent: true });
    }
    const currentNote = String(this.noteOverrides.has(booking.providerId)
      ? this.noteOverrides.get(booking.providerId)
      : input.note ?? booking.note ?? "");
    const nextNote = PricingNote.update(currentNote, deposit, total).note;
    const body = { deposit_minor: depositMinor, send_email: false };
    let response;
    try {
      response = await this.api.updateDeposit(booking.providerId, body, randomUUID(), latestRecord.version ?? booking.version);
    } catch (error) {
      if (error?.status === 412) {
        await Promise.allSettled([this.details(localId)]);
        throw Object.assign(new Error("Rezervarea Marina s-a schimbat între timp. Datele actualizate au fost încărcate; verificați din nou valorile înainte de salvare."), error, { code: "marina_stale_version", conflict: true, permanent: true });
      }
      throw error;
    }
    const returned = response?.payload?.data?.booking || response?.payload?.data || response?.payload?.booking || response?.payload || {};
    const returnedDepositMinor = Number(returned?.price?.deposit_minor ?? returned?.deposit_minor);
    const responseMatchesDeposit = !Number.isSafeInteger(returnedDepositMinor) || returnedDepositMinor === depositMinor;
    const returnedNote = responseMatchesDeposit
      ? String(returned?.internal_note ?? returned?.note ?? nextNote)
      : nextNote;
    const totalMinor = Math.round(total * 100);
    const optimisticPrice = (latestRecord?.price || booking.price)
      ? { ...(latestRecord?.price || booking.price), total_minor: totalMinor, deposit_minor: depositMinor, balance_minor: totalMinor - depositMinor }
      : undefined;
    const returnedPrice = responseMatchesDeposit ? returned?.price : undefined;
    const updatedRecord = { ...latestRecord, ...returned, internal_note: returnedNote, ...(returnedPrice || optimisticPrice ? { price: returnedPrice || optimisticPrice } : {}) };
    this.manualDepositOverrides.set(booking.providerId, depositMinor);
    const payment = normalizeMarinaPayment({ data: updatedRecord }, {
      bookingId: booking.providerId,
      fallbackNote: returnedNote,
      fallbackEmail: field(booking.formData, "email")
    });
    payment.manual_deposit = deposit;
    payment.deposit = deposit;
    payment.balance = Number((total - deposit).toFixed(2));
    const updated = this.storeMutationBooking(normalizeBooking({
      ...updatedRecord,
      resource_id: latestRecord.resource_id ?? booking.providerResourceId,
      periods: latestRecord.periods ?? [stayPeriod(booking.dates)],
      status: latestRecord.status ?? booking.providerStatus,
      customer: latestRecord.customer,
      guests: latestRecord.guests,
      id: booking.providerId,
      internal_note: returnedNote,
      version: returned?.version ?? payment.version ?? payment.etag ?? booking.version
    }, this.resources), { noteOverride: returnedNote });
    this.refreshAfterMutation();
    return {
      ...payment,
      booking_id: payment.booking_id ?? booking.providerId,
      deposit: payment.deposit ?? deposit,
      total: payment.total ?? total,
      note: updated.note
    };
  }
  async requestPayment(localId, input = {}) {
    const booking = this.bookings.find((candidate) => candidate.localId === localId);
    const bookingId = input.bookingId ?? booking?.providerId;
    if (bookingId === undefined || bookingId === null || String(bookingId).trim() === "") {
      throw Object.assign(new Error("Rezervarea nu are un ID Marina valid."), { code: "marina_booking_id_missing", permanent: true });
    }
    const idempotencyKey = String(input.idempotencyKey || "").trim() || randomUUID();
    let response;
    try {
      response = await this.api.requestPayment(bookingId, {
        send_email: true,
        payment_type: "deposit",
        payment_reason: "Avans rezervare"
      }, idempotencyKey);
    } catch (error) {
      if (error?.status === 403 || /insufficient/i.test(error?.message || "")) {
        throw Object.assign(new Error("Utilizatorul conectat nu are permisiunile necesare pe serverul Marina pentru trimiterea emailurilor de plată."), { code: "marina_insufficient_permissions", auth: true, permanent: true, cause: error });
      }
      throw error;
    }
    return response?.payload || { status: "queued", booking_id: Number(bookingId) || bookingId, event: "booking.payment_requested" };
  }
  retry() { throw Object.assign(new Error("Marina nu folosește coada providerului existent."), { code: "marina_feature_unsupported", permanent: true }); }
  revert() { return this.retry(); }
  clearFailedCommands() { return 0; }
}

module.exports = { MarinaBookingProvider, bookingBody, bookingPatchBody, collection, normalizeBooking, normalizeFacility, normalizeFacilityIds, normalizeResource, pricingChanged, quoteBody, sameDates, uiId };
