"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const SagaInvoice = require("../src/shared/saga-invoice");
const validate = require("../src/main/validation");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const electronSource = fs.readFileSync(path.join(__dirname, "..", "electron-main.js"), "utf8");
const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const mobileBuildSource = fs.readFileSync(path.join(__dirname, "..", "scripts", "build-mobile-web.js"), "utf8");
const preloadSource = fs.readFileSync(path.join(__dirname, "..", "preload.js"), "utf8");
const mobileBridgeSource = fs.readFileSync(path.join(__dirname, "..", "mobile", "mobile-bridge.js"), "utf8");

function bookingFixture(overrides = {}) {
  return {
    localId: "local-42",
    serverId: 42,
    providerId: 42,
    resourceId: 7,
    dates: ["2026-09-10", "2026-09-12"],
    formData: {
      name: { value: "Ana" },
      secondname: { value: "Popescu" },
      email: { value: "ana@example.com" },
      phone: { value: "+40 700 000 000" },
      address_line1: { value: "Strada <Exemplu> & nr. 10" },
      address_city: { value: "Huși" },
      address_county: { value: "Vaslui" }
    },
    ...overrides
  };
}

test("SAGA export uses the Marina booking address and documented invoice fields", () => {
  const invoice = SagaInvoice.buildSagaInvoice({
    booking: bookingFixture(),
    payment: { total: 111 },
    resource: { title: "Camera 7" },
    supplier: { name: "Marina Park", cif: "RO123456" },
    invoiceNumber: "MARINA-42",
    issueDate: "2026-08-31"
  });

  assert.equal(invoice.filename, "F_RO123456_MARINA-42_20260831.xml");
  assert.equal(invoice.totalNet, 100);
  assert.equal(invoice.totalVat, 11);
  assert.equal(invoice.client.countyCode, "VS");
  assert.match(invoice.xml, /<ClientNume>Ana Popescu<\/ClientNume>/);
  assert.match(invoice.xml, /<ClientJudet>VS<\/ClientJudet>/);
  assert.match(invoice.xml, /<ClientLocalitate>Huși<\/ClientLocalitate>/);
  assert.match(invoice.xml, /<ClientAdresa>Strada &lt;Exemplu&gt; &amp; nr\. 10<\/ClientAdresa>/);
  assert.match(invoice.xml, /<FacturaData>31\.08\.2026<\/FacturaData>/);
  assert.match(invoice.xml, /<FacturaScadenta>31\.08\.2026<\/FacturaScadenta>/);
  assert.match(invoice.xml, /<TotalValoare>100\.00<\/TotalValoare>/);
  assert.match(invoice.xml, /<TotalTVA>11\.00<\/TotalTVA>/);
  assert.match(invoice.xml, /<Total>111\.00<\/Total>/);
  assert.match(invoice.xml, /<ProcTVA>11<\/ProcTVA>/);
});

test("SAGA export accepts the API's nested customer address and minor-unit total", () => {
  const invoice = SagaInvoice.buildSagaInvoice({
    booking: bookingFixture({
      formData: undefined,
      customer: {
        first_name: "Mihai",
        last_name: "Ionescu",
        address: { line1: "Str. Nouă 4", city: "Iași", county: "IS" }
      }
    }),
    payment: { total_minor: 12100 },
    supplier: { name: "Marina Park", cif: "CUI42" },
    vatRate: 21
  });

  assert.equal(invoice.totalGross, 121);
  assert.equal(invoice.client.countyCode, "IS");
  assert.match(invoice.xml, /<ClientNume>Mihai Ionescu<\/ClientNume>/);
  assert.match(invoice.xml, /<ClientAdresa>Str\. Nouă 4<\/ClientAdresa>/);
});

test("SAGA export fails closed when a required supplier or customer address value is missing", () => {
  assert.throws(
    () => SagaInvoice.buildSagaInvoice({ booking: bookingFixture(), payment: { total: 111 }, supplier: { name: "Marina Park" } }),
    /completează codul fiscal al furnizorului/
  );
  assert.throws(
    () => SagaInvoice.buildSagaInvoice({
      booking: bookingFixture({ formData: { name: { value: "Ana" }, secondname: { value: "Popescu" } } }),
      payment: { total: 111 },
      supplier: { name: "Marina Park", cif: "CUI42" }
    }),
    /adresa completă/
  );
});

test("invoice generation is wired into the payment dropdown and mobile bundle", () => {
  assert.match(indexSource, /id="bookingMenuGenerateInvoice"[^>]*>Generează factura/);
  const dropdownStart = indexSource.indexOf('id="bookingPaymentMenu"');
  const dropdownEnd = indexSource.indexOf("</div>", dropdownStart);
  const dropdown = indexSource.slice(dropdownStart, dropdownEnd);
  assert.ok(dropdown.indexOf("bookingMenuSendPayment") < dropdown.indexOf("bookingMenuGenerateInvoice"));
  assert.match(indexSource, /id="sagaInvoiceDialog"/);
  assert.match(indexSource, /src="src\/shared\/saga-invoice\.js"/);
  assert.match(appSource, /runExclusive\(`saga-invoice:\$\{activeWorkspace\}:\$\{booking\.localId\}`/);
  assert.match(appSource, /window\.SagaInvoice\.buildSagaInvoice/);
  assert.match(appSource, /window\.marina\.importSagaInvoice/);
  assert.match(appSource, /window\.marina\.getBooking\(bookingKey\)/);
  assert.match(appSource, /window\.marina\.getPayment\(bookingKey, \{ source \}\)/);
  assert.match(mobileBuildSource, /"saga-invoice\.js"/);
});

test("SAGA supplier settings are part of the existing Settings flow", () => {
  const settingsSagaSection = indexSource.match(/<section class="saga-invoice-fields" aria-labelledby="settingsSagaTitle">([\s\S]*?)<\/section>/)?.[1] || "";
  const settings = validate.sagaInvoiceSettings({ name: "Marina Park", cif: "RO123", vatRate: "11" });
  assert.equal(settings.name, "Marina Park");
  assert.equal(settings.cif, "RO123");
  assert.equal(settings.country, "RO");
  assert.equal(settings.vatRate, "11");
  assert.equal(settings.iban, "");
  assert.throws(() => validate.sagaInvoiceSettings({ vatRate: "101" }), /Cota TVA/);
  assert.match(indexSource, /id="settingsDialog"/);
  assert.match(indexSource, /id="settingsForm"/);
  assert.match(appSource, /openSettingsDialog/);
  assert.match(appSource, /saveSagaInvoiceSettings/);
  assert.match(preloadSource, /getSagaInvoiceSettings/);
  assert.match(preloadSource, /saveSagaInvoiceSettings/);
  assert.match(preloadSource, /importSagaInvoice/);
  assert.match(electronSource, /saga-invoice-settings:get/);
  assert.match(electronSource, /saga-invoice-settings:save/);
  assert.match(electronSource, /saga-invoice:import/);
  assert.match(indexSource, /name="sagaWebApiToken"[^>]*type="password"/);
  assert.match(settingsSagaSection, /name="supplierName"/);
  assert.match(settingsSagaSection, /name="supplierCif"/);
  assert.match(settingsSagaSection, /name="vatRate"/);
  assert.doesNotMatch(settingsSagaSection, /name="supplier(?:RegCom|Address|City|County|Phone|Email|Iban)"/);
  assert.match(indexSource, /id="sagaInvoiceSubmit"[^>]*>Creează și importă/);
  assert.match(mobileBridgeSource, /SAGA_WEB_TOKEN_KEY/);
  assert.match(mobileBridgeSource, /async importSagaInvoice\(input\)/);
});
