const $ = (selector) => document.querySelector(selector);

let currentUser = null;
let users = [];
let materials = [];
let recipes = [];
let orders = [];
let chestItems = [];
let chestLogs = [];

let editingRecipeId = null;
let orderQuantities = new Map();
let ammunationItems = [];
let ammunationQuantities = new Map();
let chestTarget = null;
let chestAction = null;

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

function isAdmin() {
  return currentUser?.role === 'admin';
}

function setAdminVisibility() {
  document.querySelectorAll('.admin-only').forEach((element) => {
    element.classList.toggle('hidden', !isAdmin());
  });
}

function showPage(name) {
  const meta = {
    dashboard: ['Visão geral', 'Resumo do teu painel privado.'],
    chest: ['Baú', 'Stock da organização.'],
    residentsChest: ['Baú Moradores', 'Stock do baú dos moradores.'],
    orders: ['Encomendas', 'Cria pedidos e acompanha o seu estado.'],
    recipes: ['Receitas', 'Configura itens, materiais e custos.'],
    users: ['Utilizadores', 'Gestão de acessos e permissões.']
  };

  const safeName = meta[name] ? name : 'dashboard';

  ['dashboard', 'chest', 'residentsChest', 'orders', 'recipes', 'users'].forEach((page) => {
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

function renderUsers() {
  const table = $('#usersTable');

  if (!table) return;

  table.innerHTML = users.length
    ? users.map((user) => {
      const self = user.id === currentUser?.id;

      return `
        <tr>
          <td class="username">${escapeHTML(user.username)}${self ? ' <small>(tu)</small>' : ''}</td>
          <td><span class="badge ${user.role}">${user.role === 'admin' ? 'Administrador' : 'Utilizador'}</span></td>
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
      ? chestItems.map((item) => `
        <tr>
          <td class="username">${escapeHTML(item.name)}</td>
          <td class="chest-quantity">${item.quantity}</td>
          <td>${formatDate(item.updatedAt)}</td>
          <td class="admin-only">
            ${isAdmin() ? `
              <div class="actions">
                <button class="btn secondary mini" type="button" data-chest-add="${item.id}">+ Entrada</button>
                <button class="btn secondary mini" type="button" data-chest-remove="${item.id}">− Saída</button>
                <button class="btn danger mini" type="button" data-chest-delete="${item.id}">Apagar</button>
              </div>
            ` : '—'}
          </td>
        </tr>
      `).join('')
      : '<tr><td colspan="4">O Baú ainda não tem itens.</td></tr>';
  }

  if (logsTable) {
    const labels = {
      add: 'Entrada',
      remove: 'Saída',
      create: 'Criado',
      delete: 'Apagado'
    };

    logsTable.innerHTML = chestLogs.length
      ? chestLogs.map((log) => `
        <tr>
          <td class="chest-${escapeHTML(log.changeType)}">${labels[log.changeType] || log.changeType}</td>
          <td>${escapeHTML(log.itemName)}</td>
          <td>${log.quantity}</td>
          <td>${escapeHTML(log.actorUsername)}</td>
          <td>${formatDate(log.createdAt)}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="5">Ainda não existem movimentos.</td></tr>';
  }
}

function renderOrders() {
  const table = $('#ordersTable');

  if (!table) return;

  table.innerHTML = orders.length
    ? orders.map((order) => `
      <tr>
        <td>#${order.id}</td>
        <td>
          <strong>${escapeHTML(order.title)}</strong>
          ${order.description ? `<span class="order-description">${escapeHTML(order.description)}</span>` : ''}
        </td>
        <td>${escapeHTML(order.createdByUsername)}</td>
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
    `).join('')
    : '<tr><td colspan="7">Ainda não existem encomendas.</td></tr>';
}

function selectedOrderRecipes() {
  return recipes.filter((recipe) => Number(orderQuantities.get(recipe.id) || 0) > 0);
}

function renderOrderBuilder() {
  const category = $('#orderCategoryFilter').value;
  const visibleRecipes = recipes.filter((recipe) => !category || recipe.category === category);
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
  let totalPrice = 0;

  for (const recipe of selected) {
    const quantity = Number(orderQuantities.get(recipe.id) || 0);
    totalPrice += recipe.unitPrice * quantity;

    for (const material of recipe.materials) {
      const current = totals.get(material.name) || 0;
      totals.set(material.name, current + material.quantity * quantity);
    }
  }

  calculator.innerHTML = selected.length
    ? `
      <div class="calculator-summary">
        <div class="calculator-total">Preço estimado: <strong>${formatMoney(totalPrice)}</strong></div>
        <strong>Itens</strong>
        <ul class="calculator-list">
          ${selected.map((recipe) => `
            <li><span>${escapeHTML(recipe.name)} × ${orderQuantities.get(recipe.id)}</span><span>${formatMoney(recipe.unitPrice * orderQuantities.get(recipe.id))}</span></li>
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
  let total = 0;

  for (const item of ammunationItems) {
    const quantity = Number(ammunationQuantities.get(item.id) || 0);

    if (!quantity) continue;

    const price = method === 'dirty' ? item.dirtyPrice : item.cleanPrice;
    total += price * quantity;
    selected.push({ item, quantity, price });
  }

  const className = method === 'dirty' ? 'payment-total-dirty' : 'payment-total-clean';
  const label = method === 'dirty' ? 'Dinheiro sujo' : 'Dinheiro limpo';

  calculator.innerHTML = selected.length
    ? `
      <div class="calculator-summary">
        <div class="calculator-total ${className}">${label}: <strong>${formatMoney(total)}</strong></div>
        <ul class="calculator-list">
          ${selected.map(({ item, quantity, price }) => `
            <li><span>${escapeHTML(item.name)} × ${quantity}</span><span>${formatMoney(price * quantity)}</span></li>
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
  $('#chestActionError').textContent = '';
  $('#chestActionDialog').showModal();
}

async function showOrderDetail(id) {
  try {
    const { order } = await request(`/api/orders/${id}`);

    $('#detailTitle').textContent = `Encomenda #${order.id} — ${order.title}`;

    $('#detailMeta').innerHTML = `
      Criada por <strong>${escapeHTML(order.createdByUsername)}</strong> em ${formatDate(order.createdAt)} ·
      ${paymentLabel(order.paymentMethod)} · ${statusLabel(order.status)}
      ${order.description ? `<br>Nota: ${escapeHTML(order.description)}` : ''}
    `;

    const total = order.items.reduce((sum, item) => sum + item.subtotal, 0);

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
      </div>
    `;

    $('#orderDetailDialog').showModal();
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
}

async function loadOrders() {
  const data = await request('/api/orders');
  orders = data.orders;
  renderOrders();
  await loadPendingMaterialsSummary();
}

async function loadChest() {
  const data = await request('/api/chest');
  chestItems = data.items;
  chestLogs = data.logs;
  renderChest();
}

async function loadAll() {
  await Promise.all([
    loadUsers(),
    loadCrafting(),
    loadOrders(),
    loadChest()
  ]);
}

async function openOrderBuilder() {
  try {
    await loadCrafting();

    orderQuantities = new Map();
    $('#orderForm').reset();
    $('#orderError').textContent = '';

    const categories = [...new Set(recipes.map((recipe) => recipe.category))];

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
    $('#profileRole').textContent = currentUser.role === 'admin'
      ? 'Administrador'
      : 'Utilizador';

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
    $('#profileRole').textContent = currentUser.role === 'admin'
      ? 'Administrador'
      : 'Utilizador';

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

  $('#appView').classList.add('hidden');
  $('#loginView').classList.remove('hidden');
  $('#loginForm').reset();
});

document.querySelectorAll('.nav').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.classList.contains('residents-chief-only') && !['user', 'resident_chief'].includes(currentUser?.role)) return;
    if (button.classList.contains('admin-only') && !isAdmin()) return;
    showPage(button.dataset.page);
  });
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
    errorElement.textContent = 'A confirmaÃ§Ã£o nÃ£o corresponde Ã  nova palavra-passe.';
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

$('#recipeIngredients').addEventListener('click', (event) => {
  const button = event.target.closest('.remove-recipe-ingredient');

  if (button) {
    button.closest('.ingredient-row')?.remove();
  }
});

$('#recipeForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  $('#recipeError').textContent = '';

  const recipeMaterials = collectIngredients(
    '#recipeIngredients',
    '.recipe-ingredient-material',
    '.recipe-ingredient-quantity'
  );

  try {
    await request('/api/catalog', {
      method: 'POST',
      body: JSON.stringify({
        name: $('#recipeName').value,
        category: $('#recipeCategory').value,
        unitPrice: $('#recipePrice').value,
        materials: recipeMaterials
      })
    });

    $('#recipeForm').reset();
    $('#recipePrice').value = 0;
    $('#recipeIngredients').innerHTML = ingredientRow();

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

  const recipeMaterials = collectIngredients(
    '#editIngredientsEditor',
    '.edit-ingredient-material',
    '.edit-ingredient-quantity'
  );

  try {
    await request(`/api/catalog/${editingRecipeId}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: $('#editRecipeName').value,
        category: $('#editRecipeCategory').value,
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
        quantity: $('#chestActionQuantity').value
      })
    });

    $('#chestActionDialog').close();
    await loadChest();
  } catch (error) {
    $('#chestActionError').textContent = error.message;
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

document.addEventListener('click', async (event) => {
  const userStatus = event.target.closest('[data-user-status]');
  const userDelete = event.target.closest('[data-user-delete]');
  const materialStatus = event.target.closest('[data-material-status]');
  const recipeEdit = event.target.closest('[data-recipe-edit]');
  const recipeStatus = event.target.closest('[data-recipe-status]');
  const recipeDelete = event.target.closest('[data-recipe-delete]');
  const priceButton = event.target.closest('[data-ammunation-prices]');
  const chestAdd = event.target.closest('[data-chest-add]');
  const chestRemove = event.target.closest('[data-chest-remove]');
  const chestDelete = event.target.closest('[data-chest-delete]');
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

      if (!confirm('Queres apagar este item do Baú?')) return;

      await request(`/api/chest/${id}`, { method: 'DELETE' });
      await loadChest();
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

initialise();