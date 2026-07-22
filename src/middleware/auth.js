import { getDb } from "../db/database.js";
import { hashValue, randomToken } from "../utils/security.js";
import { userPublicFields } from "../services/collectionService.js";

const COOKIE_NAME = "miniflex_session";
const SESSION_DAYS = 7;

export async function attachSession(req, _res, next) {
  const token = parseCookies(req.headers.cookie || "")[COOKIE_NAME];
  req.session = null;
  req.user = null;

  if (!token) {
    next();
    return;
  }

  const db = await getDb();
  const tokenHash = hashValue(token);
  const session = await db
    .prepare(
      "SELECT * FROM sessoes WHERE token_hash = ? AND expira_em > datetime('now')",
    )
    .get(tokenHash);

  if (session) {
    req.session = session;
    if (session.usuario_id) {
      const user = await db.prepare("SELECT * FROM usuarios WHERE id = ?").get(session.usuario_id);
      req.user = userPublicFields(user);
    }
  }

  next();
}

export async function createSession(res, { userId = null, admin = false } = {}) {
  const db = await getDb();
  const token = randomToken();
  const tokenHash = hashValue(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await db.prepare(
    "INSERT INTO sessoes (token_hash, usuario_id, admin, expira_em) VALUES (?, ?, ?, ?)",
  ).run(tokenHash, userId, admin ? 1 : 0, expiresAt.toISOString());

  res.setHeader("Set-Cookie", serializeCookie(COOKIE_NAME, token, SESSION_DAYS * 86400));
}

export async function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie || "")[COOKIE_NAME];
  if (token) {
    const db = await getDb();
    await db.prepare("DELETE FROM sessoes WHERE token_hash = ?").run(hashValue(token));
  }
  res.setHeader("Set-Cookie", serializeCookie(COOKIE_NAME, "", 0));
}

export function requireUser(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: "Faca login para continuar." });
    return;
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.session?.admin) {
    res.status(401).json({ error: "Acesso administrativo protegido." });
    return;
  }
  next();
}

function parseCookies(cookieHeader) {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [key, ...value] = part.split("=");
        return [decodeURIComponent(key), decodeURIComponent(value.join("="))];
      }),
  );
}

function serializeCookie(name, value, maxAge) {
  const parts = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];

  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}
