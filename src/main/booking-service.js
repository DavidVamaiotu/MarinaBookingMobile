"use strict";

const { EventEmitter } = require("node:events");

class BookingService extends EventEmitter {
  constructor({ database, api, queue, vault } = {}) {
    super();
    this.database = database;
    this.api = api;
    this.queue = queue;
    this.vault = vault;
    this.visibleRange = null;
    this.refreshTimer = null;
    this.refreshInFlight = null;
    queue.on("changed", () => this.emitState());
  }

  start() {
    this.queue.start();
    this.refreshTimer = setInterval(() => {
      if (this.visibleRange) void this.refresh(this.visibleRange).catch(() => {});
    }, 60_000);
    this.refreshTimer.unref?.();
  }

  stop() {
    this.queue.stop();
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  settings() {
    return { ...this.database.getSettings(), credentialsConfigured: this.vault.hasPassword() };
  }

  state(range = this.visibleRange) {
    const dates = range || { start: new Date().toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10) };
    const diagnostics = this.database.diagnostics();
    return {
      resources: this.database.listResources(),
      bookings: this.database.listBookings(dates.start, dates.end),
      commands: this.database.commandRows(),
      diagnostics: { ...diagnostics, online: this.database.db.prepare("SELECT value FROM sync_meta WHERE key='online'").get()?.value !== "false" },
      settings: this.settings(),
      range: dates
    };
  }

  emitState() {
    this.emit("state", this.state());
  }

  async refresh(range) {
    this.visibleRange = range;
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      try {
        const [resources, bookings] = await Promise.all([this.api.resources(), this.api.bookings(range.start, range.end)]);
        this.database.replaceResources(resources);
        for (const booking of bookings) this.database.upsertRemoteBooking(booking);
        const returnedIds = new Set(bookings.map((booking) => booking.serverId));
        const pending = this.database.listBookings(range.start, range.end).filter((booking) => booking.serverId && booking.syncState !== "synced" && !returnedIds.has(booking.serverId));
        for (const local of pending) {
          try {
            this.database.upsertRemoteBooking(await this.api.booking(local.serverId));
          } catch (error) {
            if (error.status === 404) this.database.markBookingConflict(local.localId, "remote_missing", "The booking was removed or is no longer visible on the server.");
            else throw error;
          }
        }
        this.database.setMeta("lastSuccessfulSync", new Date().toISOString());
        this.database.setMeta("online", "true");
        this.database.setMeta("authPaused", "false");
        this.emitState();
        return this.state(range);
      } catch (error) {
        if (error.auth) this.database.setMeta("authPaused", "true");
        this.database.setMeta("online", error.auth ? "true" : "false");
        this.emitState();
        throw error;
      } finally {
        this.refreshInFlight = null;
      }
    })();
    return this.refreshInFlight;
  }

  create(input) {
    const result = this.database.optimisticCreate(input);
    if (input.note) this.database.optimisticUpdate(result.booking.localId, { note: input.note }, "note");
    this.emitState();
    this.queue.schedule(0);
    return this.database.bookingRow(result.booking.localId);
  }

  update(localId, patch, type = "edit") {
    const result = this.database.optimisticUpdate(localId, patch, type);
    this.emitState();
    this.queue.schedule(0);
    return result.booking;
  }

  availability(resourceId, dates) {
    return this.api.availability(resourceId, dates);
  }

  retry(commandId) {
    this.database.retryCommand(commandId);
    this.emitState();
    this.queue.schedule(0);
  }

  revert(localId) {
    const result = this.database.revertBooking(localId);
    this.emitState();
    return result;
  }
}

module.exports = { BookingService };
