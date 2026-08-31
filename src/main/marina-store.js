"use strict";

const { DatabaseSync } = require("node:sqlite");

function now() {
  return new Date().toISOString();
}

class MarinaStore {
  constructor(filename = ":memory:") {
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS secrets (
        key TEXT PRIMARY KEY,
        encrypted_value BLOB NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  getMeta(key) {
    return this.db.prepare("SELECT value FROM sync_meta WHERE key=?").get(key)?.value ?? null;
  }

  setMeta(key, value) {
    this.db.prepare("INSERT INTO sync_meta(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(key, String(value), now());
  }

  setSecret(key, encryptedValue) {
    this.db.prepare("INSERT INTO secrets(key,encrypted_value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET encrypted_value=excluded.encrypted_value,updated_at=excluded.updated_at").run(key, encryptedValue, now());
  }

  getSecret(key) {
    return this.db.prepare("SELECT encrypted_value FROM secrets WHERE key=?").get(key)?.encrypted_value || null;
  }

  deleteSecret(key) {
    this.db.prepare("DELETE FROM secrets WHERE key=?").run(key);
  }

  close() {
    this.db.close();
  }
}

module.exports = { MarinaStore };
