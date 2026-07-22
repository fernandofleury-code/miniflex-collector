import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

test("database starts with active season, animals and catalog codes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "miniflex-"));
  process.env.DB_PATH = join(dir, "test.sqlite");
  const dbModule = await import(`../src/db/database.js?test=${Date.now()}`);
  const db = await dbModule.getDb();

  const season = await db.prepare("SELECT * FROM temporadas WHERE ativa = 1").get();
  const animals = await db.prepare("SELECT COUNT(*) AS total FROM animais").get();
  const catalogs = await db.prepare("SELECT COUNT(*) AS total FROM catalogos").get();

  assert.equal(season.nome, "Temporada 1 - Animais MiniFlex");
  assert.equal(animals.total, 10);
  assert.equal(catalogs.total, 30);

  db.close();
  rmSync(dir, { recursive: true, force: true });
});
