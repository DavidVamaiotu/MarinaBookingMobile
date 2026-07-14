"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const PricingNote = require("../src/shared/pricing-note");

test("pricing note parses Romanian amounts and preserves unrelated text", () => {
  const note = "Sosire târzie\nAvans: 1.234,5, Cost: 2.000, Rest: 765,5\nParcare inclusă";
  assert.deepEqual(PricingNote.parse(note), { deposit: 1234.5, total: 2000, balance: 765.5, text: "Avans: 1.234,5, Cost: 2.000, Rest: 765,5", index: 14 });
  const updated = PricingNote.update(note, 1500);
  assert.equal(updated.note, "Sosire târzie\nCost total: 2.000 RON, Depozit: 1.500 RON, Rest: 500 RON\nParcare inclusă");
  const inline = "Observație | Avans: 30, Cost: 100, Rest: 70 | parcare inclusă";
  assert.deepEqual(PricingNote.parse(inline), { deposit: 30, total: 100, balance: 70, text: "Avans: 30, Cost: 100, Rest: 70", index: 13 });
  assert.equal(PricingNote.update(inline, 40).note, "Observație | Cost total: 100 RON, Depozit: 40 RON, Rest: 60 RON | parcare inclusă");
  const canonical = "Cost total: 2.000 RON, Depozit: 1.500 RON, Rest: 500 RON";
  assert.deepEqual(PricingNote.parse(canonical), { deposit: 1500, total: 2000, balance: 500, text: canonical, index: 0 });
  assert.equal(PricingNote.update(canonical, 1600).note, "Cost total: 2.000 RON, Depozit: 1.600 RON, Rest: 400 RON");
  assert.equal(PricingNote.update(canonical, 0).note, "Cost total: 2.000 RON, Depozit: 0 RON, Rest: 2.000 RON");
});

test("pricing note rejects missing cost and deposits above the saved total", () => {
  assert.throws(() => PricingNote.update("Notă simplă", 10), /Cost valid/);
  assert.throws(() => PricingNote.update("Avans: 30, Cost: 100, Rest: 70", 101), /între zero/);
  assert.throws(() => PricingNote.update("Avans: 30, Cost: 100, Rest: 70", -1), /între zero/);
});
