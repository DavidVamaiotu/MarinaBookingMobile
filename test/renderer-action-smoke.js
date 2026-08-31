"use strict";

const path = require("node:path");
const os = require("node:os");
const { app, BrowserWindow, ipcMain } = require("electron");

const root = path.join(__dirname, "..");
const calls = [];
const rendererErrors = [];

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const today = new Date().toISOString().slice(0, 10);
const resource = {
  id: 1,
  provider: "marina",
  providerId: "11",
  title: "Camera test",
  capacity: 2,
  defaultForm: "marina",
  bookingMode: "date_range",
  active: true
};
const campingResource = {
  id: 2,
  provider: "marina",
  providerId: "15",
  title: "Camping pitches",
  capacity: 50,
  capacityMode: "limited",
  capacityUnitMode: "per_booking",
  settings: { kind: "tent" },
  defaultForm: "marina",
  bookingMode: "date_range",
  active: true
};
const facility = {
  id: 4,
  name: "Extra bed",
  currency: "RON",
  billingPeriod: "night",
  pricePerNightMinor: 2000,
  appliesToAllResources: true,
  resourceIds: [],
  active: true
};
const booking = {
  localId: "marina:101",
  serverId: "101",
  provider: "marina",
  providerId: "101",
  resourceId: 1,
  status: "approved",
  trashed: false,
  syncState: "synced",
  dates: [today, addDays(today, 1), addDays(today, 2)],
  note: "Cost: 300 lei\nAvans: 90 lei",
  formData: {
    name: { value: "Client", type: "text" },
    secondname: { value: "Test", type: "text" },
    email: { value: "client@example.test", type: "email" },
    phone: { value: "0700000000", type: "text" },
    visitors: { value: "2", type: "number" },
    children: { value: "0", type: "number" },
    details: { value: "Test local", type: "textarea" }
  },
  updatedAt: new Date().toISOString()
};

function settings(connected = true, source = "rooms") {
  return {
    provider: "marina",
    enabled: true,
    configured: true,
    credentialsConfigured: connected,
    connected,
    connecting: false,
    oauthClientConfigured: true,
    oauthScopes: "resources:read bookings:read bookings:write",
    capabilities: {
      resourcesRead: true,
      bookingsRead: true,
      bookingsWrite: true,
      canLoadCalendar: true,
      canMutateBookings: true,
      canSendPaymentEmail: true
    },
    apiBaseUrl: "https://example.test",
    workspaceId: source === "camping" ? 7 : 1,
    workspaceSlug: source,
    timezone: "Europe/Bucharest",
    connectionStatus: connected ? "connected" : "disconnected"
  };
}

function state(connected = true, source = "rooms") {
  return {
    provider: "marina",
    resources: connected ? [source === "camping" ? campingResource : resource] : [],
    facilities: connected ? [facility] : [],
    bookings: connected && source === "rooms" ? [booking] : [],
    commands: [],
    diagnostics: {
      provider: "marina",
      online: connected,
      authPaused: !connected,
      queued: 0,
      sending: 0,
      failed: 0,
      conflicts: 0,
      lastSuccessfulSync: connected ? new Date().toISOString() : null
    },
    settings: settings(connected, source),
    range: { start: addDays(today, -45), end: addDays(today, 120) }
  };
}

function record(channel, result) {
  ipcMain.handle(channel, (_event, ...args) => {
    calls.push({ channel, args });
    return typeof result === "function" ? result(...args) : result;
  });
}

function registerSyntheticIpc() {
  record("state:bootstrap", (source) => state(true, source));
  record("state:refresh", (source) => state(true, source));
  record("booking:get", booking);
  record("booking:create", booking);
  record("booking:edit", state(true));
  record("booking:status", state(true));
  record("booking:note", state(true));
  record("booking:trash", state(true));
  record("booking:payment", { total: 300, deposit: 90, balance: 210, note: booking.note, email: "client@example.test" });
  record("booking:deposit", state(true));
  record("booking:payment-request", state(true));
  record("booking:availability", { available: true });
  record("booking:quote", { valid: true, quoteId: "quote-test", total: 300, deposit: 90, balance: 210, nights: 2, expiresAt: "2099-01-01T00:00:00Z" });
  record("booking:quote-clear", true);
  record("settings:get", (source) => settings(true, source));
  record("saga-invoice-settings:get", { name: "Marina Park", cif: "RO123456", regCom: "", address: "Strada Test 1", city: "Huși", county: "Vaslui", phone: "", email: "", iban: "", country: "RO", vatRate: "11" });
  record("saga-invoice-settings:save", (input) => input);
  record("settings:clear", state(false));
  record("marina:connect", state(true));
  record("marina:disconnect", state(false));
}

async function rendererValue(window, expression) {
  return window.webContents.executeJavaScript(expression, true);
}

async function main() {
  app.setPath("userData", path.join(os.tmpdir(), `marina-renderer-smoke-${process.pid}`));
  await app.whenReady();
  registerSyntheticIpc();
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(root, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.webContents.on("console-message", (_event, ...args) => {
    const details = typeof args[0] === "object"
      ? args[0]
      : { level: args[0], message: args[1], lineNumber: args[2], sourceId: args[3] };
    if (/Uncaught|ReferenceError|TypeError|Error:/.test(String(details.message))) {
      rendererErrors.push({ message: details.message, level: details.level, line: details.lineNumber, sourceId: details.sourceId });
    }
  });
  await window.loadFile(path.join(root, "index.html"));
  await new Promise((resolve) => setTimeout(resolve, 250));

  const initial = await rendererValue(window, `(() => {
    window.__smokeConfirmations = [];
    window.confirm = (message) => { window.__smokeConfirmations.push(message); return true; };
    return {
      settingsEnabled: !document.querySelector("#openSettings").disabled,
      createEnabled: !document.querySelector("#openCreate").disabled,
      resources: state.resources.length,
      bookings: state.bookings.length
    };
  })()`);

  const surfaces = await rendererValue(window, `(() => {
    document.querySelector("#openCreate").click();
    const createOpened = document.querySelector("#createDialog").open;
    const facilityRendered = document.querySelector('#createFacilities [data-facility-id="4"]')?.closest("label")?.textContent.includes("20 lei/noapte") === true;
    document.querySelector("#createDialog").close();
    populateBookingMenu(state.bookings[0]);
    document.querySelector("#bookingMenuEdit").click();
    return { createOpened, facilityRendered };
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  surfaces.detailsOpened = await rendererValue(window, `!document.querySelector("#detailsPanel").hidden`);
  await rendererValue(window, `closeBookingOverlays()`);

  const camping = await rendererValue(window, `(async () => {
    await switchWorkspace("camping");
    document.querySelector("#openCreate").click();
    const options = [...document.querySelector("#createResource").options].map((option) => ({
      value: option.value,
      label: option.textContent
    }));
    const result = {
      workspace: activeWorkspace,
      providerIds: state.resources.map((item) => item.providerId),
      options,
      createOpened: document.querySelector("#createDialog").open
    };
    document.querySelector("#createDialog").close();
    await switchWorkspace("rooms");
    return result;
  })()`);

  await rendererValue(window, `(async () => {
    const source = "rooms";
    const id = "marina:101";
    const input = { source, resourceId: 1, dates: ["${today}", "${addDays(today, 1)}"], formData: {} };
    await runApiAction("createBooking", input);
    await runApiAction("editBooking", id, input);
    await runApiAction("setNote", id, { source, note: "Notă test" });
    await runApiAction("updateDeposit", id, { source, deposit: 90, total: 300, note: "Notă test" });
    await runApiAction("requestPayment", id, { source, send_email: true, payment_type: "deposit", payment_reason: "Avans rezervare", idempotencyKey: "smoke-key", bookingId: "101" });
    await window.marina.checkAvailability({ source, resourceId: 1, dates: input.dates });
    await window.marina.quoteBooking(input);
  })()`);

  await rendererValue(window, `(() => {
    populateBookingMenu(state.bookings[0]);
    document.querySelector("#bookingMenuStatus").click();
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await rendererValue(window, `(() => {
    populateBookingMenu(state.bookings[0]);
    document.querySelector("#bookingMenuTrash").click();
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await rendererValue(window, `document.querySelector("#openSettings").click()`);
  await new Promise((resolve) => setTimeout(resolve, 50));

  const final = await rendererValue(window, `({
    confirmations: window.__smokeConfirmations,
    toastText: document.querySelector("#toast").textContent,
    settingsConnected: state.settings.connected,
    settingsOpen: document.querySelector("#settingsDialog").open
  })`);
  const channels = calls.map((entry) => entry.channel);
  const result = { initial, surfaces, camping, final, channels, rendererErrors };
  const requiredChannels = [
    "state:bootstrap", "state:refresh", "booking:get", "booking:create", "booking:edit", "booking:status",
    "booking:note", "booking:trash", "booking:deposit", "booking:payment-request", "booking:availability",
    "booking:quote", "marina:disconnect", "saga-invoice-settings:get"
  ];
  const passed = initial.settingsEnabled
    && initial.createEnabled
    && initial.resources === 1
    && initial.bookings === 1
    && surfaces.createOpened
    && surfaces.facilityRendered
    && surfaces.detailsOpened
    && camping.workspace === "camping"
    && camping.createOpened
    && camping.providerIds.length === 1
    && camping.providerIds[0] === "15"
    && camping.options.length === 1
    && camping.options[0].value === String(campingResource.id)
    && camping.options[0].label.includes("Camping pitches")
    && final.confirmations.length === 2
    && final.settingsOpen
    && requiredChannels.every((channel) => channels.includes(channel))
    && rendererErrors.length === 0;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  window.destroy();
  app.exit(passed ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ rendererErrors }, null, 2)}\n`);
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
});
