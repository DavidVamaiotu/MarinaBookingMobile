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

test("pricing note update removes stale canonical and legacy duplicates", () => {
  const duplicated = [
    "Sosire târzie",
    "",
    "Cost total: 400 RON, Depozit: 180 RON, Rest: 220 RON",
    "",
    "Cost total: 400 RON, Depozit: 120 RON, Rest: 280 RON",
    "",
    "Avans: 90, Cost: 400, Rest: 310",
    "",
    "Parcare inclusă"
  ].join("\n");
  assert.equal(
    PricingNote.update(duplicated, 180, 400).note,
    "Sosire târzie\n\nCost total: 400 RON, Depozit: 180 RON, Rest: 220 RON\n\nParcare inclusă"
  );
});

test("pricing note normalize collapses duplicate pricing lines without changing amounts", () => {
  const duplicated = [
    "Sosire târzie",
    "Cost total: 400 RON, Depozit: 180 RON, Rest: 220 RON",
    "Cost total: 400 RON, Depozit: 120 RON, Rest: 280 RON",
    "Avans: 90, Cost: 400, Rest: 310",
    "Parcare inclusă"
  ].join("\n\n");
  assert.equal(
    PricingNote.normalize(duplicated),
    "Sosire târzie\n\nCost total: 400 RON, Depozit: 180 RON, Rest: 220 RON\n\nParcare inclusă"
  );
  assert.equal(PricingNote.normalize("Notă simplă"), "Notă simplă");
  assert.equal(PricingNote.normalize(""), "");
  assert.equal(PricingNote.normalize(undefined), "");
  assert.equal(PricingNote.normalize("Cost total: 100 RON, Depozit: 30 RON, Rest: 70 RON"), "Cost total: 100 RON, Depozit: 30 RON, Rest: 70 RON");
});

test("pricing note update appends pricing line when note has no pre-existing pricing line but total is provided", () => {
  const result = PricingNote.update("Clientul dorește pat pliant", 50, 200);
  assert.equal(result.note, "Clientul dorește pat pliant\n\nCost total: 200 RON, Depozit: 50 RON, Rest: 150 RON");
  assert.equal(result.deposit, 50);
  assert.equal(result.total, 200);
  assert.equal(result.balance, 150);

  const emptyResult = PricingNote.update("", 50, 200);
  assert.equal(emptyResult.note, "Cost total: 200 RON, Depozit: 50 RON, Rest: 150 RON");
});
