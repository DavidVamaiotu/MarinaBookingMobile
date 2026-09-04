"use strict";

const TOKEN_KEY = "marinaOAuthRefreshToken";

class MarinaTokenStore {
  constructor({ database, safeStorage } = {}) {
    this.database = database;
    this.safeStorage = safeStorage;
    this.writeChain = Promise.resolve();
  }

  assertSecureBackend() {
    if (!this.safeStorage?.isEncryptionAvailable()) throw Object.assign(new Error("Stocarea securizată pentru conectarea Marina nu este disponibilă."), { code: "marina_secure_storage_unavailable" });
    if (this.safeStorage.getSelectedStorageBackend?.() === "basic_text") throw Object.assign(new Error("Conectarea Marina necesită portofelul securizat al sistemului."), { code: "marina_secure_storage_unavailable" });
  }

  hasRefreshTokenSync() { return Boolean(this.database.getSecret(TOKEN_KEY)); }
  async hasRefreshToken() { await this.writeChain.catch(() => {}); return this.hasRefreshTokenSync(); }
  async setRefreshToken(token) {
    return this.serializeWrite(() => {
      this.assertSecureBackend();
      this.database.setSecret(TOKEN_KEY, this.safeStorage.encryptString(String(token)));
    });
  }
  async getRefreshToken() {
    await this.writeChain.catch(() => {});
    const encrypted = this.database.getSecret(TOKEN_KEY);
    if (!encrypted) return "";
    this.assertSecureBackend();
    return this.safeStorage.decryptString(Buffer.from(encrypted));
  }
  async clearRefreshToken() { return this.serializeWrite(() => this.database.deleteSecret(TOKEN_KEY)); }

  serializeWrite(operation) {
    const next = this.writeChain.catch(() => {}).then(operation);
    this.writeChain = next;
    return next.finally(() => { if (this.writeChain === next) this.writeChain = Promise.resolve(); });
  }
}

module.exports = { MarinaTokenStore, TOKEN_KEY };
