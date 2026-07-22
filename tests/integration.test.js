import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

test("collector registration, dashboard and admin overview work", async () => {
  const dir = mkdtempSync(join(tmpdir(), "miniflex-flow-"));
  process.env.DB_PATH = join(dir, "flow.sqlite");

  const { createApp } = await import(`../src/app.js?test=${Date.now()}`);
  const app = await createApp();
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const health = await jsonFetch(`${baseUrl}/health`);
    assert.equal(health.data.ok, true);

    const register = await jsonFetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      body: {
        nome: "Aluno Teste",
        senha: "1234",
      },
    });
    assert.equal(register.data.user.nome, "Aluno Teste");

    const dashboard = await jsonFetch(`${baseUrl}/api/auth/dashboard`, {
      cookie: register.cookie,
    });
    assert.equal(dashboard.data.total, 10);
    assert.equal(dashboard.data.owned, 0);
    assert.equal(dashboard.data.achievements.length, 0);

    const emptyRanking = await jsonFetch(`${baseUrl}/api/public/ranking`);
    assert.equal(emptyRanking.data.ranking.length, 0);

    const emptyHall = await jsonFetch(`${baseUrl}/api/public/hall`);
    assert.equal(emptyHall.data.firstBuyer, undefined);

    const collectorLogin = await jsonFetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      body: {
        nome: "Aluno Teste",
        senha: "1234",
      },
    });
    assert.equal(collectorLogin.data.user.nome, "Aluno Teste");

    await jsonFetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      cookie: collectorLogin.cookie,
      body: {},
    });
    const afterLogout = await fetch(`${baseUrl}/api/auth/dashboard`, {
      headers: { Cookie: collectorLogin.cookie },
    });
    assert.equal(afterLogout.status, 401);

    const adminLogin = await jsonFetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      body: { senha: "miniflex-admin" },
    });
    const overview = await jsonFetch(`${baseUrl}/api/admin/overview`, {
      cookie: adminLogin.cookie,
    });
    assert.equal(overview.data.users.length, 1);

    await jsonFetch(`${baseUrl}/api/admin/users/${register.data.user.id}/animals`, {
      method: "POST",
      cookie: adminLogin.cookie,
      body: {
        animals: [
          {
            animal_id: dashboard.data.animals[0].id,
            possui: false,
            gold: true,
            bicolor: true,
          },
        ],
      },
    });
    const variantDashboard = await jsonFetch(`${baseUrl}/api/auth/dashboard`, {
      cookie: register.cookie,
    });
    assert.equal(variantDashboard.data.animals[0].possui, 0);
    assert.equal(variantDashboard.data.animals[0].gold, 1);
    assert.equal(variantDashboard.data.animals[0].bicolor, 1);
    assert.equal(variantDashboard.data.owned, 0);

    await jsonFetch(`${baseUrl}/api/admin/users/${register.data.user.id}/purchases`, {
      method: "POST",
      cookie: adminLogin.cookie,
      body: { quantidade_pacotes: 2 },
    });
    const rankingAfterPurchase = await jsonFetch(`${baseUrl}/api/public/ranking`);
    assert.equal(rankingAfterPurchase.data.ranking.length, 1);
    assert.equal(rankingAfterPurchase.data.ranking[0].nome, "Aluno Teste");

    const hallAfterPurchase = await jsonFetch(`${baseUrl}/api/public/hall`);
    assert.equal(hallAfterPurchase.data.firstBuyer.nome, "Aluno Teste");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    const { resetDbForTests } = await import("../src/db/database.js");
    resetDbForTests();
    rmSync(dir, { recursive: true, force: true });
  }
});

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json();
  const cookie = response.headers.get("set-cookie")?.split(";")[0];

  assert.equal(response.ok, true, data.error);
  return { data, cookie };
}
