const BRAZIL_OFFSET = "-3 hours";

export function visitorIdFromRequest(req) {
  const fromHeader = String(req.get("x-miniflex-visitor-id") || "").trim();
  const fromBody = String(req.body?.visitor_id || "").trim();
  return cleanText(fromHeader || fromBody, 96);
}

export async function trackEvent(db, { tipo, visitorId = "", userId = null, rota = "", detalhes = null }) {
  if (!tipo) return;
  const cleanVisitorId = cleanText(visitorId, 96);
  const cleanUserId = Number(userId) || null;

  if (cleanVisitorId && (await isIgnoredVisitor(db, cleanVisitorId))) return;

  if (cleanUserId && (await isIgnoredUser(db, cleanUserId))) {
    if (cleanVisitorId) await rememberIgnoredVisitor(db, cleanVisitorId, cleanUserId);
    return;
  }

  await db
    .prepare(
      `
      INSERT INTO eventos_site (tipo, visitor_id, usuario_id, rota, detalhes)
      VALUES (?, ?, ?, ?, ?)
      `,
    )
    .run(
      cleanText(tipo, 40),
      cleanVisitorId || null,
      cleanUserId,
      cleanText(rota, 120) || null,
      detalhes ? JSON.stringify(detalhes).slice(0, 1000) : null,
    );
}

export async function isIgnoredUser(db, userId) {
  const user = await db.prepare("SELECT ignorar_fluxo FROM usuarios WHERE id = ?").get(Number(userId));
  return Boolean(user?.ignorar_fluxo);
}

export async function isIgnoredVisitor(db, visitorId) {
  if (!visitorId) return false;
  const ignored = await db
    .prepare("SELECT 1 FROM visitantes_ignorados WHERE visitor_id = ?")
    .get(cleanText(visitorId, 96));
  return Boolean(ignored);
}

export async function rememberIgnoredVisitor(db, visitorId, userId = null) {
  const cleanVisitorId = cleanText(visitorId, 96);
  if (!cleanVisitorId) return;
  await db
    .prepare(
      `
      INSERT INTO visitantes_ignorados (visitor_id, usuario_id)
      VALUES (?, ?)
      ON CONFLICT(visitor_id)
      DO UPDATE SET usuario_id = COALESCE(excluded.usuario_id, visitantes_ignorados.usuario_id)
      `,
    )
    .run(cleanVisitorId, Number(userId) || null);
}

export async function rememberIgnoredVisitorsForUser(db, userId) {
  const events = await db
    .prepare(
      `
      SELECT DISTINCT visitor_id
      FROM eventos_site
      WHERE usuario_id = ? AND visitor_id IS NOT NULL
      `,
    )
    .all(Number(userId));

  for (const event of events) {
    await rememberIgnoredVisitor(db, event.visitor_id, userId);
  }
}

export function resolveTrafficRange({ range = "today", date = "" } = {}) {
  const today = localDate(new Date());

  if (range === "yesterday") {
    return {
      range,
      start: shiftDate(today, -1),
      end: shiftDate(today, -1),
      label: "Ontem",
    };
  }

  if (range === "7days") {
    return {
      range,
      start: shiftDate(today, -6),
      end: today,
      label: "Últimos 7 dias",
    };
  }

  if (range === "date" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return {
      range,
      start: date,
      end: date,
      label: formatDateLabel(date),
    };
  }

  return {
    range: "today",
    start: today,
    end: today,
    label: "Hoje",
  };
}

export async function getTrafficData(db, seasonId, options = {}) {
  const period = resolveTrafficRange(options);
  const days = datesBetween(period.start, period.end);
  const params = [period.start, period.end];

  const eventTotals = await db
    .prepare(
      `
      SELECT
        COUNT(CASE WHEN eventos_site.tipo = 'page_view' THEN 1 END) AS page_views,
        COUNT(DISTINCT CASE WHEN eventos_site.tipo = 'page_view' THEN eventos_site.visitor_id END) AS unique_visitors,
        COUNT(CASE WHEN eventos_site.tipo = 'login' THEN 1 END) AS logins,
        COUNT(CASE WHEN eventos_site.tipo = 'gold_registered' THEN 1 END)
          - COUNT(CASE WHEN eventos_site.tipo = 'gold_removed' THEN 1 END) AS gold_registered,
        COUNT(CASE WHEN eventos_site.tipo = 'bicolor_registered' THEN 1 END)
          - COUNT(CASE WHEN eventos_site.tipo = 'bicolor_removed' THEN 1 END) AS bicolor_registered
      FROM eventos_site
      LEFT JOIN usuarios eu ON eu.id = eventos_site.usuario_id
      LEFT JOIN visitantes_ignorados vi ON vi.visitor_id = eventos_site.visitor_id
      WHERE date(datetime(eventos_site.data, '${BRAZIL_OFFSET}')) BETWEEN ? AND ?
        AND COALESCE(eu.ignorar_fluxo, 0) = 0
        AND vi.visitor_id IS NULL
      `,
    )
    .get(...params);

  const accountTotals = await db
    .prepare(
      `
      SELECT COUNT(*) AS new_accounts
      FROM usuarios
      WHERE temporada_id = ? AND date(datetime(data_cadastro, '${BRAZIL_OFFSET}')) BETWEEN ? AND ?
        AND COALESCE(ignorar_fluxo, 0) = 0
      `,
    )
    .get(seasonId, ...params);

  const purchaseTotals = await db
    .prepare(
      `
      SELECT
        COUNT(*) AS purchases,
        COALESCE(SUM(c.quantidade_pacotes), 0) AS packages
      FROM compras c
      JOIN usuarios u ON u.id = c.usuario_id
      WHERE u.temporada_id = ? AND date(datetime(c.data, '${BRAZIL_OFFSET}')) BETWEEN ? AND ?
        AND COALESCE(u.ignorar_fluxo, 0) = 0
      `,
    )
    .get(seasonId, ...params);

  const eventRows = await db
    .prepare(
      `
      SELECT
        date(datetime(eventos_site.data, '${BRAZIL_OFFSET}')) AS date,
        COUNT(CASE WHEN eventos_site.tipo = 'page_view' THEN 1 END) AS page_views,
        COUNT(DISTINCT CASE WHEN eventos_site.tipo = 'page_view' THEN eventos_site.visitor_id END) AS unique_visitors,
        COUNT(CASE WHEN eventos_site.tipo = 'login' THEN 1 END) AS logins,
        COUNT(CASE WHEN eventos_site.tipo = 'gold_registered' THEN 1 END)
          - COUNT(CASE WHEN eventos_site.tipo = 'gold_removed' THEN 1 END) AS gold_registered,
        COUNT(CASE WHEN eventos_site.tipo = 'bicolor_registered' THEN 1 END)
          - COUNT(CASE WHEN eventos_site.tipo = 'bicolor_removed' THEN 1 END) AS bicolor_registered
      FROM eventos_site
      LEFT JOIN usuarios eu ON eu.id = eventos_site.usuario_id
      LEFT JOIN visitantes_ignorados vi ON vi.visitor_id = eventos_site.visitor_id
      WHERE date(datetime(eventos_site.data, '${BRAZIL_OFFSET}')) BETWEEN ? AND ?
        AND COALESCE(eu.ignorar_fluxo, 0) = 0
        AND vi.visitor_id IS NULL
      GROUP BY date(datetime(eventos_site.data, '${BRAZIL_OFFSET}'))
      ORDER BY date(datetime(eventos_site.data, '${BRAZIL_OFFSET}'))
      `,
    )
    .all(...params);

  const accountRows = await db
    .prepare(
      `
      SELECT date(datetime(data_cadastro, '${BRAZIL_OFFSET}')) AS date, COUNT(*) AS new_accounts
      FROM usuarios
      WHERE temporada_id = ? AND date(datetime(data_cadastro, '${BRAZIL_OFFSET}')) BETWEEN ? AND ?
        AND COALESCE(ignorar_fluxo, 0) = 0
      GROUP BY date(datetime(data_cadastro, '${BRAZIL_OFFSET}'))
      `,
    )
    .all(seasonId, ...params);

  const purchaseRows = await db
    .prepare(
      `
      SELECT
        date(datetime(c.data, '${BRAZIL_OFFSET}')) AS date,
        COUNT(*) AS purchases,
        COALESCE(SUM(c.quantidade_pacotes), 0) AS packages
      FROM compras c
      JOIN usuarios u ON u.id = c.usuario_id
      WHERE u.temporada_id = ? AND date(datetime(c.data, '${BRAZIL_OFFSET}')) BETWEEN ? AND ?
        AND COALESCE(u.ignorar_fluxo, 0) = 0
      GROUP BY date(datetime(c.data, '${BRAZIL_OFFSET}'))
      `,
    )
    .all(seasonId, ...params);

  const byDate = new Map(days.map((date) => [date, emptyDay(date)]));
  mergeRows(byDate, eventRows);
  mergeRows(byDate, accountRows);
  mergeRows(byDate, purchaseRows);

  return {
    period,
    summary: {
      pageViews: Number(eventTotals.page_views) || 0,
      uniqueVisitors: Number(eventTotals.unique_visitors) || 0,
      logins: Number(eventTotals.logins) || 0,
      newAccounts: Number(accountTotals.new_accounts) || 0,
      purchases: Number(purchaseTotals.purchases) || 0,
      packages: Number(purchaseTotals.packages) || 0,
      goldRegistered: Number(eventTotals.gold_registered) || 0,
      bicolorRegistered: Number(eventTotals.bicolor_registered) || 0,
    },
    daily: [...byDate.values()],
  };
}

function emptyDay(date) {
  return {
    date,
    label: date.slice(5),
    page_views: 0,
    unique_visitors: 0,
    logins: 0,
    new_accounts: 0,
    purchases: 0,
    packages: 0,
    gold_registered: 0,
    bicolor_registered: 0,
  };
}

function mergeRows(byDate, rows) {
  for (const row of rows) {
    const current = byDate.get(row.date);
    if (!current) continue;
    Object.assign(current, row);
  }
}

function datesBetween(start, end) {
  const dates = [];
  let cursor = parseDate(start);
  const last = parseDate(end);

  while (cursor <= last) {
    dates.push(localDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function shiftDate(date, amount) {
  const target = parseDate(date);
  target.setDate(target.getDate() + amount);
  return localDate(target);
}

function parseDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function localDate(date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

function formatDateLabel(date) {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}
