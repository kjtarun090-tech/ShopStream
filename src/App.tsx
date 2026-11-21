import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Search, SlidersHorizontal, X } from 'lucide-react';
import type { CartItem, Category, DomainEvent, Order, Product, User } from './types';
import { TopBar, type AppView } from './components/TopBar';
import { ProductCard } from './components/ProductCard';
import { ProductDetailModal } from './components/ProductDetailModal';
import { CartDrawer } from './components/CartDrawer';
import { AccountOrdersView } from './components/AccountOrdersView';
import { AdminDashboard } from './components/AdminDashboard';

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('catalog');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [maxPrice, setMaxPrice] = useState<string>('');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [correctedQuery, setCorrectedQuery] = useState<string | null>(null);
  const [queryTimeMs, setQueryTimeMs] = useState<number | null>(null);

  // Real-time WebSocket Sync State
  const [syncedIds, setSyncedIds] = useState<number[]>([]);
  const [latestEvent, setLatestEvent] = useState<DomainEvent | null>(null);
  const syncTimerRef = useRef<number | null>(null);

  // Cart & Modals
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Auth held strictly in React memory (never localStorage)
  const [userToken, setUserToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [sessionOrders, setSessionOrders] = useState<Order[]>([]);
  const [latestOrderSync, setLatestOrderSync] = useState<{
    orderId?: number;
    orderNumber: string;
    status: string;
    seq: number;
  } | null>(null);
  const orderSyncSeqRef = useRef(0);
  const sessionOrdersRef = useRef<Order[]>(sessionOrders);

  useEffect(() => {
    sessionOrdersRef.current = sessionOrders;
  }, [sessionOrders]);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/categories');
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories);
      }
    } catch {
      // Ignore transient network errors
    }
  }, []);

  const fetchProducts = useCallback(async () => {
    setLoadingCatalog(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      if (selectedCategory !== 'all') params.set('category', selectedCategory);
      if (maxPrice) params.set('maxPrice', maxPrice);
      if (inStockOnly) params.set('inStockOnly', 'true');

      const res = await fetch(`/api/products?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setProducts(data.items);
        setCorrectedQuery(data.correctedQuery ?? null);
        setQueryTimeMs(typeof data.queryTimeMs === 'number' ? data.queryTimeMs : null);
      }
    } finally {
      setLoadingCatalog(false);
    }
  }, [searchQuery, selectedCategory, maxPrice, inStockOnly]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchProducts();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [fetchProducts]);

  // WebSocket Real-Time Inventory Synchronization
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let disposed = false;

    function connect() {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

      ws.onopen = () => {
        const currentSession = sessionOrdersRef.current;
        if (currentSession.length === 0) return;
        fetch('/api/orders/status-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orders: currentSession.map((o) => ({
              orderNumber: o.order_number,
              email: o.customer_email,
            })),
          }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (Array.isArray(data?.statuses) && data.statuses.length > 0) {
              const map = new Map<string, string>(
                data.statuses.map((u: { order_number: string; status: string }) => [
                  u.order_number,
                  u.status,
                ])
              );
              setSessionOrders((prev) =>
                prev.map((o) => {
                  const next = map.get(o.order_number);
                  return next && next !== o.status ? { ...o, status: next } : o;
                })
              );
            }
          })
          .catch(() => {});
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'inventory_sync' && Array.isArray(msg.products)) {
            const incoming = msg.products as Product[];
            const incomingMap = new Map(incoming.map((p) => [p.id, p]));
            const changedIds = incoming.map((p) => p.id);

            setProducts((prev) => prev.map((p) => incomingMap.get(p.id) ?? p));
            setSelectedProduct((prev) => (prev ? incomingMap.get(prev.id) ?? prev : null));
            setCart((prev) =>
              prev.map((item) => ({
                ...item,
                product: incomingMap.get(item.product.id) ?? item.product,
              }))
            );

            setSyncedIds(changedIds);
            if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
            syncTimerRef.current = window.setTimeout(() => setSyncedIds([]), 1600);
          } else if (msg.type === 'order_status_sync' && msg.orderNumber && msg.status) {
            setSessionOrders((prev) =>
              prev.map((o) =>
                o.order_number === msg.orderNumber || (msg.orderId && o.id === msg.orderId)
                  ? { ...o, status: msg.status }
                  : o
              )
            );
            orderSyncSeqRef.current += 1;
            setLatestOrderSync({
              orderId: msg.orderId,
              orderNumber: msg.orderNumber,
              status: msg.status,
              seq: orderSyncSeqRef.current,
            });
          } else if (msg.type === 'domain_event' && msg.event) {
            const ev = msg.event as DomainEvent;
            setLatestEvent(ev);
            if (
              ev.event_type === 'order.status_updated' &&
              typeof ev.payload?.orderNumber === 'string' &&
              typeof ev.payload?.newStatus === 'string'
            ) {
              const orderNumber = ev.payload.orderNumber;
              const newStatus = ev.payload.newStatus;
              const orderId = typeof ev.payload?.orderId === 'number' ? ev.payload.orderId : undefined;
              setSessionOrders((prev) =>
                prev.map((o) =>
                  o.order_number === orderNumber || (orderId && o.id === orderId)
                    ? { ...o, status: newStatus }
                    : o
                )
              );
              orderSyncSeqRef.current += 1;
              setLatestOrderSync({
                orderId,
                orderNumber,
                status: newStatus,
                seq: orderSyncSeqRef.current,
              });
            }
          }
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onclose = () => {
        if (!disposed) {
          reconnectTimer = window.setTimeout(connect, 2000);
        }
      };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
      if (ws) ws.close();
    };
  }, []);

  function handleAddToCart(product: Product, addQty = 1) {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        const nextQty = Math.min(product.stock, existing.quantity + addQty);
        return prev.map((item) =>
          item.product.id === product.id ? { product, quantity: nextQty } : item
        );
      }
      return [...prev, { product, quantity: Math.min(product.stock, addQty) }];
    });
    setCartOpen(true);
  }

  function handleUpdateCartQuantity(productId: number, quantity: number) {
    if (quantity <= 0) {
      setCart((prev) => prev.filter((item) => item.product.id !== productId));
      return;
    }
    setCart((prev) =>
      prev.map((item) =>
        item.product.id === productId
          ? { ...item, quantity: Math.min(item.product.stock || quantity, quantity) }
          : item
      )
    );
  }

  function handleRemoveFromCart(productId: number) {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  }

  function handleOrderSuccess(order: Order) {
    setCart([]);
    setSessionOrders((prev) => [order, ...prev]);
    fetchProducts();
  }

  const totalCartUnits = cart.reduce((sum, item) => sum + item.quantity, 0);
  const catalogSectionRef = useRef<HTMLElement | null>(null);

  return (
    <div className="min-h-screen flex flex-col bg-[#F1F5F9] text-[#0F172A]">
      <TopBar
        activeView={activeView}
        onNavigate={setActiveView}
        cartCount={totalCartUnits}
        onOpenCart={() => setCartOpen(true)}
      />

      <main className="flex-1">
        {activeView === 'catalog' && (
          <>
            {/* Storefront Hero */}
            <section className="border-b border-slate-200 bg-white">
              <div className="mx-auto grid max-w-[1440px] grid-cols-1 items-stretch lg:grid-cols-12">
                <div className="flex flex-col justify-center px-6 py-12 lg:col-span-6 lg:px-10 lg:py-16">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#2563EB]">
                    Real-Time Hardware Storefront
                  </p>
                  <h1 className="mt-3 max-w-xl text-balance text-4xl font-bold tracking-tight text-[#0F172A] sm:text-5xl leading-[1.12]">
                    Precision electronics, verified live in stock.
                  </h1>
                  <p className="mt-4 max-w-lg text-base leading-relaxed text-slate-600">
                    Every unit count reflects live warehouse and physical-store inventory synchronized through transaction-safe checkout and instant search indexing.
                  </p>

                  {/* Intelligent Typo-Tolerant Search Bar */}
                  <div className="mt-8 max-w-xl">
                    <div className="relative flex items-center">
                      <Search
                        className="pointer-events-none absolute left-3.5 h-4 w-4 text-slate-400"
                        aria-hidden="true"
                      />
                      <input
                        type="search"
                        aria-label="Search products"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder='Search hardware (try "bluetoth headphone")...'
                        className="w-full rounded-xl border border-slate-200 bg-[#F1F5F9] py-3 pl-10 pr-10 text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-[#2563EB] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]/15"
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          aria-label="Clear search"
                          className="absolute right-3 text-slate-400 hover:text-slate-700"
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      <button
                        type="button"
                        onClick={() => setSearchQuery('bluetoth headphone')}
                        className="font-medium text-[#2563EB] hover:underline"
                      >
                        Try typo query: &ldquo;bluetoth headphone&rdquo;
                      </button>
                      <span aria-hidden="true">·</span>
                      <button
                        type="button"
                        onClick={() =>
                          catalogSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
                        }
                        className="inline-flex items-center gap-1 font-medium text-slate-700 hover:text-[#0F172A]"
                      >
                        <span>Browse Collection</span>
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-6">
                  <div className="aspect-[16/9] h-full w-full overflow-hidden bg-[#F1F5F9] lg:aspect-auto">
                    <img
                      src="/src/assets/images/hero_shopstream_showcase_1795258718450.jpg"
                      alt="ShopStream flagship audio and precision hardware collection"
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  </div>
                </div>
              </div>
            </section>

            {/* Featured Product Catalog & Filter Bar */}
            <section
              ref={catalogSectionRef}
              className="mx-auto max-w-[1440px] px-6 py-12 lg:px-10"
            >
              <div className="space-y-4 border-b border-slate-200 pb-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-xl font-bold tracking-tight text-[#0F172A]">
                      Product Catalog
                    </h2>
                    <p className="mt-1 text-xs text-slate-500 tabular-nums">
                      {products.length} {products.length === 1 ? 'product' : 'products'}
                      {queryTimeMs !== null ? ` · Indexed search in ${queryTimeMs} ms` : ''}
                      {correctedQuery ? ` · Matched "${correctedQuery}"` : ''}
                    </p>
                  </div>

                  {/* Price & Availability Filters */}
                  <div className="flex flex-wrap items-center gap-2">
                    <SlidersHorizontal className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                    <select
                      aria-label="Maximum price filter"
                      value={maxPrice}
                      onChange={(e) => setMaxPrice(e.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-[#2563EB] focus:outline-none"
                    >
                      <option value="">Any Price</option>
                      <option value="250">Under $250</option>
                      <option value="400">Under $400</option>
                      <option value="700">Under $700</option>
                    </select>

                    <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0">
                      <input
                        type="checkbox"
                        checked={inStockOnly}
                        onChange={(e) => setInStockOnly(e.target.checked)}
                        className="rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
                      />
                      <span>In Stock Only</span>
                    </label>
                  </div>
                </div>

                {/* Category Segmented Tabs */}
                <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-200/70 p-1 w-fit max-w-full">
                  <button
                    type="button"
                    onClick={() => setSelectedCategory('all')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      selectedCategory === 'all'
                        ? 'bg-white text-[#0F172A] shadow-sm'
                        : 'text-slate-600 hover:text-[#0F172A]'
                    }`}
                  >
                    All
                  </button>
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedCategory(cat.slug)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        selectedCategory === cat.slug
                          ? 'bg-white text-[#0F172A] shadow-sm'
                          : 'text-slate-600 hover:text-[#0F172A]'
                      }`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* 3-Column Product Grid */}
              {loadingCatalog && products.length === 0 ? (
                <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {[1, 2, 3].map((idx) => (
                    <div
                      key={idx}
                      className="h-96 animate-pulse rounded-xl border border-slate-200 bg-white"
                    />
                  ))}
                </div>
              ) : products.length === 0 ? (
                <div className="mt-8 rounded-xl border border-slate-200 bg-white p-12 text-center">
                  <p className="text-base font-semibold text-[#0F172A]">
                    No products matched your filter criteria
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Adjust your search keywords or clear the active category and price filters.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedCategory('all');
                      setMaxPrice('');
                      setInStockOnly(false);
                    }}
                    className="mt-5 rounded-lg bg-[#0F172A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2563EB]"
                  >
                    Reset Filters
                  </button>
                </div>
              ) : (
                <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {products.map((product) => {
                    const cartLine = cart.find((c) => c.product.id === product.id);
                    return (
                      <ProductCard
                        key={product.id}
                        product={product}
                        cartQuantity={cartLine?.quantity ?? 0}
                        recentlySynced={syncedIds.includes(product.id)}
                        onSelect={setSelectedProduct}
                        onAddToCart={(p) => handleAddToCart(p, 1)}
                      />
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}

        {(activeView === 'orders' || activeView === 'account') && (
          <AccountOrdersView
            mode={activeView}
            user={currentUser}
            authToken={userToken}
            recentOrders={sessionOrders}
            latestOrderSync={latestOrderSync}
            onSessionOrdersReconciled={(updates) => {
              const map = new Map(updates.map((u) => [u.order_number, u.status]));
              setSessionOrders((prev) =>
                prev.map((o) => {
                  const next = map.get(o.order_number);
                  return next && next !== o.status ? { ...o, status: next } : o;
                })
              );
            }}
            onOrderDiscovered={(found) => {
              setSessionOrders((prev) => {
                const rest = prev.filter((o) => o.order_number !== found.order_number);
                return [found, ...rest];
              });
            }}
            onAuthSuccess={(token, user) => {
              setUserToken(token);
              setCurrentUser(user);
            }}
            onUserUpdated={setCurrentUser}
            onLogout={() => {
              setUserToken(null);
              setCurrentUser(null);
            }}
          />
        )}

        {activeView === 'admin' && (
          <AdminDashboard
            adminToken={adminToken}
            onAdminTokenChange={setAdminToken}
            categories={categories}
            liveProducts={products}
            latestEvent={latestEvent}
            onCatalogMutated={() => {
              fetchCategories();
              fetchProducts();
            }}
          />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1440px] flex-col items-start justify-between gap-4 px-6 py-6 text-xs text-slate-500 sm:flex-row sm:items-center lg:px-10">
          <span>ShopStream Retail Platform</span>
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => setActiveView('catalog')}
              className="hover:text-[#0F172A]"
            >
              Catalog
            </button>
            <button
              type="button"
              onClick={() => setActiveView('orders')}
              className="hover:text-[#0F172A]"
            >
              Track Order
            </button>
            <button
              type="button"
              onClick={() => setActiveView('admin')}
              className="hover:text-[#0F172A]"
            >
              Inventory Administration
            </button>
          </div>
        </div>
      </footer>

      <ProductDetailModal
        product={selectedProduct}
        cartQuantity={cart.find((c) => c.product.id === selectedProduct?.id)?.quantity ?? 0}
        user={currentUser}
        authToken={userToken}
        onClose={() => setSelectedProduct(null)}
        onAddToCart={handleAddToCart}
        onReviewSubmitted={fetchProducts}
      />

      <CartDrawer
        open={cartOpen}
        items={cart}
        user={currentUser}
        authToken={userToken}
        onClose={() => setCartOpen(false)}
        onUpdateQuantity={handleUpdateCartQuantity}
        onRemoveItem={handleRemoveFromCart}
        onOrderSuccess={handleOrderSuccess}
      />
    </div>
  );
}
