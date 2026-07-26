const BRAZIL_OFFSET = "-3 hours";

export function visitorIdFromRequest(req) {
  const fromHeader = String(req.get("x-miniflex-visitor-id") || "").trim();
  const fromBody = String(req.body?.visitor_id || "").trim();
  return cleanText(fromHeader || fromBody, 96);
}

export async function trackEvent(db, { tipo, visitorId = "", userId = null, rota = "", detalhes = null }) {
  if (!tipo) return;

  await db
    .prepare(
      `
      INSERT INTO eventos_site (tipo, visitor_id, usuario_id, rota, detalhes)
      VALUES (?, ?, ?, ?, ?)
      `,
    )
    .run(
      cleanText(tipo, 40),
      cleanText(visitorId, 96) || null,
      Number(userId) || null,
      cleanText(rota, 120) || null,
      detalhes ? JSON.stringify(detalhes).slice(0, 1000) : null,
    );
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
      label: "Ultimos 7 dias",
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
        COUNT(CASE WHEN tipo = 'page_view' THEN 1 END) AS page_views,
        COUNT(DISTINCT CASE WHEN tipo = 'page_view' THEN visitor_id END) AS unique_visitors,
        COUNT(CASE WHEN tipo = 'login' THEN 1 END) AS logins,
        COUNT(CASE WHEN tipo = 'gold_registered' THEN 1 END)
          - COUNT(CASE WHEN tipo = 'gold_removed' THEN 1 END) AS gold_registered,
        COUNT(CASE WHEN tipo = 'bicolor_registered' THEN 1 END)
          - COUNT(CASE WHEN tipo = 'bicolor_removed' THEN 1 END) AS bicolor_registered
      FROM eventos_site
      WHERE date(datetime(data, '${BRAZIL_OFFSET}')) BETWEEN ? AND ?
      `,
    )
    .get(...params);

  const accountTotals = await db
    .prepare(
      `
      SELECT COUNT(*) AS new_accounts
      FROM usuarios
      WHERE temporada_id = ? AND date(datetime(data_cadastro, '${BRAZIL_OFFSET}')) BETWEEN ? AND ?
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
      `,
    )
    .get(seasonId, ...params);

  const eventRows = await db
    .prepare(
      `
      SELECT
        date(datetime(data, '${BRAZIL_OFFSET}')) AS date,
        COUNT(CASE WHEN tipo = 'page_view' THEN 1 END) AS page_views,
        COUNT(DISTINCT CASE WHEN tipo = 'page_view' THEN visitor_id END) AS unique_visitors,
        COUNT(CASE WHEN tipo = 'login' THEN 1 END) AS logins,
        COUNT(CASE WHEN tipo = 'gold_registered' THEN 1 END)
          - COUNT(CASE WHEN tipo = 'gold_removed' THEN 1 END) AS gold_registered,
        COUNT(CASE WHEN tipo = 'bicolor_registered' THEN 1 END)
          - COUNT(CASE WHEN tipo = 'bicolor_removed' THEN 1 END) AS bicolor_registered
      FROM eventos_site
      WHERE date(datetime(data, '${BRAZIL_OFFSET}')) BETWEEN ? AND ?
      GROUP BY date(datetime(data, '${BRAZIL_OFFSET}'))
      ORDER BY date(datetime(data, '${BRAZIL_OFFSET}'))
      `,
    )
    .all(...params);

  const accountRows = await db
    .prepare(
      `
      SELECT date(datetime(data_cadastro, '${BRAZIL_OFFSET}')) AS date, COUNT(*) AS new_accounts
      FROM usuarios
      WHERE temporada_id = ? AND date(datetime(data_cadastro, '${BRAZIL_OFFSET}')) BETWEEN ? AND ?
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
