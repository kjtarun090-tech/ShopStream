import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Layers,
  Plus,
  Store,
  Trash2,
  Activity,
  Pencil,
  X,
} from 'lucide-react';
import type { AdminStats, Category, DomainEvent, Order, Product } from '../types';
import { formatPrice, formatTimestamp } from '../lib/format';

type AdminTab = 'inventory' | 'catalog' | 'orders' | 'pos' | 'events';

interface AdminDashboardProps {
  adminToken: string | null;
  onAdminTokenChange: (token: string | null) => void;
  categories: Category[];
  liveProducts: Product[];
  latestEvent: DomainEvent | null;
  onCatalogMutated: () => void;
}

const IMAGE_PRESETS = [
  { label: 'Bluetooth Headphones', url: '/src/assets/images/product_bluetooth_headphones_1795258719516.jpg' },
  { label: 'Mechanical Keyboard', url: '/src/assets/images/product_mechanical_keyboard_1795258718563.jpg' },
  { label: 'Wireless Studio Mouse', url: '/src/assets/images/product_wireless_mouse_1795260060654.jpg' },
  { label: 'Titanium Smartwatch', url: '/src/assets/images/product_smartwatch_titanium_1795258718713.jpg' },
  { label: 'Acoustic Speaker', url: '/src/assets/images/product_studio_speaker_1795258718603.jpg' },
  { label: 'Thunderbolt Dock', url: '/src/assets/images/product_usb_hub_dock_1795258718104.jpg' },
  { label: 'Architectural Desk Lamp', url: '/src/assets/images/product_desk_lamp_aluminum_1795260059076.jpg' },
  { label: 'Mirrorless Camera', url: '/src/assets/images/product_mirrorless_camera_1795260059697.jpg' },
  { label: 'Espresso Grinder', url: '/src/assets/images/product_espresso_grinder_1795260060266.jpg' },
  { label: 'Gooseneck Kettle', url: '/src/assets/images/product_ceramic_kettle_1795260060546.jpg' },
  { label: 'Weatherproof Backpack', url: '/src/assets/images/product_travel_backpack_1795260060771.jpg' },
];

export function AdminDashboard({
  adminToken,
  onAdminTokenChange,
  categories,
  liveProducts,
  latestEvent,
  onCatalogMutated,
}: AdminDashboardProps) {
  const [authStatus, setAuthStatus] = useState<{ configuredViaEnv: boolean; claimed: boolean } | null>(null);
  const [passcode, setPasscode] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<AdminTab>('inventory');
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [events, setEvents] = useState<DomainEvent[]>([]);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [actionBanner, setActionBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Add / Edit Product modal state
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formSku, setFormSku] = useState('');
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formCatId, setFormCatId] = useState<number>(categories[0]?.id || 1);
  const [formPriceDollars, setFormPriceDollars] = useState('199.00');
  const [formStock, setFormStock] = useState('10');
  const [formThreshold, setFormThreshold] = useState('5');
  const [formImage, setFormImage] = useState(IMAGE_PRESETS[0].url);

  // New Category form
  const [newCatName, setNewCatName] = useState('');
  const [newCatDesc, setNewCatDesc] = useState('');

  // Physical Store POS state
  const [posProductId, setPosProductId] = useState<number>(liveProducts[0]?.id || 1);
  const [posQty, setPosQty] = useState<number>(1);

  useEffect(() => {
    fetch('/api/admin/auth-status')
      .then((r) => r.json())
      .then((data) => setAuthStatus(data))
      .catch(() => setAuthStatus({ configuredViaEnv: false, claimed: false }));
  }, []);

  const fetchOverview = useCallback(async () => {
    if (!adminToken) return;
    setLoadingOverview(true);
    try {
      const res = await fetch('/api/admin/overview', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.status === 401 || res.status === 403) {
        onAdminTokenChange(null);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products);
        setOrders(data.orders);
        setStats(data.stats);
        setEvents(data.events);
      }
    } finally {
      setLoadingOverview(false);
    }
  }, [adminToken, onAdminTokenChange]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  // Sync live WebSocket product & event updates into Admin view immediately
  useEffect(() => {
    if (liveProducts.length > 0 && adminToken) {
      setProducts((prev) => {
        if (prev.length === 0) return liveProducts;
        const map = new Map(liveProducts.map((p) => [p.id, p]));
        return prev.map((p) => map.get(p.id) ?? p);
      });
    }
  }, [liveProducts, adminToken]);

  useEffect(() => {
    if (latestEvent && adminToken) {
      setEvents((prev) => {
        if (prev.some((e) => e.id === latestEvent.id)) return prev;
        return [latestEvent, ...prev].slice(0, 40);
      });
      if (latestEvent.topic === 'shopstream.orders') {
        fetchOverview();
      }
    }
  }, [latestEvent, adminToken, fetchOverview]);

  async function handleAdminAuth(e: FormEvent) {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      const endpoint = authStatus?.claimed ? '/api/admin/login' : '/api/admin/claim';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Authentication failed.');
        return;
      }
      setPasscode('');
      setAuthStatus((prev) => (prev ? { ...prev, claimed: true } : prev));
      onAdminTokenChange(data.token);
    } catch {
      setAuthError('Network error while authenticating.');
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleAdjustStock(productId: number, delta: number, source: string) {
    if (!adminToken) return;
    setActionBanner(null);
    const res = await fetch(`/api/admin/products/${productId}/adjust-stock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ delta, source }),
    });
    const data = await res.json();
    if (!res.ok) {
      setActionBanner({ type: 'err', text: data.error || 'Failed to adjust stock.' });
      return;
    }
    setActionBanner({
      type: 'ok',
      text: `${data.product.name} updated to ${data.product.stock} units and synchronized.`,
    });
    await fetchOverview();
    onCatalogMutated();
  }

  function openCreateModal() {
    setEditingProduct(null);
    setFormSku(`SS-HW-${Math.floor(500 + Math.random() * 400)}`);
    setFormName('');
    setFormDesc('');
    setFormCatId(categories[0]?.id || 1);
    setFormPriceDollars('199.00');
    setFormStock('12');
    setFormThreshold('5');
    setFormImage(IMAGE_PRESETS[0].url);
    setShowProductModal(true);
  }

  function openEditModal(product: Product) {
    setEditingProduct(product);
    setFormSku(product.sku);
    setFormName(product.name);
    setFormDesc(product.description);
    setFormCatId(product.category_id);
    setFormPriceDollars((product.price_cents / 100).toFixed(2));
    setFormStock(String(product.stock));
    setFormThreshold(String(product.low_stock_threshold));
    setFormImage(product.image_url);
    setShowProductModal(true);
  }

  async function handleSaveProduct(e: FormEvent) {
    e.preventDefault();
    if (!adminToken) return;
    const priceCents = Math.round(Number.parseFloat(formPriceDollars) * 100);
    const stock = Number.parseInt(formStock, 10);
    const lowStockThreshold = Number.parseInt(formThreshold, 10);

    const url = editingProduct ? `/api/admin/products/${editingProduct.id}` : '/api/admin/products';
    const method = editingProduct ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        sku: formSku,
        name: formName,
        description: formDesc,
        categoryId: formCatId,
        priceCents,
        stock,
        lowStockThreshold,
        imageUrl: formImage,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setActionBanner({ type: 'err', text: data.error || 'Could not save product.' });
      return;
    }

    setShowProductModal(false);
    setActionBanner({
      type: 'ok',
      text: editingProduct ? `Updated ${data.product.name}.` : `Created ${data.product.name}.`,
    });
    await fetchOverview();
    onCatalogMutated();
  }

  async function handleDeleteProduct(product: Product) {
    if (!adminToken) return;
    const res = await fetch(`/api/admin/products/${product.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();
    if (!res.ok) {
      setActionBanner({ type: 'err', text: data.error || 'Unable to delete product.' });
      return;
    }
    setActionBanner({ type: 'ok', text: `Removed ${product.name} from catalog.` });
    await fetchOverview();
    onCatalogMutated();
  }

  async function handleCreateCategory(e: FormEvent) {
    e.preventDefault();
    if (!adminToken || !newCatName.trim()) return;
    const res = await fetch('/api/admin/categories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ name: newCatName, description: newCatDesc }),
    });
    const data = await res.json();
    if (!res.ok) {
      setActionBanner({ type: 'err', text: data.error || 'Failed to add category.' });
      return;
    }
    setNewCatName('');
    setNewCatDesc('');
    setActionBanner({ type: 'ok', text: `Added category ${data.category.name}.` });
    onCatalogMutated();
  }

  async function handleUpdateOrderStatus(orderId: number, status: string) {
    if (!adminToken) return;
    const res = await fetch(`/api/admin/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      await fetchOverview();
      setActionBanner({ type: 'ok', text: `Order status updated to ${status}.` });
    }
  }

  if (!adminToken) {
    return (
      <div className="mx-auto max-w-md px-6 py-16">
        <div className="rounded-xl border border-slate-200 bg-white p-7">
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
            {authStatus?.claimed ? 'Inventory Admin Sign In' : 'Claim Administrator Passcode'}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            {authStatus?.claimed
              ? 'Enter your administrator passcode to manage products, inventory counts, physical store POS sync, and customer orders.'
              : 'Set the initial administrator passcode for this ShopStream workspace (minimum 6 characters).'}
          </p>

          <form onSubmit={handleAdminAuth} className="mt-6 space-y-4">
            {authError && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-[#DC2626]">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{authError}</span>
              </div>
            )}

            <div>
              <label htmlFor="admin-passcode" className="block text-xs font-medium text-slate-700">
                Administrator Passcode
              </label>
              <input
                id="admin-passcode"
                type="password"
                required
                minLength={6}
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Enter passcode"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/15"
              />
            </div>

            <button
              type="submit"
              disabled={authLoading || authStatus === null}
              className="w-full rounded-lg bg-[#0F172A] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#2563EB] disabled:opacity-50"
            >
              {authLoading
                ? 'Verifying...'
                : authStatus?.claimed
                  ? 'Unlock Inventory Console'
                  : 'Set Passcode & Open Console'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const sidebarItems: { id: AdminTab; label: string; icon: typeof Boxes }[] = [
    { id: 'inventory', label: 'Overview & Stock', icon: Boxes },
    { id: 'catalog', label: 'Catalog & Categories', icon: Layers },
    { id: 'orders', label: 'Customer Orders', icon: ClipboardList },
    { id: 'pos', label: 'Physical Store POS', icon: Store },
    { id: 'events', label: 'Event Stream', icon: Activity },
  ];

  const currentTabLabel = sidebarItems.find((t) => t.id === activeTab)?.label || 'Overview';

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-[1440px] flex-col lg:flex-row">
      {/* Sidebar */}
      <aside className="w-full border-b border-slate-200 bg-white p-4 lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r lg:p-6">
        <div className="flex flex-row gap-2 overflow-x-auto lg:flex-col">
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-[#0F172A] text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-[#0F172A]'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-6 hidden border-t border-slate-200 pt-5 lg:block">
          <button
            type="button"
            onClick={() => onAdminTokenChange(null)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-[#0F172A]"
          >
            Lock Admin Session
          </button>
        </div>
      </aside>

      {/* Main Content Viewport */}
      <main className="flex-1 p-6 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <p className="text-xs text-slate-500">Inventory Admin / {currentTabLabel}</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#0F172A]">
              {currentTabLabel}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Add Product</span>
            </button>
          </div>
        </div>

        {actionBanner && (
          <div
            className={`mt-5 flex items-center justify-between rounded-lg border px-4 py-3 text-xs font-medium ${
              actionBanner.type === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-[#16A34A]'
                : 'border-red-200 bg-red-50 text-[#DC2626]'
            }`}
          >
            <span className="flex items-center gap-2">
              {actionBanner.type === 'ok' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              {actionBanner.text}
            </span>
            <button type="button" onClick={() => setActionBanner(null)} aria-label="Dismiss message">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* KPI Summary Strip */}
        {stats && (
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">Active SKUs</p>
              <p className="mt-1 font-mono text-2xl font-bold text-[#0F172A] tabular-nums">
                {stats.totalProducts}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">Available Units</p>
              <p className="mt-1 font-mono text-2xl font-bold text-[#0F172A] tabular-nums">
                {stats.totalUnits}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">Low / Out of Stock</p>
              <p className="mt-1 font-mono text-2xl font-bold text-[#D97706] tabular-nums">
                {stats.lowStockCount + stats.outOfStockCount}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">Order Revenue ({stats.totalOrders})</p>
              <p className="mt-1 font-mono text-2xl font-bold text-[#0F172A] tabular-nums">
                {formatPrice(stats.totalRevenueCents)}
              </p>
            </div>
          </div>
        )}

        {/* Tab 1: Overview & Stock */}
        {activeTab === 'inventory' && (
          <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <tr>
                    <th className="px-4 py-3">SKU</th>
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3 text-right">Price</th>
                    <th className="px-4 py-3 text-right">Stock</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Sync Controls</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingOverview && products.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-xs text-slate-500">
                        Loading inventory ledger...
                      </td>
                    </tr>
                  ) : (
                    products.map((product) => {
                      const statusLabel =
                        product.stock <= 0
                          ? { text: 'Out of Stock', cls: 'text-[#DC2626]' }
                          : product.stock <= product.low_stock_threshold
                            ? { text: 'Low Stock', cls: 'text-[#D97706]' }
                            : { text: 'Nominal', cls: 'text-[#16A34A]' };

                      return (
                        <tr key={product.id} className="hover:bg-slate-50/70">
                          <td className="px-4 py-3 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                            {product.sku}
                          </td>
                          <td className="px-4 py-3 font-medium text-[#0F172A]">{product.name}</td>
                          <td className="px-4 py-3 text-xs text-slate-600">{product.category_name}</td>
                          <td className="px-4 py-3 text-right font-mono text-xs font-medium text-[#0F172A] tabular-nums">
                            {formatPrice(product.price_cents)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-[#0F172A] tabular-nums">
                            {product.stock}
                          </td>
                          <td className={`px-4 py-3 text-xs font-semibold whitespace-nowrap ${statusLabel.cls}`}>
                            {statusLabel.text}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={product.stock <= 0}
                                onClick={() => handleAdjustStock(product.id, -1, 'physical_pos_sale')}
                                className="rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                              >
                                -1 POS
                              </button>
                              <button
                                type="button"
                                onClick={() => handleAdjustStock(product.id, 5, 'warehouse_restock')}
                                className="rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-[#2563EB] hover:bg-blue-50"
                              >
                                +5 Restock
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditModal(product)}
                                aria-label={`Edit ${product.name}`}
                                className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                              >
                                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteProduct(product)}
                                aria-label={`Delete ${product.name}`}
                                className="rounded border border-slate-200 p-1.5 text-slate-500 hover:bg-red-50 hover:text-[#DC2626]"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 2: Catalog & Categories */}
        {activeTab === 'catalog' && (
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-5">
              <h2 className="text-base font-semibold text-[#0F172A]">Create Category</h2>
              <form onSubmit={handleCreateCategory} className="mt-4 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700" htmlFor="cat-name">
                    Category Name
                  </label>
                  <input
                    id="cat-name"
                    type="text"
                    required
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    placeholder="Studio Displays"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700" htmlFor="cat-desc">
                    Description
                  </label>
                  <input
                    id="cat-desc"
                    type="text"
                    value={newCatDesc}
                    onChange={(e) => setNewCatDesc(e.target.value)}
                    placeholder="Calibrated color-accurate monitors"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full rounded-lg bg-[#0F172A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2563EB]"
                >
                  Add Category
                </button>
              </form>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white lg:col-span-7">
              <div className="border-b border-slate-100 px-6 py-4">
                <h2 className="text-base font-semibold text-[#0F172A]">Configured Categories</h2>
              </div>
              <div className="divide-y divide-slate-100">
                {categories.map((cat) => (
                  <div key={cat.id} className="flex items-center justify-between px-6 py-4">
                    <div>
                      <p className="text-sm font-semibold text-[#0F172A]">{cat.name}</p>
                      <p className="text-xs text-slate-500">{cat.description}</p>
                    </div>
                    <span className="font-mono text-xs text-slate-600 tabular-nums">
                      {cat.product_count ?? 0} SKUs
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Customer Orders */}
        {activeTab === 'orders' && (
          <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {orders.length === 0 ? (
              <div className="p-10 text-center">
                <p className="text-sm font-medium text-slate-700">No customer orders recorded yet</p>
                <p className="mt-1 text-xs text-slate-500">
                  Orders placed from the online storefront will stream here automatically.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <tr>
                      <th className="px-4 py-3">Order #</th>
                      <th className="px-4 py-3">Customer</th>
                      <th className="px-4 py-3">Items</th>
                      <th className="px-4 py-3 text-right">Total</th>
                      <th className="px-4 py-3">Placed</th>
                      <th className="px-4 py-3">Fulfillment Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {orders.map((order) => (
                      <tr key={order.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-[#0F172A] tabular-nums whitespace-nowrap">
                          {order.order_number}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-xs font-medium text-[#0F172A]">{order.customer_name}</div>
                          <div className="text-xs text-slate-500">{order.customer_email}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          {order.items?.map((i) => `${i.product_name} × ${i.quantity}`).join(', ')}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-[#0F172A] tabular-nums">
                          {formatPrice(order.total_cents)}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 tabular-nums whitespace-nowrap">
                          {formatTimestamp(order.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <select
                            aria-label={`Order status for ${order.order_number}`}
                            value={order.status}
                            onChange={(e) => handleUpdateOrderStatus(order.id, e.target.value)}
                            className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                          >
                            <option value="Confirmed">Confirmed</option>
                            <option value="Preparing Shipment">Preparing Shipment</option>
                            <option value="Shipped">Shipped</option>
                            <option value="Delivered">Delivered</option>
                            <option value="Cancelled">Cancelled</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Physical Store POS Sync */}
        {activeTab === 'pos' && (
          <div className="mt-6 max-w-2xl rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-base font-semibold text-[#0F172A]">
              Physical Store Point-of-Sale Synchronization
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Record an in-store purchase or warehouse replenishment. The database validates stock atomically and broadcasts the updated count to all online shoppers in real time.
            </p>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label htmlFor="pos-sku" className="block text-xs font-medium text-slate-700">
                  Select Product
                </label>
                <select
                  id="pos-sku"
                  value={posProductId}
                  onChange={(e) => setPosProductId(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.stock} available)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="pos-qty" className="block text-xs font-medium text-slate-700">
                  Units
                </label>
                <input
                  id="pos-qty"
                  type="number"
                  min={1}
                  max={50}
                  value={posQty}
                  onChange={(e) => setPosQty(Math.max(1, Number(e.target.value) || 1))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm tabular-nums focus:border-[#2563EB] focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => handleAdjustStock(posProductId, -posQty, 'physical_store_pos')}
                className="rounded-lg bg-[#0F172A] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#2563EB]"
              >
                Record In-Store Sale (-{posQty})
              </button>
              <button
                type="button"
                onClick={() => handleAdjustStock(posProductId, posQty, 'warehouse_restock')}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-[#0F172A] hover:bg-slate-50"
              >
                Receive Warehouse Shipment (+{posQty})
              </button>
            </div>
          </div>
        )}

        {/* Tab 5: Live Event Stream */}
        {activeTab === 'events' && (
          <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-6 py-4">
              <h2 className="text-base font-semibold text-[#0F172A]">
                Order & Inventory Event Stream
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Real-time domain events emitted on transactional database commits and consumed by the search indexer.
              </p>
            </div>
            {events.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500">
                No events recorded yet. Place an order or adjust stock to observe live event synchronization.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {events.map((ev) => (
                  <div key={ev.id} className="flex flex-col gap-1 px-6 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono font-semibold text-[#2563EB]">{ev.topic}</span>
                        <span aria-hidden="true" className="text-slate-300">·</span>
                        <span className="font-mono font-medium text-[#0F172A]">{ev.event_type}</span>
                        <span aria-hidden="true" className="text-slate-300">·</span>
                        <span className="font-mono text-slate-500 tabular-nums">
                          {ev.processing_ms} ms
                        </span>
                      </div>
                      <p className="mt-1 truncate font-mono text-xs text-slate-600">
                        {JSON.stringify(ev.payload)}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-xs text-slate-400 tabular-nums">
                      {formatTimestamp(ev.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Add / Edit Product Modal */}
      {showProductModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={editingProduct ? 'Edit Product' : 'Add Product'}
          onClick={() => setShowProductModal(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h2 className="text-base font-semibold text-[#0F172A]">
                {editingProduct ? `Edit ${editingProduct.name}` : 'Add Catalog Product'}
              </h2>
              <button type="button" onClick={() => setShowProductModal(false)} aria-label="Close modal">
                <X className="h-4 w-4 text-slate-500" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="mt-4 space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700" htmlFor="prod-sku">
                    SKU
                  </label>
                  <input
                    id="prod-sku"
                    type="text"
                    required
                    disabled={Boolean(editingProduct)}
                    value={formSku}
                    onChange={(e) => setFormSku(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700" htmlFor="prod-cat">
                    Category
                  </label>
                  <select
                    id="prod-cat"
                    value={formCatId}
                    onChange={(e) => setFormCatId(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700" htmlFor="prod-name">
                  Product Name
                </label>
                <input
                  id="prod-name"
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700" htmlFor="prod-desc">
                  Description
                </label>
                <textarea
                  id="prod-desc"
                  required
                  rows={2}
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700" htmlFor="prod-price">
                    Price (USD)
                  </label>
                  <input
                    id="prod-price"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={formPriceDollars}
                    onChange={(e) => setFormPriceDollars(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700" htmlFor="prod-stock">
                    Stock Units
                  </label>
                  <input
                    id="prod-stock"
                    type="number"
                    min="0"
                    required
                    value={formStock}
                    onChange={(e) => setFormStock(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700" htmlFor="prod-thresh">
                    Low Threshold
                  </label>
                  <input
                    id="prod-thresh"
                    type="number"
                    min="0"
                    required
                    value={formThreshold}
                    onChange={(e) => setFormThreshold(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs tabular-nums"
                  />
                </div>
              </div>

              {!editingProduct && (
                <div>
                  <label className="block text-xs font-medium text-slate-700" htmlFor="prod-img">
                    Product Photography
                  </label>
                  <select
                    id="prod-img"
                    value={formImage}
                    onChange={(e) => setFormImage(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    {IMAGE_PRESETS.map((preset) => (
                      <option key={preset.url} value={preset.url}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowProductModal(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8]"
                >
                  {editingProduct ? 'Save Changes' : 'Create Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
