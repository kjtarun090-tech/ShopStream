import 'dotenv/config';
import http from 'http';
import path from 'path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer as createViteServer } from 'vite';
import { db, initDatabase } from './server/db.ts';
import {
  getAdminAuthStatus,
  hashPassword,
  optionalAuth,
  requireAdmin,
  requireAuth,
  signJwt,
  verifyAdminPasscode,
  verifyPassword,
  type AuthenticatedRequest,
} from './server/auth.ts';
import { rebuildSearchIndex, searchCatalog } from './server/search.ts';
import {
  attachWebSocketServer,
  broadcastInventorySnapshot,
  broadcastOrderStatusUpdate,
  getRecentEvents,
  publishEvent,
} from './server/events.ts';

initDatabase();
rebuildSearchIndex();

const app = express();
app.use(express.json({ limit: '1mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
attachWebSocketServer(wss);

wss.on('connection', (ws) => {
  ws.send(
    JSON.stringify({
      type: 'connected',
      timestamp: new Date().toISOString(),
    })
  );
});

setInterval(() => {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.ping();
    }
  });
}, 25000);

// Health Check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'shopstream-api' });
});

// Customer Authentication
app.post('/api/auth/register', (req, res) => {
  const { name, email, password, address = '', phone = '' } = req.body ?? {};
  if (
    typeof name !== 'string' ||
    name.trim().length < 2 ||
    typeof email !== 'string' ||
    !email.includes('@') ||
    typeof password !== 'string' ||
    password.length < 6
  ) {
    return res.status(400).json({
      error: 'Please provide a valid name, email address, and password (minimum 6 characters).',
    });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const passwordHash = hashPassword(password);
  const info = db
    .prepare(
      'INSERT INTO users (name, email, password_hash, role, address, phone) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(name.trim(), normalizedEmail, passwordHash, 'customer', String(address).trim(), String(phone).trim());

  const userId = Number(info.lastInsertRowid);
  const token = signJwt({
    sub: userId,
    email: normalizedEmail,
    name: name.trim(),
    role: 'customer',
  });

  res.status(201).json({
    token,
    user: {
      id: userId,
      name: name.trim(),
      email: normalizedEmail,
      role: 'customer',
      address: String(address).trim(),
      phone: String(phone).trim(),
    },
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = db
    .prepare('SELECT id, name, email, password_hash, role, address, phone FROM users WHERE email = ?')
    .get(normalizedEmail) as
    | {
        id: number;
        name: string;
        email: string;
        password_hash: string;
        role: 'customer' | 'admin';
        address: string;
        phone: string;
      }
    | undefined;

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = signJwt({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      address: user.address,
      phone: user.phone,
    },
  });
});

app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
  if (req.user?.sub === 0 && req.user.role === 'admin') {
    return res.json({
      user: {
        id: 0,
        name: 'Inventory Administrator',
        email: req.user.email,
        role: 'admin',
        address: '',
        phone: '',
      },
    });
  }
  const user = db
    .prepare('SELECT id, name, email, role, address, phone, created_at FROM users WHERE id = ?')
    .get(req.user!.sub);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }
  res.json({ user });
});

app.put('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const { name, address, phone } = req.body ?? {};
  if (typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ error: 'Name must be at least 2 characters.' });
  }
  db.prepare('UPDATE users SET name = ?, address = ?, phone = ? WHERE id = ?').run(
    name.trim(),
    typeof address === 'string' ? address.trim() : '',
    typeof phone === 'string' ? phone.trim() : '',
    req.user!.sub
  );
  const updated = db
    .prepare('SELECT id, name, email, role, address, phone FROM users WHERE id = ?')
    .get(req.user!.sub);
  res.json({ user: updated });
});

// Admin Authentication (First-run Claim or Passcode Verification)
app.get('/api/admin/auth-status', (_req, res) => {
  res.json(getAdminAuthStatus());
});

app.post('/api/admin/claim', (req, res) => {
  const status = getAdminAuthStatus();
  if (status.configuredViaEnv || status.claimed) {
    return res.status(409).json({ error: 'Administrator passcode is already configured.' });
  }

  const { passcode } = req.body ?? {};
  if (typeof passcode !== 'string' || passcode.trim().length < 6) {
    return res.status(400).json({ error: 'Choose an admin passcode with at least 6 characters.' });
  }

  const hash = hashPassword(passcode.trim());
  const claimTx = db.transaction(() => {
    const existing = db.prepare('SELECT id FROM admin_config WHERE id = 1').get();
    if (existing) {
      throw new Error('ALREADY_CLAIMED');
    }
    db.prepare('INSERT INTO admin_config (id, passcode_hash) VALUES (1, ?)').run(hash);
  });

  try {
    claimTx();
  } catch {
    return res.status(409).json({ error: 'Administrator passcode is already configured.' });
  }

  const token = signJwt({
    sub: 0,
    email: 'admin@shopstream.local',
    name: 'Inventory Administrator',
    role: 'admin',
  });

  res.status(201).json({ token, role: 'admin' });
});

app.post('/api/admin/login', (req, res) => {
  const status = getAdminAuthStatus();
  if (!status.claimed) {
    return res.status(400).json({ error: 'Administrator passcode not claimed yet.' });
  }

  const { passcode } = req.body ?? {};
  if (typeof passcode !== 'string' || !verifyAdminPasscode(passcode.trim())) {
    return res.status(401).json({ error: 'Invalid administrator passcode.' });
  }

  const token = signJwt({
    sub: 0,
    email: 'admin@shopstream.local',
    name: 'Inventory Administrator',
    role: 'admin',
  });

  res.json({ token, role: 'admin' });
});

// Categories
app.get('/api/categories', (_req, res) => {
  const categories = db
    .prepare(`
      SELECT c.*, COUNT(p.id) AS product_count
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.id
      ORDER BY c.name ASC
    `)
    .all();
  res.json({ categories });
});

app.post('/api/admin/categories', requireAdmin, (req, res) => {
  const { name, description = '' } = req.body ?? {};
  if (typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ error: 'Category name is required.' });
  }
  const cleanName = name.trim();
  const slug = cleanName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const existing = db.prepare('SELECT id FROM categories WHERE slug = ? OR name = ?').get(slug, cleanName);
  if (existing) {
    return res.status(409).json({ error: 'Category already exists.' });
  }

  const info = db
    .prepare('INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)')
    .run(cleanName, slug, String(description).trim());

  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ category });
});

// Intelligent Typo-Tolerant Product Search & Browsing
app.get('/api/products', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const category = typeof req.query.category === 'string' ? req.query.category : 'all';
  const minPrice = req.query.minPrice ? Number(req.query.minPrice) : undefined;
  const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : undefined;
  const inStockOnly = req.query.inStockOnly === 'true';

  const result = searchCatalog({
    q,
    category,
    minPriceCents: Number.isFinite(minPrice) ? Math.round(minPrice! * 100) : undefined,
    maxPriceCents: Number.isFinite(maxPrice) ? Math.round(maxPrice! * 100) : undefined,
    inStockOnly,
  });

  res.json(result);
});

app.get('/api/products/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid product ID.' });
  }
  const product = db
    .prepare(`
      SELECT
        p.*,
        c.name AS category_name,
        c.slug AS category_slug,
        ROUND(COALESCE(AVG(r.rating), 0), 1) AS rating_avg,
        COUNT(r.id) AS review_count
      FROM products p
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN product_reviews r ON r.product_id = p.id
      WHERE p.id = ?
      GROUP BY p.id
    `)
    .get(id);
  if (!product) {
    return res.status(404).json({ error: 'Product not found.' });
  }
  res.json({ product });
});

// Product Reviews & Star Ratings
app.get('/api/products/:id/reviews', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid product ID.' });
  }
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(id);
  if (!product) {
    return res.status(404).json({ error: 'Product not found.' });
  }
  const reviews = db
    .prepare('SELECT * FROM product_reviews WHERE product_id = ? ORDER BY id DESC')
    .all(id);
  const summary = db
    .prepare(
      'SELECT ROUND(COALESCE(AVG(rating), 0), 1) AS rating_avg, COUNT(*) AS review_count FROM product_reviews WHERE product_id = ?'
    )
    .get(id) as { rating_avg: number; review_count: number };

  res.json({ reviews, ...summary });
});

app.post('/api/products/:id/reviews', optionalAuth, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid product ID.' });
  }
  const product = db.prepare('SELECT id, sku, name FROM products WHERE id = ?').get(id) as
    | { id: number; sku: string; name: string }
    | undefined;
  if (!product) {
    return res.status(404).json({ error: 'Product not found.' });
  }

  const { reviewerName, rating, comment = '' } = req.body ?? {};
  const numericRating = Number(rating);
  const cleanName =
    typeof reviewerName === 'string' && reviewerName.trim().length >= 2
      ? reviewerName.trim().slice(0, 80)
      : req.user?.name || '';

  if (cleanName.length < 2) {
    return res.status(400).json({ error: 'Please provide your name (at least 2 characters).' });
  }
  if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
    return res.status(400).json({ error: 'Rating must be an integer between 1 and 5.' });
  }

  const cleanComment = typeof comment === 'string' ? comment.trim().slice(0, 600) : '';
  const info = db
    .prepare('INSERT INTO product_reviews (product_id, reviewer_name, rating, comment) VALUES (?, ?, ?, ?)')
    .run(id, cleanName, numericRating, cleanComment);

  const review = db.prepare('SELECT * FROM product_reviews WHERE id = ?').get(info.lastInsertRowid);
  const summary = db
    .prepare(
      'SELECT ROUND(COALESCE(AVG(rating), 0), 1) AS rating_avg, COUNT(*) AS review_count FROM product_reviews WHERE product_id = ?'
    )
    .get(id) as { rating_avg: number; review_count: number };

  publishEvent('shopstream.search', 'product.reviewed', {
    productId: product.id,
    sku: product.sku,
    productName: product.name,
    rating: numericRating,
    ratingAvg: summary.rating_avg,
    reviewCount: summary.review_count,
  });
  broadcastInventorySnapshot([id]);

  res.status(201).json({ review, ...summary });
});

// Transaction-Safe Checkout & Order Placement (ACID Row-Lock Equivalent)
app.post('/api/orders', optionalAuth, (req: AuthenticatedRequest, res) => {
  const { customerName, customerEmail, shippingAddress, items } = req.body ?? {};
  if (
    typeof customerName !== 'string' ||
    customerName.trim().length < 2 ||
    typeof customerEmail !== 'string' ||
    !customerEmail.includes('@') ||
    typeof shippingAddress !== 'string' ||
    shippingAddress.trim().length < 5 ||
    !Array.isArray(items) ||
    items.length === 0
  ) {
    return res.status(400).json({
      error: 'Please provide customer name, email, shipping address, and at least one cart item.',
    });
  }

  // Normalize & validate line items
  const normalizedItems: { productId: number; quantity: number }[] = [];
  for (const item of items) {
    const productId = Number(item?.productId);
    const quantity = Number(item?.quantity);
    if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity <= 0 || quantity > 99) {
      return res.status(400).json({ error: 'Invalid cart item quantity.' });
    }
    const existing = normalizedItems.find((i) => i.productId === productId);
    if (existing) {
      existing.quantity += quantity;
    } else {
      normalizedItems.push({ productId, quantity });
    }
  }

  interface StockConflict {
    productId: number;
    productName: string;
    requested: number;
    available: number;
  }

  let orderResult: {
    orderId: number;
    orderNumber: string;
    totalCents: number;
    updatedProducts: { id: number; name: string; sku: string; previousStock: number; newStock: number; lowStockThreshold: number }[];
  };

  const checkoutTx = db.transaction(() => {
    const conflicts: StockConflict[] = [];
    const verifiedLines: {
      productId: number;
      name: string;
      sku: string;
      priceCents: number;
      quantity: number;
      previousStock: number;
      newStock: number;
      lowStockThreshold: number;
    }[] = [];

    let totalCents = 0;

    for (const line of normalizedItems) {
      const product = db
        .prepare('SELECT id, name, sku, price_cents, stock, low_stock_threshold FROM products WHERE id = ?')
        .get(line.productId) as
        | {
            id: number;
            name: string;
            sku: string;
            price_cents: number;
            stock: number;
            low_stock_threshold: number;
          }
        | undefined;

      if (!product) {
        throw { status: 404, message: `Product #${line.productId} no longer exists.` };
      }

      if (product.stock < line.quantity) {
        conflicts.push({
          productId: product.id,
          productName: product.name,
          requested: line.quantity,
          available: product.stock,
        });
      } else {
        totalCents += product.price_cents * line.quantity;
        verifiedLines.push({
          productId: product.id,
          name: product.name,
          sku: product.sku,
          priceCents: product.price_cents,
          quantity: line.quantity,
          previousStock: product.stock,
          newStock: product.stock - line.quantity,
          lowStockThreshold: product.low_stock_threshold,
        });
      }
    }

    if (conflicts.length > 0) {
      throw {
        status: 409,
        message: 'Insufficient inventory for one or more items.',
        conflicts,
      };
    }

    const orderNumber = `SS-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
    const userId = req.user && req.user.sub > 0 ? req.user.sub : null;

    const orderInsert = db
      .prepare(`
        INSERT INTO orders (order_number, user_id, customer_name, customer_email, shipping_address, status, total_cents)
        VALUES (?, ?, ?, ?, ?, 'Confirmed', ?)
      `)
      .run(
        orderNumber,
        userId,
        customerName.trim(),
        customerEmail.trim().toLowerCase(),
        shippingAddress.trim(),
        totalCents
      );

    const orderId = Number(orderInsert.lastInsertRowid);
    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, sku, quantity, unit_price_cents)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const updateStock = db.prepare(`
      UPDATE products SET stock = stock - ?, updated_at = datetime('now') WHERE id = ? AND stock >= ?
    `);

    for (const line of verifiedLines) {
      const updateResult = updateStock.run(line.quantity, line.productId, line.quantity);
      if (updateResult.changes !== 1) {
        throw { status: 409, message: `Concurrent inventory conflict on ${line.name}.` };
      }
      insertItem.run(
        orderId,
        line.productId,
        line.name,
        line.sku,
        line.quantity,
        line.priceCents
      );
    }

    return {
      orderId,
      orderNumber,
      totalCents,
      updatedProducts: verifiedLines.map((l) => ({
        id: l.productId,
        name: l.name,
        sku: l.sku,
        previousStock: l.previousStock,
        newStock: l.newStock,
        lowStockThreshold: l.lowStockThreshold,
      })),
    };
  });

  try {
    orderResult = checkoutTx.immediate();
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string; conflicts?: StockConflict[] };
    if (e.status === 409) {
      return res.status(409).json({
        error: e.message || 'Insufficient inventory.',
        conflicts: e.conflicts ?? [],
      });
    }
    if (e.status === 404) {
      return res.status(404).json({ error: e.message });
    }
    return res.status(500).json({ error: 'Order transaction failed.' });
  }

  // Event-driven pipeline: emit order & inventory events, re-index OpenSearch, broadcast WebSocket sync
  publishEvent('shopstream.orders', 'order.placed', {
    orderNumber: orderResult.orderNumber,
    totalCents: orderResult.totalCents,
    itemCount: normalizedItems.reduce((sum, i) => sum + i.quantity, 0),
  });

  for (const prod of orderResult.updatedProducts) {
    publishEvent('shopstream.inventory', 'inventory.updated', {
      productId: prod.id,
      sku: prod.sku,
      productName: prod.name,
      previousStock: prod.previousStock,
      newStock: prod.newStock,
      delta: prod.newStock - prod.previousStock,
      source: 'online_checkout',
    });

    if (prod.newStock <= prod.lowStockThreshold) {
      publishEvent('shopstream.inventory', 'inventory.low_stock', {
        productId: prod.id,
        sku: prod.sku,
        productName: prod.name,
        remainingStock: prod.newStock,
        threshold: prod.lowStockThreshold,
      });
    }
  }

  broadcastInventorySnapshot(orderResult.updatedProducts.map((p) => p.id));

  const createdOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderResult.orderId);
  const createdItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderResult.orderId);

  res.status(201).json({
    order: createdOrder,
    items: createdItems,
  });
});

// Customer Orders History / Order Lookup
app.get('/api/orders', optionalAuth, (req: AuthenticatedRequest, res) => {
  const orderNumber = typeof req.query.orderNumber === 'string' ? req.query.orderNumber.trim() : '';
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';

  if (orderNumber && email) {
    const order = db
      .prepare('SELECT * FROM orders WHERE order_number = ? AND customer_email = ?')
      .get(orderNumber, email) as { id: number } | undefined;
    if (!order) {
      return res.status(404).json({ error: 'Order not found for that order number and email.' });
    }
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    return res.json({ orders: [{ ...order, items }] });
  }

  if (!req.user) {
    return res.status(401).json({ error: 'Sign in or provide order number and email to view orders.' });
  }

  const orders =
    req.user.role === 'admin'
      ? (db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 50').all() as { id: number }[])
      : (db
          .prepare('SELECT * FROM orders WHERE user_id = ? OR customer_email = ? ORDER BY id DESC LIMIT 50')
          .all(req.user.sub, req.user.email) as { id: number }[]);

  const getItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  const enriched = orders.map((o) => ({
    ...o,
    items: getItems.all(o.id),
  }));

  res.json({ orders: enriched });
});

// Admin Inventory Overview & Operations
app.get('/api/admin/overview', requireAdmin, (_req, res) => {
  const products = db
    .prepare(`
      SELECT p.*, c.name AS category_name, c.slug AS category_slug
      FROM products p
      JOIN categories c ON c.id = p.category_id
      ORDER BY p.id ASC
    `)
    .all();

  const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 50').all() as { id: number }[];
  const getItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  const enrichedOrders = orders.map((o) => ({ ...o, items: getItems.all(o.id) }));

  const stats = db
    .prepare(`
      SELECT
        COUNT(*) AS totalProducts,
        COALESCE(SUM(stock), 0) AS totalUnits,
        COALESCE(SUM(CASE WHEN stock <= low_stock_threshold AND stock > 0 THEN 1 ELSE 0 END), 0) AS lowStockCount,
        COALESCE(SUM(CASE WHEN stock = 0 THEN 1 ELSE 0 END), 0) AS outOfStockCount
      FROM products
    `)
    .get() as Record<string, number>;

  const revenue = db
    .prepare('SELECT COUNT(*) AS totalOrders, COALESCE(SUM(total_cents), 0) AS totalRevenueCents FROM orders')
    .get() as Record<string, number>;

  const events = getRecentEvents(35);

  res.json({
    products,
    orders: enrichedOrders,
    stats: { ...stats, ...revenue },
    events,
  });
});

app.post('/api/admin/products', requireAdmin, (req, res) => {
  const { sku, name, description, categoryId, priceCents, stock, lowStockThreshold = 5, imageUrl, featured = false } =
    req.body ?? {};

  if (
    typeof sku !== 'string' ||
    sku.trim().length < 2 ||
    typeof name !== 'string' ||
    name.trim().length < 2 ||
    typeof description !== 'string' ||
    !Number.isInteger(Number(categoryId)) ||
    !Number.isInteger(Number(priceCents)) ||
    Number(priceCents) < 0 ||
    !Number.isInteger(Number(stock)) ||
    Number(stock) < 0
  ) {
    return res.status(400).json({ error: 'Invalid product fields provided.' });
  }

  const cleanName = name.trim();
  const slug = `${cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString().slice(-4)}`;
  const safeImageUrl =
    typeof imageUrl === 'string' && imageUrl.startsWith('/src/assets/images/')
      ? imageUrl
      : '/src/assets/images/product_bluetooth_headphones_1795258719516.jpg';

  try {
    const info = db
      .prepare(`
        INSERT INTO products (sku, name, slug, description, category_id, price_cents, stock, low_stock_threshold, image_url, featured)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        sku.trim().toUpperCase(),
        cleanName,
        slug,
        description.trim(),
        Number(categoryId),
        Number(priceCents),
        Number(stock),
        Number(lowStockThreshold) || 5,
        safeImageUrl,
        featured ? 1 : 0
      );

    const productId = Number(info.lastInsertRowid);
    publishEvent('shopstream.inventory', 'product.created', {
      productId,
      sku: sku.trim().toUpperCase(),
      productName: cleanName,
      stock: Number(stock),
    });
    broadcastInventorySnapshot([productId]);

    const product = db
      .prepare('SELECT p.*, c.name AS category_name, c.slug AS category_slug FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ?')
      .get(productId);

    res.status(201).json({ product });
  } catch {
    res.status(409).json({ error: 'A product with this SKU already exists.' });
  }
});

app.put('/api/admin/products/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid product ID.' });
  }

  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as
    | { id: number; name: string; sku: string; stock: number; price_cents: number; low_stock_threshold: number }
    | undefined;
  if (!existing) {
    return res.status(404).json({ error: 'Product not found.' });
  }

  const { name, description, categoryId, priceCents, stock, lowStockThreshold, featured } = req.body ?? {};
  const nextName = typeof name === 'string' && name.trim() ? name.trim() : existing.name;
  const nextPrice = Number.isInteger(Number(priceCents)) && Number(priceCents) >= 0 ? Number(priceCents) : existing.price_cents;
  const nextStock = Number.isInteger(Number(stock)) && Number(stock) >= 0 ? Number(stock) : existing.stock;
  const nextThreshold =
    Number.isInteger(Number(lowStockThreshold)) && Number(lowStockThreshold) >= 0
      ? Number(lowStockThreshold)
      : existing.low_stock_threshold;

  db.prepare(`
    UPDATE products
    SET name = COALESCE(?, name),
        description = COALESCE(?, description),
        category_id = COALESCE(?, category_id),
        price_cents = ?,
        stock = ?,
        low_stock_threshold = ?,
        featured = COALESCE(?, featured),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    nextName,
    typeof description === 'string' ? description.trim() : null,
    Number.isInteger(Number(categoryId)) ? Number(categoryId) : null,
    nextPrice,
    nextStock,
    nextThreshold,
    typeof featured === 'boolean' ? (featured ? 1 : 0) : null,
    id
  );

  publishEvent('shopstream.inventory', 'inventory.updated', {
    productId: id,
    sku: existing.sku,
    productName: nextName,
    previousStock: existing.stock,
    newStock: nextStock,
    delta: nextStock - existing.stock,
    source: 'admin_catalog_edit',
  });
  broadcastInventorySnapshot([id]);

  const updated = db
    .prepare('SELECT p.*, c.name AS category_name, c.slug AS category_slug FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ?')
    .get(id);

  res.json({ product: updated });
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid product ID.' });
  }

  const existing = db.prepare('SELECT id, sku, name FROM products WHERE id = ?').get(id) as
    | { id: number; sku: string; name: string }
    | undefined;
  if (!existing) {
    return res.status(404).json({ error: 'Product not found.' });
  }

  const hasOrders = db.prepare('SELECT COUNT(*) AS count FROM order_items WHERE product_id = ?').get(id) as {
    count: number;
  };
  if (hasOrders.count > 0) {
    return res.status(409).json({
      error: 'Cannot delete a product linked to existing order history. Set stock to 0 instead.',
    });
  }

  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  publishEvent('shopstream.inventory', 'product.deleted', {
    productId: id,
    sku: existing.sku,
    productName: existing.name,
  });
  broadcastInventorySnapshot();

  res.json({ deletedId: id });
});

// Physical Store POS Sale / Warehouse Restock (Atomic Delta Adjustment)
app.post('/api/admin/products/:id/adjust-stock', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const delta = Number(req.body?.delta);
  const source = typeof req.body?.source === 'string' ? req.body.source : 'warehouse_adjustment';

  if (!Number.isInteger(id) || !Number.isInteger(delta) || delta === 0) {
    return res.status(400).json({ error: 'Valid product ID and non-zero integer delta are required.' });
  }

  const adjustTx = db.transaction(() => {
    const product = db
      .prepare('SELECT id, sku, name, stock, low_stock_threshold FROM products WHERE id = ?')
      .get(id) as
      | { id: number; sku: string; name: string; stock: number; low_stock_threshold: number }
      | undefined;

    if (!product) {
      throw { status: 404, message: 'Product not found.' };
    }

    const nextStock = product.stock + delta;
    if (nextStock < 0) {
      throw { status: 409, message: `Insufficient stock. Only ${product.stock} units available.` };
    }

    db.prepare("UPDATE products SET stock = ?, updated_at = datetime('now') WHERE id = ?").run(nextStock, id);
    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      previousStock: product.stock,
      newStock: nextStock,
      lowStockThreshold: product.low_stock_threshold,
    };
  });

  let result;
  try {
    result = adjustTx.immediate();
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    return res.status(e.status || 500).json({ error: e.message || 'Stock adjustment failed.' });
  }

  publishEvent('shopstream.inventory', 'inventory.updated', {
    productId: result.productId,
    sku: result.sku,
    productName: result.name,
    previousStock: result.previousStock,
    newStock: result.newStock,
    delta,
    source,
  });

  if (result.newStock <= result.lowStockThreshold) {
    publishEvent('shopstream.inventory', 'inventory.low_stock', {
      productId: result.productId,
      sku: result.sku,
      productName: result.name,
      remainingStock: result.newStock,
      threshold: result.lowStockThreshold,
    });
  }

  broadcastInventorySnapshot([id]);

  const updated = db
    .prepare('SELECT p.*, c.name AS category_name, c.slug AS category_slug FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ?')
    .get(id);

  res.json({ product: updated });
});

app.patch('/api/admin/orders/:id/status', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body ?? {};
  const allowedStatuses = ['Confirmed', 'Preparing Shipment', 'Shipped', 'Delivered', 'Cancelled'];
  if (!Number.isInteger(id) || !allowedStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid order ID or status.' });
  }

  const order = db.prepare('SELECT id, order_number, status FROM orders WHERE id = ?').get(id) as
    | { id: number; order_number: string; status: string }
    | undefined;
  if (!order) {
    return res.status(404).json({ error: 'Order not found.' });
  }

  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
  publishEvent('shopstream.orders', 'order.status_updated', {
    orderId: order.id,
    orderNumber: order.order_number,
    previousStatus: order.status,
    newStatus: status,
  });
  broadcastOrderStatusUpdate(order.id, order.order_number, status);

  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  res.json({ order: updated });
});

app.post('/api/orders/status-batch', (req, res) => {
  const queries = req.body?.orders;
  if (!Array.isArray(queries) || queries.length === 0) {
    return res.json({ statuses: [] });
  }
  const stmt = db.prepare('SELECT id, order_number, status FROM orders WHERE order_number = ? AND customer_email = ?');
  const statuses: { id: number; order_number: string; status: string }[] = [];
  for (const q of queries.slice(0, 25)) {
    if (typeof q?.orderNumber === 'string' && typeof q?.email === 'string') {
      const row = stmt.get(q.orderNumber.trim(), q.email.trim().toLowerCase()) as
        | { id: number; order_number: string; status: string }
        | undefined;
      if (row) statuses.push(row);
    }
  }
  res.json({ statuses });
});

app.get('/api/admin/events', requireAdmin, (_req, res) => {
  res.json({ events: getRecentEvents(50) });
});

async function startServer() {
  const PORT = 3000;

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`ShopStream running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
