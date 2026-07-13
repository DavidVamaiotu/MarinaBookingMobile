(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PricingNote = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const AMOUNT = "(?:\\d+\\.\\d{1,2}|\\d+(?:[.\\s]\\d{3})*(?:,\\d{1,2})?)";
  const PRICING_LINE = new RegExp(`Avans:\\s*(${AMOUNT}),\\s*Cost:\\s*(${AMOUNT}),\\s*Rest:\\s*(${AMOUNT})(?![\\d.,])`, "i");

  function parseAmount(value) {
    const normalized = String(value ?? "").trim().replace(/\s+/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
    const amount = Number(normalized);
    return Number.isFinite(amount) && amount >= 0 ? amount : null;
  }

  function formatAmount(value) {
    return new Intl.NumberFormat("ro-RO", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value) || 0);
  }

  function parse(note) {
    const match = String(note || "").match(PRICING_LINE);
    if (!match) return null;
    const deposit = parseAmount(match[1]);
    const total = parseAmount(match[2]);
    const balance = parseAmount(match[3]);
    if (![deposit, total, balance].every(Number.isFinite)) return null;
    return { deposit, total, balance, text: match[0], index: match.index };
  }

  function update(note, deposit, total) {
    const currentPricing = parse(note);
    if (!currentPricing) throw new TypeError("Nota rezervării nu conține un Cost valid.");
    const nextDeposit = Number(deposit);
    const savedTotal = Number(total === undefined ? currentPricing.total : total);
    if (!Number.isFinite(nextDeposit) || !Number.isFinite(savedTotal) || nextDeposit <= 0 || nextDeposit > savedTotal) {
      throw new TypeError("Avansul trebuie să fie mai mare decât zero și cel mult egal cu costul rezervării.");
    }
    const balance = Math.round((savedTotal - nextDeposit) * 100) / 100;
    const line = `Avans: ${formatAmount(nextDeposit)}, Cost: ${formatAmount(savedTotal)}, Rest: ${formatAmount(balance)}`;
    const current = String(note || "");
    return { note: current.replace(PRICING_LINE, line), deposit: nextDeposit, total: savedTotal, balance, line };
  }

  return { PRICING_LINE, formatAmount, parse, parseAmount, update };
});
