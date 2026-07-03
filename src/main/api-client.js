"use strict";

class ApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ApiError";
    Object.assign(this, options);
  }
}

function normalizeBaseUrl(value, { allowHttpLocalhost = true } = {}) {
  const namespace = "/wp-json/marina-booking/v1";
  let url;
  try {
    url = new URL(String(value || "").trim().replace(/\/+$/, ""));
  } catch {
    throw new ApiError("API URL is invalid.", { code: "invalid_url", permanent: true });
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(allowHttpLocalhost && local)) {
    throw new ApiError("Production API URLs must use HTTPS.", { code: "https_required", permanent: true });
  }
  const sitePath = url.pathname.replace(/\/+$/, "");
  url.pathname = sitePath.endsWith(namespace) ? sitePath : `${sitePath}${namespace}`;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function apiBookings(payload) {
  if (Array.isArray(payload?.bookings)) return payload.bookings;
  if (Array.isArray(payload?.result?.bookings)) return payload.result.bookings;
  if (payload?.result?.bookings && typeof payload.result.bookings === "object") return Object.values(payload.result.bookings);
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.result?.rows)) return payload.result.rows;
  return [];
}

function formValue(field) {
  if (field && typeof field === "object" && "value" in field) return field.value;
  return field ?? "";
}

function normalizeBooking(raw) {
  const serverId = Number(raw.booking_id ?? raw.id ?? raw.bookingId);
  const rawDates = Array.isArray(raw.dates) ? raw.dates : [];
  const dates = [...new Set(rawDates.map((entry) => String(entry?.date ?? entry?.booking_date ?? entry).slice(0, 10)).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
  const formData = raw.form_data || raw.form || raw.parsed_form || {};
  const normalizedForm = {};
  if (Array.isArray(formData)) {
    for (const field of formData) {
      const name = field.name || field.field_name;
      if (name) normalizedForm[name] = { value: String(formValue(field.value)), type: field.type || "text" };
    }
  } else {
    for (const [name, field] of Object.entries(formData || {})) {
      if (["_all_", "_all_fields_"].includes(name) || (field && typeof field === "object" && !("value" in field))) continue;
      normalizedForm[name] = { value: String(formValue(field)), type: field?.type || (name === "email" ? "email" : "text") };
    }
  }
  const datesApproved = rawDates.length > 0 && rawDates.every((entry) => Number(entry?.approved) === 1);
  return {
    serverId,
    resourceId: Number(raw.resource_id ?? raw.booking_type ?? raw.type_id),
    dates,
    status: raw.status === "approved" || raw.approved === true || Number(raw.approved) === 1 || datesApproved ? "approved" : "pending",
    trashed: raw.trashed === true || raw.trash === true || Number(raw.trash) === 1 || raw.is_trash === true || Number(raw.is_trash) === 1,
    note: String(raw.note ?? raw.remark ?? ""),
    formData: normalizedForm,
    serverUpdatedAt: raw.updated_at ?? raw.modification_date ?? null,
    serverPayload: raw
  };
}

class MarinaApiClient {
  constructor({ getConfig, fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
    this.getConfig = getConfig;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request(path, { method = "GET", body, idempotencyKey, timeoutMs = this.timeoutMs } = {}) {
    const config = await this.getConfig();
    const baseUrl = normalizeBaseUrl(config.apiBaseUrl);
    if (!config.username || !config.password) throw new ApiError("Credentials are not configured.", { code: "credentials_missing", auth: true, permanent: true });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`, "utf8").toString("base64")}`
      };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
      const response = await this.fetchImpl(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, redirect: "error" });
      const text = await response.text();
      let payload = {};
      try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text.slice(0, 500) }; }
      if (!response.ok) {
        const message = payload?.message || payload?.data?.message || `API returned HTTP ${response.status}.`;
        throw new ApiError(message, {
          code: payload?.code || `http_${response.status}`,
          status: response.status,
          auth: response.status === 401 || response.status === 403,
          rateLimited: response.status === 429,
          retryAfter: Number(response.headers.get("retry-after")) || null,
          temporary: response.status === 429 || response.status >= 500,
          permanent: response.status >= 400 && response.status < 500 && response.status !== 429,
          payload
        });
      }
      return { payload, status: response.status, idempotencyReplay: response.headers.get("Idempotency-Replayed") === "true", idempotencySupported: response.headers.get("Idempotency-Supported") === "true" };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const timeout = error?.name === "AbortError";
      throw new ApiError(timeout ? "Request timed out; server outcome is unknown." : "The API is unreachable.", { code: timeout ? "timeout_unknown" : "network_error", temporary: !timeout, unknownOutcome: timeout, cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  async resources() {
    const { payload } = await this.request("/resources");
    return Array.isArray(payload.resources) ? payload.resources : [];
  }

  async bookings(start, end, resourceId = null) {
    const params = new URLSearchParams({ start, end, trash: "any", per_page: "100" });
    if (resourceId) params.set("resource_id", String(resourceId));
    const all = [];
    for (let page = 1; page <= 50; page += 1) {
      params.set("page", String(page));
      const { payload } = await this.request(`/bookings?${params}`);
      const rows = apiBookings(payload);
      all.push(...rows.map(normalizeBooking).filter((booking) => booking.serverId && booking.dates.length));
      if (rows.length < 100) break;
    }
    return all;
  }

  booking(id) { return this.request(`/bookings/${id}`).then(({ payload }) => normalizeBooking(payload.booking || payload)); }
  bookingByExternalId(externalId) { return this.request(`/bookings/by-external-id/${encodeURIComponent(externalId)}`).then(({ payload }) => normalizeBooking(payload.booking || payload)); }
  availability(resourceId, dates) { return this.request("/availability", { method: "POST", body: { resource_id: resourceId, dates } }).then(({ payload }) => payload); }
  create(payload, key) { return this.request("/bookings", { method: "POST", body: payload, idempotencyKey: key }); }
  edit(id, payload, key) { return this.request(`/bookings/${id}`, { method: "PATCH", body: payload, idempotencyKey: key }); }
  status(id, payload, key) { return this.request(`/bookings/${id}/status`, { method: "POST", body: payload, idempotencyKey: key }); }
  note(id, payload, key) { return this.request(`/bookings/${id}/note`, { method: "POST", body: payload, idempotencyKey: key }); }
  trash(id, payload, key) { return this.request(`/bookings/${id}/trash`, { method: "POST", body: payload, idempotencyKey: key }); }
}

module.exports = { ApiError, MarinaApiClient, normalizeBaseUrl, normalizeBooking, apiBookings };
