import { Router } from "express";
import { getDb } from "../db/database.js";
import { createSession, destroySession, requireUser } from "../middleware/auth.js";
import {
  getActiveSeason,
  getUserCollection,
  normalizeCode,
  userPublicFields,
} from "../services/collectionService.js";
import { trackEvent, visitorIdFromRequest } from "../services/analyticsService.js";
import { hashPassword, verifyPassword } from "../utils/security.js";

export const authRoutes = Router();

authRoutes.get("/me", (req, res) => {
  res.json({
    user: req.user,
    admin: Boolean(req.session?.admin),
  });
});

authRoutes.post("/register", async (req, res) => {
  const db = await getDb();
  const nome = String(req.body.nome || "").trim();
  const senha = String(req.body.senha || "");

  if (!nome || senha.length < 4) {
    res.status(400).json({
      error: "Informe nome e senha com pelo menos 4 caracteres.",
    });
    return;
  }

  const season = await getActiveSeason(db);
  const internalCode = await generateInternalAccountCode(db);
  const result = await db
    .prepare(
      `
      INSERT INTO usuarios (nome, codigo_catalogo, senha, temporada_id)
      VALUES (?, ?, ?, ?)
      `,
    )
    .run(nome, internalCode, hashPassword(senha), season.id);

  const userId = Number(result.lastInsertRowid);

  await createSession(res, { userId });
  const user = await db.prepare("SELECT * FROM usuarios WHERE id = ?").get(userId);
  await trackEvent(db, {
    tipo: "account_created",
    visitorId: visitorIdFromRequest(req),
    userId,
    rota: "register",
  });
  res.status(201).json({ user: userPublicFields(user) });
});

authRoutes.post("/login", async (req, res) => {
  const db = await getDb();
  const nome = String(req.body.nome || "").trim();
  const codigo = normalizeCode(req.body.codigo_catalogo);
  const senha = String(req.body.senha || "");
  let user = null;

  if (nome) {
    const candidates = await db
      .prepare("SELECT * FROM usuarios WHERE lower(nome) = lower(?) ORDER BY data_cadastro DESC")
      .all(nome);
    user = candidates.find((candidate) => verifyPassword(senha, candidate.senha));
  } else if (codigo) {
    user = await db.prepare("SELECT * FROM usuarios WHERE codigo_catalogo = ?").get(codigo);
  }

  if (!user || !verifyPassword(senha, user.senha)) {
    res.status(401).json({ error: "Nome ou senha inválidos." });
    return;
  }

  await createSession(res, { userId: user.id });
  await trackEvent(db, {
    tipo: "login",
    visitorId: visitorIdFromRequest(req),
    userId: user.id,
    rota: "login",
  });
  res.json({ user: userPublicFields(user) });
});

authRoutes.post("/logout", async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
});

authRoutes.get("/dashboard", requireUser, async (req, res) => {
  const collection = await getUserCollection(await getDb(), req.user.id);
  res.json({
    profile: userPublicFields(collection.user),
    animals: collection.animals,
    achievements: collection.achievements,
    owned: collection.owned,
    total: collection.total,
    progress: collection.progress,
  });
});

authRoutes.get("/active-season", async (_req, res) => {
  res.json({ season: await getActiveSeason(await getDb()) });
});

async function generateInternalAccountCode(db) {
  let code;

  do {
    code = `WEB-${Date.now().toString(36).toUpperCase()}-${Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase()}`;
  } while (await db.prepare("SELECT 1 FROM usuarios WHERE codigo_catalogo = ?").get(code));

  return code;
}
