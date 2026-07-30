import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createClient } from "@libsql/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..", "..");
const dbPath = process.env.DB_PATH || join(projectRoot, "data", "miniflex.sqlite");

let database;
let databaseInit;

export const DEFAULT_ANIMALS = [
  ["001", "Tubarão"],
  ["002", "Hipopótamo"],
  ["003", "Lontra"],
  ["004", "Polvo"],
  ["005", "Raposa"],
  ["006", "Crocodilo"],
  ["007", "Caranguejo"],
  ["008", "Elefante"],
  ["009", "Capivara"],
  ["010", "Tatu"],
];

export async function getDb() {
  if (database) return database;

  if (!databaseInit) {
    databaseInit = initializeDatabase();
  }

  database = await databaseInit;
  return database;
}

export function resetDbForTests() {
  if (database) database.close();
  database = undefined;
  databaseInit = undefined;
}

async function initializeDatabase() {
  ensureProductionDatabaseIsPersistent();
  const db = process.env.TURSO_DATABASE_URL ? createTursoDatabase() : createLocalDatabase();

  await db.exec("PRAGMA foreign_keys = ON");
  await migrate(db);
  await seed(db);

  return db;
}

function ensureProductionDatabaseIsPersistent() {
  const allowLocalProduction = process.env.ALLOW_LOCAL_SQLITE_IN_PRODUCTION === "true";
  if (process.env.NODE_ENV === "production" && !process.env.TURSO_DATABASE_URL && !allowLocalProduction) {
    throw new Error(
      "Em producao, configure TURSO_DATABASE_URL e TURSO_AUTH_TOKEN para evitar perda de dados.",
    );
  }
}

function createLocalDatabase() {
  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new DatabaseSync(dbPath);

  return {
    provider: "sqlite",
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        get: async (...args) => statement.get(...args),
        all: async (...args) => statement.all(...args),
        run: async (...args) => statement.run(...args),
      };
    },
    exec: async (sql) => sqlite.exec(sql),
    close: () => sqlite.close(),
  };
}

function createTursoDatabase() {
  if (!process.env.TURSO_AUTH_TOKEN) {
    throw new Error("Defina TURSO_AUTH_TOKEN para conectar o MiniFlex ao Turso.");
  }

  const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  return {
    provider: "turso",
    prepare(sql) {
      return {
        get: async (...args) => {
          const result = await client.execute({ sql, args });
          return normalizeRow(result.rows[0], result.columns);
        },
        all: async (...args) => {
          const result = await client.execute({ sql, args });
          return result.rows.map((row) => normalizeRow(row, result.columns));
        },
        run: async (...args) => {
          const result = await client.execute({ sql, args });
          return {
            changes: Number(result.rowsAffected || 0),
            lastInsertRowid:
              result.lastInsertRowid === undefined ? undefined : Number(result.lastInsertRowid),
          };
        },
      };
    },
    exec: async (sql) => client.executeMultiple(sql),
    close: () => client.close(),
  };
}

function normalizeRow(row, columns = []) {
  if (!row) return undefined;

  return Object.fromEntries(columns.map((column, index) => [column, normalizeValue(row[column] ?? row[index])]));
}

function normalizeValue(value) {
  return typeof value === "bigint" ? Number(value) : value;
}

async function migrate(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS temporadas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      imagem TEXT,
      ativa INTEGER NOT NULL DEFAULT 0,
      data_criacao TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      codigo_catalogo TEXT NOT NULL UNIQUE,
      senha TEXT NOT NULL,
      data_cadastro TEXT NOT NULL DEFAULT (datetime('now')),
      quantidade_pacotes INTEGER NOT NULL DEFAULT 0,
      colecao_completa INTEGER NOT NULL DEFAULT 0,
      data_completou TEXT,
      temporada_id INTEGER NOT NULL,
      FOREIGN KEY (temporada_id) REFERENCES temporadas(id)
    );

    CREATE TABLE IF NOT EXISTS catalogos (
      codigo TEXT PRIMARY KEY,
      utilizado INTEGER NOT NULL DEFAULT 0,
      usuario_id INTEGER,
      temporada_id INTEGER NOT NULL,
      data_criacao TEXT NOT NULL DEFAULT (datetime('now')),
      data_utilizacao TEXT,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
      FOREIGN KEY (temporada_id) REFERENCES temporadas(id)
    );

    CREATE TABLE IF NOT EXISTS conquistas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      nome_conquista TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT (datetime('now')),
      temporada_id INTEGER NOT NULL,
      UNIQUE (usuario_id, nome_conquista, temporada_id),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
      FOREIGN KEY (temporada_id) REFERENCES temporadas(id)
    );

    CREATE TABLE IF NOT EXISTS animais (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      temporada_id INTEGER NOT NULL,
      numero TEXT NOT NULL,
      nome TEXT NOT NULL,
      UNIQUE (temporada_id, numero),
      FOREIGN KEY (temporada_id) REFERENCES temporadas(id)
    );

    CREATE TABLE IF NOT EXISTS usuario_animais (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      animal_id INTEGER NOT NULL,
      possui INTEGER NOT NULL DEFAULT 0,
      gold INTEGER NOT NULL DEFAULT 0,
      bicolor INTEGER NOT NULL DEFAULT 0,
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (usuario_id, animal_id),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
      FOREIGN KEY (animal_id) REFERENCES animais(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS compras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      quantidade_pacotes INTEGER NOT NULL,
      data TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sessoes (
      token_hash TEXT PRIMARY KEY,
      usuario_id INTEGER,
      admin INTEGER NOT NULL DEFAULT 0,
      expira_em TEXT NOT NULL,
      criada_em TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS eventos_site (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL,
      visitor_id TEXT,
      usuario_id INTEGER,
      rota TEXT,
      detalhes TEXT,
      data TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS visitantes_ignorados (
      visitor_id TEXT PRIMARY KEY,
      usuario_id INTEGER,
      data TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS presentes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      animal TEXT NOT NULL,
      destinatario TEXT NOT NULL,
      turma TEXT NOT NULL,
      mensagem TEXT,
      surpresa INTEGER NOT NULL DEFAULT 0,
      usuario_id INTEGER,
      visitor_id TEXT,
      status TEXT NOT NULL DEFAULT 'solicitado',
      data TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS usuarios_temporada_idx ON usuarios (temporada_id);
    CREATE INDEX IF NOT EXISTS catalogos_temporada_idx ON catalogos (temporada_id);
    CREATE INDEX IF NOT EXISTS conquistas_usuario_idx ON conquistas (usuario_id);
    CREATE INDEX IF NOT EXISTS usuario_animais_usuario_idx ON usuario_animais (usuario_id);
    CREATE INDEX IF NOT EXISTS compras_usuario_idx ON compras (usuario_id);
    CREATE INDEX IF NOT EXISTS eventos_site_data_idx ON eventos_site (data);
    CREATE INDEX IF NOT EXISTS eventos_site_tipo_idx ON eventos_site (tipo);
    CREATE INDEX IF NOT EXISTS eventos_site_visitor_idx ON eventos_site (visitor_id);
    CREATE INDEX IF NOT EXISTS visitantes_ignorados_usuario_idx ON visitantes_ignorados (usuario_id);
    CREATE INDEX IF NOT EXISTS presentes_data_idx ON presentes (data);
    CREATE INDEX IF NOT EXISTS presentes_usuario_idx ON presentes (usuario_id);
  `);

  await addColumnIfMissing(db, "usuarios", "ignorar_fluxo", "ignorar_fluxo INTEGER NOT NULL DEFAULT 0");
}

async function addColumnIfMissing(db, table, column, definition) {
  const columns = await db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

async function seed(db) {
  const hasSeason = await db.prepare("SELECT id FROM temporadas LIMIT 1").get();

  if (!hasSeason) {
    await db.prepare(
      "INSERT INTO temporadas (nome, imagem, ativa) VALUES (?, ?, 1)",
    ).run("Temporada 1 - Animais MiniFlex", "/assets/season-1.svg");
  }

  const activeSeason = await db
    .prepare("SELECT id FROM temporadas WHERE ativa = 1 ORDER BY id LIMIT 1")
    .get();

  for (const [numero, nome] of DEFAULT_ANIMALS) {
    await db.prepare(
      "INSERT OR IGNORE INTO animais (temporada_id, numero, nome) VALUES (?, ?, ?)",
    ).run(activeSeason.id, numero, nome);
  }

  const catalogStats = await db
    .prepare("SELECT COUNT(*) AS total FROM catalogos WHERE temporada_id = ?")
    .get(activeSeason.id);

  if (catalogStats.total === 0) {
    for (let index = 1; index <= 30; index += 1) {
      const code = `CAT-${String(index).padStart(4, "0")}`;
      await db.prepare(
        "INSERT OR IGNORE INTO catalogos (codigo, temporada_id) VALUES (?, ?)",
      ).run(code, activeSeason.id);
    }
  }
}
