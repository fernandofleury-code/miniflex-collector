import { Router } from "express";
import { getDb } from "../db/database.js";
import { createSession, requireAdmin } from "../middleware/auth.js";
import {
  activateSeason,
  addAchievement,
  createSeason,
  getActiveSeason,
  normalizeCode,
  refreshUserProgress,
  getUserCollection,
  userPublicFields,
} from "../services/collectionService.js";
import { getTrafficData, trackEvent } from "../services/analyticsService.js";
import { hashPassword } from "../utils/security.js";
import { parseCsv, rowsToObjects, stringifyCsv } from "../utils/csv.js";

export const adminRoutes = Router();

adminRoutes.post("/login", async (req, res) => {
  const configuredPassword = process.env.ADMIN_PASSWORD || "miniflex-admin";
  if (String(req.body.senha || "") !== configuredPassword) {
    res.status(401).json({ error: "Senha administrativa invalida." });
    return;
  }

  await createSession(res, { admin: true });
  res.json({ ok: true });
});

adminRoutes.use(requireAdmin);

adminRoutes.get("/overview", async (req, res) => {
  const db = await getDb();
  const activeSeason = await getActiveSeason(db);
  const seasonId = Number(req.query.season_id) || activeSeason.id;

  const seasons = await db.prepare("SELECT * FROM temporadas ORDER BY id DESC").all();
  const animals = await db
    .prepare("SELECT * FROM animais WHERE temporada_id = ? ORDER BY numero")
    .all(seasonId);
  const users = (await db
    .prepare(
      `
      SELECT
        u.*,
        COALESCE(SUM(ua.gold), 0) AS gold,
        COALESCE(SUM(ua.bicolor), 0) AS bicolor,
        COALESCE(SUM(ua.possui), 0) AS animais_possuidos
      FROM usuarios u
      LEFT JOIN usuario_animais ua ON ua.usuario_id = u.id
      WHERE u.temporada_id = ?
      GROUP BY u.id
      ORDER BY u.nome
      `,
    )
    .all(seasonId))
    .map((user) => ({
      ...userPublicFields(user),
      gold: user.gold,
      bicolor: user.bicolor,
      animais_possuidos: user.animais_possuidos,
    }));

  const catalogs = (await db
    .prepare(
      "SELECT codigo, utilizado, usuario_id, temporada_id, data_criacao, data_utilizacao FROM catalogos WHERE temporada_id = ? ORDER BY codigo",
    )
    .all(seasonId))
    .map((catalog) => ({ ...catalog, utilizado: Boolean(catalog.utilizado) }));

  const peopleTotals = await db
    .prepare(
      `
      SELECT
        COUNT(*) AS colecionadores,
        COALESCE(SUM(quantidade_pacotes), 0) AS pacotes_vendidos
      FROM usuarios
      WHERE temporada_id = ?
      `,
    )
    .get(seasonId);
  const rarityTotals = await db
    .prepare(
      `
      SELECT
        COALESCE(SUM(ua.gold), 0) AS gold,
        COALESCE(SUM(ua.bicolor), 0) AS bicolor
      FROM usuario_animais ua
      JOIN usuarios u ON u.id = ua.usuario_id
      WHERE u.temporada_id = ?
      `,
    )
    .get(seasonId);
  const totals = { ...peopleTotals, ...rarityTotals };

  res.json({
    activeSeason,
    selectedSeasonId: seasonId,
    seasons,
    animals,
    users,
    catalogs,
    totals,
    charts: await getChartData(db, seasonId),
    traffic: await getTrafficData(db, seasonId, {
      range: String(req.query.traffic_range || "today"),
      date: String(req.query.traffic_date || ""),
    }),
  });
});

adminRoutes.post("/catalogs", async (req, res) => {
  const db = await getDb();
  const activeSeason = await getActiveSeason(db);
  const seasonId = Number(req.body.temporada_id) || activeSeason.id;
  const codes = normalizeCodes(req.body.codes || req.body.codigos || "");
  let created = 0;

  for (const code of codes) {
    const result = await db
      .prepare("INSERT OR IGNORE INTO catalogos (codigo, temporada_id) VALUES (?, ?)")
      .run(code, seasonId);
    created += result.changes;
  }

  res.status(201).json({ created });
});

adminRoutes.post("/users", async (req, res) => {
  const db = await getDb();
  const nome = String(req.body.nome || "").trim();
  const senha = String(req.body.senha || "miniflex123");
  const pacotes = Math.max(0, Number(req.body.quantidade_pacotes) || 0);
  const activeSeason = await getActiveSeason(db);
  const seasonId = Number(req.body.temporada_id) || activeSeason.id;
  const codigo = normalizeCode(req.body.codigo_catalogo || `MAN-${Date.now()}`);

  if (!nome) {
    res.status(400).json({ error: "Informe o nome do colecionador." });
    return;
  }

  let catalog = await db.prepare("SELECT * FROM catalogos WHERE codigo = ?").get(codigo);
  if (!catalog) {
    await db.prepare("INSERT INTO catalogos (codigo, temporada_id) VALUES (?, ?)").run(codigo, seasonId);
    catalog = await db.prepare("SELECT * FROM catalogos WHERE codigo = ?").get(codigo);
  }

  if (catalog.utilizado) {
    res.status(409).json({ error: "Este codigo ja esta vinculado a outro usuario." });
    return;
  }

  const result = await db
    .prepare(
      `
      INSERT INTO usuarios
        (nome, codigo_catalogo, senha, quantidade_pacotes, temporada_id)
      VALUES (?, ?, ?, ?, ?)
      `,
    )
    .run(nome, codigo, hashPassword(senha), pacotes, catalog.temporada_id);
  const userId = Number(result.lastInsertRowid);

  await db.prepare(
    "UPDATE catalogos SET utilizado = 1, usuario_id = ?, data_utilizacao = datetime('now') WHERE codigo = ?",
  ).run(userId, codigo);

  if (pacotes > 0) {
    await addPurchase(db, userId, pacotes);
  }

  const user = await db.prepare("SELECT * FROM usuarios WHERE id = ?").get(userId);
  res.status(201).json({ user: userPublicFields(user) });
});

adminRoutes.patch("/users/:id", async (req, res) => {
  const db = await getDb();
  const userId = Number(req.params.id);
  const user = await db.prepare("SELECT * FROM usuarios WHERE id = ?").get(userId);
  if (!user) {
    res.status(404).json({ error: "Usuario nao encontrado." });
    return;
  }

  const nome = String(req.body.nome || user.nome).trim();
  const pacotes = Math.max(0, Number(req.body.quantidade_pacotes ?? user.quantidade_pacotes));

  if (req.body.senha) {
    await db.prepare("UPDATE usuarios SET nome = ?, quantidade_pacotes = ?, senha = ? WHERE id = ?").run(
      nome,
      pacotes,
      hashPassword(String(req.body.senha)),
      userId,
    );
  } else {
    await db.prepare("UPDATE usuarios SET nome = ?, quantidade_pacotes = ? WHERE id = ?").run(
      nome,
      pacotes,
      userId,
    );
  }

  res.json({
    user: userPublicFields(await db.prepare("SELECT * FROM usuarios WHERE id = ?").get(userId)),
  });
});

adminRoutes.post("/users/:id/purchases", async (req, res) => {
  const db = await getDb();
  const userId = Number(req.params.id);
  const quantity = Number(req.body.quantidade_pacotes);
  const user = await db.prepare("SELECT * FROM usuarios WHERE id = ?").get(userId);

  if (!user || !Number.isInteger(quantity) || quantity <= 0) {
    res.status(400).json({ error: "Usuario e quantidade de pacotes validos sao obrigatorios." });
    return;
  }

  await addPurchase(db, userId, quantity);

  res.json({ ok: true });
});

adminRoutes.get("/users/:id/collection", async (req, res) => {
  const collection = await getUserCollection(await getDb(), Number(req.params.id));
  if (!collection) {
    res.status(404).json({ error: "Usuario nao encontrado." });
    return;
  }

  res.json({
    profile: userPublicFields(collection.user),
    animals: collection.animals,
    achievements: collection.achievements,
    owned: collection.owned,
    total: collection.total,
    progress: collection.progress,
  });
});

adminRoutes.post("/users/:id/animals", async (req, res) => {
  const db = await getDb();
  const userId = Number(req.params.id);
  const records = Array.isArray(req.body.animals) ? req.body.animals : [];
  const user = await db.prepare("SELECT * FROM usuarios WHERE id = ?").get(userId);

  if (!user) {
    res.status(404).json({ error: "Usuario nao encontrado." });
    return;
  }

  for (const record of records) {
    const animalId = Number(record.animal_id);
    const animal = await db
      .prepare("SELECT id FROM animais WHERE id = ? AND temporada_id = ?")
      .get(animalId, user.temporada_id);
    if (!animal) continue;

    const possui = record.possui ? 1 : 0;
    const gold = record.gold ? 1 : 0;
    const bicolor = record.bicolor ? 1 : 0;
    const previous = (await db
      .prepare("SELECT gold, bicolor FROM usuario_animais WHERE usuario_id = ? AND animal_id = ?")
      .get(userId, animalId)) || { gold: 0, bicolor: 0 };

    await db.prepare(
      `
      INSERT INTO usuario_animais
        (usuario_id, animal_id, possui, gold, bicolor, atualizado_em)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(usuario_id, animal_id)
      DO UPDATE SET
        possui = excluded.possui,
        gold = excluded.gold,
        bicolor = excluded.bicolor,
        atualizado_em = datetime('now')
      `,
    ).run(userId, animalId, possui, gold, bicolor);

    if (Boolean(previous.gold) !== Boolean(gold)) {
      await trackEvent(db, {
        tipo: gold ? "gold_registered" : "gold_removed",
        userId,
        rota: "admin_animals",
        detalhes: { animal_id: animalId },
      });
    }

    if (Boolean(previous.bicolor) !== Boolean(bicolor)) {
      await trackEvent(db, {
        tipo: bicolor ? "bicolor_registered" : "bicolor_removed",
        userId,
        rota: "admin_animals",
        detalhes: { animal_id: animalId },
      });
    }
  }

  const collection = await refreshUserProgress(db, userId);
  res.json({
    ok: true,
    owned: collection.owned,
    total: collection.total,
    progress: collection.progress,
    complete: Boolean(collection.user.colecao_completa),
  });
});

adminRoutes.post("/seasons", async (req, res) => {
  const db = await getDb();
  const nome = String(req.body.nome || "").trim();
  const imagem = String(req.body.imagem || "").trim();
  const animals = parseAnimalList(req.body.animais || "");

  if (!nome) {
    res.status(400).json({ error: "Informe o nome da temporada." });
    return;
  }

  const seasonId = await createSeason(db, { nome, imagem, animais: animals });
  res.status(201).json({ seasonId });
});

adminRoutes.post("/seasons/:id/activate", async (req, res) => {
  await activateSeason(await getDb(), Number(req.params.id));
  res.json({ ok: true });
});

adminRoutes.get("/export/:entity", async (req, res) => {
  const db = await getDb();
  const entity = String(req.params.entity || "");
  const allowed = {
    usuarios: "SELECT id, nome, codigo_catalogo, senha, data_cadastro, quantidade_pacotes, colecao_completa, data_completou, temporada_id FROM usuarios ORDER BY id",
    catalogos: "SELECT codigo, utilizado, usuario_id, temporada_id, data_criacao, data_utilizacao FROM catalogos ORDER BY codigo",
    conquistas: "SELECT id, usuario_id, nome_conquista, data, temporada_id FROM conquistas ORDER BY id",
    animais: "SELECT id, temporada_id, numero, nome FROM animais ORDER BY temporada_id, numero",
    compras: "SELECT id, usuario_id, quantidade_pacotes, data FROM compras ORDER BY id",
    eventos_site: "SELECT id, tipo, visitor_id, usuario_id, rota, detalhes, data FROM eventos_site ORDER BY id",
  };

  if (!allowed[entity]) {
    res.status(404).json({ error: "Exportacao nao encontrada." });
    return;
  }

  const csv = stringifyCsv(await db.prepare(allowed[entity]).all());
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=miniflex-${entity}.csv`);
  res.send(csv);
});

adminRoutes.post("/import/catalogs", async (req, res) => {
  const db = await getDb();
  const activeSeason = await getActiveSeason(db);
  const seasonId = Number(req.body.temporada_id) || activeSeason.id;
  const rows = parseCsv(req.body.csv || "");
  const headers = rows[0]?.map((item) => item.toLowerCase()) || [];
  const hasHeader = headers.includes("codigo");
  const objects = hasHeader ? rowsToObjects(rows) : rows.map((row) => ({ codigo: row[0] }));
  let created = 0;

  for (const item of objects) {
    const code = normalizeCode(item.codigo);
    if (!code) continue;
    const result = await db
      .prepare("INSERT OR IGNORE INTO catalogos (codigo, temporada_id) VALUES (?, ?)")
      .run(code, Number(item.temporada_id) || seasonId);
    created += result.changes;
  }

  res.json({ created });
});

adminRoutes.post("/import/users", async (req, res) => {
  const db = await getDb();
  const activeSeason = await getActiveSeason(db);
  const seasonId = Number(req.body.temporada_id) || activeSeason.id;
  const objects = rowsToObjects(parseCsv(req.body.csv || ""));
  let created = 0;

  for (const item of objects) {
    const nome = String(item.nome || "").trim();
    const codigo = normalizeCode(item.codigo_catalogo);
    if (!nome || !codigo) continue;

    const password = item.senha?.includes(":")
      ? item.senha
      : hashPassword(String(item.senha || "miniflex123"));
    const targetSeason = Number(item.temporada_id) || seasonId;

    await db.prepare("INSERT OR IGNORE INTO catalogos (codigo, utilizado, temporada_id) VALUES (?, 1, ?)").run(
      codigo,
      targetSeason,
    );

    const result = await db
      .prepare(
        `
        INSERT OR IGNORE INTO usuarios
          (nome, codigo_catalogo, senha, data_cadastro, quantidade_pacotes, colecao_completa, data_completou, temporada_id)
        VALUES (?, ?, ?, COALESCE(?, datetime('now')), ?, ?, ?, ?)
        `,
      )
      .run(
        nome,
        codigo,
        password,
        item.data_cadastro || null,
        Number(item.quantidade_pacotes) || 0,
        Number(item.colecao_completa) || 0,
        item.data_completou || null,
        targetSeason,
      );

    created += result.changes;
    if (result.changes) {
      const user = await db.prepare("SELECT id FROM usuarios WHERE codigo_catalogo = ?").get(codigo);
      await db.prepare("UPDATE catalogos SET utilizado = 1, usuario_id = ? WHERE codigo = ?").run(
        user.id,
        codigo,
      );
    }
  }

  res.json({ created });
});

async function getChartData(db, seasonId) {
  const weekUsers = await db
    .prepare(
      `
      SELECT strftime('%Y-W%W', data_cadastro) AS label, COUNT(*) AS value
      FROM usuarios
      WHERE temporada_id = ?
      GROUP BY label
      ORDER BY label
      `,
    )
    .all(seasonId);

  const packages = await db
    .prepare(
      `
      SELECT strftime('%Y-W%W', c.data) AS label, COALESCE(SUM(c.quantidade_pacotes), 0) AS value
      FROM compras c
      JOIN usuarios u ON u.id = c.usuario_id
      WHERE u.temporada_id = ?
      GROUP BY label
      ORDER BY label
      `,
    )
    .all(seasonId);

  const rarity = await db
    .prepare(
      `
      SELECT
        COALESCE(SUM(gold), 0) AS gold,
        COALESCE(SUM(bicolor), 0) AS bicolor
      FROM usuario_animais ua
      JOIN usuarios u ON u.id = ua.usuario_id
      WHERE u.temporada_id = ?
      `,
    )
    .get(seasonId);

  const buyers = await db
    .prepare(
      `
      SELECT nome AS label, quantidade_pacotes AS value
      FROM usuarios
      WHERE temporada_id = ? AND quantidade_pacotes > 0
      ORDER BY quantidade_pacotes DESC
      LIMIT 10
      `,
    )
    .all(seasonId);

  return { weekUsers, packages, rarity, buyers };
}

function normalizeCodes(value) {
  const raw = Array.isArray(value) ? value : String(value).split(/[\n,;]+/);
  return [...new Set(raw.map(normalizeCode).filter(Boolean))];
}

async function addPurchase(db, userId, quantity) {
  const user = await db.prepare("SELECT * FROM usuarios WHERE id = ?").get(userId);
  const previousPurchases = await db
    .prepare(
      `
      SELECT COUNT(*) AS total
      FROM compras c
      JOIN usuarios u ON u.id = c.usuario_id
      WHERE u.temporada_id = ?
      `,
    )
    .get(user.temporada_id);

  await db.prepare("INSERT INTO compras (usuario_id, quantidade_pacotes) VALUES (?, ?)").run(
    userId,
    quantity,
  );
  await db.prepare(
    "UPDATE usuarios SET quantidade_pacotes = quantidade_pacotes + ? WHERE id = ?",
  ).run(quantity, userId);

  if (previousPurchases.total === 0) {
    await addAchievement(db, userId, "Primeiro Comprador", user.temporada_id);
  }
}

function parseAnimalList(value) {
  return String(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const match = line.match(/^(\d{1,3})[\s-]+(.+)$/);
      return {
        numero: match ? match[1].padStart(3, "0") : String(index + 1).padStart(3, "0"),
        nome: match ? match[2].trim() : line,
      };
    });
}
