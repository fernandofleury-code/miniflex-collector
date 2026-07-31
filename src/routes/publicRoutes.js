import { Router } from "express";
import { getDb } from "../db/database.js";
import { requireUser } from "../middleware/auth.js";
import { getActiveSeason } from "../services/collectionService.js";
import { trackEvent, visitorIdFromRequest } from "../services/analyticsService.js";

export const publicRoutes = Router();

publicRoutes.get("/summary", async (req, res) => {
  const db = await getDb();
  const activeSeason = await getActiveSeason(db);
  const seasonId = Number(req.query.season_id) || activeSeason.id;

  const stats = await db
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

  const rarity = await db
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

  const firstCompleter = await db
    .prepare(
      `
      SELECT nome, data_completou
      FROM usuarios
      WHERE temporada_id = ? AND colecao_completa = 1
      ORDER BY data_completou ASC
      LIMIT 1
      `,
    )
    .get(seasonId);

  const topBuyer = await db
    .prepare(
      `
      SELECT nome, quantidade_pacotes
      FROM usuarios
      WHERE temporada_id = ? AND quantidade_pacotes > 0
      ORDER BY quantidade_pacotes DESC, data_cadastro ASC
      LIMIT 1
      `,
    )
    .get(seasonId);

  const season = await db.prepare("SELECT * FROM temporadas WHERE id = ?").get(seasonId);

  res.json({
    season,
    firstCompleter,
    topBuyer,
    colecionadores: stats.colecionadores,
    pacotes_vendidos: stats.pacotes_vendidos,
    gold: rarity.gold,
    bicolor: rarity.bicolor,
  });
});

publicRoutes.get("/seasons", async (_req, res) => {
  const seasons = (await (await getDb())
    .prepare("SELECT * FROM temporadas ORDER BY id DESC")
    .all())
    .map((season) => ({ ...season, ativa: Boolean(season.ativa) }));
  res.json({ seasons });
});

publicRoutes.post("/track", async (req, res) => {
  const db = await getDb();
  const visitorId = visitorIdFromRequest(req);
  const view = String(req.body.view || "unknown").trim().slice(0, 60);

  if (!visitorId) {
    res.json({ ok: true });
    return;
  }

  await trackEvent(db, {
    tipo: "page_view",
    visitorId,
    userId: req.user?.id,
    rota: view,
    detalhes: {
      path: String(req.body.path || "").slice(0, 120),
    },
  });

  res.json({ ok: true });
});

publicRoutes.post("/gifts", requireUser, async (req, res) => {
  const db = await getDb();
  const visitorId = visitorIdFromRequest(req);
  const animal = cleanRequestText(req.body.animal, 80);
  const destinatario = cleanRequestText(req.body.destinatario, 90);
  const turma = cleanRequestText(req.body.turma, 40);
  const mensagem = cleanRequestText(req.body.mensagem, 240);
  const surpresa = req.body.surpresa === true || req.body.surpresa === "on" || req.body.surpresa === "true";

  if (!animal || !destinatario || !turma) {
    res.status(400).json({ error: "Preencha animal, destinatário e turma." });
    return;
  }

  await db
    .prepare(
      `
      INSERT INTO presentes (animal, destinatario, turma, mensagem, surpresa, usuario_id, visitor_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(animal, destinatario, turma, mensagem || null, surpresa ? 1 : 0, req.user?.id || null, visitorId || null);

  await trackEvent(db, {
    tipo: "gift_request",
    visitorId,
    userId: req.user?.id,
    rota: "gift",
    detalhes: { animal, turma, surpresa },
  });

  res.status(201).json({ ok: true });
});

publicRoutes.post("/normal-orders", requireUser, async (req, res) => {
  const db = await getDb();
  const visitorId = visitorIdFromRequest(req);
  const animal = "Animal aleatório";
  const turma = cleanRequestText(req.body.turma, 40);
  const observacao = cleanRequestText(req.body.observacao, 240);
  const quantidade = Math.max(1, Math.min(20, Number(req.body.quantidade) || 1));

  if (!turma) {
    res.status(400).json({ error: "Preencha a turma." });
    return;
  }

  await db
    .prepare(
      `
      INSERT INTO pedidos_normais (animal, quantidade, turma, observacao, usuario_id, visitor_id)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
    )
    .run(animal, quantidade, turma, observacao || null, req.user?.id || null, visitorId || null);

  await trackEvent(db, {
    tipo: "normal_order_request",
    visitorId,
    userId: req.user?.id,
    rota: "store",
    detalhes: { animal, quantidade, turma },
  });

  res.status(201).json({ ok: true });
});

publicRoutes.get("/collection", async (req, res) => {
  const db = await getDb();
  const activeSeason = await getActiveSeason(db);
  const seasonId = Number(req.query.season_id) || activeSeason.id;
  const animals = await db
    .prepare("SELECT id, numero, nome FROM animais WHERE temporada_id = ? ORDER BY numero")
    .all(seasonId);
  res.json({ animals });
});

publicRoutes.get("/ranking", async (req, res) => {
  const db = await getDb();
  const activeSeason = await getActiveSeason(db);
  const seasonId = Number(req.query.season_id) || activeSeason.id;
  const rows = (await db
    .prepare(
      `
      SELECT
        u.id,
        u.nome,
        u.quantidade_pacotes,
        u.colecao_completa,
        COALESCE(SUM(ua.gold), 0) AS gold,
        COALESCE(SUM(ua.bicolor), 0) AS bicolor
      FROM usuarios u
      LEFT JOIN usuario_animais ua ON ua.usuario_id = u.id
      WHERE u.temporada_id = ? AND u.quantidade_pacotes > 0
      GROUP BY u.id
      ORDER BY u.quantidade_pacotes DESC, gold DESC, bicolor DESC, u.data_cadastro ASC
      `,
    )
    .all(seasonId))
    .map((row, index) => ({
      posicao: index + 1,
      ...row,
      colecao_completa: Boolean(row.colecao_completa),
    }));

  res.json({ ranking: rows });
});

publicRoutes.get("/hall", async (req, res) => {
  const db = await getDb();
  const activeSeason = await getActiveSeason(db);
  const seasonId = Number(req.query.season_id) || activeSeason.id;

  const firstBuyer = await db
    .prepare(
      `
      SELECT u.nome, c.data AS data_compra
      FROM compras c
      JOIN usuarios u ON u.id = c.usuario_id
      WHERE u.temporada_id = ?
      ORDER BY c.data ASC, c.id ASC
      LIMIT 1
      `,
    )
    .get(seasonId);

  const firstCompleter = await db
    .prepare(
      `
      SELECT nome, data_completou
      FROM usuarios
      WHERE temporada_id = ? AND colecao_completa = 1
      ORDER BY data_completou ASC
      LIMIT 1
      `,
    )
    .get(seasonId);

  const topBuyers = await topList(db, seasonId, "u.quantidade_pacotes", "pacotes");
  const topGold = await topList(db, seasonId, "gold", "gold");
  const topBicolor = await topList(db, seasonId, "bicolor", "bicolor");

  res.json({ firstBuyer, firstCompleter, topBuyers, topGold, topBicolor });
});

async function topList(db, seasonId, orderField, valueName) {
  const positiveRarityFilter = {
    gold: "HAVING COALESCE(SUM(ua.gold), 0) > 0",
    bicolor: "HAVING COALESCE(SUM(ua.bicolor), 0) > 0",
  }[valueName] || "";

  return (await db
    .prepare(
      `
      SELECT
        u.nome,
        u.quantidade_pacotes AS pacotes,
        COALESCE(SUM(ua.gold), 0) AS gold,
        COALESCE(SUM(ua.bicolor), 0) AS bicolor
      FROM usuarios u
      LEFT JOIN usuario_animais ua ON ua.usuario_id = u.id
      WHERE u.temporada_id = ? AND u.quantidade_pacotes > 0
      GROUP BY u.id
      ${positiveRarityFilter}
      ORDER BY ${orderField} DESC, u.data_cadastro ASC
      LIMIT 10
      `,
    )
    .all(seasonId))
    .map((row, index) => ({
      posicao: index + 1,
      nome: row.nome,
      valor: row[valueName],
      pacotes: row.pacotes,
      gold: row.gold,
      bicolor: row.bicolor,
    }));
}

function cleanRequestText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
