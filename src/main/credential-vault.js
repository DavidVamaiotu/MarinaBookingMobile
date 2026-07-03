"use strict";

class CredentialVault {
  constructor(database, safeStorage) {
    this.database = database;
    this.safeStorage = safeStorage;
  }

  assertSecureBackend() {
    if (!this.safeStorage?.isEncryptionAvailable()) throw new Error("OS credential encryption is unavailable.");
    const backend = this.safeStorage.getSelectedStorageBackend?.();
    if (backend === "basic_text") throw new Error("A secure OS keychain is required; Electron reported the insecure basic_text backend.");
  }

  setPassword(password) {
    this.assertSecureBackend();
    this.database.setSecret("applicationPassword", this.safeStorage.encryptString(String(password)));
  }

  getPassword() {
    const encrypted = this.database.getSecret("applicationPassword");
    if (!encrypted) return "";
    this.assertSecureBackend();
    return this.safeStorage.decryptString(Buffer.from(encrypted));
  }

  hasPassword() {
    return Boolean(this.database.getSecret("applicationPassword"));
  }

  clear() {
    this.database.deleteSecret("applicationPassword");
  }
}

module.exports = { CredentialVault };
