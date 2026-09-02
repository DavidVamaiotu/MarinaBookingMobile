"use strict";

const TOKEN_KEY = "sagaWebApiToken";

class SagaWebTokenStore {
  constructor({ database, safeStorage } = {}) {
    this.database = database;
    this.safeStorage = safeStorage;
  }

  assertSecureBackend() {
    if (!this.safeStorage?.isEncryptionAvailable()) throw Object.assign(new Error("Stocarea securizată pentru cheia SAGA Web nu este disponibilă."), { code: "saga_web_secure_storage_unavailable" });
    if (this.safeStorage.getSelectedStorageBackend?.() === "basic_text") throw Object.assign(new Error("Cheia SAGA Web necesită portofelul securizat al sistemului."), { code: "saga_web_secure_storage_unavailable" });
  }

  hasTokenSync() { return Boolean(this.database.getSecret(TOKEN_KEY)); }
  async hasToken() { return this.hasTokenSync(); }
  async setToken(token) {
    const value = String(token || "").trim();
    if (!value) throw new TypeError("Cheia API SAGA Web este obligatorie.");
    this.assertSecureBackend();
    this.database.setSecret(TOKEN_KEY, this.safeStorage.encryptString(value));
  }
  async getToken() {
    const encrypted = this.database.getSecret(TOKEN_KEY);
    if (!encrypted) return "";
    this.assertSecureBackend();
    return this.safeStorage.decryptString(Buffer.from(encrypted));
  }
  async clearToken() { this.database.deleteSecret(TOKEN_KEY); }
}

module.exports = { SagaWebTokenStore, TOKEN_KEY };
