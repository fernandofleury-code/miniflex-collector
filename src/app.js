import express from "express";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./db/database.js";
import { attachSession } from "./middleware/auth.js";
import { authRoutes } from "./routes/authRoutes.js";
import { publicRoutes } from "./routes/publicRoutes.js";
import { adminRoutes } from "./routes/adminRoutes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

export async function createApp() {
  await getDb();

  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(attachSession);
  app.use(express.static(publicDir));

  app.use("/api/auth", authRoutes);
  app.use("/api/public", publicRoutes);
  app.use("/api/admin", adminRoutes);

  app.get("/health", (_req, res) => {
    res.json({ ok: true, name: "MiniFlex Collector" });
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "Algo saiu do trilho. Tente novamente." });
  });

  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/api")) {
      res.sendFile(join(publicDir, "index.html"));
      return;
    }
    next();
  });

  return app;
}
