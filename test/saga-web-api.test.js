"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const SagaWebApi = require("../src/shared/saga-web-api");
const { SagaWebTokenStore } = require("../src/main/saga-web-token-store");
const validate = require("../src/main/validation");

const invoiceXml = '<?xml version="1.0" encoding="UTF-8"?><Facturi><Factura><Antet></Antet></Factura></Facturi>';

test("SAGA Web import uploads the generated XML with the documented headers", async () => {
  let request;
  const result = await SagaWebApi.importSagaInvoice({
    xml: invoiceXml,
    filename: "F_RO123_MARINA-42_20260902.xml",
    codFiscal: "RO123",
    token: "initial-token",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => name.toLowerCase() === "x-saga-refresh-token" ? "rotated-token" : null },
        text: async () => JSON.stringify({ success: true, message: "Import realizat cu succes." })
      };
    }
  });

  assert.equal(request.url, SagaWebApi.DEFAULT_IMPORT_URL);
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer initial-token");
  assert.equal(request.options.headers["X-Saga-Cod-Fiscal"], "RO123");
  assert.equal(request.options.headers["Content-Type"], undefined);
  assert.equal(request.options.body.get("file").name, "F_RO123_MARINA-42_20260902.xml");
  assert.equal(await request.options.body.get("file").text(), invoiceXml);
  assert.equal(result.refreshToken, "rotated-token");
  assert.equal(result.message, "Import realizat cu succes.");
});

test("SAGA Web errors retain a rotated token for the caller to persist", async () => {
  await assert.rejects(
    SagaWebApi.importSagaInvoice({
      xml: invoiceXml,
      filename: "F_RO123_MARINA-42_20260902.xml",
      codFiscal: "RO123",
      token: "initial-token",
      fetchImpl: async () => ({
        ok: false,
        status: 400,
        headers: { get: () => "rotated-after-error" },
        text: async () => JSON.stringify({ success: false, error: "Fișier XML invalid." })
      })
    }),
    (error) => error.message === "Fișier XML invalid."
      && error.status === 400
      && error.refreshToken === "rotated-after-error"
  );
});

test("SAGA Web token storage requires encryption and never returns ciphertext as text", async () => {
  const secrets = new Map();
  const database = {
    getSecret: (key) => secrets.get(key) || null,
    setSecret: (key, value) => secrets.set(key, value),
    deleteSecret: (key) => secrets.delete(key)
  };
  const safeStorage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "kwallet",
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (value) => value.toString().replace(/^encrypted:/, "")
  };
  const store = new SagaWebTokenStore({ database, safeStorage });

  await store.setToken("secret-token");
  assert.equal(store.hasTokenSync(), true);
  assert.equal(await store.getToken(), "secret-token");
  assert.notEqual(String([...secrets.values()][0]), "secret-token");
});

test("SAGA Web import IPC input accepts only a SAGA invoice XML filename contract", () => {
  assert.deepEqual(validate.sagaInvoiceImport({
    xml: invoiceXml,
    filename: "F_RO123_MARINA-42_20260902.xml",
    codFiscal: "RO123"
  }), {
    xml: invoiceXml,
    filename: "F_RO123_MARINA-42_20260902.xml",
    codFiscal: "RO123"
  });
  assert.throws(() => validate.sagaInvoiceImport({ xml: "<not-saga />", filename: "invoice.xml", codFiscal: "RO123" }), /XML-ul facturii SAGA este invalid/);
});
