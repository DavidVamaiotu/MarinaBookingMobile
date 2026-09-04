"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { customerFromFormData, customerAddressFromFormData } = require("../src/shared/marina-customer");

test("customerFromFormData extracts names, contact, and address fields", () => {
  const formData = {
    firstName: { value: "Ion" },
    lastName: { value: "Popescu" },
    email: { value: "ion@example.com" },
    phone: { value: "0712345678" },
    address_line1: { value: "Str. Florilor nr. 10" },
    address_city: { value: "Huși" },
    address_county: { value: "Vaslui" },
    address_country: { value: "RO" },
    carPlate: { value: "VS 01 ABC" }
  };

  const customer = customerFromFormData(formData);
  assert.equal(customer.first_name, "Ion");
  assert.equal(customer.last_name, "Popescu");
  assert.equal(customer.email, "ion@example.com");
  assert.equal(customer.phone, "0712345678");
  assert.deepEqual(customer.address, {
    line1: "Str. Florilor nr. 10",
    city: "Huși",
    county: "Vaslui",
    country: "RO"
  });
  assert.deepEqual(customer.custom_fields, {
    carPlate: "VS 01 ABC"
  });
});

test("customerAddressFromFormData supports alternative address alias field names", () => {
  const formData = {
    adresa: { value: "Str. Principală nr. 5" },
    oras: { value: "Iași" },
    judet: { value: "Iași" },
    tara: { value: "RO" }
  };

  const address = customerAddressFromFormData(formData);
  assert.deepEqual(address, {
    line1: "Str. Principală nr. 5",
    city: "Iași",
    county: "Iași",
    country: "RO"
  });
});
