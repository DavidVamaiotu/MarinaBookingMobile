import { Capacitor, CapacitorHttp, registerPlugin } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Preferences } from "@capacitor/preferences";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { marinaAvailabilityPeriod, marinaCheckoutDate, marinaStayPeriod } from "../src/shared/mobile-api.js";
import { customerFromFormData } from "../src/shared/marina-customer.js";
import { MANUAL_DEPOSIT_FIELD, normalizeMarinaPayment } from "../src/shared/marina-payment.js";
import { normalizeMarinaQuote } from "../src/shared/marina-quote.js";
import { normalizeFormData } from "../src/shared/form-data.js";
import * as BookingFields from "../src/shared/booking-fields.js";
import * as PricingNote from "../src/shared/pricing-note.js";
import * as MarinaConfig from "../src/shared/marina-config.js";
import * as MarinaOAuth from "../src/shared/marina-oauth.js";
import { orderMarinaResources } from "../src/shared/marina-resource-order.js";
import { parseReservationDeepLink } from "../src/shared/reservation-deep-link.js";

const marinaBuildConfig = MarinaConfig.createConfig({
  MARINA_INTEGRATION_ENABLED: typeof __MARINA_INTEGRATION_ENABLED__ === "undefined" ? "false" : __MARINA_INTEGRATION_ENABLED__,
  MARINA_API_BASE_URL: typeof __MARINA_API_BASE_URL__ === "undefined" ? "https://booking.husi.ro" : __MARINA_API_BASE_URL__,
  MARINA_OAUTH_CLIENT_ID: typeof __MARINA_OAUTH_CLIENT_ID__ === "undefined" ? "" : __MARINA_OAUTH_CLIENT_ID__,
  MARINA_OAUTH_SCOPES: typeof __MARINA_OAUTH_SCOPES__ === "undefined" ? "resources:read resources:write bookings:read bookings:write" : __MARINA_OAUTH_SCOPES__,
  MARINA_ROOMS_WORKSPACE_ID: typeof __MARINA_ROOMS_WORKSPACE_ID__ === "undefined" ? "" : __MARINA_ROOMS_WORKSPACE_ID__,
  MARINA_CAMPING_WORKSPACE_ID: typeof __MARINA_CAMPING_WORKSPACE_ID__ === "undefined" ? "" : __MARINA_CAMPING_WORKSPACE_ID__
});

const AutoUpdater = registerPlugin("AutoUpdater");

if (!window.marina) {
  const SOURCES = new Set(["rooms", "camping"]);
  const SETTINGS_KEY = "marina-mobile-settings-v1";
  const CACHE_KEY = "marina-mobile-cache-v1";
  const SAGA_INVOICE_SETTINGS_KEY = "marina-saga-invoice-settings-v1";
  const MARINA_REFRESH_TOKEN_KEY = "marina-oauth-refresh-token";
  const callbacks = new Set();
  const reservationLinkCallbacks = new Set();
  const marinaNoteRequests = new Map();
  const marinaNoteOverrides = new Map();
  const marinaManualDepositOverrides = new Map();
  const sourceConnections = new Map();
  const jsonWrites = new Map();
  const MOBILE_REFRESH_INTERVAL_MS = 5 * 60_000;
  const MOBILE_RECONNECT_INTERVAL_MS = 15_000;

  function assertWritableSource(source) {
    if (!SOURCES.has(source)) throw new TypeError("Sursa rezervărilor este invalidă.");
    if (!marinaBuildConfig.configured) throw Object.assign(new Error("Clientul OAuth public Marina nu este configurat în această versiune a aplicației."), { code: "marina_oauth_config_incomplete", permanent: true });
  }

  function assertReadableSource(source) {
    assertWritableSource(source);
  }

  App.addListener("backButton", ({ canGoBack }) => {
    const event = new Event("marina:back", { cancelable: true });
    if (!window.dispatchEvent(event)) return;
    if (canGoBack) window.history.back();
    else void App.exitApp();
  });
  const quoteCache = new Map();
  let currentSource = "rooms";
  let currentRange = null;
  let refreshTimer = null;
  let updateCheckStarted = false;
  let pendingReservationLink = null;
  let lastReservationLinkKey = "";
  let lastReservationLinkAt = 0;

  function checkForMobileUpdateOnce() {
    if (updateCheckStarted || !Capacitor.isNativePlatform()) return;
    updateCheckStarted = true;
    void AutoUpdater.checkAndInstall().catch((error) => console.error("Mobile update check failed:", error));
  }

  function connectionFor(source = currentSource) {
    return sourceConnections.get(source) || { online: false, authPaused: false, lastSuccessfulAt: 0 };
  }

  function rememberConnection(source, online, authPaused = false) {
    const previous = connectionFor(source);
    sourceConnections.set(source, {
      online,
      authPaused,
      lastSuccessfulAt: online && !authPaused ? Date.now() : previous.lastSuccessfulAt
    });
  }

  const emptyDiagnostics = (online = false, authPaused = false) => ({
    online,
    authPaused,
    queued: 0,
    sending: 0,
    failed: 0,
    conflicts: 0,
    lastSuccessfulSync: null
  });

  function marinaWorkspaceSettings(source) {
    return {
      provider: "marina",
      enabled: marinaBuildConfig.enabled,
      configured: marinaBuildConfig.configured,
      apiBaseUrl: marinaBuildConfig.apiBaseUrl,
      oauthClientConfigured: Boolean(marinaBuildConfig.clientId),
      oauthScopes: marinaBuildConfig.scopeString,
      workspaceId: marinaBuildConfig.workspaceIds[source],
      workspaceSlug: source,
      timezone: "Europe/Bucharest"
    };
  }
  const defaultSettings = () => ({
    rooms: marinaWorkspaceSettings("rooms"),
    camping: marinaWorkspaceSettings("camping")
  });
  function defaultSagaInvoiceSettings() {
    if (typeof window.SagaInvoice?.defaultSupplierSettings === "function") return window.SagaInvoice.defaultSupplierSettings();
    return { name: "Marina Park", cif: "", regCom: "", address: "", city: "", county: "", phone: "", email: "", iban: "", country: "RO", vatRate: "11" };
  }
  function normalizeSagaInvoiceSettings(value = {}) {
    if (typeof window.SagaInvoice?.normalizeSupplierSettings === "function") return window.SagaInvoice.normalizeSupplierSettings(value);
    const input = value && typeof value === "object" ? value : {};
    const pick = (...keys) => {
      for (const key of keys) {
        const candidate = String(input[key] ?? "").trim();
        if (candidate) return candidate;
      }
      return "";
    };
    return {
      name: pick("name", "supplierName", "companyName"),
      cif: pick("cif", "supplierCif", "companyCif"),
      regCom: pick("regCom", "reg_com", "supplierRegCom"),
      address: pick("address", "adresa", "supplierAddress"),
      city: pick("city", "localitate", "supplierCity"),
      county: pick("county", "judet", "supplierCounty"),
      phone: pick("phone", "telefon", "supplierPhone"),
      email: pick("email", "mail", "supplierEmail"),
      iban: pick("iban", "supplierIban"),
      country: pick("country", "tara") || "RO",
      vatRate: pick("vatRate", "vat_rate") || "11"
    };
  }
  const marinaWorkspaceCache = (source) => ({ workspaceId: marinaBuildConfig.workspaceIds[source], workspaceSlug: source, resources: [], facilities: [], bookings: [], updatedAt: null, noteOverrides: {}, manualDepositOverrides: {} });
  const defaultCache = () => ({ rooms: marinaWorkspaceCache("rooms"), camping: marinaWorkspaceCache("camping") });

  async function readJson(key, fallback) {
    const { value } = await Preferences.get({ key });
    if (!value) return fallback();
    try { return { ...fallback(), ...JSON.parse(value) }; } catch { return fallback(); }
  }

  async function writeJson(key, value) {
    await Preferences.set({ key, value: JSON.stringify(value) });
  }

  function mutateJson(key, fallback, update) {
    const previous = jsonWrites.get(key) || Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      const value = await readJson(key, fallback);
      const result = await update(value);
      await writeJson(key, value);
      return result;
    });
    jsonWrites.set(key, operation);
    return operation.finally(() => {
      if (jsonWrites.get(key) === operation) jsonWrites.delete(key);
    });
  }

  async function allSettings() {
    const defaults = defaultSettings();
    const stored = await readJson(SETTINGS_KEY, () => defaults);
    return MarinaConfig.mergeWorkspaceSettings(stored, defaults);
  }
  async function allCache() { return readJson(CACHE_KEY, defaultCache); }

  const marinaOverridesHydration = new Map();
  const marinaOverrideKey = (source, providerId) => `${source}:${providerId}`;
  async function ensureMarinaOverrides(source = currentSource) {
    if (!marinaOverridesHydration.has(source)) marinaOverridesHydration.set(source, (async () => {
      const cache = await allCache();
      const marina = cache[source] || marinaWorkspaceCache(source);
      for (const [providerId, note] of Object.entries(marina.noteOverrides || {})) marinaNoteOverrides.set(marinaOverrideKey(source, providerId), String(note ?? ""));
      for (const [providerId, minor] of Object.entries(marina.manualDepositOverrides || {})) {
        const amount = Number(minor);
        if (Number.isInteger(amount) && amount >= 0) marinaManualDepositOverrides.set(marinaOverrideKey(source, providerId), amount);
      }
    })());
    await marinaOverridesHydration.get(source);
  }

  function storeMarinaOverrides(cache, source = currentSource) {
    cache[source] = { ...marinaWorkspaceCache(source), ...(cache[source] || {}) };
    cache[source].noteOverrides = Object.fromEntries([...marinaNoteOverrides]
      .filter(([key]) => key.startsWith(`${source}:`))
      .map(([key, value]) => [key.slice(source.length + 1), value]));
    cache[source].manualDepositOverrides = Object.fromEntries([...marinaManualDepositOverrides]
      .filter(([key]) => key.startsWith(`${source}:`))
      .map(([key, value]) => [key.slice(source.length + 1), value]));
  }

  async function persistMarinaOverrides(source = currentSource) {
    await mutateJson(CACHE_KEY, defaultCache, (cache) => { storeMarinaOverrides(cache, source); });
  }

  let marinaMetadata = null;
  let marinaPending = null;
  let marinaAccessToken = "";
  let marinaAccessExpiresAt = 0;
  let marinaEffectiveScopes = [...marinaBuildConfig.scopes];
  let marinaRefreshPromise = null;
  const marinaWorkspaceIds = new Map();
  marinaWorkspaceIds.set("rooms", marinaBuildConfig.workspaceIds.rooms);
  marinaWorkspaceIds.set("camping", marinaBuildConfig.workspaceIds.camping);
  const marinaWorkspaceResolutions = new Map();

  function mobilePayload(response) {
    if (response?.data && typeof response.data === "object") return response.data;
    try { return JSON.parse(String(response?.data || "{}")); } catch { return {}; }
  }

  function marinaProblemMessage(payload, status) {
    const details = [payload?.detail, payload?.message, payload?.title]
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) => value.trim());
    if (Array.isArray(payload?.errors)) {
      for (const error of payload.errors) {
        const value = error?.detail ?? error?.message ?? error;
        if (typeof value === "string" && value.trim()) details.push(value.trim());
      }
    } else if (payload?.errors && typeof payload.errors === "object") {
      for (const [field, value] of Object.entries(payload.errors)) {
        const text = Array.isArray(value) ? value.join(", ") : String(value ?? "");
        if (text.trim()) details.push(`${field}: ${text.trim()}`);
      }
    }
    const unique = details.filter((value, index) => details.indexOf(value) === index);
    return unique.length ? `Eroare Marina: ${unique.join("; ").slice(0, 450)}` : `API-ul Marina a returnat HTTP ${status}.`;
  }

  async function marinaDiscover() {
    if (marinaMetadata) return marinaMetadata;
    const response = await CapacitorHttp.get({ url: `${marinaBuildConfig.apiBaseUrl}/.well-known/oauth-authorization-server`, headers: { Accept: "application/json" }, connectTimeout: 15000, readTimeout: 15000 });
    const payload = mobilePayload(response);
    if (response.status < 200 || response.status >= 300) throw Object.assign(new Error("Descoperirea OAuth Marina a eșuat."), { code: "marina_oauth_discovery_failed", status: response.status });
    const endpoint = (value, fallback) => {
      const url = new URL(value || fallback, `${marinaBuildConfig.apiBaseUrl}/`);
      if (url.protocol !== "https:" || url.origin !== new URL(marinaBuildConfig.apiBaseUrl).origin) throw Object.assign(new Error("Metadatele OAuth Marina conțin un endpoint invalid."), { code: "marina_oauth_metadata_invalid" });
      return url.toString();
    };
    marinaMetadata = {
      authorizationEndpoint: endpoint(payload.authorization_endpoint, "/oauth/authorize"),
      tokenEndpoint: endpoint(payload.token_endpoint, "/oauth/token"),
      revocationEndpoint: endpoint(payload.revocation_endpoint, "/oauth/revoke")
    };
    return marinaMetadata;
  }

  async function marinaTokenRequest(values) {
    const metadata = await marinaDiscover();
    const response = await CapacitorHttp.post({
      url: metadata.tokenEndpoint,
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      data: MarinaOAuth.formBody(values),
      connectTimeout: 15000,
      readTimeout: 15000
    });
    const payload = mobilePayload(response);
    if (response.status < 200 || response.status >= 300 || !payload.access_token) throw Object.assign(new Error(payload.error_description || "Schimbul tokenului OAuth Marina a eșuat."), { code: payload.error || "marina_oauth_token_failed", auth: true, status: response.status });
    marinaAccessToken = String(payload.access_token);
    marinaAccessExpiresAt = Date.now() + Math.max(0, Number(payload.expires_in) || 0) * 1000;
    if (payload.scope) marinaEffectiveScopes = MarinaConfig.normalizeScopes(payload.scope);
    if (payload.refresh_token) await SecureStorage.set(MARINA_REFRESH_TOKEN_KEY, String(payload.refresh_token));
    return marinaAccessToken;
  }

  async function marinaRefreshAccessToken() {
    if (marinaRefreshPromise) return marinaRefreshPromise;
    marinaRefreshPromise = (async () => {
      const refreshToken = String(await SecureStorage.get(MARINA_REFRESH_TOKEN_KEY) || "");
      if (!refreshToken) throw Object.assign(new Error("Conectarea Marina este necesară."), { code: "marina_reconnect_required", auth: true, permanent: true });
      try { return await marinaTokenRequest({ grant_type: "refresh_token", client_id: marinaBuildConfig.clientId, refresh_token: refreshToken }); }
      catch (error) { marinaAccessToken = ""; marinaAccessExpiresAt = 0; await SecureStorage.remove(MARINA_REFRESH_TOKEN_KEY); throw error; }
    })();
    try { return await marinaRefreshPromise; } finally { marinaRefreshPromise = null; }
  }

  async function marinaBearer() {
    if (marinaAccessToken && marinaAccessExpiresAt > Date.now() + 60000) return marinaAccessToken;
    return marinaRefreshAccessToken();
  }

  async function resolveMarinaWorkspaceId(source) {
    const configured = marinaWorkspaceIds.get(source);
    if (configured !== null && configured !== undefined) return configured;
    if (!marinaWorkspaceResolutions.has(source)) marinaWorkspaceResolutions.set(source, (async () => {
      const payload = await marinaRequest("/v1/workspaces", { source, workspaceScoped: false });
      const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.workspaces) ? payload.workspaces : [];
      const active = rows.filter((workspace) => workspace?.active !== false);
      let selected = active.find((workspace) => String(workspace?.slug || "").trim().toLowerCase() === source);
      if (!selected && source === "rooms") {
        selected = active.find((workspace) => ["camere", "default"].includes(String(workspace?.slug || "").trim().toLowerCase()))
          || active.find((workspace) => workspace?.is_default === true);
      }
      const id = MarinaConfig.normalizeWorkspaceId(selected?.id);
      if (id === null) throw Object.assign(new Error(`Workspace-ul Marina „${source}” nu este accesibil.`), { code: "marina_workspace_missing", permanent: true });
      marinaWorkspaceIds.set(source, id);
      return id;
    })().catch((error) => { marinaWorkspaceResolutions.delete(source); throw error; }));
    return marinaWorkspaceResolutions.get(source);
  }

  async function marinaRequest(path, { method = "GET", body, retry = true, headers = {}, source = currentSource, workspaceScoped = true } = {}) {
    const workspaceId = workspaceScoped ? await resolveMarinaWorkspaceId(source) : null;
    const token = await marinaBearer();
    const response = await CapacitorHttp.request({
      url: `${marinaBuildConfig.apiBaseUrl}${path}`,
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
        ...(workspaceId === null ? {} : { "X-Workspace-ID": String(workspaceId) })
      },
      data: body,
      connectTimeout: 15000,
      readTimeout: 15000
    });
    if (response.status === 401 && retry) { await marinaRefreshAccessToken(); return marinaRequest(path, { method, body, retry: false, headers, source, workspaceScoped }); }
    const payload = mobilePayload(response);
    if (response.status < 200 || response.status >= 300) throw Object.assign(new Error(marinaProblemMessage(payload, response.status)), { code: payload.code || `marina_http_${response.status}`, status: response.status, auth: response.status === 401 || response.status === 403, conflict: response.status === 409 });
    return payload;
  }

  async function connectMarina() {
    if (!marinaBuildConfig.configured) throw Object.assign(new Error("Clientul OAuth public Marina nu este configurat."), { code: "marina_oauth_config_incomplete", permanent: true });
    const metadata = await marinaDiscover();
    const pair = await MarinaOAuth.createPkcePair();
    const state = MarinaOAuth.createState();
    marinaPending = { codeVerifier: pair.codeVerifier, state };
    const url = MarinaOAuth.buildAuthorizationUrl({ authorizationEndpoint: metadata.authorizationEndpoint, clientId: marinaBuildConfig.clientId, redirectUri: marinaBuildConfig.redirectUris.mobile, scopes: marinaBuildConfig.scopes, state, codeChallenge: pair.codeChallenge });
    await Browser.open({ url });
    return configuredState(false, true, currentSource);
  }

  async function acceptMarinaCallback(url) {
    if (!marinaPending) return;
    const callback = MarinaOAuth.parseCallbackUrl(url, { protocol: "ro.marinapark.booking.mobile:", pathname: "/callback" });
    MarinaOAuth.validateState(marinaPending.state, callback.state);
    const verifier = marinaPending.codeVerifier;
    marinaPending = null;
    await marinaTokenRequest({ grant_type: "authorization_code", client_id: marinaBuildConfig.clientId, code: callback.code, redirect_uri: marinaBuildConfig.redirectUris.mobile, code_verifier: verifier });
    await Browser.close();
    for (const source of SOURCES) rememberConnection(source, true, false);
    if (currentRange) emit(await refresh(currentRange));
  }

  async function disconnectMarina() {
    const refreshToken = String(await SecureStorage.get(MARINA_REFRESH_TOKEN_KEY) || "");
    try {
      if (refreshToken) {
        const metadata = await marinaDiscover();
        await CapacitorHttp.post({ url: metadata.revocationEndpoint, headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, data: MarinaOAuth.formBody({ token: refreshToken, token_type_hint: "refresh_token", client_id: marinaBuildConfig.clientId }) });
      }
    } finally {
      marinaAccessToken = "";
      marinaAccessExpiresAt = 0;
      marinaPending = null;
      await SecureStorage.remove(MARINA_REFRESH_TOKEN_KEY);
      marinaNoteOverrides.clear();
      marinaManualDepositOverrides.clear();
      marinaOverridesHydration.clear();
      marinaWorkspaceResolutions.clear();
      marinaWorkspaceIds.set("rooms", marinaBuildConfig.workspaceIds.rooms);
      marinaWorkspaceIds.set("camping", marinaBuildConfig.workspaceIds.camping);
      await writeJson(CACHE_KEY, defaultCache());
      for (const source of SOURCES) rememberConnection(source, false, true);
    }
    const next = await configuredState(false, true, currentSource);
    emit(next);
    return next;
  }

  function deliverReservationLink(link) {
    const key = `${link.source}:${link.bookingId}`;
    const now = Date.now();
    if (key === lastReservationLinkKey && now - lastReservationLinkAt < 5000) return;
    lastReservationLinkKey = key;
    lastReservationLinkAt = now;
    pendingReservationLink = link;
    for (const callback of reservationLinkCallbacks) callback(link);
  }

  function handleAppUrl(url) {
    const reservationLink = parseReservationDeepLink(url);
    if (reservationLink) {
      deliverReservationLink(reservationLink);
      return;
    }
    if (!String(url || "").startsWith("ro.marinapark.booking.mobile://oauth/callback")) return;
    void acceptMarinaCallback(url).catch((error) => {
      marinaPending = null;
      console.error("Marina OAuth callback failed:", error.code || error.message);
    });
  }

  App.addListener("appUrlOpen", ({ url }) => handleAppUrl(url));
  void App.getLaunchUrl().then((result) => {
    if (result?.url) handleAppUrl(result.url);
  }).catch((error) => console.error("Mobile launch URL could not be read:", error));

  function stateFrom(cache, settings, online = false, authPaused = false, source = currentSource) {
    const sourceCache = cache[source] || defaultCache()[source];
    const sourceSettings = settings[source] || defaultSettings()[source];
    return {
      resources: sourceCache.resources || [],
      facilities: sourceCache.facilities || [],
      bookings: sourceCache.bookings || [],
      commands: [],
      diagnostics: {
        ...emptyDiagnostics(online, authPaused),
        lastSuccessfulSync: sourceCache.updatedAt || null
      },
      settings: sourceSettings,
      range: currentRange
    };
  }

  async function configuredState(online = false, authPaused = false, source = currentSource) {
    const [settings, cache] = await Promise.all([allSettings(), allCache()]);
    const result = stateFrom(cache, settings, online, authPaused, source);
    const connected = Boolean(marinaAccessToken || await SecureStorage.get(MARINA_REFRESH_TOKEN_KEY));
    const capabilities = MarinaConfig.capabilities(marinaEffectiveScopes);
    result.settings = {
      ...result.settings,
      workspaceId: marinaWorkspaceIds.get(source) ?? result.settings.workspaceId,
      connected,
      connecting: Boolean(marinaPending),
      credentialsConfigured: connected,
      oauthScopes: marinaEffectiveScopes.join(" "),
      capabilities,
      connectionStatus: connected ? "connected" : marinaPending ? "connecting" : marinaBuildConfig.configured ? "disconnected" : "disabled"
    };
    result.diagnostics.authPaused = !connected;
    return result;
  }

  function emit(state) { for (const callback of callbacks) callback(state); }

  function marinaFieldValue(field) {
    if (Array.isArray(field)) return field.map(marinaFieldValue).filter(Boolean).join(", ");
    if (field && typeof field === "object") {
      const key = ["value", "field_value", "raw_value", "val", "values"].find((candidate) => Object.prototype.hasOwnProperty.call(field, candidate));
      return key ? marinaFieldValue(field[key]) : "";
    }
    return field ?? "";
  }

  function marinaFormData(booking, customer, guests) {
    const formData = {};
    const add = (name, value, type = "text") => {
      const text = String(marinaFieldValue(value) ?? "");
      if (text !== "") formData[name] = { value: text, type };
    };
    for (const [name, value] of Object.entries(booking.form_data || booking.formData || {})) add(name, value?.value ?? value, value?.type || "text");
    for (const [name, value] of Object.entries(customer.custom_fields || {})) add(name, value, value?.type || "text");
    for (const [name, value] of Object.entries(customer.address || {})) add(`address_${name}`, value);
    for (const [name, value] of Object.entries(booking.custom_fields || {})) {
      if (name !== "migration" && name !== MANUAL_DEPOSIT_FIELD) add(name, value, value?.type || "text");
    }
    add("name", customer.first_name ?? customer.firstName ?? booking.name ?? "");
    add("secondname", customer.last_name ?? customer.lastName ?? "");
    add("email", customer.email ?? booking.email ?? "", "email");
    add("phone", customer.phone ?? booking.phone ?? "");
    add("visitors", guests.adults ?? booking.adults ?? 1, "selectbox-one");
    add("children", guests.children ?? booking.children ?? 0, "selectbox-one");
    return formData;
  }

  function marinaUiId(value) {
    let hash = 2166136261;
    for (const char of `marina:${value}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return (hash >>> 1) || 1;
  }

  function normalizeMarinaResource(resource) {
    return {
      id: marinaUiId(resource.id),
      provider: "marina",
      providerId: String(resource.id),
      title: String(resource.title || resource.name || `Marina ${resource.id}`),
      capacity: Number(resource.capacity) || null,
      capacityMode: String(resource.capacity_mode ?? resource.capacityMode ?? "exclusive"),
      capacityUnitMode: String(resource.capacity_unit_mode ?? resource.capacityUnitMode ?? "per_booking"),
      defaultForm: "marina",
      bookingMode: String(resource.booking_mode ?? resource.bookingMode ?? "date_range"),
      active: resource.active !== false,
      settings: resource.settings && typeof resource.settings === "object" ? { ...resource.settings } : {},
      version: resource.version ?? null
    };
  }

  function normalizeMarinaFacilityIds(values) {
    const ids = [...new Set((Array.isArray(values) ? values : []).map(Number))].sort((a, b) => a - b);
    if (ids.length > 64 || ids.some((id) => !Number.isSafeInteger(id) || id < 1)) throw Object.assign(new Error("Selecția facilităților Marina este invalidă."), { code: "marina_facility_ids_invalid", permanent: true });
    return ids;
  }

  function normalizeMarinaFacility(facility) {
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

  function marinaFacilitySnapshots(booking) {
    if (Array.isArray(booking?.facilities)) return booking.facilities.map((facility) => ({ id: Number(facility.id ?? facility.facility_id), name: String(facility.name || ""), currency: String(facility.currency || "RON"), billingPeriod: String(facility.billing_period ?? facility.billingPeriod ?? "night"), pricePerNightMinor: Number(facility.price_per_night_minor ?? facility.pricePerNightMinor) || 0 })).filter((facility) => Number.isSafeInteger(facility.id) && facility.id > 0);
    return normalizeMarinaFacilityIds(booking?.facility_ids).map((id) => ({ id }));
  }

  function normalizeMarinaBookingRecord(booking, resources) {
    const period = booking.periods?.[0] || booking.booking_periods?.[0] || {};
    const providerResourceId = String(booking.resource_id ?? booking.resourceId ?? booking.resource?.id ?? period.resource_id ?? period.resourceId ?? "");
    const resource = resources.find((item) => item.providerId === providerResourceId);
    const dateOnlyStart = booking.start_date ?? period.start_date;
    const dateOnlyEnd = booking.end_date ?? period.end_date;
    const start = String(dateOnlyStart ?? booking.start_at ?? period.start_at ?? "").slice(0, 10);
    const rawEnd = String(dateOnlyEnd ?? booking.end_at ?? period.end_at ?? start).slice(0, 10);
    const dateRangeBooking = resource?.bookingMode !== "time_slot";
    const hasNestedTimedEnd = Boolean(period.end_at ?? period.endAt ?? period.ends_at ?? period.endsAt);
    const end = dateOnlyEnd || (dateRangeBooking && !hasNestedTimedEnd) ? marinaCheckoutDate(rawEnd) : rawEnd;
    const dates = [];
    for (let cursor = start; /^\d{4}-\d{2}-\d{2}$/.test(cursor) && cursor <= end && dates.length < 366;) {
      dates.push(cursor);
      const next = new Date(`${cursor}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      cursor = next.toISOString().slice(0, 10);
    }
    const customer = booking.customer || booking.guest || {};
    const guests = booking.guests || {};
    const status = String(booking.status || "pending").toLowerCase();
    const trashValue = booking.trash ?? booking.trashed;
    const explicitTrash = trashValue === true || trashValue === 1 || ["1", "true", "trash", "trashed"].includes(String(trashValue || "").trim().toLowerCase());
    const facilities = marinaFacilitySnapshots(booking);
    return {
      localId: `marina:${booking.id}`,
      serverId: String(booking.id),
      provider: "marina",
      providerId: String(booking.id),
      providerResourceId,
      resourceId: marinaUiId(providerResourceId),
      status: ["approved", "confirmed", "active"].includes(status) ? "approved" : "pending",
      providerStatus: status,
      trashed: explicitTrash || ["cancelled", "canceled", "deleted"].includes(status),
      note: marinaNoteText(booking),
      price: booking.price && typeof booking.price === "object" ? { ...booking.price } : null,
      facilities,
      facilityIds: facilities.map((facility) => facility.id),
      formData: marinaFormData(booking, customer, guests),
      dates,
      syncState: "synced",
      version: booking.version ?? null
    };
  }

  function marinaNoteBodies(payload) {
    const rows = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.data?.notes)
        ? payload.data.notes
        : Array.isArray(payload?.notes)
          ? payload.notes
          : Array.isArray(payload)
            ? payload
            : [];
    return rows.map((note) => String(note?.body ?? note?.note ?? note?.text ?? "").trim()).filter(Boolean);
  }

  function marinaNoteText(booking) {
    const hasInternalNote = Object.prototype.hasOwnProperty.call(booking || {}, "internal_note");
    const primaryNote = String(booking?.note || "").trim();
    return (hasInternalNote ? [booking?.internal_note] : primaryNote ? [primaryNote] : marinaNoteBodies(booking))
      .map((value) => String(value || "").trim())
      .filter((value, index, values) => value && values.indexOf(value) === index)
      .join("\n\n");
  }

  function fetchMarinaNotes(providerId, source = currentSource) {
    const key = marinaOverrideKey(source, providerId);
    const existing = marinaNoteRequests.get(key);
    if (existing) return existing;
    const request = marinaRequest(`/v1/bookings/${encodeURIComponent(providerId)}/notes`, { source })
      .then((payload) => marinaNoteBodies(payload))
      .finally(() => {
        if (marinaNoteRequests.get(key) === request) marinaNoteRequests.delete(key);
      });
    marinaNoteRequests.set(key, request);
    return request;
  }

  async function refresh(range) {
    currentRange = range;
    const source = currentSource;
    await ensureMarinaOverrides(source);
    const connected = Boolean(marinaAccessToken || await SecureStorage.get(MARINA_REFRESH_TOKEN_KEY));
    if (!connected) return configuredState(false, true, source);
    try {
      if (!MarinaConfig.capabilities(marinaEffectiveScopes).resourcesRead) return configuredState(true, false, source);
      const resourcePayload = await marinaRequest("/v1/resources", { source });
      const resourceRows = Array.isArray(resourcePayload?.data) ? resourcePayload.data : Array.isArray(resourcePayload?.resources) ? resourcePayload.resources : Array.isArray(resourcePayload) ? resourcePayload : [];
      const resources = orderMarinaResources(resourceRows.map(normalizeMarinaResource), { ignoreLegacy32: source !== "camping" });
      const facilityPayload = await marinaRequest("/v1/facilities", { source });
      const facilityRows = Array.isArray(facilityPayload?.data) ? facilityPayload.data : Array.isArray(facilityPayload?.facilities) ? facilityPayload.facilities : Array.isArray(facilityPayload) ? facilityPayload : [];
      const facilities = facilityRows.map(normalizeMarinaFacility);
      const bookings = [];
      let after = "";
      if (MarinaConfig.capabilities(marinaEffectiveScopes).bookingsRead) do {
        const params = new URLSearchParams({ from: range.start, to: range.end, limit: "200" });
        if (after) params.set("after", after);
        const payload = await marinaRequest(`/v1/bookings?${params}`, { source });
        const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.bookings) ? payload.bookings : Array.isArray(payload) ? payload : [];
        const previousBookings = new Map((((await allCache())[source]?.bookings) || []).map((booking) => [booking.providerId, booking]));
        for (const booking of rows) {
          const normalized = normalizeMarinaBookingRecord(booking, resources);
          const previous = previousBookings.get(normalized.providerId);
          const overrideKey = marinaOverrideKey(source, normalized.providerId);
          if (marinaNoteOverrides.has(overrideKey)) {
            const override = marinaNoteOverrides.get(overrideKey);
            const responseHasNote = Object.prototype.hasOwnProperty.call(booking || {}, "internal_note") || Object.prototype.hasOwnProperty.call(booking || {}, "note");
            if (responseHasNote && normalized.note === override) marinaNoteOverrides.delete(overrideKey);
            else normalized.note = override;
          } else if (!normalized.note && previous?.note) normalized.note = previous.note;
          bookings.push(normalized);
        }
        after = payload?.next_cursor ?? payload?.pagination?.next_cursor ?? payload?.meta?.next_cursor ?? "";
      } while (after);
      await mutateJson(CACHE_KEY, defaultCache, (cache) => {
        cache[source] = { ...marinaWorkspaceCache(source), resources, facilities, bookings, updatedAt: new Date().toISOString() };
        storeMarinaOverrides(cache, source);
      });
      rememberConnection(source, true, false);
      const next = await configuredState(true, false, source);
      emit(next);
      return next;
    } catch (error) {
      rememberConnection(source, Boolean(error.auth), Boolean(error.auth));
      const cached = await configuredState(Boolean(error.auth), Boolean(error.auth), source);
      emit(cached);
      throw error;
    }
  }

  async function refreshIfConfigured({ force = false } = {}) {
    if (!currentRange) return;
    const source = currentSource;
    const connection = connectionFor(source);
    if (!force && connection.online && Date.now() - connection.lastSuccessfulAt < MOBILE_REFRESH_INTERVAL_MS) return;
    if (!marinaBuildConfig.configured || !await SecureStorage.get(MARINA_REFRESH_TOKEN_KEY)) return;
    try { await refresh(currentRange); } catch {}
  }

  function startRefreshTimer() {
    if (refreshTimer) return;
    refreshTimer = window.setInterval(() => { void refreshIfConfigured(); }, MOBILE_RECONNECT_INTERVAL_MS);
  }

  function stopRefreshTimer() {
    if (!refreshTimer) return;
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }

  async function marinaCachedBooking(localId, source = currentSource) { return ((await allCache())[source]?.bookings || []).find((booking) => booking.localId === String(localId)); }
  function marinaBookingSnapshot(booking) {
    const period = marinaStayPeriod(booking.dates);
    return {
      id: booking.providerId,
      resource_id: Number(booking.providerResourceId),
      status: booking.providerStatus || booking.status,
      periods: period ? [{ ...period, units: 1 }] : [],
      customer: customerFromFormData(booking.formData),
      guests: {
        adults: Number(booking.formData?.visitors?.value) || 1,
        children: Number(booking.formData?.children?.value) || 0
      },
      internal_note: booking.note || "",
      facilities: booking.facilities || [],
      facility_ids: normalizeMarinaFacilityIds(booking.facilityIds),
      ...(booking.price ? { price: booking.price } : {}),
      version: booking.version
    };
  }
  async function storeMarinaMutationBooking(rawBooking, options = {}, source = currentSource) {
    await ensureMarinaOverrides(source);
    const cache = await allCache();
    const normalized = normalizeMarinaBookingRecord(rawBooking, cache[source].resources);
    const overrideKey = marinaOverrideKey(source, normalized.providerId);
    if (Object.prototype.hasOwnProperty.call(options, "noteOverride")) {
      const noteOverride = String(options.noteOverride ?? "");
      marinaNoteOverrides.set(overrideKey, noteOverride);
      normalized.note = noteOverride;
    }
    if (Object.prototype.hasOwnProperty.call(options, "manualDepositMinor")) {
      const minor = Number(options.manualDepositMinor);
      if (Number.isInteger(minor) && minor >= 0) marinaManualDepositOverrides.set(overrideKey, minor);
    }
    await mutateJson(CACHE_KEY, defaultCache, (nextCache) => {
      const bookings = nextCache[source].bookings || [];
      const index = bookings.findIndex((booking) => booking.localId === normalized.localId);
      if (index === -1) bookings.push(normalized);
      else bookings[index] = normalized;
      nextCache[source].bookings = bookings;
      nextCache[source].updatedAt = new Date().toISOString();
      storeMarinaOverrides(nextCache, source);
    });
    if (currentSource === source) emit(await configuredState(true, false, source));
    return normalized;
  }
  function scheduleMarinaRefresh() {
    if (!currentRange) return;
    const range = { ...currentRange };
    void refresh(range).catch(() => {});
  }
  async function marinaProviderResourceId(resourceId, source = currentSource) {
    const resource = ((await allCache())[source]?.resources || []).find((item) => Number(item.id) === Number(resourceId));
    if (!resource) throw Object.assign(new Error("Resursa Marina nu mai este disponibilă."), { code: "marina_resource_missing", permanent: true });
    const providerId = Number(resource.providerId);
    if (!Number.isSafeInteger(providerId) || providerId < 1) throw Object.assign(new Error("Identificatorul resursei Marina este invalid."), { code: "marina_resource_id_invalid", permanent: true });
    return providerId;
  }
  async function marinaMutation(path, body, { method = "POST", version, idempotencyKey, source = currentSource } = {}) {
    const headers = { "Idempotency-Key": idempotencyKey || crypto.randomUUID() };
    if (version !== undefined && version !== null) headers["If-Match"] = String(version);
    const versionedBody = version !== undefined && version !== null && (method === "PATCH" || path.endsWith("/status"))
      ? { ...body, expected_version: Number(version) }
      : body;
    const result = await marinaRequest(path, { method, body: versionedBody, headers, source });
    return result?.data || result?.booking || result;
  }
  async function marinaQuoteBody(input, source = currentSource) {
    const period = marinaStayPeriod(input.dates);
    if (!period) throw Object.assign(new Error("Cotația Marina necesită cel puțin o dată."), { code: "marina_quote_dates_missing", permanent: true });
    return {
      resource_id: await marinaProviderResourceId(input.resourceId, source),
      periods: [{ ...period, units: 1 }],
      guests: {
        adults: Number(input.formData?.visitors?.value) || 1,
        children: Number(input.formData?.children?.value) || 0
      },
      facility_ids: normalizeMarinaFacilityIds(input.facilityIds)
    };
  }
  async function marinaBookingBody(input, source = currentSource) {
    const body = await marinaQuoteBody(input, source);
    body.customer = customerFromFormData(input.formData);
    body.custom_fields = {};
    body.internal_note = String(input.note || "");
    body.send_email = Boolean(input.sendEmail);
    if (input.quoteId) body.quote_id = String(input.quoteId);
    return body;
  }
  function marinaPricingChanged(current, next) {
    const datesEqual = JSON.stringify([...new Set(current.dates || [])].map((value) => String(value).slice(0, 10)).sort()) === JSON.stringify([...new Set(next.dates || [])].map((value) => String(value).slice(0, 10)).sort());
    const adultsEqual = (Number(current.formData?.visitors?.value) || 1) === (Number(next.formData?.visitors?.value) || 1);
    const childrenEqual = (Number(current.formData?.children?.value) || 0) === (Number(next.formData?.children?.value) || 0);
    const facilitiesEqual = JSON.stringify(normalizeMarinaFacilityIds(current.facilityIds ?? current.facilities?.map((facility) => facility.id))) === JSON.stringify(normalizeMarinaFacilityIds(next.facilityIds ?? next.facilities?.map((facility) => facility.id)));
    return Number(current.resourceId) !== Number(next.resourceId) || !datesEqual || !adultsEqual || !childrenEqual || !facilitiesEqual;
  }
  async function marinaBookingPatchBody(current, patch, source = currentSource) {
    const merged = { ...current, ...patch, formData: patch.formData || current.formData, dates: patch.dates || current.dates, facilityIds: patch.facilityIds ?? current.facilityIds };
    const body = {};
    if (marinaPricingChanged(current, merged)) {
      const quote = await marinaQuoteBody(merged, source);
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

  window.marina = Object.freeze({
    platform: "android",
    connectMarina,
    disconnectMarina,
    setSource(source) {
      if (!SOURCES.has(source)) throw new TypeError("Sursa rezervărilor este invalidă.");
      currentSource = source;
    },
    async bootstrap(range) {
      checkForMobileUpdateOnce();
      currentRange = range;
      const connection = connectionFor();
      return configuredState(connection.online, connection.authPaused);
    },
    refresh,
    onReservationLink(callback) {
      reservationLinkCallbacks.add(callback);
      if (pendingReservationLink) queueMicrotask(() => callback(pendingReservationLink));
      return () => reservationLinkCallbacks.delete(callback);
    },
    async getBookingByProviderId(value, requestedSource = currentSource) {
      const source = SOURCES.has(requestedSource) ? requestedSource : currentSource;
      assertReadableSource(source);
      const bookingId = String(value || "").trim();
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(bookingId)) {
        throw Object.assign(new Error("Linkul rezervării conține un identificator invalid."), { code: "marina_booking_id_invalid", permanent: true });
      }
      let cache = await allCache();
      if (!(cache[source]?.resources || []).length) {
        const resourcePayload = await marinaRequest("/v1/resources", { source });
        const rows = Array.isArray(resourcePayload?.data) ? resourcePayload.data : Array.isArray(resourcePayload?.resources) ? resourcePayload.resources : Array.isArray(resourcePayload) ? resourcePayload : [];
        const resources = orderMarinaResources(rows.map(normalizeMarinaResource), { ignoreLegacy32: source !== "camping" });
        await mutateJson(CACHE_KEY, defaultCache, (nextCache) => {
          nextCache[source].resources = resources;
          nextCache[source].updatedAt = new Date().toISOString();
        });
        cache = await allCache();
      }
      const payload = await marinaRequest(`/v1/bookings/${encodeURIComponent(bookingId)}`, { source });
      const record = payload?.data?.booking || payload?.data || payload?.booking || payload;
      if (!record || typeof record !== "object") throw Object.assign(new Error("API-ul Marina nu a returnat rezervarea solicitată."), { code: "marina_booking_missing", permanent: true });
      return storeMarinaMutationBooking({ ...record, id: record.id ?? bookingId }, {}, source);
    },
    async getBooking(id) {
      const source = currentSource;
      await ensureMarinaOverrides(source);
      const cached = (await allCache())[source]?.bookings?.find((booking) => booking.localId === String(id)) || null;
      if (!cached) return cached;
      const bookingPayload = await marinaRequest(`/v1/bookings/${encodeURIComponent(cached.providerId)}`, { source });
      const record = bookingPayload?.data?.booking || bookingPayload?.data || bookingPayload?.booking || bookingPayload;
      const resources = (await allCache())[source].resources;
      const detailed = normalizeMarinaBookingRecord({ ...record, id: record?.id ?? cached.providerId }, resources);
      const hasInternalNote = Object.prototype.hasOwnProperty.call(record || {}, "internal_note");
      const overrideKey = marinaOverrideKey(source, cached.providerId);
      const hasNoteOverride = marinaNoteOverrides.has(overrideKey);
      const noteOverride = hasNoteOverride ? marinaNoteOverrides.get(overrideKey) : null;
      if (hasNoteOverride) {
        if (hasInternalNote && detailed.note === noteOverride) marinaNoteOverrides.delete(overrideKey);
        else detailed.note = noteOverride;
      }
      const notesPromise = hasNoteOverride || hasInternalNote || detailed.note || cached.note
        ? Promise.resolve([])
        : fetchMarinaNotes(cached.providerId, source).catch(() => []);
      const merge = (noteValues) => ({
        ...cached,
        ...detailed,
        resourceId: detailed.providerResourceId ? detailed.resourceId : cached.resourceId,
        providerResourceId: detailed.providerResourceId || cached.providerResourceId,
        dates: detailed.dates.length ? detailed.dates : cached.dates,
        note: (hasInternalNote ? [detailed.note] : [detailed.note || cached.note, ...(!detailed.note && !cached.note ? noteValues : [])])
          .map((value) => String(value || "").trim())
          .filter((value, index, values) => value && values.indexOf(value) === index)
          .join("\n\n")
      });
      let merged = merge([]);
      await mutateJson(CACHE_KEY, defaultCache, (cache) => {
        cache[source].bookings = cache[source].bookings.map((booking) => booking.localId === merged.localId ? merged : booking);
        cache[source].updatedAt = new Date().toISOString();
        storeMarinaOverrides(cache, source);
      });
      if (currentSource === source) emit(await configuredState(true, false, source));
      const fetchedNotes = await notesPromise;
      const withNotes = merge(fetchedNotes);
      if (withNotes.note !== merged.note) {
        merged = withNotes;
        await mutateJson(CACHE_KEY, defaultCache, (cache) => {
          cache[source].bookings = cache[source].bookings.map((booking) => booking.localId === merged.localId ? merged : booking);
          cache[source].updatedAt = new Date().toISOString();
          storeMarinaOverrides(cache, source);
        });
        if (currentSource === source) emit(await configuredState(true, false, source));
      }
      return merged;
    },
    async createBooking(input) {
      const source = SOURCES.has(input?.source) ? input.source : currentSource;
      assertWritableSource(source);

        if (!input.quoteId) throw Object.assign(new Error("Rezervarea Marina necesită o cotație confirmată."), { code: "marina_quote_required", permanent: true });
        const quotePayload = await marinaRequest("/v1/quotes", { method: "POST", body: await marinaQuoteBody(input, source), source });
        const finalQuote = normalizeMarinaQuote(quotePayload, { mode: "full" });
        const body = await marinaBookingBody({ ...input, quoteId: finalQuote.quoteId }, source);
        body.status = input.approved ? "approved" : "pending";
        const created = await marinaMutation("/v1/bookings", body, { source });
        const id = created?.id ?? created?.booking_id;
        const createdRecord = { ...body, ...created, id };
        if (!String(createdRecord.note || createdRecord.internal_note || "").trim() && body.internal_note) createdRecord.internal_note = body.internal_note;
        const normalized = await storeMarinaMutationBooking(createdRecord, { noteOverride: body.internal_note }, source);
        scheduleMarinaRefresh();
        return normalized;
    },
    async editBooking(id, patch) {
      const source = SOURCES.has(patch?.source) ? patch.source : currentSource;
      assertWritableSource(source);

        const booking = await marinaCachedBooking(id, source);
        if (!booking) throw new Error("Rezervarea Marina nu există în cache.");
        const merged = { ...booking, ...patch, formData: patch.formData || booking.formData, dates: patch.dates || booking.dates, facilityIds: patch.facilityIds ?? booking.facilityIds };
        const repricing = marinaPricingChanged(booking, merged);
        if (repricing && !patch.quoteId) throw Object.assign(new Error("Modificarea prețului Marina necesită o cotație nouă."), { code: "marina_quote_required", permanent: true });
        const finalPatch = repricing
          ? { ...patch, quoteId: normalizeMarinaQuote(await marinaRequest("/v1/quotes", { method: "POST", body: await marinaQuoteBody(merged, source), source }), { mode: "full" }).quoteId }
          : patch;
        const body = await marinaBookingPatchBody(booking, finalPatch, source);
        const result = await marinaMutation(`/v1/bookings/${encodeURIComponent(booking.providerId)}`, body, { method: "PATCH", version: booking.version, source });
        const hasNoteMutation = Object.prototype.hasOwnProperty.call(body, "internal_note");
        const noteOverride = hasNoteMutation ? String(body.internal_note ?? "") : undefined;
        const normalized = await storeMarinaMutationBooking({ ...marinaBookingSnapshot(booking), ...body, ...result, ...(hasNoteMutation ? { internal_note: noteOverride } : {}), id: booking.providerId }, hasNoteMutation ? { noteOverride } : {}, source);
        scheduleMarinaRefresh();
        return normalized;
    },
    setStatus: async (id, patch) => {
      const source = SOURCES.has(patch?.source) ? patch.source : currentSource;
      assertWritableSource(source);
      const booking = await marinaCachedBooking(id, source);
      const result = await marinaMutation(`/v1/bookings/${encodeURIComponent(booking.providerId)}/status`, { status: patch.status, send_email: Boolean(patch.sendEmail) }, { version: booking.version, source });
      const normalized = await storeMarinaMutationBooking({ ...marinaBookingSnapshot(booking), status: patch.status, ...result, id: booking.providerId }, {}, source);
      scheduleMarinaRefresh();
      return normalized;
    },
    setNote: async (id, patch) => {
      const source = SOURCES.has(patch?.source) ? patch.source : currentSource;
      assertWritableSource(source);
      const booking = await marinaCachedBooking(id, source);
      const note = String(patch.note ?? "");
      const result = await marinaMutation(`/v1/bookings/${encodeURIComponent(booking.providerId)}`, { internal_note: note }, { method: "PATCH", version: booking.version, source });
      const normalized = await storeMarinaMutationBooking({ ...marinaBookingSnapshot(booking), ...(String(result?.id) === booking.providerId ? result : {}), internal_note: note, id: booking.providerId }, { noteOverride: note }, source);
      scheduleMarinaRefresh();
      return normalized;
    },
    setTrash: async (id, patch) => {
      const source = SOURCES.has(patch?.source) ? patch.source : currentSource;
      assertWritableSource(source);
      const booking = await marinaCachedBooking(id, source);
      const trashed = Boolean(patch.trashed);
      const status = trashed ? "cancelled" : "pending";
      const action = trashed ? "cancel" : "status";
      const send_email = Boolean(patch.sendEmail);
      const result = await marinaMutation(`/v1/bookings/${encodeURIComponent(booking.providerId)}/${action}`, trashed ? { send_email } : { status, send_email }, { version: booking.version, source });
      const normalized = await storeMarinaMutationBooking({ ...marinaBookingSnapshot(booking), status, ...result, id: booking.providerId }, {}, source);
      scheduleMarinaRefresh();
      return normalized;
    },
    async getPayment(id, input = {}) {
      const source = SOURCES.has(input?.source) ? input.source : currentSource;
      assertReadableSource(source);

        await ensureMarinaOverrides(source);
        const booking = await marinaCachedBooking(id, source);
        if (!booking) throw Object.assign(new Error("Rezervarea Marina nu există în cache."), { code: "marina_booking_missing", permanent: true });
        const payload = await marinaRequest(`/v1/bookings/${encodeURIComponent(booking.providerId)}`, { source });
        const snapshot = normalizeMarinaPayment(payload, {
          bookingId: booking.providerId,
          fallbackNote: booking.note,
          fallbackEmail: BookingFields.value(booking, "email")
        });
        const overrideKey = marinaOverrideKey(source, booking.providerId);
        if (marinaNoteOverrides.has(overrideKey)) snapshot.note = marinaNoteOverrides.get(overrideKey);
        if (marinaManualDepositOverrides.has(overrideKey)) {
          const minor = marinaManualDepositOverrides.get(overrideKey);
          const deposit = Number((minor / 100).toFixed(2));
          if (snapshot.deposit !== null && snapshot.deposit !== undefined && Math.abs(snapshot.deposit - deposit) < 0.005) {
            marinaManualDepositOverrides.delete(overrideKey);
            await persistMarinaOverrides(source);
          } else {
            snapshot.manual_deposit = deposit;
            snapshot.deposit = deposit;
            if (Number.isFinite(snapshot.total)) snapshot.balance = Number((snapshot.total - deposit).toFixed(2));
          }
        }
        return snapshot;
    },
    async updateDeposit(id, input) {
      const source = SOURCES.has(input?.source) ? input.source : currentSource;
      assertWritableSource(source);

        await ensureMarinaOverrides(source);
        const booking = await marinaCachedBooking(id, source);
        if (!booking) throw Object.assign(new Error("Rezervarea Marina nu există în cache."), { code: "marina_booking_missing", permanent: true });
        const deposit = Number(input.deposit);
        const total = Number(input.total);
        if (!Number.isFinite(deposit) || !Number.isFinite(total) || deposit < 0 || total <= 0 || deposit > total) throw new Error("Avansul trebuie să fie între zero și costul rezervării.");
        const latestPayload = await marinaRequest(`/v1/bookings/${encodeURIComponent(booking.providerId)}`, { source });
        const latestRecord = latestPayload?.data?.booking || latestPayload?.data || latestPayload?.booking || latestPayload || {};
        const depositMinor = Math.round(deposit * 100);
        if (!Number.isSafeInteger(depositMinor)) throw new Error("Avansul este prea mare.");
        const overrideKey = marinaOverrideKey(source, booking.providerId);
        const currentNote = String(marinaNoteOverrides.has(overrideKey)
          ? marinaNoteOverrides.get(overrideKey)
          : input.note ?? booking.note ?? "");
        const nextNote = PricingNote.update(currentNote, deposit, total).note;
        const body = { deposit_minor: depositMinor, send_email: false };
        const result = await marinaMutation(`/v1/bookings/${encodeURIComponent(booking.providerId)}`, body, { method: "PATCH", version: latestRecord.version ?? booking.version, source });
        const returnedDepositMinor = Number(result?.price?.deposit_minor ?? result?.deposit_minor);
        const responseMatchesDeposit = !Number.isSafeInteger(returnedDepositMinor) || returnedDepositMinor === depositMinor;
        const returnedNote = responseMatchesDeposit
          ? String(result?.internal_note ?? result?.note ?? nextNote)
          : nextNote;
        const totalMinor = Math.round(total * 100);
        const optimisticPrice = (latestRecord?.price || booking.price)
          ? { ...(latestRecord?.price || booking.price), total_minor: totalMinor, deposit_minor: depositMinor, balance_minor: totalMinor - depositMinor }
          : undefined;
        const returnedPrice = responseMatchesDeposit ? result?.price : undefined;
        const updatedRecord = { ...latestRecord, ...result, internal_note: returnedNote, ...(returnedPrice || optimisticPrice ? { price: returnedPrice || optimisticPrice } : {}) };
        const payment = normalizeMarinaPayment({ data: updatedRecord }, {
          bookingId: booking.providerId,
          fallbackNote: returnedNote,
          fallbackEmail: BookingFields.value(booking, "email")
        });
        payment.manual_deposit = deposit;
        payment.deposit = deposit;
        payment.balance = Number((total - deposit).toFixed(2));
        const normalized = await storeMarinaMutationBooking({
          ...marinaBookingSnapshot(booking),
          ...updatedRecord,
          internal_note: returnedNote,
          id: booking.providerId
        }, { noteOverride: returnedNote, manualDepositMinor: depositMinor }, source);
        scheduleMarinaRefresh();
        return { ...payment, booking_id: payment.booking_id ?? booking.providerId, deposit: payment.deposit ?? deposit, total: payment.total ?? total, note: normalized.note, localId: normalized.localId };
    },
    async requestPayment(id, input = {}) {
      const source = SOURCES.has(input?.source) ? input.source : currentSource;
      assertWritableSource(source);

        const booking = await marinaCachedBooking(id, source);
        const bookingId = input.bookingId ?? booking?.providerId;
        if (bookingId === undefined || bookingId === null || String(bookingId).trim() === "") throw Object.assign(new Error("Rezervarea nu are un ID Marina valid."), { code: "marina_booking_id_missing", permanent: true });
        let result;
        try {
          result = await marinaMutation(`/v1/admin/bookings/${encodeURIComponent(bookingId)}/payment-request`, {
            send_email: true,
            payment_type: "deposit",
            payment_reason: "Avans rezervare"
          }, { method: "POST", idempotencyKey: input.idempotencyKey, source });
        } catch (error) {
          if (error?.status === 403 || /insufficient/i.test(error?.message || "")) {
            throw Object.assign(new Error("Utilizatorul conectat nu are permisiunile necesare pe serverul Marina pentru trimiterea emailurilor de plată."), { code: "marina_insufficient_permissions", auth: true, permanent: true, cause: error });
          }
          throw error;
        }
        return result || { status: "queued", booking_id: Number(bookingId) || bookingId, event: "booking.payment_requested" };
    },
    checkAvailability(input) {
      const source = SOURCES.has(input?.source) ? input.source : currentSource;
      assertWritableSource(source);
      return (async () => {
        const period = marinaAvailabilityPeriod(input.dates);
        if (!period) throw Object.assign(new Error("Intervalul Marina este invalid."), { code: "marina_invalid_dates", permanent: true });
        const body = { resource_id: await marinaProviderResourceId(input.resourceId, source), periods: [period], units: 1 };
        const payload = await marinaRequest("/v1/availability/check", { method: "POST", body, source });
        return payload?.data && typeof payload.data === "object" ? payload.data : payload;
      })();
    },
    async quoteBooking(input) {
      const source = SOURCES.has(input?.source) ? input.source : currentSource;
      assertWritableSource(source);
      const payload = await marinaRequest("/v1/quotes", { method: "POST", body: await marinaQuoteBody(input, source), source });
      return normalizeMarinaQuote(payload, { mode: input.mode || "full" });
    },
    clearQuoteCache() { quoteCache.clear(); },
    async getSagaInvoiceSettings() {
      return normalizeSagaInvoiceSettings(await readJson(SAGA_INVOICE_SETTINGS_KEY, defaultSagaInvoiceSettings));
    },
    async saveSagaInvoiceSettings(input) {
      const settings = normalizeSagaInvoiceSettings(input);
      await mutateJson(SAGA_INVOICE_SETTINGS_KEY, defaultSagaInvoiceSettings, (stored) => {
        Object.assign(stored, settings);
        return settings;
      });
      return settings;
    },
    async getSettings(requestedSource = currentSource) {
      const source = SOURCES.has(requestedSource) ? requestedSource : currentSource;
      return (await configuredState(false, true, source)).settings;
    },
    async testConnection(input) {
      const source = SOURCES.has(input?.source) ? input.source : currentSource;
      assertWritableSource(source);
      const next = await refresh(currentRange || { start: new Date().toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10) });
      return { ok: true, resources: next.resources.length };
    },
    async clearCredentials(requestedSource = currentSource) {
      if (SOURCES.has(requestedSource)) currentSource = requestedSource;
      return (await disconnectMarina()).settings;
    },
    onStateChanged(callback) { callbacks.add(callback); return () => callbacks.delete(callback); }
  });
  App.addListener("appStateChange", ({ isActive }) => {
    if (!isActive) { stopRefreshTimer(); return; }
    startRefreshTimer();
    void refreshIfConfigured({ force: true });
  });
  window.addEventListener("online", () => { void refreshIfConfigured({ force: true }); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { void refreshIfConfigured({ force: true }); }
  });
  startRefreshTimer();
  document.documentElement.classList.add("is-mobile-app");
}
