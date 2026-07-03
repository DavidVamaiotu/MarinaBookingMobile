"use strict";

const { app, BrowserWindow, ipcMain, safeStorage, session, shell } = require("electron");
const path = require("node:path");
const { BookingDatabase } = require("./src/main/database");
const { CredentialVault } = require("./src/main/credential-vault");
const { MarinaApiClient, normalizeBaseUrl } = require("./src/main/api-client");
const { CommandQueue } = require("./src/main/command-queue");
const { BookingService } = require("./src/main/booking-service");
const validate = require("./src/main/validation");

app.setName("Marina Booking Desktop");

let window = null;
let database = null;
let service = null;

function sendState(state) {
  if (window && !window.isDestroyed()) window.webContents.send("state:changed", state);
}

function registerIpc() {
  ipcMain.handle("state:bootstrap", (_event, input) => {
    const range = validate.range(input);
    service.visibleRange = range;
    return service.state(range);
  });
  ipcMain.handle("state:refresh", async (_event, input) => service.refresh(validate.range(input)));
  ipcMain.handle("booking:create", (_event, input) => service.create(validate.bookingInput(input)));
  ipcMain.handle("booking:edit", (_event, localId, patch) => service.update(validate.id(localId, "localId"), validate.bookingPatch(patch), "edit"));
  ipcMain.handle("booking:status", (_event, localId, patch) => service.update(validate.id(localId, "localId"), validate.bookingPatch(patch), "status"));
  ipcMain.handle("booking:note", (_event, localId, patch) => service.update(validate.id(localId, "localId"), validate.bookingPatch(patch), "note"));
  ipcMain.handle("booking:trash", (_event, localId, patch) => service.update(validate.id(localId, "localId"), validate.bookingPatch(patch), "trash"));
  ipcMain.handle("booking:availability", (_event, input) => {
    input = validate.object(input);
    const resourceId = Number(input.resourceId);
    if (!Number.isInteger(resourceId) || resourceId < 1) throw new TypeError("resourceId must be positive.");
    return service.availability(resourceId, validate.dates(input.dates));
  });
  ipcMain.handle("queue:retry", (_event, id) => service.retry(validate.id(id, "commandId")));
  ipcMain.handle("queue:revert", (_event, localId) => service.revert(validate.id(localId, "localId")));
  ipcMain.handle("settings:get", () => service.settings());
  ipcMain.handle("settings:save", (_event, input) => {
    const settings = validate.settings(input);
    settings.apiBaseUrl = normalizeBaseUrl(settings.apiBaseUrl);
    database.saveSettings(settings);
    if (settings.password) service.vault.setPassword(settings.password);
    service.queue.resumeAfterCredentials();
    service.emitState();
    return service.settings();
  });
  ipcMain.handle("settings:test", async () => ({ ok: true, resources: (await service.api.resources()).length }));
  ipcMain.handle("settings:clear", () => {
    service.vault.clear();
    database.saveSettings({ apiBaseUrl: "", username: "" });
    database.setMeta("authPaused", "true");
    service.queue.authPaused = true;
    service.emitState();
    return service.settings();
  });
}

async function createWindow() {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": ["default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"] } });
  });
  window = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1050,
    minHeight: 680,
    show: false,
    backgroundColor: "#f4f1e9",
    icon: path.join(__dirname, "assets", "marina-park-logo.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());
  await window.loadFile(path.join(__dirname, "index.html"));
}

async function start() {
  database = new BookingDatabase(path.join(app.getPath("userData"), "marina-booking.sqlite"));
  const vault = new CredentialVault(database, safeStorage);
  const initialSettings = database.getSettings();
  if (!vault.hasPassword() || !initialSettings.apiBaseUrl || !initialSettings.username) {
    database.setMeta("authPaused", "true");
    database.setMeta("online", "false");
  }
  const api = new MarinaApiClient({ getConfig: async () => ({ ...database.getSettings(), password: vault.getPassword() }) });
  const queue = new CommandQueue({ database, api });
  service = new BookingService({ database, api, queue, vault });
  service.on("state", sendState);
  registerIpc();
  service.start();
  await createWindow();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { window?.show(); window?.focus(); });
  app.whenReady().then(start).catch((error) => { console.error(error); app.quit(); });
}

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => { service?.stop(); database?.close(); });
