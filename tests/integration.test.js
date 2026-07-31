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
  const visitorId = "visitor-test";

  try {
    const health = await jsonFetch(`${baseUrl}/health`);
    assert.equal(health.data.ok, true);

    const tracked = await jsonFetch(`${baseUrl}/api/public/track`, {
      method: "POST",
      visitorId,
      body: { view: "home", path: "/" },
    });
    assert.equal(tracked.data.ok, true);

    const blockedGift = await fetch(`${baseUrl}/api/public/gifts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        animal: "001 Tubarão",
        destinatario: "Colega Teste",
        turma: "6A",
      }),
    });
    assert.equal(blockedGift.status, 401);

    const register = await jsonFetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      visitorId,
      body: {
        nome: "Aluno Teste",
        senha: "1234",
      },
    });
    assert.equal(register.data.user.nome, "Aluno Teste");

    const collection = await jsonFetch(`${baseUrl}/api/public/collection`);
    assert.equal(collection.data.animals.find((animal) => animal.numero === "006").nome, "Koala");

    const dashboard = await jsonFetch(`${baseUrl}/api/auth/dashboard`, {
      cookie: register.cookie,
    });
    assert.equal(dashboard.data.total, 10);
    assert.equal(dashboard.data.owned, 0);
    assert.equal(dashboard.data.achievements.length, 0);

    const giftRequest = await jsonFetch(`${baseUrl}/api/public/gifts`, {
      method: "POST",
      visitorId,
      cookie: register.cookie,
      body: {
        animal: "001 Tubarão",
        destinatario: "Colega Teste",
        turma: "6A",
        mensagem: "Surpresa MiniFlex",
        surpresa: true,
      },
    });
    assert.equal(giftRequest.data.ok, true);

    const emptyRanking = await jsonFetch(`${baseUrl}/api/public/ranking`);
    assert.equal(emptyRanking.data.ranking.length, 0);

    const emptyHall = await jsonFetch(`${baseUrl}/api/public/hall`);
    assert.equal(emptyHall.data.firstBuyer, undefined);

    const collectorLogin = await jsonFetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      visitorId,
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
    assert.equal(overview.data.traffic.summary.pageViews, 1);
    assert.equal(overview.data.traffic.summary.uniqueVisitors, 1);
    assert.equal(overview.data.traffic.summary.newAccounts, 1);
    assert.equal(overview.data.traffic.summary.logins, 1);
    assert.equal(overview.data.giftRequests.length, 1);
    assert.equal(overview.data.giftRequests[0].destinatario, "Colega Teste");

    await jsonFetch(`${baseUrl}/api/admin/gifts/${overview.data.giftRequests[0].id}`, {
      method: "DELETE",
      cookie: adminLogin.cookie,
    });
    const overviewAfterGiftDelete = await jsonFetch(`${baseUrl}/api/admin/overview`, {
      cookie: adminLogin.cookie,
    });
    assert.equal(overviewAfterGiftDelete.data.giftRequests.length, 0);

    const adminDeviceId = "admin-device-test";
    await jsonFetch(`${baseUrl}/api/public/track`, {
      method: "POST",
      visitorId: adminDeviceId,
      body: { view: "admin", path: "/#admin" },
    });
    const overviewWithAdminVisit = await jsonFetch(`${baseUrl}/api/admin/overview`, {
      cookie: adminLogin.cookie,
    });
    assert.equal(overviewWithAdminVisit.data.traffic.summary.pageViews, 2);
    assert.equal(overviewWithAdminVisit.data.traffic.summary.uniqueVisitors, 2);

    await jsonFetch(`${baseUrl}/api/admin/ignore-current-visitor`, {
      method: "POST",
      cookie: adminLogin.cookie,
      visitorId: adminDeviceId,
      body: {},
    });
    const overviewAfterDeviceIgnore = await jsonFetch(`${baseUrl}/api/admin/overview`, {
      cookie: adminLogin.cookie,
    });
    assert.equal(overviewAfterDeviceIgnore.data.traffic.summary.pageViews, 1);
    assert.equal(overviewAfterDeviceIgnore.data.traffic.summary.uniqueVisitors, 1);

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
    assert.equal(hallAfterPurchase.data.topGold.length, 0);
    assert.equal(hallAfterPurchase.data.topBicolor.length, 0);

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

    const hallAfterRarity = await jsonFetch(`${baseUrl}/api/public/hall`);
    assert.equal(hallAfterRarity.data.topGold.length, 1);
    assert.equal(hallAfterRarity.data.topBicolor.length, 1);

    const overviewAfterRarity = await jsonFetch(`${baseUrl}/api/admin/overview`, {
      cookie: adminLogin.cookie,
    });
    assert.equal(overviewAfterRarity.data.traffic.summary.packages, 2);
    assert.equal(overviewAfterRarity.data.traffic.summary.goldRegistered, 1);
    assert.equal(overviewAfterRarity.data.traffic.summary.bicolorRegistered, 1);

    await jsonFetch(`${baseUrl}/api/admin/users/${register.data.user.id}`, {
      method: "PATCH",
      cookie: adminLogin.cookie,
      body: {
        nome: "Aluno Teste",
        quantidade_pacotes: 2,
        ignorar_fluxo: true,
      },
    });
    const ignoredOverview = await jsonFetch(`${baseUrl}/api/admin/overview`, {
      cookie: adminLogin.cookie,
    });
    assert.equal(ignoredOverview.data.traffic.summary.pageViews, 0);
    assert.equal(ignoredOverview.data.traffic.summary.uniqueVisitors, 0);
    assert.equal(ignoredOverview.data.traffic.summary.logins, 0);
    assert.equal(ignoredOverview.data.traffic.summary.newAccounts, 0);
    assert.equal(ignoredOverview.data.traffic.summary.packages, 0);
    assert.equal(ignoredOverview.data.traffic.summary.goldRegistered, 0);
    assert.equal(ignoredOverview.data.traffic.summary.bicolorRegistered, 0);
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
      ...(options.visitorId ? { "X-MiniFlex-Visitor-Id": options.visitorId } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json();
  const cookie = response.headers.get("set-cookie")?.split(";")[0];

  assert.equal(response.ok, true, data.error);
  return { data, cookie };
}
