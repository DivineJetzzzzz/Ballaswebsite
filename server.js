require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const requiredEnv = [
  'INITIAL_ADMIN_USERNAME',
  'INITIAL_ADMIN_PASSWORD',
  'SESSION_SECRET'
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Variável obrigatória em falta no .env: ${key}`);
  }
}

const app = express();
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

const databaseDirectory = process.env.RAILWAY_VOLUME_MOUNT_PATH
  || path.join(__dirname, 'database');

fs.mkdirSync(databaseDirectory, { recursive: true });

const db = new Database(path.join(databaseDirectory, 'novacore.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'user', 'resident_chief', 'officials')) DEFAULT 'resident_chief',
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER,
    action TEXT NOT NULL,
    target_username TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS catalog_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    category TEXT NOT NULL,
    unit_price INTEGER NOT NULL DEFAULT 0 CHECK(unit_price >= 0),
    clean_price INTEGER NOT NULL DEFAULT 0 CHECK(clean_price >= 0),
    dirty_price INTEGER NOT NULL DEFAULT 0 CHECK(dirty_price >= 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS catalog_item_materials (
    item_id INTEGER NOT NULL,
    material_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    PRIMARY KEY (item_id, material_id),
    FOREIGN KEY (item_id) REFERENCES catalog_items(id) ON DELETE CASCADE,
    FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK(status IN ('pending', 'in_progress', 'completed', 'cancelled')) DEFAULT 'pending',
    payment_method TEXT NOT NULL DEFAULT 'materials',
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS order_recipe_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    catalog_item_id INTEGER,
    item_name TEXT NOT NULL,
    category TEXT NOT NULL,
    unit_price INTEGER NOT NULL DEFAULT 0,
    clean_price INTEGER NOT NULL DEFAULT 0,
    dirty_price INTEGER NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS order_material_totals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    material_id INTEGER,
    material_name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE SET NULL,
    UNIQUE(order_id, material_name)
  );

  CREATE TABLE IF NOT EXISTS chest_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chest_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    change_type TEXT NOT NULL CHECK(change_type IN ('add', 'remove', 'create', 'delete')),
    quantity INTEGER NOT NULL DEFAULT 0,
    actor_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES chest_items(id) ON DELETE CASCADE,
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS residents_chest_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS residents_chest_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER,
    item_name TEXT NOT NULL,
    change_type TEXT NOT NULL CHECK(change_type IN ('add', 'remove', 'create', 'delete')),
    quantity INTEGER NOT NULL DEFAULT 0,
    actor_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS officials_chest_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS officials_chest_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER,
    item_name TEXT NOT NULL,
    change_type TEXT NOT NULL CHECK(change_type IN ('add', 'remove', 'create', 'delete')),
    quantity INTEGER NOT NULL DEFAULT 0,
    actor_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS orders_chest_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders_chest_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER,
    item_name TEXT NOT NULL,
    change_type TEXT NOT NULL CHECK(change_type IN ('add', 'remove', 'create', 'delete')),
    quantity INTEGER NOT NULL DEFAULT 0,
    actor_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
  );
`);

function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();

  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

addColumnIfMissing('catalog_items', 'clean_price', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('catalog_items', 'dirty_price', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('orders', 'payment_method', "TEXT NOT NULL DEFAULT 'materials'");
addColumnIfMissing('order_recipe_items', 'clean_price', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('order_recipe_items', 'dirty_price', 'INTEGER NOT NULL DEFAULT 0');
const usersTableSql = db.prepare(`
  SELECT sql
  FROM sqlite_master
  WHERE type = 'table' AND name = 'users'
`).get()?.sql || '';

if (
  !usersTableSql.includes('resident_chief') ||
  !usersTableSql.includes('officials')
) {
  db.pragma('foreign_keys = OFF');

  db.transaction(() => {
    db.exec(`
      ALTER TABLE users RENAME TO users_old;

      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'user', 'resident_chief', 'officials')) DEFAULT 'resident_chief',
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (
        id,
        username,
        password_hash,
        role,
        active,
        created_at,
        updated_at
      )
      SELECT
        id,
        username,
        password_hash,
        CASE
        WHEN role = 'admin' THEN 'admin'
       WHEN role = 'officials' THEN 'officials'
       WHEN role = 'resident_chief' THEN 'resident_chief'
       ELSE 'resident_chief'
      END,
        active,
        created_at,
        updated_at
      FROM users_old;

      DROP TABLE users_old;
    `);
  })();

  db.pragma('foreign_keys = ON');
}

const ordersTableSql = db.prepare(`
  SELECT sql
  FROM sqlite_master
  WHERE type = 'table' AND name = 'orders'
`).get()?.sql || '';

if (ordersTableSql.includes('ON DELETE RESTRICT')) {
  db.pragma('foreign_keys = OFF');

  db.transaction(() => {
    db.exec(`
      ALTER TABLE orders RENAME TO orders_old;

      CREATE TABLE orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK(status IN ('pending', 'in_progress', 'completed', 'cancelled')) DEFAULT 'pending',
        payment_method TEXT NOT NULL DEFAULT 'materials',
        created_by INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      );

      INSERT INTO orders (
        id, title, description, status, payment_method,
        created_by, created_at, updated_at
      )
      SELECT
        id, title, description, status, payment_method,
        created_by, created_at, updated_at
      FROM orders_old;

      DROP TABLE orders_old;
    `);
  })();

  db.pragma('foreign_keys = ON');
}

// Migra as tabelas de logs dos baús para suportarem transferências entre
// baús, justificação obrigatória e associação a encomendas, preservando
// o histórico já existente.
function migrateChestLogsTable(table) {
  const currentSql = db.prepare(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(table)?.sql || '';

  if (!currentSql || currentSql.includes('transfer_in')) return;

  db.pragma('foreign_keys = OFF');

  db.transaction(() => {
    db.exec(`ALTER TABLE ${table} RENAME TO ${table}_old;`);

    db.exec(`
      CREATE TABLE ${table} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER,
        item_name TEXT NOT NULL,
        change_type TEXT NOT NULL CHECK(change_type IN ('add', 'remove', 'create', 'delete', 'transfer_in', 'transfer_out')),
        quantity INTEGER NOT NULL DEFAULT 0,
        actor_id INTEGER,
        reason TEXT,
        order_id INTEGER,
        transfer_group TEXT,
        counterpart_label TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
      );
    `);

    db.exec(`
      INSERT INTO ${table} (id, item_id, item_name, change_type, quantity, actor_id, created_at)
      SELECT id, item_id, item_name, change_type, quantity, actor_id, created_at
      FROM ${table}_old;
    `);

    db.exec(`DROP TABLE ${table}_old;`);
  })();

  db.pragma('foreign_keys = ON');
}

[
  'chest_logs',
  'residents_chest_logs',
  'officials_chest_logs',
  'orders_chest_logs'
].forEach(migrateChestLogsTable);

db.exec(`
  UPDATE catalog_items
  SET clean_price = unit_price
  WHERE clean_price = 0;

  UPDATE catalog_items
  SET dirty_price = unit_price
  WHERE dirty_price = 0;

  UPDATE order_recipe_items
  SET clean_price = unit_price
  WHERE clean_price = 0;

  UPDATE order_recipe_items
  SET dirty_price = unit_price
  WHERE dirty_price = 0;
`);

if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count === 0) {
  const username = process.env.INITIAL_ADMIN_USERNAME.trim();
  const password = process.env.INITIAL_ADMIN_PASSWORD;

  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username) || password.length < 12) {
    throw new Error('Credenciais iniciais inválidas no .env.');
  }

  db.prepare(`
    INSERT INTO users (username, password_hash, role, active)
    VALUES (?, ?, 'admin', 1)
  `).run(username, bcrypt.hashSync(password, 12));
}

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '50kb' }));

app.use(session({
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: databaseDirectory,
    concurrentDB: true
  }),
  name: 'novacore.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    error: 'Demasiadas tentativas. Tenta novamente dentro de 15 minutos.'
  }
});

function cleanText(value, min, max) {
  if (typeof value !== 'string') return null;

  const result = value.trim();
  return result.length >= min && result.length <= max ? result : null;
}

function cleanUsername(value) {
  const username = cleanText(value, 3, 30);
  return username && /^[a-zA-Z0-9_.-]+$/.test(username) ? username : null;
}

function ensureInteger(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    active: Boolean(user.active),
    createdAt: user.created_at
  };
}

function logAction(actorId, action, target) {
  db.prepare(`
    INSERT INTO audit_logs (actor_id, action, target_username)
    VALUES (?, ?, ?)
  `).run(actorId, action, target || null);
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }

  const user = db.prepare(`
    SELECT id, username, role, active, created_at
    FROM users
    WHERE id = ?
  `).get(req.session.user.id);

  if (!user || !user.active) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'A tua sessão já não é válida.' });
  }

  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Apenas administradores podem executar esta ação.'
    });
  }

  next();
}

function requireResidentChief(req, res, next) {
  if (req.user.role !== 'resident_chief') {
    return res.status(403).json({
      error: 'Apenas Chefes de Moradores podem executar esta ação.'
    });
  }

  next();
}

function requireResidentChiefOrUser(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'resident_chief' && req.user.role !== 'user') {
    return res.status(403).json({
      error: 'Apenas administradores, chefes de moradores e utilizadores podem fazer isso.'
    });
  }

  next();
}

function requireOfficials(req, res, next) {
  if (req.user.role !== 'officials') {
    return res.status(403).json({
      error: 'Apenas oficiais podem executar esta ação.'
    });
  }

  next();
}

function requireOfficialsOrAdmin(req, res, next) {
  if (req.user.role !== 'officials' && req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Apenas oficiais e administradores podem executar esta ação.'
    });
  }

  next();
}

function requireResidentChiefOrAdmin(req, res, next) {
  // Apenas administradores e chefes de moradores podem ver ou modificar o Baú de Moradores.
  if (req.user.role !== 'admin' && req.user.role !== 'resident_chief') {
    return res.status(403).json({
      error: 'Apenas administradores e chefes de moradores podem aceder ao Baú de Moradores.'
    });
  }

  next();
}

function allowOfficialsReadOrders(req, res, next) {
  // GET - allow admin, officials, chefes de moradores e utilizadores (apenas leitura)
  if (req.method === 'GET') {
    if (!['admin', 'officials', 'resident_chief', 'user'].includes(req.user.role)) {
      return res.status(403).json({
        error: 'Acesso negado.'
      });
    }
    return next();
  }

  // POST, PATCH, DELETE - only admin
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Apenas administradores podem modificar encomendas.'
    });
  }

  next();
}

function publicMaterial(material) {
  return {
    id: material.id,
    name: material.name,
    active: Boolean(material.active),
    createdAt: material.created_at
  };
}

function getCatalogItems(includeInactive = false) {
  const rows = db.prepare(`
    SELECT id, name, category, unit_price, clean_price, dirty_price, active, created_at
    FROM catalog_items
    ${includeInactive ? '' : 'WHERE active = 1'}
    ORDER BY category COLLATE NOCASE ASC, name COLLATE NOCASE ASC
  `).all();

  const getMaterials = db.prepare(`
    SELECT materials.id, materials.name, catalog_item_materials.quantity
    FROM catalog_item_materials
    INNER JOIN materials ON materials.id = catalog_item_materials.material_id
    WHERE catalog_item_materials.item_id = ?
    ORDER BY materials.name COLLATE NOCASE ASC
  `);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    unitPrice: row.unit_price,
    cleanPrice: row.clean_price,
    dirtyPrice: row.dirty_price,
    active: Boolean(row.active),
    createdAt: row.created_at,
    materials: getMaterials.all(row.id).map((material) => ({
      id: material.id,
      name: material.name,
      quantity: material.quantity
    }))
  }));
}

function validateRecipeMaterials(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 30) {
    return null;
  }

  const used = new Set();
  const validated = [];

  for (const entry of value) {
    const materialId = ensureInteger(entry.materialId, 1);
    const quantity = ensureInteger(entry.quantity, 1, 100000);

    if (!materialId || !quantity || used.has(materialId)) {
      return null;
    }

    const material = db.prepare(`
      SELECT id, active
      FROM materials
      WHERE id = ?
    `).get(materialId);

    if (!material || !material.active) {
      return null;
    }

    used.add(materialId);
    validated.push({ materialId, quantity });
  }

  return validated;
}

function publicOrder(order) {
  return {
    id: order.id,
    title: order.title,
    description: order.description,
    status: order.status,
    paymentMethod: order.payment_method,
    createdBy: order.created_by,
    createdByUsername: order.created_by_username || null,
    createdAt: order.created_at,
    updatedAt: order.updated_at
  };
}

function getOrderById(id) {
  return db.prepare(`
    SELECT orders.*, users.username AS created_by_username
    FROM orders
    LEFT JOIN users ON users.id = orders.created_by
    WHERE orders.id = ?
  `).get(id);
}

function getDetailedOrder(id) {
  const order = getOrderById(id);

  if (!order) return null;

  const items = db.prepare(`
    SELECT id, catalog_item_id, item_name, category, unit_price, clean_price, dirty_price, quantity
    FROM order_recipe_items
    WHERE order_id = ?
    ORDER BY category COLLATE NOCASE ASC, item_name COLLATE NOCASE ASC
  `).all(id);

  const materials = db.prepare(`
    SELECT id, material_id, material_name, quantity
    FROM order_material_totals
    WHERE order_id = ?
    ORDER BY material_name COLLATE NOCASE ASC
  `).all(id);

  const paymentPriceKey = order.payment_method === 'dirty'
    ? 'dirty_price'
    : 'clean_price';

  return {
    ...publicOrder(order),
    items: items.map((item) => ({
      id: item.id,
      catalogItemId: item.catalog_item_id,
      name: item.item_name,
      category: item.category,
      unitPrice: item.unit_price,
      cleanPrice: item.clean_price,
      dirtyPrice: item.dirty_price,
      quantity: item.quantity,
      subtotal: (
        order.payment_method === 'clean' || order.payment_method === 'dirty'
          ? item[paymentPriceKey]
          : item.unit_price
      ) * item.quantity
    })),
    materials: materials.map((material) => ({
      id: material.id,
      materialId: material.material_id,
      name: material.material_name,
      quantity: material.quantity
    }))
  };
}

function publicChestItem(item) {
  return {
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    updatedAt: item.updated_at
  };
}

function getChestResponse(itemsTable, logsTable) {
  const items = db.prepare(`
    SELECT id, name, quantity, updated_at
    FROM ${itemsTable}
    ORDER BY name COLLATE NOCASE ASC
  `).all();

  const logs = db.prepare(`
    SELECT ${logsTable}.*, users.username AS actor_username, orders.title AS order_title
    FROM ${logsTable}
    LEFT JOIN users ON users.id = ${logsTable}.actor_id
    LEFT JOIN orders ON orders.id = ${logsTable}.order_id
    ORDER BY ${logsTable}.created_at DESC, ${logsTable}.id DESC
    LIMIT 30
  `).all();

  return {
    items: items.map(publicChestItem),
    logs: logs.map((log) => ({
      id: log.id,
      itemId: log.item_id,
      itemName: log.item_name,
      changeType: log.change_type,
      quantity: log.quantity,
      actorUsername: log.actor_username || 'Sistema',
      reason: log.reason || null,
      orderId: log.order_id || null,
      orderTitle: log.order_title || null,
      transferGroup: log.transfer_group || null,
      counterpartLabel: log.counterpart_label || null,
      createdAt: log.created_at
    }))
  };
}

function createChestRoutes(prefix, itemsTable, logsTable, permission) {
  app.get(prefix, requireAuth, permission, (req, res) => {
    res.json(getChestResponse(itemsTable, logsTable));
  });

  app.post(prefix, requireAuth, permission, (req, res, next) => {
    try {
      const name = cleanText(req.body.name, 2, 80);

      if (!name) {
        return res.status(400).json({
          error: 'O nome do item deve ter entre 2 e 80 caracteres.'
        });
      }

      const result = db.prepare(`
        INSERT INTO ${itemsTable} (name, quantity)
        VALUES (?, 0)
      `).run(name);

      const item = db.prepare(`
        SELECT id, name, quantity, updated_at
        FROM ${itemsTable}
        WHERE id = ?
      `).get(result.lastInsertRowid);

      db.prepare(`
        INSERT INTO ${logsTable} (item_id, item_name, change_type, quantity, actor_id)
        VALUES (?, ?, 'create', 0, ?)
      `).run(item.id, item.name, req.user.id);

      logAction(req.user.id, `create_${itemsTable}_item`, item.name);
      res.status(201).json({ item: publicChestItem(item) });
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed')) {
        return res.status(409).json({
          error: 'Já existe um item com esse nome neste Baú.'
        });
      }

      next(error);
    }
  });

  app.patch(`${prefix}/:id`, requireAuth, permission, (req, res, next) => {
    try {
      const id = ensureInteger(req.params.id, 1);
      const action = req.body.action === 'remove' ? 'remove' : 'add';
      const quantity = ensureInteger(req.body.quantity, 1, 1000000000);

      if (!id || !quantity) {
        return res.status(400).json({ error: 'Movimento de Baú inválido.' });
      }

      const justification = resolveMovementJustification(req.body);

      if (justification.error) {
        return res.status(400).json({ error: justification.error });
      }

      const item = db.prepare(`
        SELECT id, name, quantity, updated_at
        FROM ${itemsTable}
        WHERE id = ?
      `).get(id);

      if (!item) {
        return res.status(404).json({ error: 'Item do Baú não encontrado.' });
      }

      if (action === 'remove' && item.quantity < quantity) {
        return res.status(400).json({
          error: 'Não existe quantidade suficiente no Baú.'
        });
      }

      const newQuantity = action === 'add'
        ? item.quantity + quantity
        : item.quantity - quantity;

      db.prepare(`
        UPDATE ${itemsTable}
        SET quantity = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newQuantity, id);

      db.prepare(`
        INSERT INTO ${logsTable} (item_id, item_name, change_type, quantity, actor_id, reason, order_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, item.name, action, quantity, req.user.id, justification.reason, justification.orderId);

      const updated = db.prepare(`
        SELECT id, name, quantity, updated_at
        FROM ${itemsTable}
        WHERE id = ?
      `).get(id);

      logAction(req.user.id, `${itemsTable}_${action}`, item.name);
      res.json({ item: publicChestItem(updated) });
    } catch (error) {
      next(error);
    }
  });

  app.delete(`${prefix}/:id`, requireAuth, permission, (req, res, next) => {
    try {
      const id = ensureInteger(req.params.id, 1);

      if (!id) {
        return res.status(400).json({ error: 'Item do Baú inválido.' });
      }

      const item = db.prepare(`
        SELECT id, name, quantity
        FROM ${itemsTable}
        WHERE id = ?
      `).get(id);

      if (!item) {
        return res.status(404).json({ error: 'Item do Baú não encontrado.' });
      }

      db.prepare(`
        INSERT INTO ${logsTable} (item_id, item_name, change_type, quantity, actor_id)
        VALUES (?, ?, 'delete', ?, ?)
      `).run(id, item.name, item.quantity, req.user.id);

      db.prepare(`DELETE FROM ${itemsTable} WHERE id = ?`).run(id);

      logAction(req.user.id, `delete_${itemsTable}_item`, item.name);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });
}

// Configuração central dos 4 baús, usada pela transferência entre baús e
// pela associação de movimentos a encomendas, para garantir que a mesma
// regra de permissões é aplicada em todo o lado.
const CHEST_CONFIG = {
  chest: {
    itemsTable: 'chest_items',
    logsTable: 'chest_logs',
    label: 'Baú 113',
    canAccess: (role) => role === 'admin'
  },
  residents: {
    itemsTable: 'residents_chest_items',
    logsTable: 'residents_chest_logs',
    label: 'Baú de Moradores',
    canAccess: (role) => role === 'admin' || role === 'resident_chief'
  },
  officials: {
    itemsTable: 'officials_chest_items',
    logsTable: 'officials_chest_logs',
    label: 'Baú de Oficiais',
    canAccess: (role) => role === 'admin' || role === 'officials'
  },
  orders: {
    itemsTable: 'orders_chest_items',
    logsTable: 'orders_chest_logs',
    label: 'Baú de Encomendas',
    canAccess: (role) => role === 'admin'
  }
};

function cleanReason(value, { required } = {}) {
  const raw = typeof value === 'string' ? value.trim() : '';

  if (!raw) return required ? { error: true } : { reason: null };

  if (raw.length < 3 || raw.length > 300) {
    return { error: true, tooShortOrLong: true };
  }

  return { reason: raw };
}

// Valida a justificação e a encomenda (opcional) de um movimento de stock.
// Se for indicada uma encomenda, a justificação passa a ser obrigatória.
function resolveMovementJustification(body) {
  let orderId = null;

  if (body.orderId !== undefined && body.orderId !== null && body.orderId !== '') {
    orderId = ensureInteger(body.orderId, 1);

    if (!orderId || !db.prepare('SELECT id FROM orders WHERE id = ?').get(orderId)) {
      return { error: 'A encomenda associada é inválida ou não existe.' };
    }
  }

  const reasonResult = cleanReason(body.reason, { required: Boolean(orderId) });

  if (reasonResult.error) {
    return {
      error: reasonResult.tooShortOrLong
        ? 'A justificação deve ter entre 3 e 300 caracteres.'
        : 'É obrigatório indicar uma justificação para associar o movimento a uma encomenda.'
    };
  }

  return { reason: reasonResult.reason, orderId };
}

app.post('/api/login', loginLimiter, async (req, res, next) => {
  try {
    const username = cleanUsername(req.body.username);
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!username || !password) {
      return res.status(400).json({
        error: 'Introduz utilizador e palavra-passe válidos.'
      });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

    const valid = user
      && user.active
      && await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({
        error: 'Nome de utilizador, palavra-passe ou acesso inválido.'
      });
    }

    req.session.regenerate((error) => {
      if (error) return next(error);

      req.session.user = { id: user.id };

      req.session.save((saveError) => {
        if (saveError) return next(saveError);

        logAction(user.id, 'login', user.username);
        res.json({ user: publicUser(user) });
      });
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/logout', requireAuth, (req, res, next) => {
  logAction(req.user.id, 'logout', req.user.username);

  req.session.destroy((error) => {
    if (error) return next(error);

    res.clearCookie('novacore.sid');
    res.status(204).end();
  });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.patch('/api/me/password', requireAuth, async (req, res, next) => {
  try {
    const currentPassword = typeof req.body.currentPassword === 'string'
      ? req.body.currentPassword
      : '';

    const newPassword = typeof req.body.newPassword === 'string'
      ? req.body.newPassword
      : '';

    if (!currentPassword || newPassword.length < 12) {
      return res.status(400).json({
        error: 'Indica a palavra-passe atual e uma nova palavra-passe com pelo menos 12 caracteres.'
      });
    }

    const user = db.prepare(`
      SELECT id, username, password_hash
      FROM users
      WHERE id = ?
    `).get(req.user.id);

    const valid = user && await bcrypt.compare(currentPassword, user.password_hash);

    if (!valid) {
      return res.status(401).json({
        error: 'A palavra-passe atual está incorreta.'
      });
    }

    const newHash = await bcrypt.hash(newPassword, 12);

    db.prepare(`
      UPDATE users
      SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newHash, req.user.id);

    logAction(req.user.id, 'change_own_password', req.user.username);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT id, username, role, active, created_at
    FROM users
    ORDER BY id ASC
  `).all();

  res.json({ users: users.map(publicUser) });
});

app.post('/api/users', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const username = cleanUsername(req.body.username);
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    const role = req.body.role === 'admin' ? 'admin'
               : req.body.role === 'officials' ? 'officials'
               : req.body.role === 'user' ? 'user'
               : 'resident_chief';

    if (!username || password.length < 12) {
      return res.status(400).json({
        error: 'Usa um nome de utilizador válido e uma palavra-passe com pelo menos 12 caracteres.'
      });
    }

    const result = db.prepare(`
      INSERT INTO users (username, password_hash, role, active)
      VALUES (?, ?, ?, 1)
    `).run(username, await bcrypt.hash(password, 12), role);

    const user = db.prepare(`
      SELECT id, username, role, active, created_at
      FROM users
      WHERE id = ?
    `).get(result.lastInsertRowid);

    logAction(req.user.id, `create_${role}`, username);
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (String(error.message).includes('UNIQUE constraint failed')) {
      return res.status(409).json({
        error: 'Esse nome de utilizador já existe.'
      });
    }

    next(error);
  }
});

app.patch('/api/users/:id/status', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const id = ensureInteger(req.params.id, 1);
    const active = req.body.active === true;

    if (!id) return res.status(400).json({ error: 'Utilizador inválido.' });

    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);

    if (!target) {
      return res.status(404).json({ error: 'Utilizador não encontrado.' });
    }

    if (target.id === req.user.id) {
      return res.status(400).json({
        error: 'Não podes bloquear a tua própria conta.'
      });
    }

    if (target.role === 'admin' && !active) {
      const admins = db.prepare(`
        SELECT COUNT(*) AS count
        FROM users
        WHERE role = 'admin' AND active = 1
      `).get().count;

      if (admins <= 1) {
        return res.status(400).json({
          error: 'Tem de existir pelo menos um administrador ativo.'
        });
      }
    }

    db.prepare(`
      UPDATE users
      SET active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(active ? 1 : 0, id);

    const updated = db.prepare(`
      SELECT id, username, role, active, created_at
      FROM users
      WHERE id = ?
    `).get(id);

    logAction(req.user.id, active ? 'activate_user' : 'block_user', target.username);
    res.json({ user: publicUser(updated) });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/users/:id/password', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = ensureInteger(req.params.id, 1);
    const newPassword = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';

    if (!id) {
      return res.status(400).json({ error: 'Utilizador inválido.' });
    }

    if (newPassword.length < 12) {
      return res.status(400).json({
        error: 'A nova palavra-passe tem de ter pelo menos 12 caracteres.'
      });
    }

    const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(id);

    if (!target) {
      return res.status(404).json({ error: 'Utilizador não encontrado.' });
    }

    const newHash = await bcrypt.hash(newPassword, 12);

    db.prepare(`
      UPDATE users
      SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newHash, id);

    logAction(req.user.id, 'reset_user_password', target.username);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/audit-logs', requireAuth, requireAdmin, (req, res) => {
  const logs = db.prepare(`
    SELECT audit_logs.*, users.username AS actor_username
    FROM audit_logs
    LEFT JOIN users ON users.id = audit_logs.actor_id
    ORDER BY audit_logs.created_at DESC, audit_logs.id DESC
    LIMIT 200
  `).all();

  res.json({
    logs: logs.map((log) => ({
      id: log.id,
      action: log.action,
      actorUsername: log.actor_username || 'Sistema',
      targetUsername: log.target_username,
      createdAt: log.created_at
    }))
  });
});

app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const id = ensureInteger(req.params.id, 1);

    if (!id) return res.status(400).json({ error: 'Utilizador inválido.' });

    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);

    if (!target) {
      return res.status(404).json({ error: 'Utilizador não encontrado.' });
    }

    if (target.id === req.user.id) {
      return res.status(400).json({
        error: 'Não podes apagar a tua própria conta.'
      });
    }

    if (target.role === 'admin') {
      const admins = db.prepare(`
        SELECT COUNT(*) AS count
        FROM users
        WHERE role = 'admin'
      `).get().count;

      if (admins <= 1) {
        return res.status(400).json({
          error: 'Tem de existir pelo menos uma conta de administrador.'
        });
      }
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    logAction(req.user.id, 'delete_user', target.username);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/materials', requireAuth, requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, active, created_at
    FROM materials
    ORDER BY name COLLATE NOCASE ASC
  `).all();

  res.json({ materials: rows.map(publicMaterial) });
});

app.post('/api/materials', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const name = cleanText(req.body.name, 2, 60);

    if (!name) {
      return res.status(400).json({
        error: 'O nome do material deve ter entre 2 e 60 caracteres.'
      });
    }

    const result = db.prepare(`
      INSERT INTO materials (name, active)
      VALUES (?, 1)
    `).run(name);

    const material = db.prepare(`
      SELECT id, name, active, created_at
      FROM materials
      WHERE id = ?
    `).get(result.lastInsertRowid);

    logAction(req.user.id, 'create_material', name);
    res.status(201).json({ material: publicMaterial(material) });
  } catch (error) {
    if (String(error.message).includes('UNIQUE constraint failed')) {
      return res.status(409).json({
        error: 'Esse material já existe.'
      });
    }

    next(error);
  }
});

app.patch('/api/materials/:id/status', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const id = ensureInteger(req.params.id, 1);
    const active = req.body.active === true;

    if (!id) return res.status(400).json({ error: 'Material inválido.' });

    const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(id);

    if (!material) {
      return res.status(404).json({ error: 'Material não encontrado.' });
    }

    db.prepare('UPDATE materials SET active = ? WHERE id = ?')
      .run(active ? 1 : 0, id);

    const updated = db.prepare(`
      SELECT id, name, active, created_at
      FROM materials
      WHERE id = ?
    `).get(id);

    logAction(req.user.id, active ? 'activate_material' : 'disable_material', material.name);
    res.json({ material: publicMaterial(updated) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/catalog', requireAuth, requireAdmin, (req, res) => {
  res.json({ items: getCatalogItems(true) });
});

app.post('/api/catalog', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const name = cleanText(req.body.name, 2, 80);
    const category = cleanText(req.body.category, 2, 40);
    const unitPrice = ensureInteger(req.body.unitPrice, 0, 1000000000);
    const recipeMaterials = validateRecipeMaterials(req.body.materials);

    if (!name || !category || unitPrice === null || !recipeMaterials) {
      return res.status(400).json({
        error: 'Preenche nome, categoria, preço e materiais da receita corretamente.'
      });
    }

    const createRecipe = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO catalog_items (
          name, category, unit_price, clean_price, dirty_price, active
        )
        VALUES (?, ?, ?, ?, ?, 1)
      `).run(name, category, unitPrice, unitPrice, unitPrice);

      const insertMaterial = db.prepare(`
        INSERT INTO catalog_item_materials (item_id, material_id, quantity)
        VALUES (?, ?, ?)
      `);

      for (const material of recipeMaterials) {
        insertMaterial.run(result.lastInsertRowid, material.materialId, material.quantity);
      }

      return Number(result.lastInsertRowid);
    });

    const id = createRecipe();
    const item = getCatalogItems(true).find((recipe) => recipe.id === id);

    logAction(req.user.id, 'create_recipe', name);
    res.status(201).json({ item });
  } catch (error) {
    if (String(error.message).includes('UNIQUE constraint failed')) {
      return res.status(409).json({
        error: 'Já existe uma receita com esse nome.'
      });
    }

    next(error);
  }
});

app.put('/api/catalog/:id', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const id = ensureInteger(req.params.id, 1);
    const name = cleanText(req.body.name, 2, 80);
    const category = cleanText(req.body.category, 2, 40);
    const unitPrice = ensureInteger(req.body.unitPrice, 0, 1000000000);
    const recipeMaterials = validateRecipeMaterials(req.body.materials);

    if (!id || !name || !category || unitPrice === null || !recipeMaterials) {
      return res.status(400).json({
        error: 'Preenche nome, categoria, preço e materiais da receita corretamente.'
      });
    }

    const recipe = db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(id);

    if (!recipe) {
      return res.status(404).json({ error: 'Receita não encontrada.' });
    }

    const updateRecipe = db.transaction(() => {
      db.prepare(`
        UPDATE catalog_items
        SET name = ?, category = ?, unit_price = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(name, category, unitPrice, id);

      db.prepare('DELETE FROM catalog_item_materials WHERE item_id = ?').run(id);

      const insertMaterial = db.prepare(`
        INSERT INTO catalog_item_materials (item_id, material_id, quantity)
        VALUES (?, ?, ?)
      `);

      for (const material of recipeMaterials) {
        insertMaterial.run(id, material.materialId, material.quantity);
      }
    });

    updateRecipe();

    const item = getCatalogItems(true).find((entry) => entry.id === id);
    logAction(req.user.id, 'update_recipe', name);

    res.json({ item });
  } catch (error) {
    if (String(error.message).includes('UNIQUE constraint failed')) {
      return res.status(409).json({
        error: 'Já existe uma receita com esse nome.'
      });
    }

    next(error);
  }
});

app.patch('/api/catalog/:id/status', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const id = ensureInteger(req.params.id, 1);
    const active = req.body.active === true;

    if (!id) return res.status(400).json({ error: 'Receita inválida.' });

    const recipe = db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(id);

    if (!recipe) {
      return res.status(404).json({ error: 'Receita não encontrada.' });
    }

    db.prepare(`
      UPDATE catalog_items
      SET active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(active ? 1 : 0, id);

    const item = getCatalogItems(true).find((entry) => entry.id === id);

    logAction(req.user.id, active ? 'activate_recipe' : 'disable_recipe', recipe.name);
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/catalog/:id/prices', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const id = ensureInteger(req.params.id, 1);
    const cleanPrice = ensureInteger(req.body.cleanPrice, 0, 1000000000);
    const dirtyPrice = ensureInteger(req.body.dirtyPrice, 0, 1000000000);

    if (!id || cleanPrice === null || dirtyPrice === null) {
      return res.status(400).json({
        error: 'Os preços têm de ser números inteiros iguais ou superiores a zero.'
      });
    }

    const recipe = db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(id);

    if (!recipe) {
      return res.status(404).json({ error: 'Receita não encontrada.' });
    }

    db.prepare(`
      UPDATE catalog_items
      SET clean_price = ?, dirty_price = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(cleanPrice, dirtyPrice, id);

    const item = getCatalogItems(true).find((entry) => entry.id === id);

    logAction(req.user.id, 'update_ammunation_prices', recipe.name);
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/catalog/:id', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const id = ensureInteger(req.params.id, 1);

    if (!id) return res.status(400).json({ error: 'Receita inválida.' });

    const recipe = db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(id);

    if (!recipe) {
      return res.status(404).json({ error: 'Receita não encontrada.' });
    }

    db.prepare('DELETE FROM catalog_items WHERE id = ?').run(id);

    logAction(req.user.id, 'delete_recipe', recipe.name);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
app.get('/api/orders/pending-materials-summary', requireAuth, requireAdmin, (req, res) => {
  const materials = db.prepare(`
    SELECT
      order_material_totals.material_name AS name,
      SUM(order_material_totals.quantity) AS quantity
    FROM order_material_totals
    INNER JOIN orders ON orders.id = order_material_totals.order_id
    WHERE orders.status = 'pending'
      AND orders.payment_method = 'materials'
    GROUP BY order_material_totals.material_name
    ORDER BY order_material_totals.material_name COLLATE NOCASE ASC
  `).all();

  const pendingOrders = db.prepare(`
    SELECT COUNT(*) AS count
    FROM orders
    WHERE status = 'pending'
      AND payment_method = 'materials'
  `).get().count;

  res.json({
    pendingOrders,
    materials: materials.map((material) => ({
      name: material.name,
      quantity: material.quantity
    }))
  });
});
app.get('/api/orders', requireAuth, allowOfficialsReadOrders, (req, res) => {
  const rows = db.prepare(`
    SELECT orders.*, users.username AS created_by_username
    FROM orders
    LEFT JOIN users ON users.id = orders.created_by
    ORDER BY orders.created_at DESC, orders.id DESC
  `).all();

  res.json({ orders: rows.map(publicOrder) });
});
app.get('/api/orders/:id', requireAuth, allowOfficialsReadOrders, (req, res) => {
  const id = ensureInteger(req.params.id, 1);

  if (!id) {
    return res.status(400).json({ error: 'Encomenda inválida.' });
  }

  const order = getDetailedOrder(id);

  if (!order) {
    return res.status(404).json({ error: 'Encomenda não encontrada.' });
  }

  res.json({ order });
});

app.get('/api/orders/:id/movements', requireAuth, allowOfficialsReadOrders, (req, res, next) => {
  try {
    const id = ensureInteger(req.params.id, 1);

    if (!id) {
      return res.status(400).json({ error: 'Encomenda inválida.' });
    }

    const order = getOrderById(id);

    if (!order) {
      return res.status(404).json({ error: 'Encomenda não encontrada.' });
    }

    const movements = Object.entries(CHEST_CONFIG).flatMap(([chestKey, config]) => {
      const rows = db.prepare(`
        SELECT ${config.logsTable}.*, users.username AS actor_username
        FROM ${config.logsTable}
        LEFT JOIN users ON users.id = ${config.logsTable}.actor_id
        WHERE ${config.logsTable}.order_id = ?
      `).all(id);

      return rows.map((row) => ({
        chestKey,
        chestLabel: config.label,
        changeType: row.change_type,
        itemName: row.item_name,
        quantity: row.quantity,
        reason: row.reason || null,
        counterpartLabel: row.counterpart_label || null,
        transferGroup: row.transfer_group || null,
        actorUsername: row.actor_username || 'Sistema',
        createdAt: row.created_at
      }));
    });

    movements.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

    res.json({ movements });
  } catch (error) {
    next(error);
  }
});

app.post('/api/orders/crafting', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const title = cleanText(req.body.title, 3, 100);
    const description = typeof req.body.description === 'string'
      ? req.body.description.trim().slice(0, 2000)
      : '';

    const requestedItems = Array.isArray(req.body.items) ? req.body.items : [];

    if (!title || requestedItems.length === 0 || requestedItems.length > 100) {
      return res.status(400).json({
        error: 'Indica um título e pelo menos um item com quantidade.'
      });
    }

    const grouped = new Map();

    for (const entry of requestedItems) {
      const itemId = ensureInteger(entry.itemId, 1);
      const quantity = ensureInteger(entry.quantity, 1, 100000);

      if (!itemId || !quantity) {
        return res.status(400).json({
          error: 'Uma das quantidades é inválida.'
        });
      }

      grouped.set(itemId, (grouped.get(itemId) || 0) + quantity);
    }

    const itemQuery = db.prepare(`
      SELECT id, name, category, unit_price, clean_price, dirty_price, active
      FROM catalog_items
      WHERE id = ?
    `);

    const ingredientsQuery = db.prepare(`
      SELECT materials.id, materials.name, catalog_item_materials.quantity
      FROM catalog_item_materials
      INNER JOIN materials ON materials.id = catalog_item_materials.material_id
      WHERE catalog_item_materials.item_id = ? AND materials.active = 1
    `);

    const selections = [];
    const materialTotals = new Map();

    for (const [itemId, quantity] of grouped) {
      const item = itemQuery.get(itemId);

      if (!item || !item.active) {
        return res.status(400).json({
          error: 'Uma das receitas já não existe ou está desativada.'
        });
      }

      const ingredients = ingredientsQuery.all(itemId);

      if (!ingredients.length) {
        return res.status(400).json({
          error: `A receita "${item.name}" não tem materiais ativos.`
        });
      }

      selections.push({ item, quantity });

      for (const ingredient of ingredients) {
        const total = materialTotals.get(ingredient.id) || {
          materialId: ingredient.id,
          name: ingredient.name,
          quantity: 0
        };

        total.quantity += ingredient.quantity * quantity;
        materialTotals.set(ingredient.id, total);
      }
    }

    const createOrder = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO orders (title, description, status, payment_method, created_by)
        VALUES (?, ?, 'pending', 'materials', ?)
      `).run(title, description, req.user.id);

      const orderId = Number(result.lastInsertRowid);

      const insertItem = db.prepare(`
        INSERT INTO order_recipe_items (
          order_id,
          catalog_item_id,
          item_name,
          category,
          unit_price,
          clean_price,
          dirty_price,
          quantity
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertMaterial = db.prepare(`
        INSERT INTO order_material_totals (
          order_id,
          material_id,
          material_name,
          quantity
        )
        VALUES (?, ?, ?, ?)
      `);

      for (const selection of selections) {
        insertItem.run(
          orderId,
          selection.item.id,
          selection.item.name,
          selection.item.category,
          selection.item.unit_price,
          selection.item.clean_price,
          selection.item.dirty_price,
          selection.quantity
        );
      }

      for (const material of materialTotals.values()) {
        insertMaterial.run(
          orderId,
          material.materialId,
          material.name,
          material.quantity
        );
      }

      return orderId;
    });

    const id = createOrder();

    logAction(req.user.id, 'create_crafting_order', title);
    res.status(201).json({ order: getDetailedOrder(id) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/ammunation/catalog', requireAuth, requireAdmin, (req, res) => {
  const items = getCatalogItems(false)
    .filter((item) => item.category === 'Ammunation');

  res.json({ items });
});

app.post('/api/orders/ammunation', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const title = cleanText(req.body.title, 3, 100);
    const paymentMethod = req.body.paymentMethod === 'dirty' ? 'dirty' : 'clean';
    const requestedItems = Array.isArray(req.body.items) ? req.body.items : [];

    if (!title || requestedItems.length === 0 || requestedItems.length > 100) {
      return res.status(400).json({
        error: 'Indica um título e pelo menos um item com quantidade.'
      });
    }

    const grouped = new Map();

    for (const entry of requestedItems) {
      const itemId = ensureInteger(entry.itemId, 1);
      const quantity = ensureInteger(entry.quantity, 1, 100000);

      if (!itemId || !quantity) {
        return res.status(400).json({
          error: 'Uma das quantidades é inválida.'
        });
      }

      grouped.set(itemId, (grouped.get(itemId) || 0) + quantity);
    }

    const itemQuery = db.prepare(`
      SELECT id, name, category, unit_price, clean_price, dirty_price, active
      FROM catalog_items
      WHERE id = ?
    `);

    const selections = [];

    for (const [itemId, quantity] of grouped) {
      const item = itemQuery.get(itemId);

      if (!item || !item.active || item.category !== 'Ammunation') {
        return res.status(400).json({
          error: 'Um dos itens Ammunation já não existe ou está desativado.'
        });
      }

      selections.push({ item, quantity });
    }

    const createOrder = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO orders (title, description, status, payment_method, created_by)
        VALUES (?, '', 'pending', ?, ?)
      `).run(title, paymentMethod, req.user.id);

      const orderId = Number(result.lastInsertRowid);

      const insertItem = db.prepare(`
        INSERT INTO order_recipe_items (
          order_id,
          catalog_item_id,
          item_name,
          category,
          unit_price,
          clean_price,
          dirty_price,
          quantity
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const selection of selections) {
        insertItem.run(
          orderId,
          selection.item.id,
          selection.item.name,
          selection.item.category,
          selection.item.unit_price,
          selection.item.clean_price,
          selection.item.dirty_price,
          selection.quantity
        );
      }

      return orderId;
    });

    const id = createOrder();

    logAction(req.user.id, `create_ammunation_${paymentMethod}_order`, title);
    res.status(201).json({ order: getDetailedOrder(id) });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/orders/:id/status', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const id = ensureInteger(req.params.id, 1);
    const status = req.body.status;
    const allowed = ['pending', 'in_progress', 'completed', 'cancelled'];

    if (!id || !allowed.includes(status)) {
      return res.status(400).json({
        error: 'Estado de encomenda inválido.'
      });
    }

    const order = getOrderById(id);

    if (!order) {
      return res.status(404).json({
        error: 'Encomenda não encontrada.'
      });
    }

    db.prepare(`
      UPDATE orders
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, id);

    logAction(req.user.id, `order_${status}`, order.title);
    res.json({ order: publicOrder(getOrderById(id)) });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/orders/:id', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const id = ensureInteger(req.params.id, 1);

    if (!id) {
      return res.status(400).json({ error: 'Encomenda inválida.' });
    }

    const order = getOrderById(id);

    if (!order) {
      return res.status(404).json({
        error: 'Encomenda não encontrada.'
      });
    }

    db.prepare('DELETE FROM orders WHERE id = ?').run(id);

    logAction(req.user.id, 'delete_order', order.title);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/chest', requireAuth, (req, res) => {
  res.json(getChestResponse('chest_items', 'chest_logs'));
});

app.post('/api/chest', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const name = cleanText(req.body.name, 2, 80);

    if (!name) {
      return res.status(400).json({
        error: 'O nome do item deve ter entre 2 e 80 caracteres.'
      });
    }

    const result = db.prepare(`
      INSERT INTO chest_items (name, quantity)
      VALUES (?, 0)
    `).run(name);

    const item = db.prepare(`
      SELECT id, name, quantity, updated_at
      FROM chest_items
      WHERE id = ?
    `).get(result.lastInsertRowid);

    db.prepare(`
      INSERT INTO chest_logs (item_id, item_name, change_type, quantity, actor_id)
      VALUES (?, ?, 'create', 0, ?)
    `).run(item.id, item.name, req.user.id);

    logAction(req.user.id, 'create_chest_item', item.name);
    res.status(201).json({ item: publicChestItem(item) });
  } catch (error) {
    if (String(error.message).includes('UNIQUE constraint failed')) {
      return res.status(409).json({
        error: 'Já existe um item com esse nome no Baú 113.'
      });
    }

    next(error);
  }
});

app.patch('/api/chest/:id', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const id = ensureInteger(req.params.id, 1);
    const action = req.body.action === 'remove' ? 'remove' : 'add';
    const quantity = ensureInteger(req.body.quantity, 1, 1000000000);

    if (!id || !quantity) {
      return res.status(400).json({ error: 'Movimento de Baú 113 inválido.' });
    }

    const justification = resolveMovementJustification(req.body);

    if (justification.error) {
      return res.status(400).json({ error: justification.error });
    }

    const item = db.prepare(`
      SELECT id, name, quantity, updated_at
      FROM chest_items
      WHERE id = ?
    `).get(id);

    if (!item) {
      return res.status(404).json({ error: 'Item do Baú 113 não encontrado.' });
    }

    if (action === 'remove' && item.quantity < quantity) {
      return res.status(400).json({
        error: 'Não existe quantidade suficiente no Baú 113.'
      });
    }

    const newQuantity = action === 'add'
      ? item.quantity + quantity
      : item.quantity - quantity;

    db.prepare(`
      UPDATE chest_items
      SET quantity = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newQuantity, id);

    db.prepare(`
      INSERT INTO chest_logs (item_id, item_name, change_type, quantity, actor_id, reason, order_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, item.name, action, quantity, req.user.id, justification.reason, justification.orderId);

    const updated = db.prepare(`
      SELECT id, name, quantity, updated_at
      FROM chest_items
      WHERE id = ?
    `).get(id);

    logAction(req.user.id, `chest_${action}`, item.name);
    res.json({ item: publicChestItem(updated) });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/chest/:id', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const id = ensureInteger(req.params.id, 1);

    if (!id) {
      return res.status(400).json({ error: 'Item do Baú 113 inválido.' });
    }

    const item = db.prepare(`
      SELECT id, name, quantity
      FROM chest_items
      WHERE id = ?
    `).get(id);

    if (!item) {
      return res.status(404).json({ error: 'Item do Baú 113 não encontrado.' });
    }

    db.prepare(`
      INSERT INTO chest_logs (item_id, item_name, change_type, quantity, actor_id)
      VALUES (?, ?, 'delete', ?, ?)
    `).run(id, item.name, item.quantity, req.user.id);

    db.prepare('DELETE FROM chest_items WHERE id = ?').run(id);

    logAction(req.user.id, 'delete_chest_item', item.name);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

createChestRoutes(
  '/api/residents-chest',
  'residents_chest_items',
  'residents_chest_logs',
  requireResidentChiefOrAdmin
);

createChestRoutes(
  '/api/officials-chest',
  'officials_chest_items',
  'officials_chest_logs',
  requireOfficialsOrAdmin
);

createChestRoutes(
  '/api/orders-chest',
  'orders_chest_items',
  'orders_chest_logs',
  requireAdmin
);

app.post('/api/chest-transfers', requireAuth, (req, res, next) => {
  try {
    const fromKey = typeof req.body.fromChest === 'string' ? req.body.fromChest : '';
    const toKey = typeof req.body.toChest === 'string' ? req.body.toChest : '';
    const from = CHEST_CONFIG[fromKey];
    const to = CHEST_CONFIG[toKey];

    if (!from || !to || fromKey === toKey) {
      return res.status(400).json({ error: 'Baú de origem ou de destino inválido.' });
    }

    if (!from.canAccess(req.user.role) || !to.canAccess(req.user.role)) {
      return res.status(403).json({
        error: `Não tens permissões sobre o ${from.label} e/ou o ${to.label} para fazer esta transferência.`
      });
    }

    const name = cleanText(req.body.itemName, 2, 80);
    const quantity = ensureInteger(req.body.quantity, 1, 1000000000);

    if (!name || !quantity) {
      return res.status(400).json({ error: 'Indica um item e uma quantidade válidos.' });
    }

    const reasonResult = cleanReason(req.body.reason, { required: true });

    if (reasonResult.error) {
      return res.status(400).json({
        error: reasonResult.tooShortOrLong
          ? 'A justificação deve ter entre 3 e 300 caracteres.'
          : 'É obrigatório indicar uma justificação para transferir stock entre baús.'
      });
    }

    let orderId = null;

    if (req.body.orderId !== undefined && req.body.orderId !== null && req.body.orderId !== '') {
      orderId = ensureInteger(req.body.orderId, 1);

      if (!orderId || !db.prepare('SELECT id FROM orders WHERE id = ?').get(orderId)) {
        return res.status(400).json({ error: 'A encomenda associada é inválida ou não existe.' });
      }
    }

    const sourceItem = db.prepare(`
      SELECT id, name, quantity
      FROM ${from.itemsTable}
      WHERE name = ?
    `).get(name);

    if (!sourceItem) {
      return res.status(404).json({ error: `O item "${name}" não existe no ${from.label}.` });
    }

    if (sourceItem.quantity < quantity) {
      return res.status(400).json({
        error: `Não existe quantidade suficiente de "${sourceItem.name}" no ${from.label}.`
      });
    }

    const transferGroup = crypto.randomUUID();

    const performTransfer = db.transaction(() => {
      db.prepare(`
        UPDATE ${from.itemsTable}
        SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(quantity, sourceItem.id);

      let destItem = db.prepare(`
        SELECT id, name, quantity
        FROM ${to.itemsTable}
        WHERE name = ?
      `).get(sourceItem.name);

      if (!destItem) {
        const inserted = db.prepare(`
          INSERT INTO ${to.itemsTable} (name, quantity)
          VALUES (?, 0)
        `).run(sourceItem.name);

        destItem = { id: inserted.lastInsertRowid, name: sourceItem.name, quantity: 0 };
      }

      db.prepare(`
        UPDATE ${to.itemsTable}
        SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(quantity, destItem.id);

      db.prepare(`
        INSERT INTO ${from.logsTable}
          (item_id, item_name, change_type, quantity, actor_id, reason, order_id, transfer_group, counterpart_label)
        VALUES (?, ?, 'transfer_out', ?, ?, ?, ?, ?, ?)
      `).run(
        sourceItem.id,
        sourceItem.name,
        quantity,
        req.user.id,
        reasonResult.reason,
        orderId,
        transferGroup,
        to.label
      );

      db.prepare(`
        INSERT INTO ${to.logsTable}
          (item_id, item_name, change_type, quantity, actor_id, reason, order_id, transfer_group, counterpart_label)
        VALUES (?, ?, 'transfer_in', ?, ?, ?, ?, ?, ?)
      `).run(
        destItem.id,
        sourceItem.name,
        quantity,
        req.user.id,
        reasonResult.reason,
        orderId,
        transferGroup,
        from.label
      );
    });

    performTransfer();

    logAction(
      req.user.id,
      'chest_transfer',
      `${sourceItem.name} (${quantity}) de ${from.label} para ${to.label}`
    );

    const fromItem = db.prepare(`
      SELECT id, name, quantity, updated_at FROM ${from.itemsTable} WHERE id = ?
    `).get(sourceItem.id);

    const toItem = db.prepare(`
      SELECT id, name, quantity, updated_at FROM ${to.itemsTable} WHERE name = ?
    `).get(sourceItem.name);

    res.status(201).json({
      transferGroup,
      fromChest: fromKey,
      toChest: toKey,
      fromItem: publicChestItem(fromItem),
      toItem: publicChestItem(toItem)
    });
  } catch (error) {
    next(error);
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.use((error, req, res, next) => {
  console.error(error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    error: 'Ocorreu um erro interno no servidor.'
  });
});

app.listen(port, () => {
  console.log(`NovaCore disponível em http://localhost:${port}`);
});
