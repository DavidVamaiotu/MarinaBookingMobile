(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MarinaOperationRegistry = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function stableValue(value, omittedKeys = new Set()) {
    if (Array.isArray(value)) return value.map((item) => stableValue(item, omittedKeys));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).sort()
      .filter((key) => !omittedKeys.has(key) && value[key] !== undefined)
      .map((key) => [key, stableValue(value[key], omittedKeys)]));
  }

  function operationScope(kind, workspace, input, omittedKeys = ["quoteId"]) {
    return JSON.stringify([kind, String(workspace ?? ""), stableValue(input, new Set(omittedKeys))]);
  }

  function outcomeIsUncertain(error) {
    return Boolean(error) && (error.status === undefined || error.status === 408 || error.status === 429 || error.status >= 500);
  }

  function capacityError() {
    return Object.assign(new Error("Sunt prea multe operațiuni Marina cu rezultat incert în această sesiune. Reîncearcă după ce verifici operațiunile precedente."), {
      code: "marina_retry_capacity",
      permanent: true
    });
  }

  function createOperationRegistry({ limit = 50, createKey = () => crypto.randomUUID() } = {}) {
    const records = new Map();

    function recordFor(scope) {
      let record = records.get(scope);
      if (record) return record;
      if (records.size >= limit) throw capacityError();
      record = { key: createKey(), prepared: undefined, preparePromise: null, inFlight: null };
      records.set(scope, record);
      return record;
    }

    async function run(scope, prepare, execute) {
      const record = recordFor(scope);
      if (record.inFlight) return record.inFlight;
      const operation = (async () => {
        if (record.prepared === undefined) {
          if (!record.preparePromise) record.preparePromise = Promise.resolve().then(prepare);
          try { record.prepared = await record.preparePromise; }
          catch (error) {
            if (records.get(scope) === record) records.delete(scope);
            throw error;
          } finally { record.preparePromise = null; }
        }
        try {
          const result = await execute(record.prepared, record.key);
          if (records.get(scope) === record) records.delete(scope);
          return result;
        } catch (error) {
          if (!outcomeIsUncertain(error) && records.get(scope) === record) records.delete(scope);
          throw error;
        }
      })();
      record.inFlight = operation;
      try { return await operation; }
      finally { if (record.inFlight === operation) record.inFlight = null; }
    }

    function clear() { records.clear(); }
    return { clear, get size() { return records.size; }, run };
  }

  return { createOperationRegistry, operationScope, outcomeIsUncertain, stableValue };
});
