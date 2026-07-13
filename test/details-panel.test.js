"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

test("reservation editor groups fields under clear Romanian sections", () => {
  for (const label of ["Rezervare", "Client", "Notă internă", "Plată avans", "Salvare"]) {
    assert.match(indexSource, new RegExp(label));
  }
  for (const technicalLabel of ["Status sincronizare", "ID local", "Istoric sincronizare"]) assert.doesNotMatch(indexSource, new RegExp(technicalLabel));
  assert.match(indexSource, /Nume de familie<input name="secondname"/);
  assert.match(indexSource, /Unitate de cazare<select name="resourceId"/);
  assert.ok(indexSource.indexOf("<h3>Client</h3>") < indexSource.indexOf("<h3>Rezervare</h3>"));
});

test("technical WordPress fields stay hidden while client email remains editable", () => {
  assert.match(appSource, /const formData = \{ \.\.\.booking\.formData \}/);
  assert.match(appSource, /BookingFields\.matchesName\(name, "firstName", "lastName", "email", "phone", "adults", "children"\)/);
  assert.match(indexSource, /Email<input name="email" type="email"/);
  assert.match(appSource, /BookingFields\.assign\(formData, "email"/);
});

test("common WordPress fields receive understandable labels", () => {
  assert.match(appSource, /visitors: "Număr adulți"/);
  assert.match(appSource, /children: "Număr copii"/);
  assert.match(appSource, /details: "Observații client"/);
  assert.match(appSource, /"pat-suplimentar": "Pat suplimentar \(da\/nu\)"/);
});

test("adult and child counts are always editable, including zero children", () => {
  assert.match(indexSource, /Număr adulți<input name="visitors" type="number"/);
  assert.match(indexSource, /Număr copii<input name="children" type="number"/);
  assert.doesNotMatch(indexSource, /id="extraFieldsSection" hidden/);
  assert.match(appSource, /form\.elements\.children\.value = BookingFields\.value\(booking, "children"\) \|\| booking\.formData\?\.children_val\?\.value \|\| "0"/);
  assert.match(appSource, /if \(booking\.formData\?\.children_val\) formData\.children_val = \{ \.\.\.booking\.formData\.children_val, value: children \}/);
});

test("extra bed is edited as a checkbox and serializes to a WordPress boolean value", () => {
  assert.match(appSource, /name === "pat-suplimentar" \|\| isElectricityField\(name\)/);
  assert.match(appSource, /<input type="checkbox" \$\{attributes\}/);
  assert.match(appSource, /input\.type === "checkbox" \? \(input\.checked \? "true" : "no"\)/);
});

test("reservation details expose only requested conditional WordPress fields", () => {
  assert.match(appSource, /BookingFields\.isDetailsField\(name, field\)/);
  assert.match(appSource, /name === "pat-suplimentar"\) return activeWorkspace === "rooms"/);
  assert.match(appSource, /isElectricityField\(name\)\) return activeWorkspace === "camping"/);
  assert.match(appSource, /BookingFields\.matchesName\(name, "car_plates"/);
  assert.match(appSource, /const clientFields = vehicleField \? \[vehicleField\] : \[\]/);
  assert.match(appSource, /\["Energie_electrica", \{ value: "no", type: "checkbox" \}\]/);
  assert.match(indexSource, /Telefon<input name="phone"/);
  assert.match(indexSource, /id="clientExtraFields"/);
  assert.match(indexSource, /id="reservationExtraFields"/);
  assert.match(appSource, /const observation = namedObservation \|\| extraFields\.find/);
  assert.match(indexSource, /Trimite notificări pentru acțiuni/);
  assert.equal((indexSource.match(/name="sendEmail"/g) || []).length, 2);
});

test("rooms hide camping electricity without deleting its stored value", () => {
  assert.match(appSource, /if \(isElectricityField\(name\)\) return activeWorkspace === "camping"/);
  assert.doesNotMatch(appSource, /delete formData\[name\]/);
  assert.match(appSource, /const caravan = camping && isCaravanResource\(form\.elements\.resourceId\.value\)/);
  assert.match(appSource, /form\.elements\.electricity\.disabled = !caravan/);
  assert.match(stylesSource, /\.create-client-fields>label\[hidden\]\{display:none\}/);
});

test("new reservations default to pending with notifications opt-in", () => {
  assert.match(indexSource, /class="check email-option create-email-option"><input name="sendEmail" type="checkbox">/);
  assert.equal((indexSource.match(/name="sendEmail"/g) || []).length, 2);
  assert.match(indexSource, /<input name="approved" type="checkbox" hidden>/);
  assert.doesNotMatch(indexSource, /name="approved"[^>]*checked/);
  assert.match(appSource, /form\.elements\.approved\.checked = false/);
  assert.match(appSource, /form\.elements\.sendEmail\.checked = false/);
  assert.match(appSource, /sendEmail: Boolean\(form\.elements\.sendEmail\.checked\)/);
  assert.match(appSource, /bookingFormType, sendEmail: Boolean\(form\.elements\.sendEmail\.checked\), source/);
  assert.match(appSource, /sendEmail: false, source/);
});

test("booking details expose separate queueable deposit and payment-email actions", () => {
  assert.match(indexSource, /id="paymentDialog"/);
  assert.match(indexSource, /id="paymentForm"/);
  assert.match(indexSource, /id="paymentSection"/);
  assert.match(indexSource, /name="depositAmount"/);
  assert.match(indexSource, /id="saveDeposit"/);
  assert.match(indexSource, /id="sendPaymentRequest"/);
  assert.match(appSource, /window\.marina\.updateDeposit\(booking\.localId/);
  assert.match(appSource, /window\.marina\.requestPayment\(booking\.localId/);
  assert.match(appSource, /window\.marina\.getPayment\(booking\.localId/);
  assert.match(appSource, /snapshot\?\.deposit/);
  assert.match(appSource, /Adaugă emailul în Detalii rezervare/);
  assert.match(appSource, /Email programat; va fi trimis după salvarea avansului/);
});

test("booking popup exposes deposit and payment email through a three-dot menu", () => {
  assert.match(indexSource, /id="bookingPaymentMenuToggle"/);
  assert.match(indexSource, /id="bookingMenuChangeDeposit"/);
  assert.match(indexSource, /id="bookingMenuSendPayment"/);
  assert.match(appSource, /populatePaymentDialog\(booking\);[\s\S]*depositAmount/);
  assert.match(appSource, /bookingMenuSendPayment[\s\S]*queuePaymentEmail\(booking\)/);
});
