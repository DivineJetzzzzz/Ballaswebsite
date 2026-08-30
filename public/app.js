const $ = (selector) => document.querySelector(selector);

let currentUser = null;
let users = [];
let materials = [];
let recipes = [];
let orders = [];
let chestItems = [];
let chestLogs = [];
let residentsChestItems = [];
let residentsChestLogs = [];
let officialsChestItems = [];
let officialsChestLogs = [];
let ordersChestItems = [];
let ordersChestLogs = [];

let editingRecipeId = null;
let orderQuantities = new Map();
let ammunationItems = [];
let ammunationQuantities = new Map();
let chestTarget = null;
let chestAction = null;
let residentsChestTarget = null;
let residentsChestAction = null;
let officialsChestTarget = null;
let officialsChestAction = null;
let ordersChestTarget = null;
let ordersChestAction = null;
let chestTransferTarget = null;
let resetPasswordTarget = null;
let auditLogs = [];
let publicOrders = [];
let publicOrderDetailId = null;

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  if (response.status === 204) return null;

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Ocorreu um erro inesperado.');
  }

  return data;
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };

    return entities[character];
  });
}

function formatMoney(value) {
  return `${new Intl.NumberFormat('pt-PT').format(Number(value) || 0)} $`;
}

function formatDate(value) {
  if (!value) return '—';

  const normalised = String(value).includes('T')
    ? String(value)
    : `${String(value).replace(' ', 'T')}Z`;

  const date = new Date(normalised);

  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('pt-PT', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC'
  }).format(date);
}

function statusLabel(status) {
  const labels = {
    pending: 'Pendente',
    in_progress: 'Em curso',
    completed: 'Concluída',
    cancelled: 'Cancelada'
  };

  return labels[status] || status;
}

function paymentLabel(method) {
  const labels = {
    materials: 'Materiais',
    clean: 'Dinheiro limpo',
    dirty: 'Dinheiro sujo'
  };

  return labels[method] || method;
}

function paymentPreferencesLabel(methods) {
  const list = Array.isArray(methods) ? methods : [methods];

  return list.length
    ? list.map((method) => paymentLabel(method)).join(' + ')
    : '—';
}

function isAdmin() {
  return currentUser?.role === 'admin';
}

function isOfficials() {
  return currentUser?.role === 'officials';
}

function isResidentChief() {
  return currentUser?.role === 'resident_chief';
}

function isAdminOrOfficials() {
  return currentUser?.role === 'admin' || currentUser?.role === 'officials';
}

function isAdminOrResidentChief() {
  return currentUser?.role === 'admin' || currentUser?.role === 'resident_chief';
}

function canViewOrders() {
  return ['admin', 'officials', 'resident_chief', 'user'].includes(currentUser?.role);
}

// Espelha a configuração de baús do servidor, para construir o diálogo de
// transferência e decidir para que baús o utilizador tem permissões.
const CHEST_CONFIG = {
  chest: { label: 'Baú 113', canAccess: () => isAdmin() },
  residents: { label: 'Baú de Moradores', canAccess: () => isAdminOrResidentChief() },
  officials: { label: 'Baú de Oficiais', canAccess: () => isAdminOrOfficials() },
  orders: { label: 'Baú de Encomendas', canAccess: () => isAdmin() }
};

function getChestItemsByKey(chestKey) {
  switch (chestKey) {
    case 'chest': return chestItems;
    case 'residents': return residentsChestItems;
    case 'officials': return officialsChestItems;
    case 'orders': return ordersChestItems;
    default: return [];
  }
}

function getChestLoaderByKey(chestKey) {
  switch (chestKey) {
    case 'chest': return loadChest;
    case 'residents': return loadResidentsChest;
    case 'officials': return loadOfficials;
    case 'orders': return loadOrdersChest;
    default: return async () => {};
  }
}

function populateOrderSelect(selector) {
  const select = $(selector);

  if (!select) return;

  select.innerHTML = [
    '<option value="">Nenhuma</option>',
    ...orders.map((order) => `
      <option value="${order.id}">#${order.id} — ${escapeHTML(order.title)} (${statusLabel(order.status)})</option>
    `)
  ].join('');
}

function getRoleLabel(role = currentUser?.role) {
  if (role === 'admin') return 'Administrador';
  if (role === 'officials') return 'Oficial';
  if (role === 'resident_chief') return 'Chefe de Moradores';
  if (role === 'user') return 'Utilizador';
  return 'Utilizador';
}

function setAdminVisibility() {
  document.querySelectorAll('.admin-only').forEach((element) => {
    element.classList.toggle('hidden', !isAdmin());
  });

  document.querySelectorAll('.admin-or-officials').forEach((element) => {
    element.classList.toggle('hidden', !isAdminOrOfficials());
  });

  document.querySelectorAll('.admin-or-resident-chief').forEach((element) => {
    element.classList.toggle('hidden', !isAdminOrResidentChief());
  });

  document.querySelectorAll('.orders-viewer').forEach((element) => {
    element.classList.toggle('hidden', !canViewOrders());
  });
}

function showPage(name) {
  const meta = {
    dashboard: ['Visão geral', 'Resumo do teu painel privado.'],
    chest: ['Baú 113', 'Stock da organização.'],
    residentsChest: ['Baú Moradores', 'Stock do baú dos moradores.'],
    officialsChest: ['Baú Oficiais', 'Stock do baú dos oficiais.'],
    ordersChest: ['Baú Encomendas', 'Stock do baú de encomendas. Acesso exclusivo a administradores.'],
    orders: ['Encomendas', 'Cria pedidos e acompanha o seu estado.'],
    ammunationOrders: ['Encomendas Ammunation', 'Encomendas pagas a dinheiro, limpo ou sujo.'],
    publicOrders: ['Pedidos Públicos', 'Pedidos recebidos em /encomendar, sem necessidade de conta.'],
    recipes: ['Receitas', 'Configura itens, materiais e custos.'],
    users: ['Utilizadores', 'Gestão de acessos e permissões.'],
    auditLogs: ['Registo de atividade', 'Histórico de ações realizadas no sistema.']
  };

  const safeName = meta[name] ? name : 'dashboard';

  ['dashboard', 'chest', 'residentsChest', 'officialsChest', 'ordersChest', 'orders', 'ammunationOrders', 'publicOrders', 'recipes', 'users', 'auditLogs'].forEach((page) => {
    $(`#${page}Page`)?.classList.toggle('hidden', page !== safeName);
  });

  document.querySelectorAll('.nav').forEach((button) => {
    button.classList.toggle('active', button.dataset.page === safeName);
  });

  $('#pageTitle').textContent = meta[safeName][0];
  $('#pageSubtitle').textContent = meta[safeName][1];
}

function renderStats() {
  $('#totalUsers').textContent = users.length;
  $('#activeUsers').textContent = users.filter((user) => user.active).length;
  $('#adminUsers').textContent = users.filter((user) => user.role === 'admin').length;
}

function renderDashboard() {
  const titleElement = $('#dashboardWelcomeTitle');
  const messageElement = $('#dashboardMessage');

  if (titleElement && currentUser) {
    titleElement.textContent = `Olá, ${currentUser.username}`;
  }

  if (messageElement && currentUser) {
    const messages = {
      admin: 'Tens acesso total: gere utilizadores, receitas, baús e encomendas no menu ao lado.',
      officials: 'Consulta e acompanha as encomendas e o stock do Baú de Oficiais no menu ao lado.',
      resident_chief: 'Consulta as encomendas e gere o Baú de Moradores no menu ao lado.',
      user: 'A tua função é Utilizador. Consulta as encomendas disponíveis no menu ao lado.'
    };

    messageElement.textContent = messages[currentUser.role]
      || 'Usa o menu para gerir os módulos disponíveis na tua função.';
  }

  const pendingCount = orders.filter((order) => order.status === 'pending').length;
  const myCount = orders.filter((order) => order.createdBy === currentUser?.id).length;

  if ($('#pendingOrdersCount')) $('#pendingOrdersCount').textContent = pendingCount;
  if ($('#myOrdersCount')) $('#myOrdersCount').textContent = myCount;
}

function renderUsers() {
  const table = $('#usersTable');

  if (!table) return;

  table.innerHTML = users.length
    ? users.map((user, index) => {
      const self = user.id === currentUser?.id;
      const roleLabel = getRoleLabel(user.role);

      return `
        <tr class="fade-in-row" style="--fade-index: ${index}">
          <td class="username">${escapeHTML(user.username)}${self ? ' <small>(tu)</small>' : ''}</td>
          <td><span class="badge ${user.role}">${roleLabel}</span></td>
          <td><span class="badge ${user.active ? 'active' : 'blocked'}">${user.active ? 'Ativo' : 'Bloqueado'}</span></td>
          <td>${formatDate(user.createdAt)}</td>
          <td>
            <div class="actions">
              ${!self ? `
                <button
                  class="btn secondary mini"
                  type="button"
                  data-user-status="${user.id}"
                  data-user-active="${user.active ? 'false' : 'true'}"
                >
                  ${user.active ? 'Bloquear' : 'Reativar'}
                </button>
                <button class="btn secondary mini" type="button" data-user-reset-password="${user.id}" data-user-reset-username="${escapeHTML(user.username)}">
                  Repor password
                </button>
                <button class="btn danger mini" type="button" data-user-delete="${user.id}">
                  Apagar
                </button>
              ` : '—'}
            </div>
          </td>
        </tr>
      `;
    }).join('')
    : '<tr><td colspan="5">Ainda não existem utilizadores.</td></tr>';
}

function materialOptions(selectedId = '') {
  return [
    '<option value="">Seleciona...</option>',
    ...materials
      .filter((material) => material.active)
      .map((material) => `
        <option value="${material.id}" ${Number(selectedId) === material.id ? 'selected' : ''}>
          ${escapeHTML(material.name)}
        </option>
      `)
  ].join('');
}

function ingredientRow(materialId = '', quantity = 1, mode = 'create') {
  const materialClass = mode === 'edit'
    ? 'edit-ingredient-material'
    : 'recipe-ingredient-material';

  const quantityClass = mode === 'edit'
    ? 'edit-ingredient-quantity'
    : 'recipe-ingredient-quantity';

  const removeClass = mode === 'edit'
    ? 'remove-edit-ingredient'
    : 'remove-recipe-ingredient';

  return `
    <div class="ingredient-row">
      <label class="field">
        Material
        <select class="${materialClass}" required>
          ${materialOptions(materialId)}
        </select>
      </label>

      <label class="field">
        Quantidade
        <input class="${quantityClass}" type="number" min="1" max="100000" step="1" value="${Number(quantity) || 1}" required>
      </label>

      <button class="btn danger mini ${removeClass}" type="button">Remover</button>
    </div>
  `;
}

function toggleRecipeMaterialsSection(category, sectionId, hintId, editorId) {
  const isAmmunation = category === 'Ammunation';

  $(sectionId).classList.toggle('hidden', isAmmunation);
  $(hintId).classList.toggle('hidden', !isAmmunation);

  $(editorId).querySelectorAll('select, input').forEach((field) => {
    field.required = !isAmmunation;
  });
}

function renderMaterials() {
  const list = $('#materialsList');

  if (!list) return;

  list.innerHTML = materials.length
    ? materials.map((material) => `
      <div class="material-chip">
        <strong>${escapeHTML(material.name)}</strong>
        <span class="badge ${material.active ? 'active' : 'blocked'}">
          ${material.active ? 'Ativo' : 'Desativado'}
        </span>
        ${isAdmin() ? `
          <button
            class="btn secondary mini"
            type="button"
            data-material-status="${material.id}"
            data-material-active="${material.active ? 'false' : 'true'}"
          >
            ${material.active ? 'Desativar' : 'Ativar'}
          </button>
        ` : ''}
      </div>
    `).join('')
    : '<p>Ainda não existem materiais. Cria o primeiro acima.</p>';
}

function renderRecipes() {
  const table = $('#recipesTable');

  if (!table) return;

  table.innerHTML = recipes.length
    ? recipes.map((recipe) => {
      const materialsText = recipe.materials.length
        ? recipe.materials.map((material) => `
          <span>${escapeHTML(material.name)} × ${material.quantity}</span>
        `).join('')
        : '<span>Sem materiais</span>';

      const prices = recipe.category === 'Ammunation'
        ? `
          <div>${formatMoney(recipe.unitPrice)} <small>(base)</small></div>
          <small>Limpo: ${formatMoney(recipe.cleanPrice)} · Sujo: ${formatMoney(recipe.dirtyPrice)}</small>
        `
        : formatMoney(recipe.unitPrice);

      return `
        <tr>
          <td class="username">${escapeHTML(recipe.name)}</td>
          <td>${escapeHTML(recipe.category)}</td>
          <td>${prices}</td>
          <td><div class="recipe-materials">${materialsText}</div></td>
          <td><span class="badge ${recipe.active ? 'active' : 'blocked'}">${recipe.active ? 'Ativa' : 'Desativada'}</span></td>
          <td class="admin-only">
            ${isAdmin() ? `
              <div class="actions">
                <button class="btn secondary mini" type="button" data-recipe-edit="${recipe.id}">Editar</button>
                ${recipe.category === 'Ammunation' ? `
                  <button class="btn secondary mini" type="button" data-ammunation-prices="${recipe.id}">Preços</button>
                ` : ''}
                <button
                  class="btn secondary mini"
                  type="button"
                  data-recipe-status="${recipe.id}"
                  data-recipe-active="${recipe.active ? 'false' : 'true'}"
                >
                  ${recipe.active ? 'Desativar' : 'Ativar'}
                </button>
                <button class="btn danger mini" type="button" data-recipe-delete="${recipe.id}">Apagar</button>
              </div>
            ` : '—'}
          </td>
        </tr>
      `;
    }).join('')
    : '<tr><td colspan="6">Ainda não existem receitas nesta categoria.</td></tr>';
}

function renderChest() {
  const table = $('#chestTable');
  const logsTable = $('#chestLogsTable');

  if (table) {
    table.innerHTML = chestItems.length
      ? chestItems.map((item, index) => `
        <div class="chest-card fade-in-row" style="--fade-index: ${index}">
          <div class="chest-card-head">
            <span class="chest-card-name">${escapeHTML(item.name)}</span>
          </div>
          <span class="chest-card-quantity">${item.quantity}</span>
          <span class="chest-card-updated">Atualizado: ${formatDate(item.updatedAt)}</span>
          ${isAdmin() ? `
            <div class="chest-card-actions admin-only">
              <button class="btn secondary mini" type="button" data-chest-add="${item.id}">+ Entrada</button>
              <button class="btn secondary mini" type="button" data-chest-remove="${item.id}">− Saída</button>
              <button class="btn secondary mini" type="button" data-chest-transfer="${item.id}">⇄ Transferir</button>
              <button class="btn danger mini" type="button" data-chest-delete="${item.id}">Apagar</button>
            </div>
          ` : ''}
        </div>
      `).join('')
      : '<div class="chest-grid-empty">O Baú 113 ainda não tem itens.</div>';
  }

  if (logsTable) {
    const labels = {
      add: 'Entrada',
      remove: 'Saída',
      create: 'Criado',
      delete: 'Apagado',
      transfer_in: 'Transferência (entrada)',
      transfer_out: 'Transferência (saída)'
    };

    logsTable.innerHTML = chestLogs.length
      ? chestLogs.map((log) => `
        <tr>
          <td class="chest-${escapeHTML(log.changeType)}">${labels[log.changeType] || log.changeType}</td>
          <td>${escapeHTML(log.itemName)}</td>
          <td>${log.quantity}</td>
          <td>${escapeHTML(log.actorUsername)}</td>
          <td>${log.counterpartLabel ? escapeHTML(log.counterpartLabel) : '—'}</td>
          <td>${log.reason ? escapeHTML(log.reason) : '—'}</td>
          <td>${log.orderId ? `#${log.orderId} ${escapeHTML(log.orderTitle || '')}` : '—'}</td>
          <td>${formatDate(log.createdAt)}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="8">Ainda não existem movimentos.</td></tr>';
  }
}

function renderResidentsChest() {
  const table = $('#residentsChestTable');
  const logsTable = $('#residentsChestLogsTable');

  if (table) {
    const canModifyResidentsChest = isAdmin() || currentUser?.role === 'resident_chief';

    table.innerHTML = residentsChestItems.length
      ? residentsChestItems.map((item) => `
        <div class="chest-card">
          <div class="chest-card-head">
            <span class="chest-card-name">${escapeHTML(item.name)}</span>
          </div>
          <span class="chest-card-quantity">${item.quantity}</span>
          <span class="chest-card-updated">Atualizado: ${formatDate(item.updatedAt)}</span>
          ${canModifyResidentsChest ? `
            <div class="chest-card-actions">
              <button class="btn secondary mini" type="button" data-residents-chest-add="${item.id}">+ Entrada</button>
              <button class="btn secondary mini" type="button" data-residents-chest-remove="${item.id}">− Saída</button>
              <button class="btn secondary mini" type="button" data-residents-chest-transfer="${item.id}">⇄ Transferir</button>
              <button class="btn danger mini" type="button" data-residents-chest-delete="${item.id}">Apagar</button>
            </div>
          ` : ''}
        </div>
      `).join('')
      : '<div class="chest-grid-empty">O Baú Moradores ainda não tem itens.</div>';
  }

  if (logsTable) {
    const labels = {
      add: 'Entrada',
      remove: 'Saída',
      create: 'Criado',
      delete: 'Apagado',
      transfer_in: 'Transferência (entrada)',
      transfer_out: 'Transferência (saída)'
    };

    logsTable.innerHTML = residentsChestLogs.length
      ? residentsChestLogs.map((log) => `
        <tr>
          <td class="chest-${escapeHTML(log.changeType)}">${labels[log.changeType] || log.changeType}</td>
          <td>${escapeHTML(log.itemName)}</td>
          <td>${log.quantity}</td>
          <td>${escapeHTML(log.actorUsername)}</td>
          <td>${log.counterpartLabel ? escapeHTML(log.counterpartLabel) : '—'}</td>
          <td>${log.reason ? escapeHTML(log.reason) : '—'}</td>
          <td>${log.orderId ? `#${log.orderId} ${escapeHTML(log.orderTitle || '')}` : '—'}</td>
          <td>${formatDate(log.createdAt)}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="8">Ainda não existem movimentos.</td></tr>';
  }
}

function renderOfficials() {
  const table = $('#officialsChestTable');
  const logsTable = $('#officialsChestLogsTable');

  if (table) {
    const canModifyOfficialsChest = isAdmin() || isOfficials();

    table.innerHTML = officialsChestItems.length
      ? officialsChestItems.map((item) => `
        <div class="chest-card">
          <div class="chest-card-head">
            <span class="chest-card-name">${escapeHTML(item.name)}</span>
          </div>
          <span class="chest-card-quantity">${item.quantity}</span>
          <span class="chest-card-updated">Atualizado: ${formatDate(item.updatedAt)}</span>
          ${canModifyOfficialsChest ? `
            <div class="chest-card-actions admin-or-officials">
              <button class="btn secondary mini" type="button" data-officials-chest-add="${item.id}">+ Entrada</button>
              <button class="btn secondary mini" type="button" data-officials-chest-remove="${item.id}">− Saída</button>
              <button class="btn secondary mini" type="button" data-officials-chest-transfer="${item.id}">⇄ Transferir</button>
              <button class="btn danger mini" type="button" data-officials-chest-delete="${item.id}">Apagar</button>
            </div>
          ` : ''}
        </div>
      `).join('')
      : '<div class="chest-grid-empty">O Baú Oficiais ainda não tem itens.</div>';
  }

  if (logsTable) {
    const labels = {
      add: 'Entrada',
      remove: 'Saída',
      create: 'Criado',
      delete: 'Apagado',
      transfer_in: 'Transferência (entrada)',
      transfer_out: 'Transferência (saída)'
    };

    logsTable.innerHTML = officialsChestLogs.length
      ? officialsChestLogs.map((log) => `
        <tr>
          <td class="chest-${escapeHTML(log.changeType)}">${labels[log.changeType] || log.changeType}</td>
          <td>${escapeHTML(log.itemName)}</td>
          <td>${log.quantity}</td>
          <td>${escapeHTML(log.actorUsername)}</td>
          <td>${log.counterpartLabel ? escapeHTML(log.counterpartLabel) : '—'}</td>
          <td>${log.reason ? escapeHTML(log.reason) : '—'}</td>
          <td>${log.orderId ? `#${log.orderId} ${escapeHTML(log.orderTitle || '')}` : '—'}</td>
          <td>${formatDate(log.createdAt)}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="8">Ainda não existem movimentos.</td></tr>';
  }
}

function renderOrdersChest() {
  const table = $('#ordersChestTable');
  const logsTable = $('#ordersChestLogsTable');

  if (table) {
    table.innerHTML = ordersChestItems.length
      ? ordersChestItems.map((item) => `
        <div class="chest-card">
          <div class="chest-card-head">
            <span class="chest-card-name">${escapeHTML(item.name)}</span>
          </div>
          <span class="chest-card-quantity">${item.quantity}</span>
          <span class="chest-card-updated">Atualizado: ${formatDate(item.updatedAt)}</span>
          ${isAdmin() ? `
            <div class="chest-card-actions">
              <button class="btn secondary mini" type="button" data-orders-chest-add="${item.id}">+ Entrada</button>
              <button class="btn secondary mini" type="button" data-orders-chest-remove="${item.id}">− Saída</button>
              <button class="btn secondary mini" type="button" data-orders-chest-transfer="${item.id}">⇄ Transferir</button>
              <button class="btn danger mini" type="button" data-orders-chest-delete="${item.id}">Apagar</button>
            </div>
          ` : ''}
        </div>
      `).join('')
      : '<div class="chest-grid-empty">O Baú de Encomendas ainda não tem itens.</div>';
  }

  if (logsTable) {
    const labels = {
      add: 'Entrada',
      remove: 'Saída',
      create: 'Criado',
      delete: 'Apagado',
      transfer_in: 'Transferência (entrada)',
      transfer_out: 'Transferência (saída)'
    };

    logsTable.innerHTML = ordersChestLogs.length
      ? ordersChestLogs.map((log) => `
        <tr>
          <td class="chest-${escapeHTML(log.changeType)}">${labels[log.changeType] || log.changeType}</td>
          <td>${escapeHTML(log.itemName)}</td>
          <td>${log.quantity}</td>
          <td>${escapeHTML(log.actorUsername)}</td>
          <td>${log.counterpartLabel ? escapeHTML(log.counterpartLabel) : '—'}</td>
          <td>${log.reason ? escapeHTML(log.reason) : '—'}</td>
          <td>${log.orderId ? `#${log.orderId} ${escapeHTML(log.orderTitle || '')}` : '—'}</td>
          <td>${formatDate(log.createdAt)}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="8">Ainda não existem movimentos.</td></tr>';
  }
}

function isMoneyOrder(order) {
  return order.paymentMethod === 'clean' || order.paymentMethod === 'dirty';
}

function renderOrderRow(order, index) {
  return `
    <tr class="fade-in-row" style="--fade-index: ${index}">
      <td>#${order.id}</td>
      <td>
        <strong>${escapeHTML(order.title)}</strong>
        ${order.description ? `<span class="order-description">${escapeHTML(order.description)}</span>` : ''}
      </td>
      <td>${escapeHTML(order.createdByUsername || 'Utilizador removido')}</td>
      <td>${paymentLabel(order.paymentMethod)}</td>
      <td><span class="badge ${escapeHTML(order.status)}">${statusLabel(order.status)}</span></td>
      <td>${formatDate(order.createdAt)}</td>
      <td>
        <div class="actions">
          <button class="btn secondary mini view-order" type="button" data-order-view="${order.id}">Ver</button>
          ${isAdmin() ? `
            <select class="order-status-select" data-order-status="${order.id}">
              <option value="pending" ${order.status === 'pending' ? 'selected' : ''}>Pendente</option>
              <option value="in_progress" ${order.status === 'in_progress' ? 'selected' : ''}>Em curso</option>
              <option value="completed" ${order.status === 'completed' ? 'selected' : ''}>Concluída</option>
              <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>Cancelada</option>
            </select>
          ` : ''}
          ${(isAdmin() || (order.createdBy === currentUser?.id && order.status === 'pending')) ? `
            <button class="btn danger mini" type="button" data-order-delete="${order.id}">Apagar</button>
          ` : ''}
        </div>
      </td>
    </tr>
  `;
}

function renderOrders() {
  const table = $('#ordersTable');

  if (!table) return;

  const craftingOrders = orders.filter((order) => !isMoneyOrder(order));

  table.innerHTML = craftingOrders.length
    ? craftingOrders.map((order, index) => renderOrderRow(order, index)).join('')
    : '<tr><td colspan="7">Ainda não existem encomendas.</td></tr>';
}

function renderAmmunationOrders() {
  const table = $('#ammunationOrdersTable');

  if (!table) return;

  const ammunationOrdersList = orders.filter((order) => isMoneyOrder(order));

  table.innerHTML = ammunationOrdersList.length
    ? ammunationOrdersList.map((order, index) => renderOrderRow(order, index)).join('')
    : '<tr><td colspan="7">Ainda não existem encomendas Ammunation.</td></tr>';
}

function publicOrderStatusLabel(status) {
  const labels = {
    pending: 'Pendente',
    accepted: 'Aceite / Convertido',
    rejected: 'Rejeitado',
    archived: 'Arquivado',
    spam: 'Spam'
  };

  return labels[status] || status;
}

function publicOrderStatusClass(status) {
  const classes = {
    pending: 'pending',
    accepted: 'completed',
    rejected: 'cancelled',
    archived: 'blocked',
    spam: 'cancelled'
  };

  return classes[status] || 'pending';
}

function renderPublicOrders() {
  const table = $('#publicOrdersTable');

  if (!table) return;

  table.innerHTML = publicOrders.length
    ? publicOrders.map((order) => `
      <tr>
        <td>#${order.id}</td>
        <td>
          <strong>${escapeHTML(order.contactName)}</strong>
          <span class="order-description">${escapeHTML(order.contactInfo)}</span>
        </td>
        <td>${order.itemsCount}</td>
        <td>${paymentPreferencesLabel(order.paymentPreferences)}</td>
        <td><span class="badge ${publicOrderStatusClass(order.status)}">${publicOrderStatusLabel(order.status)}</span></td>
        <td>${formatDate(order.createdAt)}</td>
        <td>
          <div class="actions">
            <button class="btn secondary mini" type="button" data-public-order-view="${order.id}">Ver / Analisar</button>
          </div>
        </td>
      </tr>
    `).join('')
    : '<tr><td colspan="7">Não existem pedidos públicos para este filtro.</td></tr>';
}

function selectedOrderRecipes() {
  return recipes.filter((recipe) => Number(orderQuantities.get(recipe.id) || 0) > 0);
}

function renderOrderBuilder() {
  const category = $('#orderCategoryFilter').value;
  const visibleRecipes = recipes.filter((recipe) => recipe.category !== 'Ammunation' && (!category || recipe.category === category));
  const list = $('#orderRecipesList');

  list.innerHTML = visibleRecipes.length
    ? visibleRecipes.map((recipe) => `
      <div class="order-recipe-row">
        <div>
          <strong>${escapeHTML(recipe.name)}</strong>
          <small>${escapeHTML(recipe.category)} · ${formatMoney(recipe.unitPrice)}</small>
        </div>
        <input
          class="order-quantity"
          type="number"
          min="0"
          max="100000"
          step="1"
          value="${Number(orderQuantities.get(recipe.id) || 0)}"
          data-order-recipe-id="${recipe.id}"
          aria-label="Quantidade para ${escapeHTML(recipe.name)}"
        >
      </div>
    `).join('')
    : '<p>Não existem receitas ativas nesta categoria.</p>';

  renderOrderCalculator();
}

function renderOrderCalculator() {
  const calculator = $('#orderCalculator');
  const selected = selectedOrderRecipes();
  const totals = new Map();
  let totalClean = 0;
  let totalDirty = 0;

  for (const recipe of selected) {
    const quantity = Number(orderQuantities.get(recipe.id) || 0);
    totalClean += (recipe.cleanPrice ?? recipe.unitPrice) * quantity;
    totalDirty += (recipe.dirtyPrice ?? recipe.unitPrice) * quantity;

    for (const material of recipe.materials) {
      const current = totals.get(material.name) || 0;
      totals.set(material.name, current + material.quantity * quantity);
    }
  }

  calculator.innerHTML = selected.length
    ? `
      <div class="calculator-summary">
        <div class="calculator-totals">
          <div class="calculator-total payment-total-clean">Total limpo: <strong>${formatMoney(totalClean)}</strong></div>
          <div class="calculator-total payment-total-dirty">Total sujo: <strong>${formatMoney(totalDirty)}</strong></div>
        </div>
        <strong>Itens</strong>
        <ul class="calculator-list">
          ${selected.map((recipe) => `
            <li><span>${escapeHTML(recipe.name)} × ${orderQuantities.get(recipe.id)}</span><span>${formatMoney((recipe.cleanPrice ?? recipe.unitPrice) * orderQuantities.get(recipe.id))} / ${formatMoney((recipe.dirtyPrice ?? recipe.unitPrice) * orderQuantities.get(recipe.id))}</span></li>
          `).join('')}
        </ul>
        <strong>Materiais necessários</strong>
        <ul class="calculator-list">
          ${[...totals.entries()].map(([name, quantity]) => `
            <li><span>${escapeHTML(name)}</span><strong>${quantity}</strong></li>
          `).join('')}
        </ul>
      </div>
    `
    : '<p>Escolhe quantidades nas receitas.</p>';
}

function selectedPaymentMethod() {
  return document.querySelector('input[name="paymentMethod"]:checked')?.value || 'clean';
}

function renderAmmunationItems() {
  const list = $('#ammunationItemsList');

  list.innerHTML = ammunationItems.length
    ? ammunationItems.map((item) => `
      <div class="order-recipe-row">
        <div>
          <strong>${escapeHTML(item.name)}</strong>
          <small>Limpo: ${formatMoney(item.cleanPrice)} · Sujo: ${formatMoney(item.dirtyPrice)}</small>
        </div>
        <input
          class="ammunation-quantity"
          type="number"
          min="0"
          max="100000"
          step="1"
          value="${Number(ammunationQuantities.get(item.id) || 0)}"
          data-ammunation-id="${item.id}"
          aria-label="Quantidade para ${escapeHTML(item.name)}"
        >
      </div>
    `).join('')
    : '<p>Não existem receitas Ammunation ativas. Cria-as em Receitas.</p>';

  renderAmmunationCalculator();
}

function renderAmmunationCalculator() {
  const calculator = $('#ammunationCalculator');
  const method = selectedPaymentMethod();
  const selected = [];
  let totalClean = 0;
  let totalDirty = 0;

  for (const item of ammunationItems) {
    const quantity = Number(ammunationQuantities.get(item.id) || 0);

    if (!quantity) continue;

    totalClean += item.cleanPrice * quantity;
    totalDirty += item.dirtyPrice * quantity;
    selected.push({ item, quantity });
  }

  calculator.innerHTML = selected.length
    ? `
      <div class="calculator-summary">
        <div class="calculator-totals">
          <div class="calculator-total payment-total-clean${method === 'clean' ? ' is-selected' : ''}">Dinheiro limpo: <strong>${formatMoney(totalClean)}</strong></div>
          <div class="calculator-total payment-total-dirty${method === 'dirty' ? ' is-selected' : ''}">Dinheiro sujo: <strong>${formatMoney(totalDirty)}</strong></div>
        </div>
        <ul class="calculator-list">
          ${selected.map(({ item, quantity }) => `
            <li><span>${escapeHTML(item.name)} × ${quantity}</span><span>${formatMoney(item.cleanPrice * quantity)} / ${formatMoney(item.dirtyPrice * quantity)}</span></li>
          `).join('')}
        </ul>
      </div>
    `
    : '<p>Escolhe as quantidades.</p>';
}

function collectIngredients(containerSelector, materialSelector, quantitySelector) {
  const rows = [...document.querySelectorAll(`${containerSelector} .ingredient-row`)];

  return rows.map((row) => ({
    materialId: row.querySelector(materialSelector)?.value,
    quantity: row.querySelector(quantitySelector)?.value
  }));
}

function openRecipeEditor(recipe) {
  editingRecipeId = recipe.id;

  $('#editRecipeName').value = recipe.name;
  $('#editRecipeCategory').value = recipe.category;
  $('#editRecipePrice').value = recipe.unitPrice;
  $('#editRecipeError').textContent = '';

  $('#editIngredientsEditor').innerHTML = recipe.materials.length
    ? recipe.materials.map((material) => ingredientRow(material.id, material.quantity, 'edit')).join('')
    : ingredientRow('', 1, 'edit');

  toggleRecipeMaterialsSection(
    recipe.category,
    '#editIngredientsSection',
    '#editRecipeAmmunationHint',
    '#editIngredientsEditor'
  );

  $('#editRecipeDialog').showModal();
}

function openChestMovement(id, action) {
  const item = chestItems.find((entry) => entry.id === id);

  if (!item) return;

  chestTarget = item;
  chestAction = action;

  $('#chestActionTitle').textContent = action === 'add'
    ? `Adicionar a ${item.name}`
    : `Retirar de ${item.name}`;

  $('#chestActionText').textContent = action === 'add'
    ? `Quantidade atual: ${item.quantity}.`
    : `Quantidade atual: ${item.quantity}. Não podes retirar mais do que existe.`;

  $('#chestActionQuantity').value = '';
  $('#chestActionReason').value = '';
  populateOrderSelect('#chestActionOrder');
  $('#chestActionOrder').value = '';
  $('#chestActionError').textContent = '';
  $('#chestActionDialog').showModal();
}

function openResidentsMovement(id, action) {
  const item = residentsChestItems.find((entry) => entry.id === id);

  if (!item) return;

  residentsChestTarget = item;
  residentsChestAction = action;

  $('#residentsChestActionTitle').textContent = action === 'add'
    ? `Adicionar a ${item.name}`
    : `Retirar de ${item.name}`;

  $('#residentsChestActionText').textContent = action === 'add'
    ? `Quantidade atual: ${item.quantity}.`
    : `Quantidade atual: ${item.quantity}. Não podes retirar mais do que existe.`;

  $('#residentsChestActionQuantity').value = '';
  $('#residentsChestActionReason').value = '';
  populateOrderSelect('#residentsChestActionOrder');
  $('#residentsChestActionOrder').value = '';
  $('#residentsChestActionError').textContent = '';
  $('#residentsChestActionDialog').showModal();
}

function openOfficialsMovement(id, action) {
  const item = officialsChestItems.find((entry) => entry.id === id);

  if (!item) return;

  officialsChestTarget = item;
  officialsChestAction = action;

  $('#officialsChestActionTitle').textContent = action === 'add'
    ? `Adicionar a ${item.name}`
    : `Retirar de ${item.name}`;

  $('#officialsChestActionText').textContent = action === 'add'
    ? `Quantidade atual: ${item.quantity}.`
    : `Quantidade atual: ${item.quantity}. Não podes retirar mais do que existe.`;

  $('#officialsChestActionQuantity').value = '';
  $('#officialsChestActionReason').value = '';
  populateOrderSelect('#officialsChestActionOrder');
  $('#officialsChestActionOrder').value = '';
  $('#officialsChestActionError').textContent = '';
  $('#officialsChestActionDialog').showModal();
}

function openOrdersChestMovement(id, action) {
  const item = ordersChestItems.find((entry) => entry.id === id);

  if (!item) return;

  ordersChestTarget = item;
  ordersChestAction = action;

  $('#ordersChestActionTitle').textContent = action === 'add'
    ? `Adicionar a ${item.name}`
    : `Retirar de ${item.name}`;

  $('#ordersChestActionText').textContent = action === 'add'
    ? `Quantidade atual: ${item.quantity}.`
    : `Quantidade atual: ${item.quantity}. Não podes retirar mais do que existe.`;

  $('#ordersChestActionQuantity').value = '';
  $('#ordersChestActionReason').value = '';
  populateOrderSelect('#ordersChestActionOrder');
  $('#ordersChestActionOrder').value = '';
  $('#ordersChestActionError').textContent = '';
  $('#ordersChestActionDialog').showModal();
}

function openChestTransfer(chestKey, id) {
  const config = CHEST_CONFIG[chestKey];
  const item = getChestItemsByKey(chestKey).find((entry) => entry.id === id);

  if (!config || !item) return;

  chestTransferTarget = { chestKey, item };

  $('#chestTransferTitle').textContent = `Transferir ${item.name}`;
  $('#chestTransferText').textContent = `De: ${config.label}. Quantidade disponível: ${item.quantity}.`;

  const destinationOptions = Object.entries(CHEST_CONFIG)
    .filter(([key, cfg]) => key !== chestKey && cfg.canAccess())
    .map(([key, cfg]) => `<option value="${key}">${escapeHTML(cfg.label)}</option>`)
    .join('');

  $('#chestTransferDestination').innerHTML = destinationOptions
    || '<option value="">Não tens acesso a outro baú</option>';

  $('#chestTransferQuantity').value = '';
  $('#chestTransferQuantity').max = String(item.quantity);
  $('#chestTransferReason').value = '';
  populateOrderSelect('#chestTransferOrder');
  $('#chestTransferOrder').value = '';
  $('#chestTransferError').textContent = '';
  $('#chestTransferDialog').showModal();
}

async function showOrderDetail(id) {
  try {
    const [{ order }, movementsData] = await Promise.all([
      request(`/api/orders/${id}`),
      request(`/api/orders/${id}/movements`).catch(() => ({ movements: [] }))
    ]);

    const movements = movementsData.movements || [];

    $('#detailTitle').textContent = `Encomenda #${order.id} — ${order.title}`;

    $('#detailMeta').innerHTML = `
      Criada por <strong>${escapeHTML(order.createdByUsername || 'Utilizador removido')}</strong> em ${formatDate(order.createdAt)} ·
      ${paymentLabel(order.paymentMethod)} · ${statusLabel(order.status)}
      ${order.description ? `<br>Nota: ${escapeHTML(order.description)}` : ''}
    `;

    const total = order.items.reduce((sum, item) => sum + item.subtotal, 0);

    const movementLabels = {
      add: 'Entrada',
      remove: 'Saída',
      create: 'Criado',
      delete: 'Apagado',
      transfer_in: 'Transferência (entrada)',
      transfer_out: 'Transferência (saída)'
    };

    $('#orderDetailContent').innerHTML = `
      <div class="detail-grid">
        <section class="detail-block">
          <h4>Itens</h4>
          <ul class="detail-list">
            ${order.items.length
              ? order.items.map((item) => `
                <li>${escapeHTML(item.name)} × ${item.quantity} — ${formatMoney(item.subtotal)}</li>
              `).join('')
              : '<li>Sem itens.</li>'}
          </ul>
          <p><strong>Total: ${formatMoney(total)}</strong></p>
        </section>

        <section class="detail-block">
          <h4>Materiais necessários</h4>
          <ul class="detail-list">
            ${order.materials.length
              ? order.materials.map((material) => `
                <li>${escapeHTML(material.name)} × ${material.quantity}</li>
              `).join('')
              : '<li>Esta encomenda não usa materiais.</li>'}
          </ul>
        </section>

        <section class="detail-block">
          <h4>Movimentos de stock associados</h4>
          <ul class="detail-list">
            ${movements.length
              ? movements.map((movement) => `
                <li>
                  <strong>${movementLabels[movement.changeType] || movement.changeType}</strong>
                  — ${escapeHTML(movement.itemName)} × ${movement.quantity}
                  no ${escapeHTML(movement.chestLabel)}
                  ${movement.counterpartLabel ? `(${escapeHTML(movement.counterpartLabel)})` : ''}
                  — por ${escapeHTML(movement.actorUsername)} em ${formatDate(movement.createdAt)}
                  ${movement.reason ? `<br><em>Motivo: ${escapeHTML(movement.reason)}</em>` : ''}
                </li>
              `).join('')
              : '<li>Ainda não existem movimentos de stock associados a esta encomenda.</li>'}
          </ul>
        </section>
      </div>
    `;

    $('#orderDetailDialog').showModal();
  } catch (error) {
    alert(error.message);
  }
}

function renderPublicOrderDetailActions(order) {
  const actions = $('#publicOrderDetailActions');

  if (!actions) return;

  if (order.status === 'accepted') {
    actions.innerHTML = order.convertedOrder
      ? `<span class="order-description">Convertido na encomenda #${order.convertedOrder.id} — ${escapeHTML(order.convertedOrder.title)} (${statusLabel(order.convertedOrder.status)}).</span>`
      : '<span class="order-description">Este pedido já foi convertido numa encomenda interna.</span>';
    return;
  }

  actions.innerHTML = `
    <button class="btn primary" type="button" data-public-order-convert="${order.id}">Aceitar e converter</button>
    <button class="btn secondary" type="button" data-public-order-reject="${order.id}">Rejeitar</button>
    <button class="btn secondary" type="button" data-public-order-archive="${order.id}">Arquivar</button>
    <button class="btn danger" type="button" data-public-order-spam="${order.id}">Marcar spam</button>
    ${order.status !== 'pending' ? `
      <button class="btn secondary" type="button" data-public-order-restore="${order.id}">Repor pendente</button>
    ` : ''}
  `;
}

async function showPublicOrderDetail(id) {
  try {
    const { publicOrder: order } = await request(`/api/public-orders/${id}`);

    publicOrderDetailId = order.id;

    $('#publicOrderDetailTitle').textContent = `Pedido público #${order.id} — ${order.contactName}`;
    $('#publicOrderDetailMeta').innerHTML = `
      Recebido em ${formatDate(order.createdAt)} ·
      <span class="badge ${publicOrderStatusClass(order.status)}">${publicOrderStatusLabel(order.status)}</span>
      ${order.reviewedByUsername ? ` · Analisado por ${escapeHTML(order.reviewedByUsername)}` : ''}
    `;

    $('#publicOrderDetailContent').innerHTML = `
      <div class="detail-grid">
        <section class="detail-block">
          <h4>Contacto RP</h4>
          <ul class="detail-list">
            <li><strong>Nome/Contacto:</strong> ${escapeHTML(order.contactName)}</li>
            <li><strong>Discord / Telefone RP:</strong> ${escapeHTML(order.contactInfo)}</li>
            <li><strong>Preferência de pagamento:</strong> ${paymentPreferencesLabel(order.paymentPreferences)}</li>
            <li><strong>Local / prazo de entrega:</strong> ${escapeHTML(order.deliveryInfo)}</li>
          </ul>
          ${order.specialRequest ? `
            <h4 style="margin-top: 14px;">Pedido especial</h4>
            <p>${escapeHTML(order.specialRequest)}</p>
          ` : ''}
          ${order.status === 'rejected' && order.rejectionReason ? `
            <h4 style="margin-top: 14px;">Motivo da rejeição</h4>
            <p>${escapeHTML(order.rejectionReason)}</p>
          ` : ''}
        </section>

        <section class="detail-block">
          <h4>Itens pedidos</h4>
          <ul class="detail-list">
            ${order.items.length
              ? order.items.map((item) => `
                <li>${escapeHTML(item.name)} × ${item.quantity} <small>(${escapeHTML(item.category)})</small></li>
              `).join('')
              : '<li>Sem itens.</li>'}
          </ul>
        </section>
      </div>
    `;

    $('#publicOrderNotes').value = order.internalNotes || '';
    $('#publicOrderNotesError').textContent = '';
    $('#publicOrderActionError').textContent = '';

    renderPublicOrderDetailActions(order);
    $('#publicOrderDetailDialog').showModal();
  } catch (error) {
    alert(error.message);
  }
}

async function openConvertPublicOrder(id) {
  try {
    const { publicOrder: order } = await request(`/api/public-orders/${id}`);

    if (order.status === 'accepted') {
      alert('Este pedido já foi convertido numa encomenda interna.');
      return;
    }

    $('#convertPublicOrderForm').dataset.publicOrderId = order.id;
    $('#convertOrderTitle').value = `Pedido público #${order.id} — ${order.contactName}`.slice(0, 100);
    $('#convertPublicOrderError').textContent = '';

    const preferenceRadio = document.querySelector(
      `input[name="convertPaymentMethod"][value="${order.paymentPreferences?.[0] || 'materials'}"]`
    );
    if (preferenceRadio) preferenceRadio.checked = true;

    $('#convertPublicOrderItems').innerHTML = `
      <h4>Itens deste pedido</h4>
      <ul class="detail-list">
        ${order.items.map((item) => `
          <li>${escapeHTML(item.name)} × ${item.quantity}</li>
        `).join('')}
      </ul>
    `;

    $('#publicOrderDetailDialog').close();
    $('#convertPublicOrderDialog').showModal();
  } catch (error) {
    alert(error.message);
  }
}

async function loadUsers() {
  if (!isAdmin()) {
    users = [currentUser];
    renderStats();
    return;
  }

  const data = await request('/api/users');
  users = data.users;
  renderUsers();
  renderStats();
}

async function loadCrafting() {
  if (!isAdmin()) {
    materials = [];
    recipes = [];
    renderMaterials();
    renderRecipes();
    return;
  }

  const [materialsData, recipesData] = await Promise.all([
    request('/api/materials'),
    request('/api/catalog')
  ]);

  materials = materialsData.materials;
  recipes = recipesData.items;

  renderMaterials();
  renderRecipes();

  if (!$('#recipeIngredients').children.length && isAdmin()) {
    $('#recipeIngredients').innerHTML = ingredientRow();
  }

  if (isAdmin()) {
    toggleRecipeMaterialsSection(
      $('#recipeCategory').value,
      '#recipeIngredientsSection',
      '#recipeAmmunationHint',
      '#recipeIngredients'
    );
  }
}

async function loadOrders() {
  if (!canViewOrders()) {
    orders = [];
    renderOrders();
    renderAmmunationOrders();
    renderDashboard();
    return;
  }

  const data = await request('/api/orders');
  orders = data.orders;
  renderOrders();
  renderAmmunationOrders();
  renderDashboard();
  await loadPendingMaterialsSummary();
  await loadPendingMoneySummary();
}

async function loadPublicOrders() {
  if (!isAdmin()) {
    publicOrders = [];
    renderPublicOrders();
    return;
  }

  const data = await request('/api/public-orders');
  const filter = $('#publicOrdersFilter')?.value || 'pending';

  publicOrders = filter === 'all'
    ? data.publicOrders
    : data.publicOrders.filter((order) => order.status === filter);

  renderPublicOrders();
}

async function loadChest() {
  if (!isAdmin()) {
    chestItems = [];
    chestLogs = [];
    renderChest();
    return;
  }

  const data = await request('/api/chest');
  chestItems = data.items;
  chestLogs = data.logs;
  renderChest();
}

async function loadResidentsChest() {
  if (!isAdminOrResidentChief()) {
    residentsChestItems = [];
    residentsChestLogs = [];
    renderResidentsChest();
    return;
  }

  const data = await request('/api/residents-chest');
  residentsChestItems = data.items;
  residentsChestLogs = data.logs;
  renderResidentsChest();
}

async function loadOfficials() {
  if (!isAdminOrOfficials()) {
    officialsChestItems = [];
    officialsChestLogs = [];
    renderOfficials();
    return;
  }

  const data = await request('/api/officials-chest');
  officialsChestItems = data.items;
  officialsChestLogs = data.logs;
  renderOfficials();
}

async function loadOrdersChest() {
  if (!isAdmin()) {
    ordersChestItems = [];
    ordersChestLogs = [];
    renderOrdersChest();
    return;
  }

  const data = await request('/api/orders-chest');
  ordersChestItems = data.items;
  ordersChestLogs = data.logs;
  renderOrdersChest();
}

async function loadAuditLogs() {
  if (!isAdmin()) {
    auditLogs = [];
    renderAuditLogs();
    return;
  }

  const data = await request('/api/audit-logs');
  auditLogs = data.logs;
  renderAuditLogs();
}

function renderAuditLogs() {
  const table = $('#auditLogsTable');

  if (!table) return;

  table.innerHTML = auditLogs.length
    ? auditLogs.map((log) => `
      <tr>
        <td>${formatDate(log.createdAt)}</td>
        <td>${escapeHTML(log.actorUsername)}</td>
        <td>${escapeHTML(log.action)}</td>
        <td>${escapeHTML(log.targetUsername || '—')}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="4">Ainda não existem registos de atividade.</td></tr>';
}

async function loadAll() {
  await Promise.all([
    loadUsers(),
    loadCrafting(),
    loadOrders(),
    loadPublicOrders(),
    loadChest(),
    loadResidentsChest(),
    loadOfficials(),
    loadOrdersChest(),
    loadAuditLogs()
  ]);
}

async function openOrderBuilder() {
  try {
    await loadCrafting();

    orderQuantities = new Map();
    $('#orderForm').reset();
    $('#orderError').textContent = '';

    const categories = [...new Set(
      recipes
        .filter((recipe) => recipe.category !== 'Ammunation')
        .map((recipe) => recipe.category)
    )];

    $('#orderCategoryFilter').innerHTML = [
      '<option value="">Todas as categorias</option>',
      ...categories.map((category) => `
        <option value="${escapeHTML(category)}">${escapeHTML(category)}</option>
      `)
    ].join('');

    renderOrderBuilder();
    $('#orderDialog').showModal();
  } catch (error) {
    alert(error.message);
  }
}

async function openAmmunationOrder() {
  try {
    const data = await request('/api/ammunation/catalog');

    ammunationItems = data.items;
    ammunationQuantities = new Map();

    $('#ammunationForm').reset();

    const cleanRadio = document.querySelector('input[name="paymentMethod"][value="clean"]');
    if (cleanRadio) cleanRadio.checked = true;

    $('#ammunationError').textContent = '';
    renderAmmunationItems();
    $('#ammunationDialog').showModal();
  } catch (error) {
    alert(error.message);
  }
}

async function initialise() {
  $('#currentDate').textContent = new Intl.DateTimeFormat('pt-PT', {
    dateStyle: 'full'
  }).format(new Date());

  try {
    const data = await request('/api/me');

    currentUser = data.user;

    $('#profileName').textContent = currentUser.username;
    $('#profileRole').textContent = getRoleLabel(currentUser.role);

    setAdminVisibility();

    $('#loginView').classList.add('hidden');
    $('#appView').classList.remove('hidden');

    await loadAll();
  } catch {
    $('#loginView').classList.remove('hidden');
    $('#appView').classList.add('hidden');
  }
}

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const errorElement = $('#loginError');
  errorElement.textContent = '';

  try {
    const data = await request('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('#loginUsername').value,
        password: $('#loginPassword').value
      })
    });

    currentUser = data.user;
    $('#loginPassword').value = '';

    $('#profileName').textContent = currentUser.username;
    $('#profileRole').textContent = getRoleLabel(currentUser.role);

    setAdminVisibility();

    $('#loginView').classList.add('hidden');
    $('#appView').classList.remove('hidden');

    await loadAll();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});

$('#logoutButton').addEventListener('click', async () => {
  try {
    await request('/api/logout', { method: 'POST' });
  } catch {
    // A sessão pode já ter expirado; mesmo assim voltamos ao login.
  }

  currentUser = null;
  users = [];
  recipes = [];
  materials = [];
  orders = [];
  chestItems = [];
  chestLogs = [];
  residentsChestItems = [];
  residentsChestLogs = [];
  officialsChestItems = [];
  officialsChestLogs = [];
  ordersChestItems = [];
  ordersChestLogs = [];
  publicOrders = [];
  publicOrderDetailId = null;

  $('#appView').classList.add('hidden');
  $('#loginView').classList.remove('hidden');
  $('#loginForm').reset();
  closeMobileMenu();
});

document.querySelectorAll('.nav').forEach((button) => {
  button.addEventListener('click', () => {
    if ((button.classList.contains('admin-only') && !isAdmin()) ||
        (button.classList.contains('admin-or-officials') && !isAdminOrOfficials()) ||
        (button.classList.contains('admin-or-resident-chief') && !isAdminOrResidentChief()) ||
        (button.classList.contains('orders-viewer') && !canViewOrders())) {
      return;
    }
    showPage(button.dataset.page);
    closeMobileMenu();
  });
});

function openMobileMenu() {
  document.querySelector('.app > aside')?.classList.add('open');
  $('#mobileMenuOverlay')?.classList.add('open');
}

function closeMobileMenu() {
  document.querySelector('.app > aside')?.classList.remove('open');
  $('#mobileMenuOverlay')?.classList.remove('open');
}

$('#mobileMenuToggle')?.addEventListener('click', openMobileMenu);
$('#closeMobileMenu')?.addEventListener('click', closeMobileMenu);
$('#mobileMenuOverlay')?.addEventListener('click', closeMobileMenu);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeMobileMenu();
  }
});

$('#openPasswordDialog').addEventListener('click', () => {
  $('#passwordForm').reset();
  $('#passwordError').textContent = '';
  $('#passwordDialog').showModal();
});

$('#closePasswordDialog').addEventListener('click', () => {
  $('#passwordDialog').close();
});

$('#passwordForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const errorElement = $('#passwordError');
  const currentPassword = $('#currentPassword').value;
  const newPassword = $('#newOwnPassword').value;
  const confirmPassword = $('#confirmOwnPassword').value;

  errorElement.textContent = '';

  if (newPassword !== confirmPassword) {
    errorElement.textContent = 'A confirmação não corresponde à nova palavra-passe.';
    return;
  }

  if (newPassword.length < 12) {
    errorElement.textContent = 'A nova palavra-passe tem de ter pelo menos 12 caracteres.';
    return;
  }

  try {
    await request('/api/me/password', {
      method: 'PATCH',
      body: JSON.stringify({ currentPassword, newPassword })
    });

    $('#passwordDialog').close();
    alert('A tua palavra-passe foi alterada com sucesso.');
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
$('#closeResetPasswordDialog').addEventListener('click', () => {
  $('#resetPasswordDialog').close();
});

$('#resetPasswordForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const errorElement = $('#resetPasswordError');
  const newPassword = $('#resetNewPassword').value;
  const confirmPassword = $('#resetConfirmPassword').value;

  errorElement.textContent = '';

  if (!resetPasswordTarget) return;

  if (newPassword !== confirmPassword) {
    errorElement.textContent = 'A confirmação não corresponde à nova palavra-passe.';
    return;
  }

  if (newPassword.length < 12) {
    errorElement.textContent = 'A nova palavra-passe tem de ter pelo menos 12 caracteres.';
    return;
  }

  try {
    await request(`/api/users/${resetPasswordTarget.id}/password`, {
      method: 'PATCH',
      body: JSON.stringify({ newPassword })
    });

    $('#resetPasswordDialog').close();
    alert(`A palavra-passe de ${resetPasswordTarget.username} foi reposta com sucesso.`);
    resetPasswordTarget = null;
  } catch (error) {
    errorElement.textContent = error.message;
  }
});

$('#openUserDialog').addEventListener('click', () => {
  $('#userForm').reset();
  $('#userError').textContent = '';
  $('#userDialog').showModal();
});

$('#closeUserDialog').addEventListener('click', () => {
  $('#userDialog').close();
});

$('#userForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  $('#userError').textContent = '';

  try {
    await request('/api/users', {
      method: 'POST',
      body: JSON.stringify({
        username: $('#newUsername').value,
        password: $('#newPassword').value,
        role: $('#newRole').value
      })
    });

    $('#userDialog').close();
    await loadUsers();
  } catch (error) {
    $('#userError').textContent = error.message;
  }
});

$('#materialForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  $('#materialError').textContent = '';

  try {
    await request('/api/materials', {
      method: 'POST',
      body: JSON.stringify({ name: $('#materialName').value })
    });

    $('#materialForm').reset();
    await loadCrafting();
  } catch (error) {
    $('#materialError').textContent = error.message;
  }
});

$('#addRecipeIngredient').addEventListener('click', () => {
  $('#recipeIngredients').insertAdjacentHTML('beforeend', ingredientRow());
});

$('#recipeCategory').addEventListener('change', () => {
  toggleRecipeMaterialsSection(
    $('#recipeCategory').value,
    '#recipeIngredientsSection',
    '#recipeAmmunationHint',
    '#recipeIngredients'
  );
});

$('#editRecipeCategory').addEventListener('change', () => {
  toggleRecipeMaterialsSection(
    $('#editRecipeCategory').value,
    '#editIngredientsSection',
    '#editRecipeAmmunationHint',
    '#editIngredientsEditor'
  );
});

$('#recipeIngredients').addEventListener('click', (event) => {
  const button = event.target.closest('.remove-recipe-ingredient');

  if (button) {
    button.closest('.ingredient-row')?.remove();
  }
});

$('#recipeForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  $('#recipeError').textContent = '';

  const category = $('#recipeCategory').value;

  const recipeMaterials = category === 'Ammunation'
    ? []
    : collectIngredients(
      '#recipeIngredients',
      '.recipe-ingredient-material',
      '.recipe-ingredient-quantity'
    );

  try {
    await request('/api/catalog', {
      method: 'POST',
      body: JSON.stringify({
        name: $('#recipeName').value,
        category,
        unitPrice: $('#recipePrice').value,
        materials: recipeMaterials
      })
    });

    $('#recipeForm').reset();
    $('#recipePrice').value = 0;
    $('#recipeIngredients').innerHTML = ingredientRow();
    toggleRecipeMaterialsSection(
      $('#recipeCategory').value,
      '#recipeIngredientsSection',
      '#recipeAmmunationHint',
      '#recipeIngredients'
    );

    await loadCrafting();
  } catch (error) {
    $('#recipeError').textContent = error.message;
  }
});

$('#closeEditRecipeDialog').addEventListener('click', () => {
  $('#editRecipeDialog').close();
});

$('#addEditIngredient').addEventListener('click', () => {
  $('#editIngredientsEditor').insertAdjacentHTML(
    'beforeend',
    ingredientRow('', 1, 'edit')
  );
});

$('#editIngredientsEditor').addEventListener('click', (event) => {
  const button = event.target.closest('.remove-edit-ingredient');

  if (button) {
    button.closest('.ingredient-row')?.remove();
  }
});

$('#editRecipeForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  $('#editRecipeError').textContent = '';

  const editCategory = $('#editRecipeCategory').value;

  const recipeMaterials = editCategory === 'Ammunation'
    ? []
    : collectIngredients(
      '#editIngredientsEditor',
      '.edit-ingredient-material',
      '.edit-ingredient-quantity'
    );

  try {
    await request(`/api/catalog/${editingRecipeId}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: $('#editRecipeName').value,
        category: editCategory,
        unitPrice: $('#editRecipePrice').value,
        materials: recipeMaterials
      })
    });

    $('#editRecipeDialog').close();
    await loadCrafting();
  } catch (error) {
    $('#editRecipeError').textContent = error.message;
  }
});

$('#openChestCreateDialog').addEventListener('click', () => {
  $('#chestCreateForm').reset();
  $('#chestCreateError').textContent = '';
  $('#chestCreateDialog').showModal();
});

$('#closeChestCreateDialog').addEventListener('click', () => {
  $('#chestCreateDialog').close();
});

$('#chestCreateForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  $('#chestCreateError').textContent = '';

  try {
    await request('/api/chest', {
      method: 'POST',
      body: JSON.stringify({ name: $('#chestItemName').value })
    });

    $('#chestCreateDialog').close();
    await loadChest();
  } catch (error) {
    $('#chestCreateError').textContent = error.message;
  }
});

$('#closeChestActionDialog').addEventListener('click', () => {
  $('#chestActionDialog').close();
});

$('#chestActionForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!chestTarget || !chestAction) return;

  $('#chestActionError').textContent = '';

  try {
    await request(`/api/chest/${chestTarget.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        action: chestAction,
        quantity: $('#chestActionQuantity').value,
        reason: $('#chestActionReason').value,
        orderId: $('#chestActionOrder').value || null
      })
    });

    $('#chestActionDialog').close();
    await loadChest();
  } catch (error) {
    $('#chestActionError').textContent = error.message;
  }
});

$('#openResidentsChestCreateDialog').addEventListener('click', () => {
  $('#residentsChestCreateForm').reset();
  $('#residentsChestCreateError').textContent = '';
  $('#residentsChestCreateDialog').showModal();
});

$('#closeResidentsChestCreateDialog').addEventListener('click', () => {
  $('#residentsChestCreateDialog').close();
});

$('#residentsChestCreateForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  $('#residentsChestCreateError').textContent = '';

  try {
    await request('/api/residents-chest', {
      method: 'POST',
      body: JSON.stringify({ name: $('#residentsChestItemName').value })
    });

    $('#residentsChestCreateDialog').close();
    await loadResidentsChest();
  } catch (error) {
    $('#residentsChestCreateError').textContent = error.message;
  }
});

$('#closeResidentsChestActionDialog').addEventListener('click', () => {
  $('#residentsChestActionDialog').close();
});

$('#residentsChestActionForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!residentsChestTarget || !residentsChestAction) return;

  $('#residentsChestActionError').textContent = '';

  try {
    await request(`/api/residents-chest/${residentsChestTarget.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        action: residentsChestAction,
        quantity: $('#residentsChestActionQuantity').value,
        reason: $('#residentsChestActionReason').value,
        orderId: $('#residentsChestActionOrder').value || null
      })
    });

    $('#residentsChestActionDialog').close();
    await loadResidentsChest();
  } catch (error) {
    $('#residentsChestActionError').textContent = error.message;
  }
});

$('#openOfficialsChestCreateDialog').addEventListener('click', () => {
  $('#officialsChestCreateForm').reset();
  $('#officialsChestCreateError').textContent = '';
  $('#officialsChestCreateDialog').showModal();
});

$('#closeOfficialsChestCreateDialog').addEventListener('click', () => {
  $('#officialsChestCreateDialog').close();
});

$('#officialsChestCreateForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  $('#officialsChestCreateError').textContent = '';

  try {
    await request('/api/officials-chest', {
      method: 'POST',
      body: JSON.stringify({ name: $('#officialsChestItemName').value })
    });

    $('#officialsChestCreateDialog').close();
    await loadOfficials();
  } catch (error) {
    $('#officialsChestCreateError').textContent = error.message;
  }
});

$('#closeOfficialsChestActionDialog').addEventListener('click', () => {
  $('#officialsChestActionDialog').close();
});

$('#officialsChestActionForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!officialsChestTarget || !officialsChestAction) return;

  $('#officialsChestActionError').textContent = '';

  try {
    await request(`/api/officials-chest/${officialsChestTarget.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        action: officialsChestAction,
        quantity: $('#officialsChestActionQuantity').value,
        reason: $('#officialsChestActionReason').value,
        orderId: $('#officialsChestActionOrder').value || null
      })
    });

    $('#officialsChestActionDialog').close();
    await loadOfficials();
  } catch (error) {
    $('#officialsChestActionError').textContent = error.message;
  }
});

$('#openOrdersChestCreateDialog').addEventListener('click', () => {
  $('#ordersChestCreateForm').reset();
  $('#ordersChestCreateError').textContent = '';
  $('#ordersChestCreateDialog').showModal();
});

$('#closeOrdersChestCreateDialog').addEventListener('click', () => {
  $('#ordersChestCreateDialog').close();
});

$('#ordersChestCreateForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  $('#ordersChestCreateError').textContent = '';

  try {
    await request('/api/orders-chest', {
      method: 'POST',
      body: JSON.stringify({ name: $('#ordersChestItemName').value })
    });

    $('#ordersChestCreateDialog').close();
    await loadOrdersChest();
  } catch (error) {
    $('#ordersChestCreateError').textContent = error.message;
  }
});

$('#closeOrdersChestActionDialog').addEventListener('click', () => {
  $('#ordersChestActionDialog').close();
});

$('#ordersChestActionForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!ordersChestTarget || !ordersChestAction) return;

  $('#ordersChestActionError').textContent = '';

  try {
    await request(`/api/orders-chest/${ordersChestTarget.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        action: ordersChestAction,
        quantity: $('#ordersChestActionQuantity').value,
        reason: $('#ordersChestActionReason').value,
        orderId: $('#ordersChestActionOrder').value || null
      })
    });

    $('#ordersChestActionDialog').close();
    await loadOrdersChest();
  } catch (error) {
    $('#ordersChestActionError').textContent = error.message;
  }
});

$('#closeChestTransferDialog').addEventListener('click', () => {
  $('#chestTransferDialog').close();
});

$('#chestTransferForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!chestTransferTarget) return;

  $('#chestTransferError').textContent = '';

  const destination = $('#chestTransferDestination').value;

  if (!destination) {
    $('#chestTransferError').textContent = 'Escolhe um baú de destino.';
    return;
  }

  try {
    await request('/api/chest-transfers', {
      method: 'POST',
      body: JSON.stringify({
        fromChest: chestTransferTarget.chestKey,
        toChest: destination,
        itemName: chestTransferTarget.item.name,
        quantity: $('#chestTransferQuantity').value,
        reason: $('#chestTransferReason').value,
        orderId: $('#chestTransferOrder').value || null
      })
    });

    const sourceKey = chestTransferTarget.chestKey;

    $('#chestTransferDialog').close();
    chestTransferTarget = null;

    await Promise.all([
      getChestLoaderByKey(sourceKey)(),
      getChestLoaderByKey(destination)()
    ]);
  } catch (error) {
    $('#chestTransferError').textContent = error.message;
  }
});

$('#openOrderDialog').addEventListener('click', openOrderBuilder);

$('#closeOrderDialog').addEventListener('click', () => {
  $('#orderDialog').close();
});

$('#orderCategoryFilter').addEventListener('change', renderOrderBuilder);

$('#orderRecipesList').addEventListener('input', (event) => {
  const input = event.target.closest('.order-quantity');

  if (!input) return;

  const id = Number(input.dataset.orderRecipeId);
  const quantity = Math.max(0, Number.parseInt(input.value || '0', 10) || 0);

  orderQuantities.set(id, quantity);
  renderOrderCalculator();
});

$('#orderForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  $('#orderError').textContent = '';

  const items = [...orderQuantities.entries()]
    .filter(([, quantity]) => quantity > 0)
    .map(([itemId, quantity]) => ({ itemId, quantity }));

  if (!items.length) {
    $('#orderError').textContent = 'Seleciona pelo menos um item.';
    return;
  }

  try {
    await request('/api/orders/crafting', {
      method: 'POST',
      body: JSON.stringify({
        title: $('#orderTitle').value,
        description: $('#orderDescription').value,
        items
      })
    });

    $('#orderDialog').close();
    await loadOrders();
  } catch (error) {
    $('#orderError').textContent = error.message;
  }
});

$('#closeOrderDetailDialog').addEventListener('click', () => {
  $('#orderDetailDialog').close();
});

$('#openAmmunationDialog').addEventListener('click', openAmmunationOrder);

$('#closeAmmunationDialog').addEventListener('click', () => {
  $('#ammunationDialog').close();
});

$('#ammunationItemsList').addEventListener('input', (event) => {
  const input = event.target.closest('.ammunation-quantity');

  if (!input) return;

  const id = Number(input.dataset.ammunationId);
  const quantity = Math.max(0, Number.parseInt(input.value || '0', 10) || 0);

  ammunationQuantities.set(id, quantity);
  renderAmmunationCalculator();
});

document.querySelectorAll('input[name="paymentMethod"]').forEach((input) => {
  input.addEventListener('change', renderAmmunationCalculator);
});

$('#ammunationForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  $('#ammunationError').textContent = '';

  const items = [...ammunationQuantities.entries()]
    .filter(([, quantity]) => quantity > 0)
    .map(([itemId, quantity]) => ({ itemId, quantity }));

  if (!items.length) {
    $('#ammunationError').textContent = 'Seleciona pelo menos um item.';
    return;
  }

  try {
    await request('/api/orders/ammunation', {
      method: 'POST',
      body: JSON.stringify({
        title: $('#ammunationTitle').value,
        paymentMethod: selectedPaymentMethod(),
        items
      })
    });

    $('#ammunationDialog').close();
    await loadOrders();
  } catch (error) {
    $('#ammunationError').textContent = error.message;
  }
});

$('#refreshPublicOrders')?.addEventListener('click', () => {
  loadPublicOrders();
});

$('#publicOrdersFilter')?.addEventListener('change', () => {
  loadPublicOrders();
});

$('#closePublicOrderDetailDialog')?.addEventListener('click', () => {
  $('#publicOrderDetailDialog').close();
});

$('#publicOrderNotesForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();

  $('#publicOrderNotesError').textContent = '';

  if (!publicOrderDetailId) return;

  try {
    await request(`/api/public-orders/${publicOrderDetailId}/notes`, {
      method: 'PATCH',
      body: JSON.stringify({ notes: $('#publicOrderNotes').value })
    });

    await loadPublicOrders();
  } catch (error) {
    $('#publicOrderNotesError').textContent = error.message;
  }
});

$('#closeConvertPublicOrderDialog')?.addEventListener('click', () => {
  $('#convertPublicOrderDialog').close();
});

$('#convertPublicOrderForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();

  $('#convertPublicOrderError').textContent = '';

  const id = $('#convertPublicOrderForm').dataset.publicOrderId;
  const paymentMethod = document.querySelector('input[name="convertPaymentMethod"]:checked')?.value || 'materials';

  if (!id) return;

  try {
    await request(`/api/public-orders/${id}/convert`, {
      method: 'POST',
      body: JSON.stringify({
        title: $('#convertOrderTitle').value,
        paymentMethod
      })
    });

    $('#convertPublicOrderDialog').close();
    await Promise.all([loadPublicOrders(), loadOrders()]);
  } catch (error) {
    $('#convertPublicOrderError').textContent = error.message;
  }
});

document.addEventListener('click', async (event) => {
  const publicOrderView = event.target.closest('[data-public-order-view]');
  const publicOrderConvert = event.target.closest('[data-public-order-convert]');
  const publicOrderReject = event.target.closest('[data-public-order-reject]');
  const publicOrderArchive = event.target.closest('[data-public-order-archive]');
  const publicOrderSpam = event.target.closest('[data-public-order-spam]');
  const publicOrderRestore = event.target.closest('[data-public-order-restore]');

  if (publicOrderView) {
    await showPublicOrderDetail(Number(publicOrderView.dataset.publicOrderView));
    return;
  }

  if (publicOrderConvert) {
    await openConvertPublicOrder(Number(publicOrderConvert.dataset.publicOrderConvert));
    return;
  }

  if (publicOrderReject) {
    const reason = prompt('Justificação para rejeitar este pedido (obrigatória):');

    if (reason === null) return;

    try {
      await request(`/api/public-orders/${publicOrderReject.dataset.publicOrderReject}/reject`, {
        method: 'PATCH',
        body: JSON.stringify({ reason })
      });

      $('#publicOrderDetailDialog').close();
      await loadPublicOrders();
    } catch (error) {
      $('#publicOrderActionError').textContent = error.message;
    }

    return;
  }

  if (publicOrderArchive) {
    try {
      await request(`/api/public-orders/${publicOrderArchive.dataset.publicOrderArchive}/archive`, {
        method: 'PATCH'
      });

      $('#publicOrderDetailDialog').close();
      await loadPublicOrders();
    } catch (error) {
      $('#publicOrderActionError').textContent = error.message;
    }

    return;
  }

  if (publicOrderSpam) {
    if (!confirm('Marcar este pedido como spam?')) return;

    try {
      await request(`/api/public-orders/${publicOrderSpam.dataset.publicOrderSpam}/spam`, {
        method: 'PATCH'
      });

      $('#publicOrderDetailDialog').close();
      await loadPublicOrders();
    } catch (error) {
      $('#publicOrderActionError').textContent = error.message;
    }

    return;
  }

  if (publicOrderRestore) {
    try {
      await request(`/api/public-orders/${publicOrderRestore.dataset.publicOrderRestore}/restore`, {
        method: 'PATCH'
      });

      await showPublicOrderDetail(Number(publicOrderRestore.dataset.publicOrderRestore));
      await loadPublicOrders();
    } catch (error) {
      $('#publicOrderActionError').textContent = error.message;
    }

    return;
  }
});

document.addEventListener('click', async (event) => {
  const userStatus = event.target.closest('[data-user-status]');
  const userResetPassword = event.target.closest('[data-user-reset-password]');
  const userDelete = event.target.closest('[data-user-delete]');
  const materialStatus = event.target.closest('[data-material-status]');
  const recipeEdit = event.target.closest('[data-recipe-edit]');
  const recipeStatus = event.target.closest('[data-recipe-status]');
  const recipeDelete = event.target.closest('[data-recipe-delete]');
  const priceButton = event.target.closest('[data-ammunation-prices]');
  const chestAdd = event.target.closest('[data-chest-add]');
  const chestRemove = event.target.closest('[data-chest-remove]');
  const chestDelete = event.target.closest('[data-chest-delete]');
  const chestTransfer = event.target.closest('[data-chest-transfer]');
  const orderView = event.target.closest('[data-order-view]');
  const orderDelete = event.target.closest('[data-order-delete]');

  try {
    if (userStatus) {
      await request(`/api/users/${userStatus.dataset.userStatus}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ active: userStatus.dataset.userActive === 'true' })
      });

      await loadUsers();
      return;
    }

    if (userResetPassword) {
      resetPasswordTarget = {
        id: userResetPassword.dataset.userResetPassword,
        username: userResetPassword.dataset.userResetUsername
      };

      $('#resetPasswordForm').reset();
      $('#resetPasswordError').textContent = '';
      $('#resetPasswordUsername').textContent = resetPasswordTarget.username;
      $('#resetPasswordDialog').showModal();
      return;
    }

    if (userDelete) {
      if (!confirm('Queres apagar este utilizador?')) return;

      await request(`/api/users/${userDelete.dataset.userDelete}`, {
        method: 'DELETE'
      });

      await loadUsers();
      return;
    }

    if (materialStatus) {
      await request(`/api/materials/${materialStatus.dataset.materialStatus}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ active: materialStatus.dataset.materialActive === 'true' })
      });

      await loadCrafting();
      return;
    }

    if (recipeEdit) {
      const recipe = recipes.find((item) => item.id === Number(recipeEdit.dataset.recipeEdit));

      if (recipe) openRecipeEditor(recipe);

      return;
    }

    if (recipeStatus) {
      await request(`/api/catalog/${recipeStatus.dataset.recipeStatus}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ active: recipeStatus.dataset.recipeActive === 'true' })
      });

      await loadCrafting();
      return;
    }

    if (recipeDelete) {
      if (!confirm('Queres apagar esta receita? Esta ação não pode ser desfeita.')) return;

      await request(`/api/catalog/${recipeDelete.dataset.recipeDelete}`, {
        method: 'DELETE'
      });

      await loadCrafting();
      return;
    }

    if (priceButton) {
      const recipe = recipes.find((item) => item.id === Number(priceButton.dataset.ammunationPrices));

      if (!recipe) return;

      const cleanInput = prompt(
        `Preço com dinheiro limpo para ${recipe.name}:`,
        recipe.cleanPrice ?? recipe.unitPrice ?? 0
      );

      if (cleanInput === null) return;

      const dirtyInput = prompt(
        `Preço com dinheiro sujo para ${recipe.name}:`,
        recipe.dirtyPrice ?? recipe.unitPrice ?? 0
      );

      if (dirtyInput === null) return;

      const cleanPrice = Number(cleanInput);
      const dirtyPrice = Number(dirtyInput);

      if (!Number.isInteger(cleanPrice) || !Number.isInteger(dirtyPrice) || cleanPrice < 0 || dirtyPrice < 0) {
        alert('Usa apenas números inteiros iguais ou superiores a zero.');
        return;
      }

      await request(`/api/catalog/${recipe.id}/prices`, {
        method: 'PATCH',
        body: JSON.stringify({ cleanPrice, dirtyPrice })
      });

      await loadCrafting();
      return;
    }

    if (chestAdd) {
      openChestMovement(Number(chestAdd.dataset.chestAdd), 'add');
      return;
    }

    if (chestRemove) {
      openChestMovement(Number(chestRemove.dataset.chestRemove), 'remove');
      return;
    }

    if (chestDelete) {
      const id = Number(chestDelete.dataset.chestDelete);

      if (!confirm('Queres apagar este item do Baú 113?')) return;

      await request(`/api/chest/${id}`, { method: 'DELETE' });
      await loadChest();
      return;
    }

    if (chestTransfer) {
      openChestTransfer('chest', Number(chestTransfer.dataset.chestTransfer));
      return;
    }

    const residentsChestAdd = event.target.closest('[data-residents-chest-add]');
    const residentsChestRemove = event.target.closest('[data-residents-chest-remove]');
    const residentsChestDelete = event.target.closest('[data-residents-chest-delete]');
    const residentsChestTransfer = event.target.closest('[data-residents-chest-transfer]');

    if (residentsChestAdd) {
      openResidentsMovement(Number(residentsChestAdd.dataset.residentsChestAdd), 'add');
      return;
    }

    if (residentsChestRemove) {
      openResidentsMovement(Number(residentsChestRemove.dataset.residentsChestRemove), 'remove');
      return;
    }

    if (residentsChestDelete) {
      const id = Number(residentsChestDelete.dataset.residentsChestDelete);

      if (!confirm('Queres apagar este item do Baú Moradores?')) return;

      await request(`/api/residents-chest/${id}`, { method: 'DELETE' });
      await loadResidentsChest();
      return;
    }

    if (residentsChestTransfer) {
      openChestTransfer('residents', Number(residentsChestTransfer.dataset.residentsChestTransfer));
      return;
    }

    const officialsChestAdd = event.target.closest('[data-officials-chest-add]');
    const officialsChestRemove = event.target.closest('[data-officials-chest-remove]');
    const officialsChestDelete = event.target.closest('[data-officials-chest-delete]');
    const officialsChestTransfer = event.target.closest('[data-officials-chest-transfer]');

    if (officialsChestAdd) {
      openOfficialsMovement(Number(officialsChestAdd.dataset.officialsChestAdd), 'add');
      return;
    }

    if (officialsChestRemove) {
      openOfficialsMovement(Number(officialsChestRemove.dataset.officialsChestRemove), 'remove');
      return;
    }

    if (officialsChestDelete) {
      const id = Number(officialsChestDelete.dataset.officialsChestDelete);

      if (!confirm('Queres apagar este item do Baú Oficiais?')) return;

      await request(`/api/officials-chest/${id}`, { method: 'DELETE' });
      await loadOfficials();
      return;
    }

    if (officialsChestTransfer) {
      openChestTransfer('officials', Number(officialsChestTransfer.dataset.officialsChestTransfer));
      return;
    }

    const ordersChestAdd = event.target.closest('[data-orders-chest-add]');
    const ordersChestRemove = event.target.closest('[data-orders-chest-remove]');
    const ordersChestDelete = event.target.closest('[data-orders-chest-delete]');
    const ordersChestTransfer = event.target.closest('[data-orders-chest-transfer]');

    if (ordersChestAdd) {
      openOrdersChestMovement(Number(ordersChestAdd.dataset.ordersChestAdd), 'add');
      return;
    }

    if (ordersChestRemove) {
      openOrdersChestMovement(Number(ordersChestRemove.dataset.ordersChestRemove), 'remove');
      return;
    }

    if (ordersChestDelete) {
      const id = Number(ordersChestDelete.dataset.ordersChestDelete);

      if (!confirm('Queres apagar este item do Baú de Encomendas?')) return;

      await request(`/api/orders-chest/${id}`, { method: 'DELETE' });
      await loadOrdersChest();
      return;
    }

    if (ordersChestTransfer) {
      openChestTransfer('orders', Number(ordersChestTransfer.dataset.ordersChestTransfer));
      return;
    }

    if (orderView) {
      await showOrderDetail(Number(orderView.dataset.orderView));
      return;
    }

    if (orderDelete) {
      if (!confirm('Queres apagar esta encomenda?')) return;

      await request(`/api/orders/${orderDelete.dataset.orderDelete}`, {
        method: 'DELETE'
      });

      await loadOrders();
    }
  } catch (error) {
    alert(error.message);
  }
});

document.addEventListener('change', async (event) => {
  const select = event.target.closest('[data-order-status]');

  if (!select) return;

  try {
    await request(`/api/orders/${select.dataset.orderStatus}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: select.value })
    });

    await loadOrders();
  } catch (error) {
    alert(error.message);
    await loadOrders();
  }
});
async function loadPendingMaterialsSummary() {
  const container = $('#pendingMaterialsSummary');

  if (!container || !isAdmin()) return;

  try {
    const data = await request('/api/orders/pending-materials-summary');

    if (!data.pendingOrders) {
      container.innerHTML = '<p>Não existem encomendas de crafting pendentes.</p>';
      return;
    }

    container.innerHTML = `
      <span class="pending-materials-count">
        ${data.pendingOrders} encomenda${data.pendingOrders === 1 ? '' : 's'} pendente${data.pendingOrders === 1 ? '' : 's'}
      </span>

      ${data.materials.length ? `
        <div class="pending-materials-list">
          ${data.materials.map((material) => `
            <div class="pending-materials-item">
              <span>${escapeHTML(material.name)}</span>
              <strong>${material.quantity}</strong>
            </div>
          `).join('')}
        </div>
      ` : '<p>As encomendas pendentes não têm materiais associados.</p>'}
    `;
  } catch (error) {
    container.innerHTML = `<p class="error">${escapeHTML(error.message)}</p>`;
  }
}
$('#refreshPendingMaterials').addEventListener('click', () => {
  loadPendingMaterialsSummary();
});

async function loadPendingMoneySummary() {
  const container = $('#pendingMoneySummary');

  if (!container || !isAdmin()) return;

  try {
    const data = await request('/api/orders/pending-money-summary');

    if (!data.pendingOrders) {
      container.innerHTML = '<p>Não existem encomendas Ammunation pendentes.</p>';
      return;
    }

    container.innerHTML = `
      <span class="pending-materials-count">
        ${data.pendingOrders} encomenda${data.pendingOrders === 1 ? '' : 's'} pendente${data.pendingOrders === 1 ? '' : 's'}
      </span>

      <div class="calculator-totals">
        <div class="calculator-total payment-total-clean">Dinheiro limpo: <strong>${formatMoney(data.totalClean)}</strong></div>
        <div class="calculator-total payment-total-dirty">Dinheiro sujo: <strong>${formatMoney(data.totalDirty)}</strong></div>
      </div>
    `;
  } catch (error) {
    container.innerHTML = `<p class="error">${escapeHTML(error.message)}</p>`;
  }
}
$('#refreshPendingMoney')?.addEventListener('click', () => {
  loadPendingMoneySummary();
});

initialise();
