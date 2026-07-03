"use strict";

const { DatabaseSync } = require("node:sqlite");
const { randomUUID } = require("node:crypto");

const ACTIVE_COMMAND_STATES = ["queued", "sending", "failed", "conflict", "needs_attention"];

function now() {
  return new Date().toISOString();
}

function json(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function datesFromRange(start, end) {
  const dates = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last && dates.length <= 366) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

class BookingDatabase {
  constructor(filename = ":memory:") {
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.migrate();
    this.recoverInterruptedCommands();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS secrets (
        key TEXT PRIMARY KEY,
        encrypted_value BLOB NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS resources (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        parent_id INTEGER,
        capacity INTEGER,
        base_cost REAL,
        default_form TEXT,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bookings (
        local_id TEXT PRIMARY KEY,
        server_id INTEGER UNIQUE,
        external_id TEXT UNIQUE,
        resource_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        trashed INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        form_data_json TEXT NOT NULL DEFAULT '{}',
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        sync_state TEXT NOT NULL DEFAULT 'synced',
        server_updated_at TEXT,
        server_payload_json TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bookings_range ON bookings(start_date, end_date, resource_id);
      CREATE TABLE IF NOT EXISTS booking_dates (
        booking_local_id TEXT NOT NULL REFERENCES bookings(local_id) ON DELETE CASCADE,
        booking_date TEXT NOT NULL,
        PRIMARY KEY (booking_local_id, booking_date)
      );
      CREATE INDEX IF NOT EXISTS idx_booking_dates_date ON booking_dates(booking_date);
      CREATE TABLE IF NOT EXISTS booking_form_data (
        booking_local_id TEXT NOT NULL REFERENCES bookings(local_id) ON DELETE CASCADE,
        field_name TEXT NOT NULL,
        field_type TEXT NOT NULL,
        field_value TEXT NOT NULL,
        PRIMARY KEY (booking_local_id, field_name)
      );
      CREATE TABLE IF NOT EXISTS booking_notes (
        booking_local_id TEXT PRIMARY KEY REFERENCES bookings(local_id) ON DELETE CASCADE,
        note TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS optimistic_overlays (
        booking_local_id TEXT PRIMARY KEY REFERENCES bookings(local_id) ON DELETE CASCADE,
        base_json TEXT,
        overlay_json TEXT NOT NULL,
        remote_shadow_json TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS commands (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        booking_local_id TEXT,
        resource_id INTEGER,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        available_at TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        result_json TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_commands_ready ON commands(status, available_at, created_at);
      CREATE INDEX IF NOT EXISTS idx_commands_booking ON commands(booking_local_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_commands_resource ON commands(resource_id, created_at);
      CREATE TABLE IF NOT EXISTS sync_errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command_id TEXT,
        booking_local_id TEXT,
        code TEXT NOT NULL,
        message TEXT NOT NULL,
        details_json TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS loaded_ranges (
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        resource_id INTEGER NOT NULL DEFAULT 0,
        loaded_at TEXT NOT NULL,
        PRIMARY KEY (start_date, end_date, resource_id)
      );
    `);
  }

  close() {
    this.db.close();
  }

  transaction(callback) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  recoverInterruptedCommands() {
    const timestamp = now();
    this.db.prepare(`UPDATE commands SET status='queued', available_at=?, updated_at=?, error_code='restart_recovery', error_message='Recovered after application restart.' WHERE status='sending'`).run(timestamp, timestamp);
  }

  getSettings() {
    const rows = this.db.prepare("SELECT key, value FROM settings").all();
    const result = { apiBaseUrl: "", username: "", timezone: "Europe/Bucharest" };
    for (const row of rows) result[row.key] = row.value;
    return result;
  }

  saveSettings(settings) {
    const statement = this.db.prepare("INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at");
    const timestamp = now();
    this.transaction(() => {
      for (const key of ["apiBaseUrl", "username", "timezone"]) {
        if (settings[key] !== undefined) statement.run(key, String(settings[key]), timestamp);
      }
    });
  }

  setSecret(key, encryptedValue) {
    this.db.prepare("INSERT INTO secrets(key,encrypted_value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET encrypted_value=excluded.encrypted_value, updated_at=excluded.updated_at").run(key, encryptedValue, now());
  }

  getSecret(key) {
    return this.db.prepare("SELECT encrypted_value FROM secrets WHERE key=?").get(key)?.encrypted_value || null;
  }

  deleteSecret(key) {
    this.db.prepare("DELETE FROM secrets WHERE key=?").run(key);
  }

  replaceResources(resources) {
    const statement = this.db.prepare(`INSERT INTO resources(id,title,parent_id,capacity,base_cost,default_form,payload_json,updated_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,parent_id=excluded.parent_id,capacity=excluded.capacity,base_cost=excluded.base_cost,default_form=excluded.default_form,payload_json=excluded.payload_json,updated_at=excluded.updated_at`);
    const timestamp = now();
    this.transaction(() => {
      for (const resource of resources) {
        statement.run(Number(resource.id), String(resource.title || `Resource ${resource.id}`), resource.parent_id ?? null, resource.capacity ?? null, resource.base_cost ?? null, resource.default_form || "", JSON.stringify(resource), timestamp);
      }
    });
  }

  listResources() {
    return this.db.prepare("SELECT id,title,parent_id AS parentId,capacity,base_cost AS baseCost,default_form AS defaultForm FROM resources ORDER BY COALESCE(parent_id,0), id").all();
  }

  bookingRow(localId) {
    const row = this.db.prepare("SELECT * FROM bookings WHERE local_id=?").get(localId);
    return row ? this.hydrateBooking(row) : null;
  }

  hydrateBooking(row) {
    const dates = this.db.prepare("SELECT booking_date FROM booking_dates WHERE booking_local_id=? ORDER BY booking_date").all(row.local_id).map((item) => item.booking_date);
    const formData = {};
    for (const field of this.db.prepare("SELECT field_name,field_type,field_value FROM booking_form_data WHERE booking_local_id=? ORDER BY field_name").all(row.local_id)) {
      formData[field.field_name] = { type: field.field_type, value: field.field_value };
    }
    return {
      localId: row.local_id,
      serverId: row.server_id,
      externalId: row.external_id,
      resourceId: row.resource_id,
      status: row.status,
      trashed: Boolean(row.trashed),
      note: row.note,
      formData,
      dates,
      startDate: row.start_date,
      endDate: row.end_date,
      syncState: row.sync_state,
      updatedAt: row.updated_at
    };
  }

  listBookings(start, end) {
    return this.db.prepare("SELECT DISTINCT b.* FROM bookings b JOIN booking_dates d ON d.booking_local_id=b.local_id WHERE d.booking_date BETWEEN ? AND ? ORDER BY b.resource_id,b.start_date,b.server_id").all(start, end).map((row) => this.hydrateBooking(row));
  }

  writeBooking(booking, { preserveOverlay = false } = {}) {
    const localId = String(booking.localId || (booking.serverId ? `server:${booking.serverId}` : `local:${randomUUID()}`));
    const dates = [...new Set(booking.dates || [])].sort();
    if (!dates.length) throw new Error("Booking dates are required");
    const formData = booking.formData || {};
    const timestamp = now();
    this.db.prepare(`INSERT INTO bookings(local_id,server_id,external_id,resource_id,status,trashed,note,form_data_json,start_date,end_date,sync_state,server_updated_at,server_payload_json,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(local_id) DO UPDATE SET server_id=excluded.server_id,external_id=COALESCE(excluded.external_id,bookings.external_id),resource_id=excluded.resource_id,status=excluded.status,trashed=excluded.trashed,note=excluded.note,form_data_json=excluded.form_data_json,start_date=excluded.start_date,end_date=excluded.end_date,sync_state=excluded.sync_state,server_updated_at=excluded.server_updated_at,server_payload_json=excluded.server_payload_json,updated_at=excluded.updated_at`).run(
        localId, booking.serverId ?? null, booking.externalId || null, Number(booking.resourceId), booking.status || "pending", booking.trashed ? 1 : 0, String(booking.note || ""), JSON.stringify(formData), dates[0], dates[dates.length - 1], booking.syncState || "synced", booking.serverUpdatedAt || null, booking.serverPayload ? JSON.stringify(booking.serverPayload) : null, timestamp
      );
    this.db.prepare("DELETE FROM booking_dates WHERE booking_local_id=?").run(localId);
    const dateStatement = this.db.prepare("INSERT INTO booking_dates(booking_local_id,booking_date) VALUES(?,?)");
    for (const date of dates) dateStatement.run(localId, date);
    this.db.prepare("DELETE FROM booking_form_data WHERE booking_local_id=?").run(localId);
    const fieldStatement = this.db.prepare("INSERT INTO booking_form_data(booking_local_id,field_name,field_type,field_value) VALUES(?,?,?,?)");
    for (const [name, field] of Object.entries(formData)) fieldStatement.run(localId, name, String(field.type || "text"), String(field.value ?? ""));
    this.db.prepare("INSERT INTO booking_notes(booking_local_id,note,updated_at) VALUES(?,?,?) ON CONFLICT(booking_local_id) DO UPDATE SET note=excluded.note,updated_at=excluded.updated_at").run(localId, String(booking.note || ""), timestamp);
    if (!preserveOverlay && booking.syncState === "synced") this.db.prepare("DELETE FROM optimistic_overlays WHERE booking_local_id=?").run(localId);
    return this.bookingRow(localId);
  }

  upsertRemoteBooking(booking) {
    const serverId = Number(booking.serverId);
    const existing = this.db.prepare("SELECT local_id,sync_state FROM bookings WHERE server_id=?").get(serverId);
    if (existing && existing.sync_state !== "synced") {
      const overlay = this.db.prepare("SELECT base_json FROM optimistic_overlays WHERE booking_local_id=?").get(existing.local_id);
      const base = json(overlay?.base_json);
      this.db.prepare("UPDATE optimistic_overlays SET remote_shadow_json=?,updated_at=? WHERE booking_local_id=?").run(JSON.stringify(booking), now(), existing.local_id);
      const comparable = (value) => value ? JSON.stringify({ resourceId: Number(value.resourceId), dates: value.dates || [], status: value.status || "pending", trashed: Boolean(value.trashed), note: value.note || "", formData: value.formData || {} }) : "";
      if (base && comparable(base) !== comparable(booking)) this.markBookingConflict(existing.local_id, "remote_changed", "The server booking changed while local edits were pending.", booking);
      return this.bookingRow(existing.local_id);
    }
    return this.transaction(() => this.writeBooking({ ...booking, localId: existing?.local_id || `server:${serverId}`, syncState: "synced" }));
  }

  setOverlay(localId, base, overlay) {
    this.db.prepare("INSERT INTO optimistic_overlays(booking_local_id,base_json,overlay_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(booking_local_id) DO UPDATE SET overlay_json=excluded.overlay_json,updated_at=excluded.updated_at").run(localId, base ? JSON.stringify(base) : null, JSON.stringify(overlay), now());
  }

  enqueue(type, bookingLocalId, resourceId, payload, options = {}) {
    const coalescible = new Set(["edit", "note"]);
    const timestamp = now();
    if (coalescible.has(type) && !options.noCoalesce) {
      const existing = this.db.prepare("SELECT id FROM commands WHERE type=? AND booking_local_id=? AND status='queued' ORDER BY created_at DESC LIMIT 1").get(type, bookingLocalId);
      if (existing) {
        this.db.prepare("UPDATE commands SET payload_json=?,resource_id=?,updated_at=?,available_at=?,error_code=NULL,error_message=NULL WHERE id=?").run(JSON.stringify(payload), resourceId ?? null, timestamp, timestamp, existing.id);
        return existing.id;
      }
    }
    const id = options.commandId || randomUUID();
    this.db.prepare("INSERT INTO commands(id,type,booking_local_id,resource_id,payload_json,status,available_at,idempotency_key,created_at,updated_at) VALUES(?,?,?,?,?,'queued',?,?,?,?)").run(id, type, bookingLocalId || null, resourceId ?? null, JSON.stringify(payload), timestamp, options.idempotencyKey || id, timestamp, timestamp);
    return id;
  }

  optimisticCreate(input) {
    const externalId = randomUUID();
    const localId = `local:${externalId}`;
    return this.transaction(() => {
      const booking = this.writeBooking({ ...input, localId, externalId, status: input.approved ? "approved" : "pending", trashed: false, syncState: "queued" });
      this.setOverlay(localId, null, booking);
      const commandId = this.enqueue("create", localId, input.resourceId, { resource_id: input.resourceId, dates: input.dates, form_data: input.formData, approved: Boolean(input.approved), send_email: Boolean(input.sendEmail), external_id: externalId }, { noCoalesce: true, idempotencyKey: externalId, commandId: externalId });
      return { booking, commandId };
    });
  }

  optimisticUpdate(localId, patch, type = "edit") {
    return this.transaction(() => {
      const current = this.bookingRow(localId);
      if (!current) throw new Error("Booking not found");
      const next = { ...current, ...patch, formData: patch.formData || current.formData, dates: patch.dates || current.dates, syncState: "queued" };
      const booking = this.writeBooking(next, { preserveOverlay: true });
      this.setOverlay(localId, current, booking);
      let payload;
      if (type === "status") payload = { status: booking.status, send_email: Boolean(patch.sendEmail) };
      else if (type === "note") payload = { note: booking.note };
      else if (type === "trash") payload = { trash: booking.trashed, send_email: Boolean(patch.sendEmail) };
      else payload = { resource_id: booking.resourceId, dates: booking.dates, form_data: booking.formData, availability_dates: current.resourceId === booking.resourceId ? booking.dates.filter((date) => !current.dates.includes(date)) : booking.dates };
      const commandId = this.enqueue(type, localId, booking.resourceId, payload);
      return { booking, commandId };
    });
  }

  commandRows(limit = 500) {
    return this.db.prepare("SELECT * FROM commands ORDER BY created_at DESC LIMIT ?").all(limit).map((row) => ({
      id: row.id, type: row.type, bookingLocalId: row.booking_local_id, resourceId: row.resource_id, payload: json(row.payload_json, {}), status: row.status, attempts: row.attempts, availableAt: row.available_at, result: json(row.result_json), errorCode: row.error_code, errorMessage: row.error_message, createdAt: row.created_at, updatedAt: row.updated_at
    }));
  }

  getCommand(id) {
    const row = this.db.prepare("SELECT * FROM commands WHERE id=?").get(id);
    return row ? { ...row, payload: json(row.payload_json, {}) } : null;
  }

  readyCommands(timestamp = now()) {
    const rows = this.db.prepare("SELECT * FROM commands WHERE status='queued' AND available_at<=? ORDER BY created_at,id").all(timestamp).map((row) => ({ ...row, payload: json(row.payload_json, {}) }));
    return rows.filter((candidate) => !this.db.prepare(`SELECT 1 FROM commands WHERE id<>? AND (created_at<? OR (created_at=? AND id<?)) AND status IN (${ACTIVE_COMMAND_STATES.map(() => "?").join(",")}) AND ((booking_local_id IS NOT NULL AND booking_local_id=?) OR (resource_id IS NOT NULL AND resource_id=?)) LIMIT 1`).get(candidate.id, candidate.created_at, candidate.created_at, candidate.id, ...ACTIVE_COMMAND_STATES, candidate.booking_local_id, candidate.resource_id));
  }

  markSending(id) {
    this.db.prepare("UPDATE commands SET status='sending',attempts=attempts+1,updated_at=?,error_code=NULL,error_message=NULL WHERE id=?").run(now(), id);
  }

  markCommand(id, status, { result = null, code = null, message = null, availableAt = null } = {}) {
    const timestamp = now();
    this.db.prepare("UPDATE commands SET status=?,result_json=?,error_code=?,error_message=?,available_at=COALESCE(?,available_at),updated_at=?,completed_at=CASE WHEN ?='synced' THEN ? ELSE completed_at END WHERE id=?").run(status, result ? JSON.stringify(result) : null, code, message, availableAt, timestamp, status, timestamp, id);
    const command = this.getCommand(id);
    if (status !== "synced" && code) this.db.prepare("INSERT INTO sync_errors(command_id,booking_local_id,code,message,details_json,created_at) VALUES(?,?,?,?,?,?)").run(id, command?.booking_local_id || null, code, message || code, result ? JSON.stringify(result) : null, timestamp);
    if (command?.booking_local_id) this.refreshBookingSyncState(command.booking_local_id);
  }

  markCreateSynced(command, serverId, result) {
    this.transaction(() => {
      this.db.prepare("UPDATE bookings SET server_id=?,sync_state='synced',updated_at=? WHERE local_id=?").run(Number(serverId), now(), command.booking_local_id);
      this.markCommand(command.id, "synced", { result });
      this.refreshBookingSyncState(command.booking_local_id);
    });
  }

  refreshBookingSyncState(localId) {
    const active = this.db.prepare("SELECT status FROM commands WHERE booking_local_id=? AND status<>'synced' ORDER BY created_at LIMIT 1").get(localId);
    const state = active?.status || "synced";
    this.db.prepare("UPDATE bookings SET sync_state=?,updated_at=? WHERE local_id=?").run(state, now(), localId);
    if (!active) this.db.prepare("DELETE FROM optimistic_overlays WHERE booking_local_id=?").run(localId);
  }

  retryCommand(id) {
    this.db.prepare("UPDATE commands SET status='queued',available_at=?,error_code=NULL,error_message=NULL,updated_at=? WHERE id=? AND status IN ('failed','conflict','needs_attention')").run(now(), now(), id);
  }

  markBookingConflict(localId, code, message, details = null) {
    const command = this.db.prepare("SELECT id FROM commands WHERE booking_local_id=? AND status='queued' ORDER BY created_at,id LIMIT 1").get(localId);
    if (command) this.markCommand(command.id, "conflict", { code, message, result: details });
    else this.db.prepare("UPDATE bookings SET sync_state='conflict',updated_at=? WHERE local_id=?").run(now(), localId);
  }

  revertBooking(localId) {
    return this.transaction(() => {
      const overlay = this.db.prepare("SELECT base_json FROM optimistic_overlays WHERE booking_local_id=?").get(localId);
      if (!overlay) return this.bookingRow(localId);
      this.db.prepare("UPDATE commands SET status='failed',error_code='reverted',error_message='Reverted by user',updated_at=? WHERE booking_local_id=? AND status IN ('queued','conflict','needs_attention')").run(now(), localId);
      const base = json(overlay.base_json);
      if (!base) {
        this.db.prepare("DELETE FROM bookings WHERE local_id=?").run(localId);
        return null;
      }
      const booking = this.writeBooking({ ...base, syncState: "synced" });
      this.db.prepare("DELETE FROM optimistic_overlays WHERE booking_local_id=?").run(localId);
      return booking;
    });
  }

  diagnostics() {
    const counts = Object.fromEntries(this.db.prepare("SELECT status,COUNT(*) count FROM commands GROUP BY status").all().map((row) => [row.status, row.count]));
    const meta = Object.fromEntries(this.db.prepare("SELECT key,value FROM sync_meta").all().map((row) => [row.key, row.value]));
    return { queued: (counts.queued || 0) + (counts.sending || 0), failed: (counts.failed || 0) + (counts.conflict || 0) + (counts.needs_attention || 0), counts, lastSuccessfulSync: meta.lastSuccessfulSync || null, authPaused: meta.authPaused === "true" };
  }

  setMeta(key, value) {
    this.db.prepare("INSERT INTO sync_meta(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(key, String(value), now());
  }
}

module.exports = { BookingDatabase, datesFromRange };
