"use strict";

const DEFAULT_IMPORT_URL = "https://web.sagasoft.ro/api/v20260225/Import";

class SagaWebImportError extends Error {
  constructor(message, { status = 0, code = "saga_web_import_failed", refreshToken = "" } = {}) {
    super(message);
    this.name = "SagaWebImportError";
    this.status = status;
    this.code = code;
    this.refreshToken = refreshToken;
    this.permanent = status >= 400 && status < 500 && status !== 408 && status !== 429;
  }
}

function requiredText(value, label, maxLength = 10_000) {
  const result = String(value ?? "").trim();
  if (!result) throw new TypeError(`${label} este obligatoriu.`);
  if (result.length > maxLength) throw new TypeError(`${label} este prea lung.`);
  return result;
}

async function responsePayload(response) {
  try {
    const text = String(await response.text() || "").trim();
    if (!text) return {};
    try {
      const payload = JSON.parse(text);
      return payload && typeof payload === "object" ? payload : {};
    } catch { return { message: text }; }
  } catch { return {}; }
}

async function importSagaInvoice({
  xml,
  filename,
  codFiscal,
  token,
  fetchImpl = globalThis.fetch,
  endpoint = DEFAULT_IMPORT_URL
} = {}) {
  const invoiceXml = requiredText(xml, "XML-ul facturii", 2_000_000);
  const invoiceFilename = requiredText(filename, "Numele fișierului", 240);
  const companyCif = requiredText(codFiscal, "Codul fiscal SAGA", 100);
  const accessToken = requiredText(token, "Cheia API SAGA Web", 20_000);
  if (typeof fetchImpl !== "function") throw new TypeError("Clientul HTTP pentru SAGA Web nu este disponibil.");

  const form = new FormData();
  form.append("file", new Blob([invoiceXml], { type: "application/xml" }), invoiceFilename);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-Saga-Cod-Fiscal": companyCif
      },
      body: form
    });
  } catch (cause) {
    throw Object.assign(new SagaWebImportError("SAGA Web nu a putut fi contactat.", { code: "saga_web_network_error" }), { cause });
  }

  const refreshToken = String(response.headers?.get?.("x-saga-refresh-token") || "").trim();
  const payload = await responsePayload(response);
  if (!response.ok || payload.success === false) {
    const message = String(payload.error || payload.message || `Importul SAGA Web a eșuat (HTTP ${response.status}).`).trim();
    throw new SagaWebImportError(message, { status: response.status, refreshToken });
  }
  return {
    success: true,
    message: String(payload.message || "Factura a fost încărcată în SAGA Web pentru import.").trim(),
    refreshToken
  };
}

module.exports = { DEFAULT_IMPORT_URL, SagaWebImportError, importSagaInvoice };
