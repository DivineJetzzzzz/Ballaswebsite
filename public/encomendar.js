const $ = (selector) => document.querySelector(selector);

let catalogItems = [];
const quantities = new Map();

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

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

function renderCatalog() {
  const list = $('#publicCatalogList');
  const category = $('#publicCategoryFilter').value;
  const visibleItems = catalogItems.filter((item) => !category || item.category === category);

  if (!visibleItems.length) {
    list.innerHTML = '<div class="public-catalog-empty">Não existem itens disponíveis nesta categoria.</div>';
    return;
  }

  list.innerHTML = visibleItems.map((item, index) => `
    <div class="public-catalog-row fade-in-row" style="--fade-index: ${index}">
      <div>
        <strong>${escapeHTML(item.name)}</strong>
        <small>${escapeHTML(item.category)} · Preço de referência: ${formatMoney(item.referencePrice)}</small>
      </div>
      <input
        class="public-item-quantity"
        type="number"
        min="0"
        max="100000"
        step="1"
        value="${Number(quantities.get(item.id) || 0)}"
        data-item-id="${item.id}"
        aria-label="Quantidade para ${escapeHTML(item.name)}"
      >
    </div>
  `).join('');
}

async function loadCatalog() {
  const list = $('#publicCatalogList');

  try {
    const data = await request('/api/public/catalog');
    catalogItems = data.items;

    const categories = [...new Set(catalogItems.map((item) => item.category))];

    $('#publicCategoryFilter').innerHTML = [
      '<option value="">Todas as categorias</option>',
      ...categories.map((category) => `
        <option value="${escapeHTML(category)}">${escapeHTML(category)}</option>
      `)
    ].join('');

    renderCatalog();
  } catch (error) {
    list.innerHTML = `<div class="public-catalog-empty">${escapeHTML(error.message)}</div>`;
  }
}

$('#publicCategoryFilter').addEventListener('change', renderCatalog);

$('#publicCatalogList').addEventListener('input', (event) => {
  const input = event.target.closest('.public-item-quantity');

  if (!input) return;

  const id = Number(input.dataset.itemId);
  const quantity = Math.max(0, Number.parseInt(input.value || '0', 10) || 0);

  quantities.set(id, quantity);
});

function showMessage(text, isError) {
  const box = $('#publicFormMessage');

  box.textContent = text;
  box.classList.remove('hidden');
  box.classList.toggle('is-error', Boolean(isError));
}

$('#publicOrderForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const errorElement = $('#publicOrderError');
  errorElement.textContent = '';

  const items = [...quantities.entries()]
    .filter(([, quantity]) => quantity > 0)
    .map(([itemId, quantity]) => ({ itemId, quantity }));

  if (!items.length) {
    errorElement.textContent = 'Escolhe pelo menos um item e a respetiva quantidade.';
    return;
  }

  const paymentPreferences = [...document.querySelectorAll('input[name="paymentPreference"]:checked')]
    .map((input) => input.value);

  if (!paymentPreferences.length) {
    errorElement.textContent = 'Escolhe pelo menos uma preferência de pagamento.';
    return;
  }

  const submitButton = event.target.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    await request('/api/public/orders', {
      method: 'POST',
      body: JSON.stringify({
        contactName: $('#contactName').value,
        contactInfo: $('#contactInfo').value,
        deliveryInfo: $('#deliveryInfo').value,
        specialRequest: $('#specialRequest').value,
        paymentPreferences,
        items
      })
    });

    showMessage('O teu pedido foi enviado com sucesso! A organização vai analisá-lo em breve.', false);

    $('#publicOrderForm').reset();
    quantities.clear();
    renderCatalog();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    errorElement.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

loadCatalog();
