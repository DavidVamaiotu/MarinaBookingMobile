(function attachSagaInvoice(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SagaInvoice = api;
})(typeof globalThis === "object" ? globalThis : this, () => {
  "use strict";

  const DEFAULT_VAT_RATE = 11;
  const DEFAULT_SUPPLIER_SETTINGS = Object.freeze({
    name: "Marina Park",
    cif: "",
    regCom: "",
    address: "",
    city: "",
    county: "",
    phone: "",
    email: "",
    iban: "",
    country: "RO",
    vatRate: String(DEFAULT_VAT_RATE)
  });
  const COUNTY_CODES = Object.freeze({
    alba: "AB",
    arad: "AR",
    arges: "AG",
    bacau: "BC",
    bihor: "BH",
    "bistrita-nasaud": "BN",
    botosani: "BT",
    brasov: "BV",
    braila: "BR",
    buzau: "BZ",
    "caras-severin": "CS",
    calarasi: "CL",
    cluj: "CJ",
    constanta: "CT",
    covasna: "CV",
    dambovita: "DB",
    dolj: "DJ",
    galati: "GL",
    giurgiu: "GR",
    gorj: "GJ",
    harghita: "HR",
    hunedoara: "HD",
    ialomita: "IL",
    iasi: "IS",
    ilfov: "IF",
    maramures: "MM",
    mehedinti: "MH",
    mures: "MS",
    neamt: "NT",
    olt: "OT",
    prahova: "PH",
    salaj: "SJ",
    "satu mare": "SM",
    sibiu: "SB",
    suceava: "SV",
    teleorman: "TR",
    timis: "TM",
    tulcea: "TL",
    vaslui: "VS",
    valcea: "VL",
    vrancea: "VN",
    bucuresti: "B",
    "municipiul bucuresti": "B"
  });

  function text(value) {
    return value == null ? "" : String(value).trim();
  }

  function defaultSupplierSettings() {
    return { ...DEFAULT_SUPPLIER_SETTINGS };
  }

  function normalizeSupplierSettings(value = {}) {
    const input = value && typeof value === "object" ? value : {};
    const pick = (...keys) => {
      for (const key of keys) {
        const candidate = text(input[key]);
        if (candidate) return candidate;
      }
      return "";
    };
    return {
      name: pick("name", "supplierName", "companyName"),
      cif: pick("cif", "supplierCif", "companyCif"),
      regCom: pick("regCom", "reg_com", "supplierRegCom"),
      address: pick("address", "adresa", "supplierAddress"),
      city: pick("city", "localitate", "supplierCity"),
      county: pick("county", "judet", "supplierCounty"),
      phone: pick("phone", "telefon", "supplierPhone"),
      email: pick("email", "mail", "supplierEmail"),
      iban: pick("iban", "supplierIban"),
      country: pick("country", "tara") || "RO",
      vatRate: pick("vatRate", "vat_rate") || String(DEFAULT_VAT_RATE)
    };
  }

  function normalizeRomanian(value) {
    return text(value)
      .toLocaleLowerCase("ro-RO")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[șş]/g, "s")
      .replace(/[țţ]/g, "t");
  }

  function normalizeKey(value) {
    return normalizeRomanian(value).replace(/[^a-z0-9]/g, "");
  }

  function unwrap(value) {
    return value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "value")
      ? value.value
      : value;
  }

  function parseAmount(value) {
    const candidate = text(unwrap(value));
    if (!candidate) return null;
    const normalized = candidate
      .replace(/\s/g, "")
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".");
    const amount = Number(normalized);
    return Number.isFinite(amount) ? amount : null;
  }

  function amountFromSources(sources) {
    const minorKeys = ["total_minor", "totalMinor", "amount_minor", "amountMinor", "gross_total_minor", "grossTotalMinor"];
    const majorKeys = ["total", "total_amount", "totalAmount", "gross_total", "grossTotal", "grand_total", "grandTotal", "amount"];
    for (const source of sources.filter((item) => item && typeof item === "object")) {
      for (const key of minorKeys) {
        if (source[key] != null) {
          const amount = parseAmount(source[key]);
          if (amount !== null) return amount / 100;
        }
      }
      for (const key of majorKeys) {
        if (source[key] != null) {
          const amount = parseAmount(source[key]);
          if (amount !== null) return amount;
        }
      }
    }
    return null;
  }

  function paymentTotal(payment, booking) {
    const price = booking?.price || booking?.pricing || {};
    return amountFromSources([
      payment,
      payment?.price,
      payment?.pricing,
      booking?.price,
      booking?.pricing,
      price
    ]);
  }

  function formDataValue(booking, names) {
    const formData = booking?.formData || booking?.form_data || {};
    const entries = Object.entries(formData);
    for (const name of names) {
      const expected = normalizeKey(name);
      const entry = entries.find(([key]) => normalizeKey(key) === expected);
      if (entry && text(unwrap(entry[1]))) return text(unwrap(entry[1]));
    }
    return "";
  }

  function customerValue(booking, names, fallback) {
    const value = formDataValue(booking, names);
    if (value) return value;
    return text(fallback);
  }

  function customerFromBooking(booking = {}) {
    const customer = booking.customer || booking.guest || {};
    const address = customer.address || customer.adresa || {};
    return {
      firstName: customerValue(booking, ["firstName", "first_name", "name", "prenume"], customer.first_name || customer.firstName || customer.prenume),
      lastName: customerValue(booking, ["lastName", "last_name", "secondname", "nume"], customer.last_name || customer.lastName || customer.secondname || customer.nume),
      email: customerValue(booking, ["email", "mail"], customer.email || customer.mail),
      phone: customerValue(booking, ["phone", "telefon"], customer.phone || customer.telefon),
      cif: customerValue(booking, ["cif", "cui", "cod_fiscal", "fiscal_code", "company_cif"], customer.cif || customer.cui),
      regCom: customerValue(booking, ["regCom", "reg_com", "nr_reg_com", "registration_number"], customer.reg_com || customer.regCom),
      country: customerValue(booking, ["address_country", "country", "tara"], address.country || address.tara || "RO"),
      county: customerValue(booking, ["address_county", "county", "judet"], address.county || address.judet),
      city: customerValue(booking, ["address_city", "city", "oras", "localitate"], address.city || address.oras || address.localitate),
      address: customerValue(booking, ["address_line1", "address", "line1", "adresa"], address.line1 || address.address || address.adresa)
    };
  }

  function countyCode(value) {
    const raw = text(value);
    if (!raw) return "";
    const compact = raw.toUpperCase().replace(/[^A-Z]/g, "");
    if (compact.length === 1 || compact.length === 2) {
      const knownCode = Object.values(COUNTY_CODES).includes(compact);
      if (knownCode) return compact;
    }
    return COUNTY_CODES[normalizeRomanian(raw)] || raw;
  }

  function roundMoney(value) {
    const rounded = Math.round((Number(value) + Number.EPSILON) * 100) / 100;
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  function money(value) {
    return roundMoney(value).toFixed(2);
  }

  function percentage(value) {
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error("Cota TVA trebuie să fie între 0 și 100%.");
    return rate.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  }

  function normalizeIsoDate(value) {
    const candidate = text(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
      const date = new Date(`${candidate}T00:00:00Z`);
      if (date.toISOString().slice(0, 10) === candidate) return candidate;
    }
    const date = new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) throw new Error("Data facturii nu este validă.");
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function addDays(value, count) {
    const date = new Date(`${normalizeIsoDate(value)}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + count);
    return date.toISOString().slice(0, 10);
  }

  function daysBetween(start, end) {
    return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
  }

  function sagaDate(value) {
    const [year, month, day] = normalizeIsoDate(value).split("-");
    return `${day}.${month}.${year}`;
  }

  function compactDate(value) {
    return normalizeIsoDate(value).replace(/-/g, "");
  }

  function safeFilePart(value, fallback) {
    const part = text(value).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+|\.+$/g, "");
    return part || fallback;
  }

  function escapeXml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function xmlTag(name, value) {
    return `<${name}>${escapeXml(value)}</${name}>`;
  }

  function bookingPeriod(booking = {}) {
    const dates = Array.isArray(booking.dates) ? booking.dates.map((value) => {
      try { return normalizeIsoDate(value); } catch { return ""; }
    }).filter(Boolean) : [];
    const start = dates[0] || booking.startDate || booking.start_date;
    const end = dates[dates.length - 1] || booking.endDate || booking.end_date;
    if (!start || !end) throw new Error("Factura SAGA: rezervarea nu are o perioadă validă.");
    const normalizedStart = normalizeIsoDate(start);
    const normalizedEnd = normalizeIsoDate(end);
    const nights = daysBetween(normalizedStart, normalizedEnd);
    if (nights < 1) throw new Error("Factura SAGA: perioada rezervării trebuie să conțină cel puțin o noapte.");
    return { start: normalizedStart, end: normalizedEnd, nights };
  }

  function buildSagaInvoice({
    booking = {},
    payment = null,
    resource = null,
    supplier = {},
    invoiceNumber = "",
    issueDate = "",
    dueDate = "",
    vatRate = DEFAULT_VAT_RATE
  } = {}) {
    const supplierName = text(supplier.name || supplier.companyName);
    const supplierCif = text(supplier.cif || supplier.companyCif);
    if (!supplierName) throw new Error("Factura SAGA: completează denumirea furnizorului.");
    if (!supplierCif) throw new Error("Factura SAGA: completează codul fiscal al furnizorului.");

    const client = customerFromBooking(booking);
    const clientName = [client.firstName, client.lastName].filter(Boolean).join(" ").trim();
    if (!clientName) throw new Error("Factura SAGA: rezervarea nu are numele clientului.");
    if (!client.address || !client.city || !client.county) {
      throw new Error("Factura SAGA: clientul nu are adresa completă (adresă, oraș și județ).");
    }

    const period = bookingPeriod(booking);
    const totalGross = paymentTotal(payment, booking);
    if (totalGross === null || totalGross < 0) throw new Error("Factura SAGA: costul total al rezervării nu a putut fi verificat.");

    const normalizedVatRate = Number(vatRate);
    const vat = normalizedVatRate === 0 ? 0 : roundMoney(totalGross - totalGross / (1 + normalizedVatRate / 100));
    const totalNet = roundMoney(totalGross - vat);
    const issue = normalizeIsoDate(issueDate || new Date());
    const due = normalizeIsoDate(dueDate || issue);
    const bookingId = text(booking.providerId || booking.serverId || booking.localId || "local");
    const number = text(invoiceNumber) || `MARINA-${bookingId}`;
    const resourceName = text(resource?.title || resource?.name || booking.resourceTitle || "Spațiu de cazare");
    const info = `Rezervare Marina ${bookingId}; perioada ${sagaDate(period.start)} - ${sagaDate(period.end)}; ${period.nights} ${period.nights === 1 ? "noapte" : "nopți"}.`;
    const description = `Cazare - ${resourceName} - ${sagaDate(period.start)} - ${sagaDate(period.end)} (${period.nights} ${period.nights === 1 ? "noapte" : "nopți"})`;
    const clientCounty = countyCode(client.county);
    const line = [
      xmlTag("LinieNrCrt", "1"),
      xmlTag("Descriere", description),
      xmlTag("UM", "SERV"),
      xmlTag("Cantitate", "1"),
      xmlTag("Pret", money(totalNet)),
      xmlTag("Valoare", money(totalNet)),
      xmlTag("ProcTVA", percentage(normalizedVatRate)),
      xmlTag("TVA", money(vat))
    ].join("\n");

    const header = [
      xmlTag("FurnizorNume", supplierName),
      xmlTag("FurnizorCIF", supplierCif),
      xmlTag("FurnizorNrRegCom", supplier.regCom || supplier.reg_com),
      xmlTag("FurnizorCapital", supplier.capital),
      xmlTag("FurnizorTara", supplier.country || "RO"),
      xmlTag("FurnizorLocalitate", supplier.city || supplier.localitate),
      xmlTag("FurnizorJudet", countyCode(supplier.county || supplier.judet)),
      xmlTag("FurnizorAdresa", supplier.address || supplier.adresa),
      xmlTag("FurnizorTelefon", supplier.phone || supplier.telefon),
      xmlTag("FurnizorMail", supplier.email || supplier.mail),
      xmlTag("FurnizorBanca", supplier.bank || supplier.banca),
      xmlTag("FurnizorIBAN", supplier.iban),
      xmlTag("FurnizorInformatiiSuplimentare", supplier.additionalInfo),
      xmlTag("ClientNume", clientName),
      xmlTag("ClientInformatiiSuplimentare", `Rezervare Marina ${bookingId}`),
      xmlTag("ClientCIF", client.cif),
      xmlTag("ClientNrRegCom", client.regCom),
      xmlTag("ClientJudet", clientCounty),
      xmlTag("ClientTara", client.country || "RO"),
      xmlTag("ClientLocalitate", client.city),
      xmlTag("ClientAdresa", client.address),
      xmlTag("ClientBanca", ""),
      xmlTag("ClientIBAN", ""),
      xmlTag("ClientTelefon", client.phone),
      xmlTag("ClientMail", client.email),
      xmlTag("FacturaNumar", number),
      xmlTag("FacturaData", sagaDate(issue)),
      xmlTag("FacturaScadenta", sagaDate(due)),
      xmlTag("FacturaTaxareInversa", supplier.reverseCharge === true ? "Da" : "Nu"),
      xmlTag("FacturaTVAIncasare", supplier.vatOnCollection === true ? "Da" : "Nu"),
      xmlTag("FacturaTip", " "),
      xmlTag("FacturaInformatiiSuplimentare", info),
      xmlTag("FacturaMoneda", "RON")
    ].join("\n");
    const facturaId = `MARINA-BOOKING-${safeFilePart(bookingId, "local")}`;
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<Facturi>",
      "<Factura>",
      "<Antet>",
      header,
      "</Antet>",
      "<Detalii>",
      "<Continut>",
      "<Linie>",
      line,
      "</Linie>",
      "</Continut>",
      "</Detalii>",
      "<Sumar>",
      xmlTag("TotalValoare", money(totalNet)),
      xmlTag("TotalTVA", money(vat)),
      xmlTag("Total", money(totalGross)),
      "</Sumar>",
      "<Observatii>",
      xmlTag("txtObservatii", info),
      xmlTag("SoldClient", money(totalGross)),
      "</Observatii>",
      xmlTag("FacturaID", facturaId),
      "</Factura>",
      "</Facturi>"
    ].join("\n");
    const filename = `F_${safeFilePart(supplierCif, "CIF")}_${safeFilePart(number, "factura")}_${compactDate(issue)}.xml`;
    return {
      xml,
      filename,
      invoiceNumber: number,
      issueDate: issue,
      dueDate: due,
      totalGross: roundMoney(totalGross),
      totalNet,
      totalVat: vat,
      vatRate: normalizedVatRate,
      nights: period.nights,
      client: { ...client, name: clientName, countyCode: clientCounty },
      period
    };
  }

  return {
    DEFAULT_VAT_RATE,
    buildSagaInvoice,
    countyCode,
    customerFromBooking,
    defaultSupplierSettings,
    normalizeSupplierSettings,
    paymentTotal,
    sagaDate
  };
});
