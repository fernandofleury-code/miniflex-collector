import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, rowsToObjects, stringifyCsv } from "../src/utils/csv.js";

test("parseCsv handles headers, commas and quotes", () => {
  const rows = parseCsv('nome,codigo\n"Ana, Bia",CAT-0001\n"Joao ""J""",CAT-0002\n');
  assert.deepEqual(rowsToObjects(rows), [
    { nome: "Ana, Bia", codigo: "CAT-0001" },
    { nome: 'Joao "J"', codigo: "CAT-0002" },
  ]);
});

test("stringifyCsv creates restorable csv", () => {
  const csv = stringifyCsv([{ nome: "Ana, Bia", codigo: "CAT-0001" }]);
  assert.equal(csv, 'nome,codigo\n"Ana, Bia",CAT-0001\n');
});
