"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const BookingFields = require("../src/shared/booking-fields");

test("WordPress client fields are read through aliases and resource suffixes", () => {
  const booking = { formData: {
    prenume2: { value: "Ana", type: "text" },
    lastname_2: { value: "Popescu", type: "text" },
    email2: { value: "ana@example.com", type: "email" },
    telefon_2: { value: "+40 712 345 678", type: "text" },
    adults2: { value: "2", type: "selectbox-one" },
    kids2: { value: "1", type: "selectbox-one" }
  } };
  assert.equal(BookingFields.value(booking, "firstName"), "Ana");
  assert.equal(BookingFields.value(booking, "lastName"), "Popescu");
  assert.equal(BookingFields.value(booking, "email"), "ana@example.com");
  assert.equal(BookingFields.value(booking, "phone"), "+40 712 345 678");
  assert.equal(BookingFields.value(booking, "adults"), "2");
  assert.equal(BookingFields.value(booking, "children"), "1");
});

test("editing client fields updates original WordPress keys instead of losing them", () => {
  const formData = { phone4: { value: "old", type: "text" }, telefon_4: { value: "old", type: "text" } };
  BookingFields.assign(formData, "phone", ["phone"], "+40 700 000 000", "text");
  assert.equal(formData.phone4.value, "+40 700 000 000");
  assert.equal(formData.telefon_4.value, "+40 700 000 000");
  assert.equal("phone" in formData, false);
});

test("unrelated extra fields are not mistaken for client fields", () => {
  assert.equal(BookingFields.matchesName("smartphone_model", "phone"), false);
  assert.equal(BookingFields.matchesName("telephone12", "phone"), true);
});

test("popup details support translated names and custom textarea fields", () => {
  assert.equal(BookingFields.detailsValue({ formData: { observatii4: { value: "Sosire târzie", type: "text" } } }), "Sosire târzie");
  assert.equal(BookingFields.detailsValue({ formData: { cerere_client4: { value: "Pătuț", type: "textarea" } } }), "Pătuț");
  assert.equal(BookingFields.detailsValue({ formData: { internal_code: { value: "ABC", type: "text" } } }), "");
});
