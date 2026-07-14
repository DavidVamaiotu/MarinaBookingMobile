"use strict";

const { EventEmitter } = require("node:events");

function backoffDelay(attempt, random = Math.random) {
  const base = Math.min(5 * 60_000, 1000 * (2 ** Math.max(0, attempt - 1)));
  return Math.round(base * (0.75 + random() * 0.5));
}

class CommandQueue extends EventEmitter {
  constructor({ database, api, maxConcurrency = 3, random = Math.random, setTimer = setTimeout, skipAvailabilityChecks = false } = {}) {
    super();
    this.database = database;
    this.api = api;
    this.maxConcurrency = maxConcurrency;
    this.random = random;
    this.setTimer = setTimer;
    this.skipAvailabilityChecks = skipAvailabilityChecks;
    this.running = new Set();
    this.timer = null;
    this.stopped = true;
    this.authPaused = database.diagnostics().authPaused;
  }

  start() {
    this.stopped = false;
    this.schedule(0);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  resumeAfterCredentials({ retryFailed = true } = {}) {
    this.authPaused = false;
    this.database.setMeta("authPaused", "false");
    if (retryFailed) this.database.retryAuthenticationCommands();
    this.schedule(0);
  }

  pauseForAuthentication() {
    this.authPaused = true;
    this.database.setMeta("authPaused", "true");
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  pauseForEndpointChange() {
    this.pauseForAuthentication();
  }

  schedule(delay = 1000) {
    if (this.stopped || this.authPaused || this.timer) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.pump();
    }, delay);
    this.timer.unref?.();
  }

  async pump() {
    if (this.stopped || this.authPaused) return;
    const slots = Math.max(0, this.maxConcurrency - this.running.size);
    const ready = this.database.readyCommands().slice(0, slots);
    for (const command of ready) {
      if (this.running.has(command.id)) continue;
      this.running.add(command.id);
      void this.execute(command).finally(() => {
        this.running.delete(command.id);
        this.emit("changed");
        this.schedule(0);
      });
    }
    this.schedule(ready.length ? 50 : 1000);
  }

  async execute(command) {
    const currentEndpoint = this.database.getSettings().apiBaseUrl;
    if (command.api_base_url && command.api_base_url !== currentEndpoint) {
      this.database.markCommand(command.id, "needs_attention", { code: "endpoint_changed", message: "Adresa API s-a schimbat; verifică ținta înainte de a reîncerca această comandă." });
      return;
    }
    this.database.markSending(command.id);
    this.emit("changed");
    const booking = command.booking_local_id ? this.database.bookingRow(command.booking_local_id) : null;
    try {
      if (!booking) throw Object.assign(new Error("Rezervarea locală nu mai există."), { code: "local_booking_missing", permanent: true });
      let response;
      if (!this.skipAvailabilityChecks && (command.type === "create" || (command.type === "edit" && command.payload.availability_dates?.length))) {
        const dates = command.type === "create" ? command.payload.dates : command.payload.availability_dates;
        const availability = await this.api.availability(command.resource_id, dates, {
          expectedApiBaseUrl: command.api_base_url,
          excludeBookingId: command.type === "edit" ? booking.serverId : undefined
        });
        if (availability.available === false) throw Object.assign(new Error("Datele solicitate nu mai sunt disponibile."), { code: "availability_conflict", conflict: true, permanent: true, payload: availability });
      }
      if (command.type === "create") response = await this.api.create(command.payload, command.idempotency_key, { expectedApiBaseUrl: command.api_base_url });
      else {
        if (!booking.serverId) throw Object.assign(new Error("Se așteaptă atribuirea ID-ului de server de către comanda de creare."), { code: "server_id_missing", temporary: true });
        const { availability_dates: _availabilityDates, ...apiPayload } = command.payload;
        response = await this.api[command.type](booking.serverId, apiPayload, command.idempotency_key, { expectedApiBaseUrl: command.api_base_url });
      }
      if (command.type === "create") {
        const serverId = Number(response.payload.booking_id ?? response.payload.id);
        if (!serverId) throw Object.assign(new Error("Crearea a reușit fără un ID de rezervare."), { code: "invalid_create_response", unknownOutcome: true });
        this.database.markCreateSynced(command, serverId, response.payload);
      } else {
        this.database.markCommand(command.id, "synced", { result: response.payload });
      }
      this.database.setMeta("lastSuccessfulSync", new Date().toISOString());
      this.database.setMeta("online", "true");
    } catch (error) {
      await this.handleFailure(command, error);
    }
  }

  async handleFailure(command, error) {
    if (error.code === "endpoint_changed") {
      this.database.markCommand(command.id, "needs_attention", { code: "endpoint_changed", message: error.message });
      return;
    }
    if (error.auth) {
      this.authPaused = true;
      this.database.setMeta("authPaused", "true");
      this.database.markCommand(command.id, "failed", { code: "authentication_failed", message: error.message, result: { serverCode: error.code || null, status: error.status || null } });
      return;
    }
    if (command.type === "create" && error.unknownOutcome) {
      try {
        const booking = await this.api.bookingByExternalId(command.payload.external_id, { expectedApiBaseUrl: command.api_base_url });
        if (booking.serverId) {
          this.database.markCreateSynced(command, booking.serverId, { booking_id: booking.serverId, reconciled: true });
          this.database.setMeta("lastSuccessfulSync", new Date().toISOString());
          return;
        }
      } catch (reconcileError) {
        if (reconcileError.status !== 404 || reconcileError.code === "rest_no_route") {
          this.database.markCommand(command.id, "needs_attention", { code: "create_outcome_unknown", message: "Rezultatul creării este necunoscut și nu a putut fi reconciliat prin external_id." });
          return;
        }
        // v1.0.2 returned a reliable exact-match miss. Retrying the same key is safe.
        const attempt = Number(command.attempts || 0) + 1;
        this.database.markCommand(command.id, "queued", { code: "create_not_found_after_timeout", message: "Nicio rezervare nu corespunde external_id; se reîncearcă folosind aceeași cheie de idempotență.", availableAt: new Date(Date.now() + backoffDelay(attempt, this.random)).toISOString() });
        return;
      }
    }
    if (["deposit_update", "payment_request"].includes(command.type) && error.unknownOutcome) {
      const attempt = Number(command.attempts || 0) + 1;
      this.database.markCommand(command.id, "queued", { code: error.code || "payment_outcome_unknown", message: "Rezultatul operației de plată este necunoscut; se reîncearcă folosind aceeași cheie de idempotență.", availableAt: new Date(Date.now() + backoffDelay(attempt, this.random)).toISOString() });
      this.database.setMeta("online", "false");
      return;
    }
    if (error.conflict || error.status === 409 || (error.status === 404 && command.type !== "create")) {
      this.database.markCommand(command.id, "conflict", { code: error.code || "conflict", message: error.message, result: error.payload });
      return;
    }
    if (error.temporary || error.rateLimited) {
      const attempt = Number(command.attempts || 0) + 1;
      const delay = error.retryAfter ? error.retryAfter * 1000 : backoffDelay(attempt, this.random);
      this.database.markCommand(command.id, "queued", { code: error.code || "temporary_failure", message: error.message, availableAt: new Date(Date.now() + delay).toISOString() });
      this.database.setMeta("online", error.rateLimited ? "true" : "false");
      return;
    }
    this.database.markCommand(command.id, "failed", { code: error.code || "request_failed", message: error.message, result: error.payload });
  }
}

module.exports = { CommandQueue, backoffDelay };
