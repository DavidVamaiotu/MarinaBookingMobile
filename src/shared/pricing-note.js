(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PricingNote = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const AMOUNT = "(?:\\d+\\.\\d{1,2}|\\d+(?:[.\\s]\\d{3})*(?:,\\d{1,2})?)";
  const PRICING_LINE = new RegExp(`Cost total:\\s*(${AMOUNT})\\s*RON,\\s*Depozit:\\s*(${AMOUNT})\\s*RON,\\s*Rest:\\s*(${AMOUNT})\\s*RON(?![\\d.,])`, "i");
  const LEGACY_PRICING_LINE = new RegExp(`Avans:\\s*(${AMOUNT}),\\s*Cost:\\s*(${AMOUNT}),\\s*Rest:\\s*(${AMOUNT})(?![\\d.,])`, "i");

  function parseAmount(value) {
    const normalized = String(value ?? "").trim().replace(/\s+/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
    const amount = Number(normalized);
    return Number.isFinite(amount) && amount >= 0 ? amount : null;
  }

  function formatAmount(value) {
    return new Intl.NumberFormat("ro-RO", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value) || 0);
  }

  function format({ total, deposit, balance }) {
    return `Cost total: ${formatAmount(total)} RON, Depozit: ${formatAmount(deposit)} RON, Rest: ${formatAmount(balance)} RON`;
  }

  function parse(note) {
    const value = String(note || "");
    const canonical = value.match(PRICING_LINE);
    const match = canonical || value.match(LEGACY_PRICING_LINE);
    if (!match) return null;
    const total = parseAmount(canonical ? match[1] : match[2]);
    const deposit = parseAmount(canonical ? match[2] : match[1]);
    const balance = parseAmount(match[3]);
    if (![deposit, total, balance].every(Number.isFinite)) return null;
    return { deposit, total, balance, text: match[0], index: match.index };
  }

  function update(note, deposit, total) {
    const currentPricing = parse(note);
    if (!currentPricing) throw new TypeError("Nota rezervării nu conține un Cost valid.");
    const nextDeposit = Number(deposit);
    const savedTotal = Number(total === undefined ? currentPricing.total : total);
    if (!Number.isFinite(nextDeposit) || !Number.isFinite(savedTotal) || nextDeposit < 0 || nextDeposit > savedTotal) {
      throw new TypeError("Avansul trebuie să fie între zero și costul rezervării.");
    }
    const balance = Math.round((savedTotal - nextDeposit) * 100) / 100;
    const line = format({ total: savedTotal, deposit: nextDeposit, balance });
    const current = String(note || "");
    const updatedNote = `${current.slice(0, currentPricing.index)}${line}${current.slice(currentPricing.index + currentPricing.text.length)}`;
    return { note: updatedNote, deposit: nextDeposit, total: savedTotal, balance, line };
  }

  return { LEGACY_PRICING_LINE, PRICING_LINE, format, formatAmount, parse, parseAmount, update };
});
