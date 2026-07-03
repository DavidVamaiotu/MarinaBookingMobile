"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("marina", Object.freeze({
  bootstrap: (range) => invoke("state:bootstrap", range),
  refresh: (range) => invoke("state:refresh", range),
  createBooking: (input) => invoke("booking:create", input),
  editBooking: (id, patch) => invoke("booking:edit", id, patch),
  setStatus: (id, patch) => invoke("booking:status", id, patch),
  setNote: (id, patch) => invoke("booking:note", id, patch),
  setTrash: (id, patch) => invoke("booking:trash", id, patch),
  checkAvailability: (input) => invoke("booking:availability", input),
  retryCommand: (id) => invoke("queue:retry", id),
  revertBooking: (id) => invoke("queue:revert", id),
  getSettings: () => invoke("settings:get"),
  saveSettings: (input) => invoke("settings:save", input),
  testConnection: () => invoke("settings:test"),
  clearCredentials: () => invoke("settings:clear"),
  onStateChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("state:changed", listener);
    return () => ipcRenderer.removeListener("state:changed", listener);
  }
}));
