import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'shopstream.db');
export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'customer',
      address TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admin_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      passcode_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
      low_stock_threshold INTEGER NOT NULL DEFAULT 5,
      image_url TEXT NOT NULL,
      featured INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      user_id INTEGER,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      shipping_address TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Confirmed',
      total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      sku TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      processing_ms REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS product_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      reviewer_name TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
  `);

  const insertCategory = db.prepare(
    'INSERT OR IGNORE INTO categories (name, slug, description) VALUES (?, ?, ?)'
  );
  const seedCategories = [
    ['Audio', 'audio', 'Reference headphones, studio monitors, and acoustic speakers'],
    ['Peripherals', 'peripherals', 'CNC aluminum keyboards and precision input hardware'],
    ['Wearables', 'wearables', 'Titanium smartwatches and connected health instruments'],
    ['Connectivity', 'connectivity', 'Thunderbolt docks, power delivery, and studio cabling'],
    ['Workspace', 'workspace', 'Architectural desk lighting and studio task hardware'],
    ['Photography', 'photography', 'Compact rangefinder cameras and prime optical gear'],
    ['Espresso & Kitchen', 'espresso-kitchen', 'Single-dose grinders and precision brewing instruments'],
    ['Home & Living', 'home-living', 'Minimalist electric kettles and tactile home objects'],
    ['Travel & Carry', 'travel-carry', 'Weatherproof ballistic-nylon backpacks and modular carry'],
  ];
  for (const cat of seedCategories) {
    insertCategory.run(...cat);
  }

  const getCatId = (slug: string) =>
    (db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug) as { id: number }).id;

  const insertProduct = db.prepare(`
    INSERT OR IGNORE INTO products (sku, name, slug, description, category_id, price_cents, stock, low_stock_threshold, image_url, featured)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seedProducts = [
    [
      'SS-AUD-101',
      'Studio Wireless Bluetooth Headphones',
      'studio-wireless-bluetooth-headphones',
      'Closed-back planar magnetic Bluetooth headphones with adaptive active noise cancellation, 48-hour battery, and anodized aluminum yokes.',
      getCatId('audio'),
      32900,
      10,
      4,
      '/src/assets/images/product_bluetooth_headphones_1795258719516.jpg',
      1,
    ],
    [
      'SS-PER-204',
      'K75 Anodized Mechanical Keyboard',
      'k75-anodized-mechanical-keyboard',
      '75% CNC-milled silver aluminum wireless mechanical keyboard with gasket-mounted tactile switches and PBT dye-sub keycaps.',
      getCatId('peripherals'),
      24900,
      14,
      5,
      '/src/assets/images/product_mechanical_keyboard_1795258718563.jpg',
      1,
    ],
    [
      'SS-WRB-302',
      'Chrono Titanium Smartwatch',
      'chrono-titanium-smartwatch',
      'Grade-5 brushed titanium timepiece with sapphire crystal display, dual-frequency GPS, and breathable braided slate strap.',
      getCatId('wearables'),
      44900,
      7,
      4,
      '/src/assets/images/product_smartwatch_titanium_1795258718713.jpg',
      1,
    ],
    [
      'SS-AUD-108',
      'Nordic Acoustic Studio Speaker',
      'nordic-acoustic-studio-speaker',
      '360-degree omnidirectional wireless speaker wrapped in Kvadrat acoustic wool with a precision knurled aluminum rotary dial.',
      getCatId('audio'),
      38900,
      3,
      5,
      '/src/assets/images/product_studio_speaker_1795258718603.jpg',
      0,
    ],
    [
      'SS-CON-401',
      'Thunderbolt 4 Pro Studio Dock',
      'thunderbolt-4-pro-studio-dock',
      '12-port CNC aluminum desktop hub delivering 96W host charging, dual 4K 60Hz display output, and 2.5GbE wired networking.',
      getCatId('connectivity'),
      27900,
      18,
      5,
      '/src/assets/images/product_usb_hub_dock_1795258718104.jpg',
      0,
    ],
    [
      'SS-AUD-115',
      'Acoustic Reference Monitor Bundle',
      'acoustic-reference-monitor-bundle',
      'Complete desk listening suite pairing wireless studio headphones with a calibrated aluminum portable speaker and travel sleeve.',
      getCatId('audio'),
      64900,
      5,
      3,
      '/src/assets/images/hero_shopstream_showcase_1795258718450.jpg',
      1,
    ],
    [
      'SS-WRK-501',
      'Cantilever Architectural LED Desk Lamp',
      'cantilever-architectural-led-desk-lamp',
      'Precision-balanced anodized aluminum and matte obsidian task lamp with high-CRI 97+ glare-free optics and touch dimming.',
      getCatId('workspace'),
      21900,
      12,
      4,
      '/src/assets/images/product_desk_lamp_aluminum_1795260059076.jpg',
      1,
    ],
    [
      'SS-PHT-601',
      'Aurora R1-D Mirrorless Rangefinder Camera',
      'aurora-r1d-mirrorless-rangefinder-camera',
      'Full-frame brushed silver and pebbled leather rangefinder paired with a fast 35mm f/1.8 prime lens and mechanical shutter dial.',
      getCatId('photography'),
      149900,
      4,
      3,
      '/src/assets/images/product_mirrorless_camera_1795260059697.jpg',
      1,
    ],
    [
      'SS-ESP-701',
      'Grain Single-Dose Espresso Grinder',
      'grain-single-dose-espresso-grinder',
      '64mm flat-burr low-retention electric coffee grinder with stepless micrometric collar and magnetic brushed aluminum dosing cup.',
      getCatId('espresso-kitchen'),
      36900,
      9,
      4,
      '/src/assets/images/product_espresso_grinder_1795260060266.jpg',
      1,
    ],
    [
      'SS-HOM-801',
      'Stagg Walnut Gooseneck Pour-Over Kettle',
      'stagg-walnut-gooseneck-pourover-kettle',
      'PID temperature-controlled matte obsidian electric kettle with precision fluted spout and solid American walnut handle.',
      getCatId('home-living'),
      19500,
      15,
      5,
      '/src/assets/images/product_ceramic_kettle_1795260060546.jpg',
      0,
    ],
    [
      'SS-TRV-901',
      'Nomad 22L Weatherproof Tech Backpack',
      'nomad-22l-weatherproof-tech-backpack',
      'Structured 1680D ballistic-nylon commuter pack with waterproof YKK AquaGuard zippers and suspended 16-inch laptop vault.',
      getCatId('travel-carry'),
      23500,
      11,
      4,
      '/src/assets/images/product_travel_backpack_1795260060771.jpg',
      0,
    ],
    [
      'SS-PER-212',
      'MagAlloy Wireless Studio Mouse',
      'magalloy-wireless-studio-mouse',
      'Sculpted magnesium-alloy ergonomic mouse featuring a machined aluminum electromagnetic scroll wheel and 8000 DPI glass-tracking sensor.',
      getCatId('peripherals'),
      13900,
      20,
      6,
      '/src/assets/images/product_wireless_mouse_1795260060654.jpg',
      0,
    ],
  ];

  for (const p of seedProducts) {
    insertProduct.run(...p);
  }

  // Seed initial product reviews idempotently per SKU
  const reviewCountForProduct = db.prepare('SELECT COUNT(*) as count FROM product_reviews WHERE product_id = ?');
  const getProdIdBySku = db.prepare('SELECT id FROM products WHERE sku = ?');
  const insertReview = db.prepare(
    'INSERT INTO product_reviews (product_id, reviewer_name, rating, comment) VALUES (?, ?, ?, ?)'
  );

  const seedReviews: Record<string, { name: string; rating: number; comment: string }[]> = {
    'SS-AUD-101': [
      { name: 'Elena R.', rating: 5, comment: 'Crisp planar detail and genuinely effortless noise cancellation on flights.' },
      { name: 'Marcus T.', rating: 5, comment: 'Zero clamp fatigue after six-hour studio sessions.' },
      { name: 'Devon K.', rating: 4, comment: 'Build quality is exceptional; wish the carrying case were slightly slimmer.' },
      { name: 'Priya S.', rating: 5, comment: 'Multipoint Bluetooth switching between laptop and phone works instantaneously.' },
    ],
    'SS-PER-204': [
      { name: 'Liam C.', rating: 5, comment: 'The anodized chassis has zero flex and the gasket mount sounds clean.' },
      { name: 'Hannah W.', rating: 5, comment: 'Best 75% wireless layout I have typed on.' },
      { name: 'Noah B.', rating: 4, comment: 'Solid weight and crisp tactile feedback right out of the box.' },
    ],
    'SS-WRB-302': [
      { name: 'Sophia M.', rating: 5, comment: 'Brushed titanium case feels weightless and still looks pristine after daily wear.' },
      { name: 'Lucas G.', rating: 4, comment: 'Dual-frequency GPS locks within seconds on city runs.' },
    ],
    'SS-AUD-108': [
      { name: 'Clara J.', rating: 5, comment: 'The machined top dial has remarkable tactile resistance and room-filling acoustics.' },
      { name: 'Owen P.', rating: 4, comment: 'Warm vocal clarity without exaggerated bass.' },
      { name: 'Nadia V.', rating: 5, comment: 'Blends cleanly into the living room bookshelf.' },
    ],
    'SS-CON-401': [
      { name: 'Victor H.', rating: 5, comment: 'Drives dual 4K monitors and 96W charging over a single braided cable.' },
      { name: 'Tessa L.', rating: 5, comment: '2.5GbE port runs cool even under sustained file transfers.' },
      { name: 'Samir D.', rating: 4, comment: 'Clean front-facing ports save reaching behind the desk.' },
    ],
    'SS-AUD-115': [
      { name: 'Julian F.', rating: 5, comment: 'Ideal desk audio pairing with matching industrial finishes.' },
      { name: 'Maya K.', rating: 5, comment: 'Saved on the bundle and both pieces arrived ready to pair.' },
    ],
    'SS-WRK-501': [
      { name: 'Grace A.', rating: 5, comment: 'Glare-free illumination across the entire desk mat with zero flicker.' },
      { name: 'Ethan Z.', rating: 5, comment: 'Counterbalanced joints hold their exact angle effortlessly.' },
      { name: 'Rachel N.', rating: 4, comment: 'Touch dimmer responds smoothly; warm spectrum is easy on the eyes.' },
    ],
    'SS-PHT-601': [
      { name: 'Kenji S.', rating: 5, comment: 'The 35mm f/1.8 renders micro-contrast beautifully wide open.' },
      { name: 'Claire B.', rating: 5, comment: 'Tactile shutter speed dial makes manual shooting intuitive.' },
    ],
    'SS-ESP-701': [
      { name: 'Marco P.', rating: 5, comment: 'Virtually zero retention and effortless dial-in between pour-over and espresso.' },
      { name: 'Aria G.', rating: 4, comment: 'Quiet motor and static-free grounds into the aluminum cup.' },
      { name: 'Theo W.', rating: 5, comment: 'Consistent particle distribution elevated my morning shots immediately.' },
    ],
    'SS-HOM-801': [
      { name: 'Simone D.', rating: 5, comment: 'Balanced walnut handle gives steady pour control for V60 brews.' },
      { name: 'Ben K.', rating: 5, comment: 'Heats rapidly and holds exact brew temperature silently.' },
    ],
    'SS-TRV-901': [
      { name: 'Jordan E.', rating: 5, comment: 'Stands upright on its own and kept my laptop bone-dry in heavy rain.' },
      { name: 'Nina T.', rating: 4, comment: 'Smart internal organization without looking bulky.' },
      { name: 'Caleb M.', rating: 5, comment: 'AquaGuard zippers feel substantial and smooth.' },
    ],
    'SS-PER-212': [
      { name: 'Derek O.', rating: 5, comment: 'Magnesium shell is featherlight yet rigid, and the free-spin wheel is addictive.' },
      { name: 'Zoe L.', rating: 4, comment: 'Tracks cleanly even directly on travertine and glass surfaces.' },
    ],
  };

  for (const [sku, reviews] of Object.entries(seedReviews)) {
    const prod = getProdIdBySku.get(sku) as { id: number } | undefined;
    if (!prod) continue;
    const existingCount = (reviewCountForProduct.get(prod.id) as { count: number }).count;
    if (existingCount === 0) {
      for (const r of reviews) {
        insertReview.run(prod.id, r.name, r.rating, r.comment);
      }
    }
  }
}
