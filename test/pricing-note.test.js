"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const PricingNote = require("../src/shared/pricing-note");

test("pricing note parses Romanian amounts and preserves unrelated text", () => {
  const note = "Sosire târzie\nAvans: 1.234,5, Cost: 2.000, Rest: 765,5\nParcare inclusă";
  assert.deepEqual(PricingNote.parse(note), { deposit: 1234.5, total: 2000, balance: 765.5, text: "Avans: 1.234,5, Cost: 2.000, Rest: 765,5", index: 14 });
  const updated = PricingNote.update(note, 1500);
  assert.equal(updated.note, "Sosire târzie\nAvans: 1.500, Cost: 2.000, Rest: 500\nParcare inclusă");
  const inline = "Observație | Avans: 30, Cost: 100, Rest: 70 | parcare inclusă";
  assert.deepEqual(PricingNote.parse(inline), { deposit: 30, total: 100, balance: 70, text: "Avans: 30, Cost: 100, Rest: 70", index: 13 });
  assert.equal(PricingNote.update(inline, 40).note, "Observație | Avans: 40, Cost: 100, Rest: 60 | parcare inclusă");
});

test("pricing note rejects missing cost and deposits above the saved total", () => {
  assert.throws(() => PricingNote.update("Notă simplă", 10), /Cost valid/);
  assert.throws(() => PricingNote.update("Avans: 30, Cost: 100, Rest: 70", 101), /cel mult egal/);
});
