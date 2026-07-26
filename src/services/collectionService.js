import { DEFAULT_ANIMALS } from "../db/database.js";

export async function getActiveSeason(db) {
  return db.prepare("SELECT * FROM temporadas WHERE ativa = 1 ORDER BY id DESC LIMIT 1").get();
}

export function normalizeCode(code = "") {
  return code.trim().toUpperCase();
}

export async function addAchievement(db, userId, achievementName, seasonId) {
  await db.prepare(
    "INSERT OR IGNORE INTO conquistas (usuario_id, nome_conquista, temporada_id) VALUES (?, ?, ?)",
  ).run(userId, achievementName, seasonId);
}

export async function createSeason(db, { nome, imagem, animais }) {
  const insert = db.prepare(
    "INSERT INTO temporadas (nome, imagem, ativa) VALUES (?, ?, 0)",
  );
  const result = await insert.run(nome, imagem || "/assets/season-1.svg");
  const seasonId = Number(result.lastInsertRowid);
  const animalRows = animais?.length ? animais : DEFAULT_ANIMALS;

  for (const animal of animalRows) {
    const numero = Array.isArray(animal) ? animal[0] : animal.numero;
    const nomeAnimal = Array.isArray(animal) ? animal[1] : animal.nome;
    await db.prepare(
      "INSERT INTO animais (temporada_id, numero, nome) VALUES (?, ?, ?)",
    ).run(seasonId, numero, nomeAnimal);
  }

  return seasonId;
}

export async function activateSeason(db, seasonId) {
  await db.exec("UPDATE temporadas SET ativa = 0");
  await db.prepare("UPDATE temporadas SET ativa = 1 WHERE id = ?").run(seasonId);
}

export async function getUserCollection(db, userId) {
  const user = await db.prepare("SELECT * FROM usuarios WHERE id = ?").get(userId);
  if (!user) return null;

  const animals = await db
    .prepare(
      `
      SELECT
        a.id,
        a.numero,
        a.nome,
        COALESCE(ua.possui, 0) AS possui,
        COALESCE(ua.gold, 0) AS gold,
        COALESCE(ua.bicolor, 0) AS bicolor
      FROM animais a
      LEFT JOIN usuario_animais ua
        ON ua.animal_id = a.id AND ua.usuario_id = ?
      WHERE a.temporada_id = ?
      ORDER BY a.numero
      `,
    )
    .all(userId, user.temporada_id);

  const achievements = await db
    .prepare(
      "SELECT nome_conquista, data FROM conquistas WHERE usuario_id = ? ORDER BY data DESC",
    )
    .all(userId);

  const owned = animals.filter((animal) => animal.possui).length;

  return {
    user,
    animals,
    achievements,
    owned,
    total: animals.length,
    progress: animals.length ? Math.round((owned / animals.length) * 100) : 0,
  };
}

export async function refreshUserProgress(db, userId) {
  const collection = await getUserCollection(db, userId);
  if (!collection) return null;

  const completed = collection.total > 0 && collection.owned === collection.total;
  const wasComplete = Boolean(collection.user.colecao_completa);
  const seasonId = collection.user.temporada_id;

  if (completed && !wasComplete) {
    const previousCompleters = await db
      .prepare(
        "SELECT COUNT(*) AS total FROM usuarios WHERE temporada_id = ? AND colecao_completa = 1",
      )
      .get(seasonId);

    await db.prepare(
      "UPDATE usuarios SET colecao_completa = 1, data_completou = datetime('now') WHERE id = ?",
    ).run(userId);
    await addAchievement(db, userId, "🏆 Mestre Colecionador", seasonId);

    if (previousCompleters.total === 0) {
      const season = await db.prepare("SELECT nome FROM temporadas WHERE id = ?").get(seasonId);
      await addAchievement(
        db,
        userId,
        `👑 Primeiro a Completar ${season?.nome || "a temporada"}`,
        seasonId,
      );
    }
  }

  if (!completed && wasComplete) {
    await db.prepare(
      "UPDATE usuarios SET colecao_completa = 0, data_completou = NULL WHERE id = ?",
    ).run(userId);
  }

  return getUserCollection(db, userId);
}

export function userPublicFields(row) {
  if (!row) return null;
  return {
    id: row.id,
    nome: row.nome,
    codigo_catalogo: row.codigo_catalogo,
    data_cadastro: row.data_cadastro,
    quantidade_pacotes: row.quantidade_pacotes,
    colecao_completa: Boolean(row.colecao_completa),
    data_completou: row.data_completou,
    temporada_id: row.temporada_id,
    ignorar_fluxo: Boolean(row.ignorar_fluxo),
  };
}
