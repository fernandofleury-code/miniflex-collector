const state = {
  view: "home",
  user: null,
  admin: false,
  seasons: [],
  selectedSeasonId: null,
  dashboard: null,
  adminData: null,
  adminCollection: null,
  giftAnimals: [],
  refreshTimer: null,
  isRefreshingCollector: false,
  trafficRange: "today",
  trafficDate: "",
};

const AUTO_REFRESH_MS = 4000;
const VISITOR_KEY = "miniflex_visitor_id";

const animalIcons = {
  tubarao: "🦈",
  tubarão: "🦈",
  hipopotamo: "🦛",
  hipopótamo: "🦛",
  lontra: "🦦",
  polvo: "🐙",
  raposa: "🦊",
  crocodilo: "🐊",
  caranguejo: "🦀",
  elefante: "🐘",
  capivara: "🟤",
  tatu: "🛡️",
};

const animalImages = {
  tubarao: "/assets/animals/tubarao.webp",
  hipopotamo: "/assets/animals/hipopotamo.webp",
  lontra: "/assets/animals/lontra.webp",
  polvo: "/assets/animals/polvo.webp",
  raposa: "/assets/animals/raposa.webp",
  caranguejo: "/assets/animals/caranguejo.webp",
  elefante: "/assets/animals/elefante.webp",
  capivara: "/assets/animals/capivara.webp",
  tatu: "/assets/animals/tatu.webp",
};

const animalFacts = {
  tubarao:
    "O tubarão é uma espécie mais antiga que as árvores e sobreviveu a uma extinção em massa ocorrida no passado.",
  hipopotamo:
    "Os hipopótamos estão entre as espécies mais mortais da África, sendo até mais fatais que leões e crocodilos.",
  lontra:
    "As lontras são muito inteligentes; para se alimentar de moluscos de casca dura, usam uma pedra para quebrar o casco.",
  polvo:
    "Os polvos têm cerca de 500 milhões de neurônios, permitindo que cada tentáculo aja com bastante independência; quando perdem um tentáculo, conseguem regenerá-lo.",
  raposa:
    "As raposas são da mesma família dos lobos e cachorros, têm audição super sensível e usam a cauda para equilíbrio e aquecimento do corpo.",
  crocodilo:
    "Os crocodilos têm a mordida mais forte do mundo animal; além disso, seus dentes são renovados ao longo da vida.",
  caranguejo:
    "Os caranguejos possuem 10 patas, conseguem regenerar membros perdidos e têm visão periférica, deixando só os olhos para fora quando se enterram.",
  elefante:
    "Os elefantes têm uma memória fantástica para reconhecer lugares e animais; como não têm proteção natural contra sol e insetos, cobrem-se de terra e areia.",
  capivara:
    "As capivaras são os maiores roedores do mundo e ótimas nadadoras, com olhos, ouvidos e narinas no alto da cabeça.",
  tatu:
    "O tatu é o único mamífero com carapaça; algumas espécies se enrolam como defesa, e sua visão é fraca por passar muito tempo no subsolo.",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindNavigation();
  bindAuth();
  bindAdmin();
  bindAnimalDetails();
  bindAutoRefresh();
  bindGift();
  bindRevealAnimations();

  const session = await api("/api/auth/me");
  state.user = session.user;
  state.admin = session.admin;
  renderSessionState();

  await loadSeasons();
  if (state.user) await loadDashboard();
  await Promise.all([loadHome(), loadHall(), loadCollection()]);
  if (!state.user) await loadDashboard();
  if (state.admin) await loadAdmin();
  trackPageView(state.view);
}

function bindNavigation() {
  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-view-link]");
    if (!link) return;
    event.preventDefault();
    showView(link.dataset.viewLink);
  });

  $("#publicSeasonSelect").addEventListener("change", async (event) => {
    state.selectedSeasonId = Number(event.target.value);
    await Promise.all([loadHome(), loadHall(), loadCollection()]);
  });
}

function bindAnimalDetails() {
  $("#collectionGrid").addEventListener("click", (event) => {
    const card = event.target.closest("[data-animal-card]");
    if (!card) return;
    openAnimalDetails(card);
  });

  $("#animalDetailClose").addEventListener("click", () => closeAnimalDetails());
  $("#animalDetailDialog").addEventListener("click", (event) => {
    if (event.target.id === "animalDetailDialog") closeAnimalDetails();
  });
}

function bindGift() {
  const form = $("#giftForm");
  if (!form) return;

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-gift-scroll]");
    if (!button) return;
    event.preventDefault();
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = formJson(form);
    payload.surpresa = form.querySelector("[name='surpresa']").checked;

    try {
      await api("/api/public/gifts", {
        method: "POST",
        body: payload,
      });
      form.reset();
      toast("Pedido de presente enviado.");
    } catch (error) {
      toast(error.message, true);
    }
  });
}

function bindRevealAnimations() {
  const elements = $$(".reveal-on-scroll");
  if (!elements.length) return;

  if (!("IntersectionObserver" in window)) {
    elements.forEach((element) => element.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.16 },
  );

  elements.forEach((element) => observer.observe(element));
  window.requestAnimationFrame(refreshRevealAnimations);
}

function bindAuth() {
  $("#registerForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const response = await api("/api/auth/register", {
        method: "POST",
        body: formJson(event.currentTarget),
      });
      state.user = response.user;
      renderSessionState();
      toast("Conta criada. Boa coleção!");
      await loadDashboard();
      await Promise.all([loadHome(), loadHall(), loadCollection()]);
    } catch (error) {
      toast(error.message, true);
    }
  });

  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const response = await api("/api/auth/login", {
        method: "POST",
        body: formJson(event.currentTarget),
      });
      state.user = response.user;
      renderSessionState();
      toast("Bem-vindo de volta!");
      await loadDashboard();
      await loadCollection();
    } catch (error) {
      toast(error.message, true);
    }
  });

  document.addEventListener("click", async (event) => {
    const logoutButton = event.target.closest("[data-logout]");
    if (!logoutButton) return;
    event.preventDefault();
    await logout();
  });
}

function bindAutoRefresh() {
  window.addEventListener("focus", () => {
    refreshCollectorData();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshCollectorData();
  });
}

function bindAdmin() {
  $("#adminLoginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/admin/login", {
        method: "POST",
        body: formJson(event.currentTarget),
      });
      state.admin = true;
      renderSessionState();
      toast("Painel liberado.");
      await loadAdmin();
    } catch (error) {
      toast(error.message, true);
    }
  });

  $("#catalogForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await adminAction("/api/admin/catalogs", formJson(event.currentTarget), "Códigos salvos.");
  });

  $("#manualUserForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await adminAction("/api/admin/users", formJson(event.currentTarget), "Usuário criado.");
  });

  $("#purchaseForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formJson(event.currentTarget);
    await adminAction(
      `/api/admin/users/${data.usuario_id}/purchases`,
      { quantidade_pacotes: Number(data.quantidade_pacotes) },
      "Compra adicionada.",
    );
  });

  $("#editUserForm").addEventListener("change", (event) => {
    if (event.target.name === "usuario_id") fillEditUserForm(Number(event.target.value));
  });

  $("#editUserForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formJson(event.currentTarget);
    const payload = {
      nome: data.nome,
      quantidade_pacotes: Number(data.quantidade_pacotes),
      ignorar_fluxo: event.currentTarget.ignorar_fluxo.checked,
    };
    if (data.senha) payload.senha = data.senha;
    await adminAction(`/api/admin/users/${data.usuario_id}`, payload, "Usuário atualizado.", "PATCH");
  });

  $("#animalUserSelect").addEventListener("change", () => loadAdminCollection());

  $("#saveAnimalsButton").addEventListener("click", async () => {
    const userId = Number($("#animalUserSelect").value);
    const animals = $$(".animal-admin-row").map((row) => ({
      animal_id: Number(row.dataset.animalId),
      possui: row.querySelector("[data-kind='possui']").checked,
      gold: row.querySelector("[data-kind='gold']").checked,
      bicolor: row.querySelector("[data-kind='bicolor']").checked,
    }));
    await adminAction(`/api/admin/users/${userId}/animals`, { animals }, "Progresso atualizado.");
    await loadAdminCollection();
    await Promise.all([loadHome(), loadHall(), loadCollection(), loadDashboard()]);
  });

  $("#seasonForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await adminAction("/api/admin/seasons", formJson(event.currentTarget), "Temporada criada.");
    await loadSeasons();
  });

  $("#activateSeasonButton").addEventListener("click", async (event) => {
    event.preventDefault();
    const seasonId = Number($("#activateSeasonSelect").value);
    await adminAction(`/api/admin/seasons/${seasonId}/activate`, {}, "Temporada ativada.");
    await loadSeasons();
  });

  document.addEventListener("click", async (event) => {
    const exportButton = event.target.closest("[data-export]");
    if (!exportButton) return;
    event.preventDefault();
    await downloadCsv(exportButton.dataset.export);
  });

  $("#importCatalogsButton").addEventListener("click", async (event) => {
    event.preventDefault();
    await adminAction(
      "/api/admin/import/catalogs",
      { csv: $("#catalogImport").value },
      "Catálogos importados.",
    );
  });

  $("#importUsersButton").addEventListener("click", async (event) => {
    event.preventDefault();
    await adminAction(
      "/api/admin/import/users",
      { csv: $("#userImport").value },
      "Usuários importados.",
    );
  });

  $("#trafficRange").addEventListener("change", async (event) => {
    state.trafficRange = event.target.value;
    if (state.admin) await loadAdmin();
  });

  $("#trafficDate").addEventListener("change", async (event) => {
    state.trafficDate = event.target.value;
    if (state.trafficRange === "date" && state.admin) await loadAdmin();
  });

  $("#ignoreDeviceButton").addEventListener("click", async (event) => {
    event.preventDefault();
    await adminAction(
      "/api/admin/ignore-current-visitor",
      {},
      "Este dispositivo não entra mais no fluxo.",
    );
  });
}

function showView(view) {
  state.view = view;
  $$(".view").forEach((section) => section.classList.toggle("is-visible", section.id === `view-${view}`));
  $$(".nav-link").forEach((link) => link.classList.toggle("is-active", link.dataset.viewLink === view));
  trackPageView(view);
  window.requestAnimationFrame(refreshRevealAnimations);

  if (view === "dashboard") loadDashboard();
  if (view === "admin" && state.admin) loadAdmin();
}

function refreshRevealAnimations() {
  $$(".view.is-visible .reveal-on-scroll").forEach((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.top < window.innerHeight - 40) element.classList.add("is-visible");
  });
}

async function loadSeasons() {
  const response = await api("/api/public/seasons");
  state.seasons = response.seasons;
  const active = response.seasons.find((season) => season.ativa) || response.seasons[0];
  state.selectedSeasonId ||= active?.id;
  renderSeasonSelect($("#publicSeasonSelect"), state.selectedSeasonId);
}

async function loadHome() {
  const data = await api(`/api/public/summary?season_id=${state.selectedSeasonId}`);
  const metrics = [
    ["📦", "Pacotes vendidos", data.pacotes_vendidos],
    ["👥", "Colecionadores", data.colecionadores],
    ["⭐", "Gold encontrados", data.gold],
    ["🎨", "Bicolor encontrados", data.bicolor],
    ["🏆", "Primeiro a completar", data.firstCompleter ? 1 : 0],
    ["🥇", "Maior comprador", data.topBuyer ? data.topBuyer.quantidade_pacotes : 0],
  ];

  $("#homeMetrics").innerHTML = metrics
    .map(
      ([icon, label, value]) => `
        <article class="metric-card">
          <span>${icon}</span>
          <strong>${value}</strong>
          <p>${label}</p>
        </article>
      `,
    )
    .join("");

  $("#firstCompleter").textContent = data.firstCompleter?.nome || "Ainda ninguém";
  $("#topBuyer").textContent = data.topBuyer
    ? `${data.topBuyer.nome} (${data.topBuyer.quantidade_pacotes})`
    : "Ainda ninguém";
}

async function loadDashboard() {
  if (!state.user) {
    $("#authPanel").classList.remove("hidden");
    $("#collectorPanel").classList.add("hidden");
    renderSessionState();
    return;
  }

  try {
    const data = await api("/api/auth/dashboard");
    state.dashboard = data;
    $("#authPanel").classList.add("hidden");
    $("#collectorPanel").classList.remove("hidden");
    renderDashboard(data);
  } catch {
    state.user = null;
    $("#authPanel").classList.remove("hidden");
    $("#collectorPanel").classList.add("hidden");
    renderSessionState();
  }
}

async function logout() {
  await api("/api/auth/logout", { method: "POST", body: {} });
  state.user = null;
  state.admin = false;
  state.dashboard = null;
  state.adminData = null;
  state.adminCollection = null;
  $("#adminPanel").classList.add("hidden");
  $("#adminLoginForm").classList.remove("hidden");
  renderSessionState();
  await loadDashboard();
  await loadCollection();
  toast("Você saiu da conta.");
}

function renderSessionState() {
  $$(".nav-logout").forEach((button) => {
    button.classList.toggle("hidden", !state.user && !state.admin);
  });

  if (state.user && !state.refreshTimer) {
    state.refreshTimer = window.setInterval(refreshCollectorData, AUTO_REFRESH_MS);
  }

  if (!state.user && state.refreshTimer) {
    window.clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
}

async function refreshCollectorData() {
  if (!state.user || state.isRefreshingCollector) return;

  state.isRefreshingCollector = true;
  try {
    await loadDashboard();
    await loadCollection();
  } finally {
    state.isRefreshingCollector = false;
  }
}

function renderDashboard(data) {
  $("#avatar").textContent = initials(data.profile.nome);
  $("#profileName").textContent = data.profile.nome;
  $("#packageCount").textContent = data.profile.quantidade_pacotes;
  $("#progressText").textContent = `${data.owned} / ${data.total} animais`;
  $("#statusText").textContent = data.profile.colecao_completa
    ? "Coleção completa"
    : "Coleção em andamento";
  $("#progressFill").style.width = `${data.progress}%`;
  $("#achievementList").innerHTML = data.achievements.length
    ? data.achievements.map((item) => `<span class="badge">${item.nome_conquista}</span>`).join("")
    : `<span class="badge">Sem conquistas ainda</span>`;
}

async function loadCollection() {
  const data = await api(`/api/public/collection?season_id=${state.selectedSeasonId}`);
  state.giftAnimals = data.animals;
  renderGiftAnimalOptions(data.animals);
  const hasSeasonDashboard = state.dashboard?.profile?.temporada_id === state.selectedSeasonId;
  const userAnimals = hasSeasonDashboard
    ? new Map(state.dashboard.animals.map((animal) => [animal.id, animal]))
    : new Map();

  renderCollectionProgress({
    owned: hasSeasonDashboard ? state.dashboard.owned : 0,
    total: hasSeasonDashboard ? state.dashboard.total : data.animals.length,
    progress: hasSeasonDashboard ? state.dashboard.progress : 0,
    hasProgress: hasSeasonDashboard,
  });

  $("#collectionGrid").innerHTML = data.animals
    .flatMap((animal) => {
      const userAnimal = userAnimals.get(animal.id);
      const cards = [animalCard(animal, Boolean(userAnimal?.possui))];
      if (userAnimal?.gold) cards.push(variantAnimalCard(animal, "gold"));
      if (userAnimal?.bicolor) cards.push(variantAnimalCard(animal, "bicolor"));
      return cards;
    })
    .join("");
}

function renderGiftAnimalOptions(animals = state.giftAnimals) {
  const select = $("#giftAnimalSelect");
  if (!select) return;

  const currentValue = select.value;
  select.innerHTML = [
    '<option value="">Escolha um animal</option>',
    ...animals.map((animal) => {
      const label = `${animal.numero} ${animal.nome}`;
      return `<option value="${escapeHtml(label)}">${escapeHtml(label)}</option>`;
    }),
  ].join("");
  if (currentValue) select.value = currentValue;
}

function renderCollectionProgress({ owned, total, progress, hasProgress }) {
  $("#collectionProgressText").textContent = `${owned} / ${total} animais`;
  $("#collectionProgressStatus").textContent = hasProgress
    ? progress >= 100
      ? "Coleção completa"
      : "Coleção em andamento"
    : "Entre para acompanhar sua coleção";
  $("#collectionProgressFill").style.width = `${Math.max(0, Math.min(100, Number(progress) || 0))}%`;
}

async function loadHall() {
  const data = await api(`/api/public/hall?season_id=${state.selectedSeasonId}`);
  $("#hallGrid").innerHTML = [
    hallFeature("🥇", "Primeiro comprador", data.firstBuyer?.nome || "Ainda ninguém", "Abriu a temporada"),
    hallFeature("👑", "Primeiro a completar", data.firstCompleter?.nome || "Ainda ninguém", "Completou os 10 animais"),
    hallRanking("🏆", "Top 10 compradores", data.topBuyers, "is-wide"),
    hallRanking("⭐", "Top 10 Gold", data.topGold),
    hallRanking("🎨", "Top 10 Bicolor", data.topBicolor),
  ].join("");
}

async function loadAdmin() {
  $("#adminLoginForm").classList.add("hidden");
  $("#adminPanel").classList.remove("hidden");
  const params = new URLSearchParams({
    season_id: state.selectedSeasonId,
    traffic_range: state.trafficRange,
  });
  if (state.trafficDate) params.set("traffic_date", state.trafficDate);
  const data = await api(`/api/admin/overview?${params}`);
  state.adminData = data;
  renderAdmin(data);
  await loadAdminCollection();
}

function renderAdmin(data) {
  $("#adminSummary").innerHTML = [
    ["📦", "Pacotes", data.totals.pacotes_vendidos],
    ["👥", "Colecionadores", data.totals.colecionadores],
    ["⭐", "Gold", data.totals.gold],
    ["🎨", "Bicolor", data.totals.bicolor],
  ]
    .map(
      ([icon, label, value]) => `
      <article class="metric-card">
        <span>${icon}</span><strong>${value}</strong><p>${label}</p>
      </article>
    `,
    )
    .join("");

  $$("[data-admin-users]").forEach((select) => {
    const current = select.value;
    select.innerHTML = data.users
      .map((user) => `<option value="${user.id}">${escapeHtml(user.nome)}</option>`)
      .join("");
    if (current) select.value = current;
  });

  $$("[data-admin-seasons]").forEach((select) => {
    renderSeasonSelect(select, data.selectedSeasonId);
  });
  renderSeasonSelect($("#activateSeasonSelect"), data.activeSeason.id);

  fillEditUserForm(Number($("#editUserForm [name='usuario_id']").value));
  drawBarChart("packagesChart", data.charts.packages, "#1168d8");
  drawBarChart("collectorsChart", data.charts.weekUsers, "#c89213");
  drawRarityChart("rarityChart", data.charts.rarity);
  drawBarChart("buyersChart", data.charts.buyers, "#0aa6c2");
  renderTraffic(data.traffic);
  renderGiftRequests(data.giftRequests || []);
}

function renderTraffic(traffic) {
  state.trafficRange = traffic.period.range;
  if (traffic.period.range === "date") state.trafficDate = traffic.period.start;

  $("#trafficRange").value = state.trafficRange;
  $("#trafficDate").value = state.trafficDate || traffic.period.start;
  $("#trafficDate").disabled = state.trafficRange !== "date";

  $("#trafficSummary").innerHTML = [
    ["👁", "Visitas", traffic.summary.pageViews],
    ["👥", "Visitantes", traffic.summary.uniqueVisitors],
    ["🔐", "Logins", traffic.summary.logins],
    ["✅", "Novas contas", traffic.summary.newAccounts],
    ["📦", "Pacotes", traffic.summary.packages],
    ["⭐", "Gold", traffic.summary.goldRegistered],
    ["🎨", "Bicolor", traffic.summary.bicolorRegistered],
  ]
    .map(
      ([icon, label, value]) => `
      <article class="metric-card">
        <span>${icon}</span><strong>${value}</strong><p>${label}</p>
      </article>
    `,
    )
    .join("");

  drawBarChart(
    "trafficChart",
    traffic.daily.map((row) => ({ label: row.label, value: row.page_views })),
    "#1168d8",
  );
}

function renderGiftRequests(requests) {
  const list = $("#giftRequestList");
  if (!list) return;

  if (!requests.length) {
    list.innerHTML = `<div class="empty-ranking">Nenhum pedido de presente ainda.</div>`;
    return;
  }

  list.innerHTML = requests
    .map(
      (request) => `
        <article class="gift-admin-item">
          <div>
            <strong>${escapeHtml(request.destinatario)}</strong>
            <p>${escapeHtml(request.animal)} • ${escapeHtml(request.turma)}</p>
            ${request.mensagem ? `<small>${escapeHtml(request.mensagem)}</small>` : ""}
          </div>
          <div class="gift-admin-meta">
            <span class="badge">${request.surpresa ? "Surpresa" : "Entrega normal"}</span>
            <small>${formatDateTime(request.data)}</small>
          </div>
        </article>
      `,
    )
    .join("");
}

async function loadAdminCollection() {
  if (!state.admin || !state.adminData?.users.length) {
    $("#animalAdminList").innerHTML = "<p>Nenhum usuário nesta temporada.</p>";
    return;
  }

  const userId = Number($("#animalUserSelect").value || state.adminData.users[0].id);
  const data = await api(`/api/admin/users/${userId}/collection`);
  state.adminCollection = data;

  $("#animalAdminList").innerHTML = data.animals
    .map(
      (animal) => `
      <div class="animal-admin-row" data-animal-id="${animal.id}">
        <strong>${animal.numero} ${escapeHtml(animal.nome)}</strong>
        <label><input type="checkbox" data-kind="possui" ${animal.possui ? "checked" : ""}/> Normal</label>
        <label><input type="checkbox" data-kind="gold" ${animal.gold ? "checked" : ""}/> Gold</label>
        <label><input type="checkbox" data-kind="bicolor" ${animal.bicolor ? "checked" : ""}/> Bicolor</label>
      </div>
    `,
    )
    .join("");
}

async function adminAction(path, body, message, method = "POST") {
  try {
    await api(path, { method, body });
    toast(message);
    await loadAdmin();
    await Promise.all([loadHome(), loadHall(), loadCollection()]);
  } catch (error) {
    toast(error.message, true);
  }
}

async function downloadCsv(entity) {
  try {
    const response = await fetch(`/api/admin/export/${entity}`);
    if (!response.ok) throw new Error("Não foi possível exportar.");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `miniflex-${entity}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    toast(error.message, true);
  }
}

function renderSeasonSelect(select, selectedId) {
  select.innerHTML = state.seasons
    .map(
      (season) => `
      <option value="${season.id}" ${season.id === selectedId ? "selected" : ""}>
        ${escapeHtml(season.nome)}${season.ativa ? " • ativa" : ""}
      </option>
    `,
    )
    .join("");
}

function fillEditUserForm(userId) {
  const form = $("#editUserForm");
  const user = state.adminData?.users.find((item) => item.id === userId);
  if (!user) return;
  form.nome.value = user.nome;
  form.quantidade_pacotes.value = user.quantidade_pacotes;
  form.senha.value = "";
  form.ignorar_fluxo.checked = Boolean(user.ignorar_fluxo);
}

function animalCard(animal, owned) {
  const key = animalKey(animal.nome);
  const variant = owned ? "normal" : "locked";
  return `
    <button
      class="animal-card ${owned ? "" : "is-locked"}"
      type="button"
      data-animal-card
      data-variant="${variant}"
      data-animal-key="${key}"
      data-animal-number="${animal.numero}"
      data-animal-name="${escapeHtml(animal.nome)}"
    >
      <span class="animal-number">${animal.numero}</span>
      <div class="animal-figure">${animalVisualMarkup(key, animal.nome)}</div>
      <h3>${escapeHtml(animal.nome)}</h3>
      <div class="badge-list">
        ${owned ? '<span class="badge">Normal</span>' : '<span class="badge ownership-badge is-missing">Não possuído</span>'}
      </div>
    </button>
  `;
}

function variantAnimalCard(animal, variant) {
  const key = animalKey(animal.nome);
  const label = variant === "gold" ? "Gold" : "Bicolor";
  return `
    <button
      class="animal-card animal-variant is-${variant}"
      type="button"
      data-animal-card
      data-variant="${variant}"
      data-animal-key="${key}"
      data-animal-number="${animal.numero}"
      data-animal-name="${escapeHtml(animal.nome)}"
    >
      <span class="animal-number">${animal.numero}</span>
      <div class="animal-figure">${animalVisualMarkup(key, animal.nome)}</div>
      <h3>${escapeHtml(animal.nome)}</h3>
      <div class="badge-list">
        <span class="badge">${label}</span>
      </div>
    </button>
  `;
}

function openAnimalDetails(card) {
  const variant = card.dataset.variant || "normal";
  const key = card.dataset.animalKey || "";
  const variantLabels = {
    normal: "Normal",
    locked: "Não possuído",
    gold: "Gold",
    bicolor: "Bicolor",
  };
  const detailCard = $("#animalDetailCard");
  const animalName = card.dataset.animalName || "Animal";
  detailCard.className = `animal-detail-card is-${variant}`;

  $("#animalDetailVariant").textContent = variantLabels[variant] || "Normal";
  $("#animalDetailFigure").innerHTML = animalVisualMarkup(key, animalName);
  $("#animalDetailNumber").textContent = card.dataset.animalNumber || "";
  $("#animalDetailTitle").textContent = animalName;
  $("#animalDetailFact").textContent = animalFacts[key] || "Curiosidade em breve.";

  const dialog = $("#animalDetailDialog");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeAnimalDetails() {
  const dialog = $("#animalDetailDialog");
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function animalKey(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function animalVisualMarkup(key, name) {
  const src = animalImages[key];
  if (src) {
    return `<img src="${src}" alt="MiniFlex ${escapeHtml(name)}" loading="lazy" />`;
  }

  return `
    <span>${animalIcons[key] || "◆"}</span>
    <small>Imagem em breve</small>
  `;
}

function hallFeature(icon, title, value, subtitle) {
  return `
    <article class="hall-card hall-feature">
      <span class="hall-feature-icon">${icon}</span>
      <div>
        <p>${escapeHtml(subtitle)}</p>
        <h3>${escapeHtml(title)}</h3>
        <strong>${escapeHtml(value)}</strong>
      </div>
    </article>
  `;
}

function hallRanking(icon, title, rows, extraClass = "") {
  return `
    <article class="hall-card hall-ranking ${extraClass}">
      <div class="hall-ranking-heading">
        <span>${icon}</span>
        <h3>${escapeHtml(title)}</h3>
      </div>
      ${
        rows.length
          ? `
            <table class="hall-ranking-table">
              <thead>
                <tr>
                  <th>Pos.</th>
                  <th>Colecionador</th>
                  <th>Pacotes</th>
                  <th>Gold</th>
                  <th>Bicolor</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map((row) => hallRankingRow(row)).join("")}
              </tbody>
            </table>
          `
          : `<div class="empty-ranking">Aguardando registros.</div>`
      }
    </article>
  `;
}

function hallRankingRow(row) {
  return `
    <tr>
      <td><span class="rank-position">${medal(row.posicao)} ${row.posicao}</span></td>
      <td class="rank-name">${escapeHtml(row.nome)}</td>
      <td class="rank-score">${row.pacotes}</td>
      <td class="rank-score">${row.gold}</td>
      <td class="rank-score">${row.bicolor}</td>
    </tr>
  `;
}

function drawBarChart(canvasId, rows = [], color = "#1168d8") {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f6f9fd";
  ctx.fillRect(0, 0, width, height);

  if (!rows.length) {
    drawEmpty(ctx, width, height);
    return;
  }

  const max = Math.max(...rows.map((row) => Number(row.value) || 0), 1);
  const gap = 12;
  const barWidth = Math.max(18, (width - gap * (rows.length + 1)) / rows.length);

  rows.forEach((row, index) => {
    const value = Number(row.value) || 0;
    const barHeight = Math.round((height - 58) * (value / max));
    const x = gap + index * (barWidth + gap);
    const y = height - barHeight - 32;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, barWidth, barHeight);
    ctx.fillStyle = "#142033";
    ctx.font = "12px sans-serif";
    ctx.fillText(String(value), x, y - 6);
    ctx.fillText(String(row.label).slice(0, 8), x, height - 12);
  });
}

function drawRarityChart(canvasId, rarity) {
  drawBarChart(
    canvasId,
    [
      { label: "Gold", value: rarity.gold },
      { label: "Bicolor", value: rarity.bicolor },
    ],
    "#c89213",
  );
}

function drawEmpty(ctx, width, height) {
  ctx.fillStyle = "#617089";
  ctx.font = "16px sans-serif";
  ctx.fillText("Sem dados ainda", width / 2 - 58, height / 2);
}

function formJson(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") data[key] = value.trim();
  }
  return data;
}

async function api(path, options = {}) {
  const fetchOptions = {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "X-MiniFlex-Visitor-Id": getVisitorId(),
    },
  };

  if (options.body !== undefined) fetchOptions.body = JSON.stringify(options.body);

  const response = await fetch(path, fetchOptions);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) throw new Error(data.error || "Não foi possível concluir a ação.");
  return data;
}

function trackPageView(view) {
  api("/api/public/track", {
    method: "POST",
    body: {
      view,
      path: window.location.pathname + window.location.hash,
    },
  }).catch(() => {});
}

function getVisitorId() {
  let visitorId = localStorage.getItem(VISITOR_KEY);
  if (!visitorId) {
    visitorId = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(VISITOR_KEY, visitorId);
  }
  return visitorId;
}

function medal(position) {
  return position === 1 ? "🥇" : position === 2 ? "🥈" : position === 3 ? "🥉" : "🏅";
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(`${value}Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function initials(name = "MF") {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

let toastTimer;
function toast(message, danger = false) {
  const element = $("#toast");
  element.textContent = message;
  element.style.background = danger ? "var(--danger)" : "var(--blue-950)";
  element.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("is-visible"), 3200);
}
