import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import type { Order, User } from '../types';
import { formatPrice, formatTimestamp } from '../lib/format';

interface OrderSyncSignal {
  orderId?: number;
  orderNumber: string;
  status: string;
  seq: number;
}

interface AccountOrdersViewProps {
  mode: 'orders' | 'account';
  user: User | null;
  authToken: string | null;
  recentOrders: Order[];
  latestOrderSync?: OrderSyncSignal | null;
  onSessionOrdersReconciled?: (updates: { id: number; order_number: string; status: string }[]) => void;
  onOrderDiscovered?: (order: Order) => void;
  onAuthSuccess: (token: string, user: User) => void;
  onUserUpdated: (user: User) => void;
  onLogout: () => void;
}

export function AccountOrdersView({
  mode,
  user,
  authToken,
  recentOrders,
  latestOrderSync = null,
  onSessionOrdersReconciled,
  onOrderDiscovered,
  onAuthSuccess,
  onUserUpdated,
  onLogout,
}: AccountOrdersViewProps) {
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [orders, setOrders] = useState<Order[]>(recentOrders);
  const [recentlyUpdatedOrder, setRecentlyUpdatedOrder] = useState<string | null>(null);
  const [lookupOrderNum, setLookupOrderNum] = useState('');
  const [lookupEmail, setLookupEmail] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [profileName, setProfileName] = useState(user?.name || '');
  const [profileAddress, setProfileAddress] = useState(user?.address || '');
  const [profilePhone, setProfilePhone] = useState(user?.phone || '');
  const [profileSaved, setProfileSaved] = useState(false);

  useEffect(() => {
    if (user) {
      setProfileName(user.name);
      setProfileAddress(user.address || '');
      setProfilePhone(user.phone || '');
    }
  }, [user]);

  useEffect(() => {
    if (!authToken) {
      setOrders(recentOrders);
      return;
    }
    fetch('/api/orders', {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.orders) {
          setOrders(data.orders);
        }
      })
      .catch(() => {});
  }, [authToken, recentOrders, mode]);

  // Reconcile guest session orders with backend DB whenever opening Orders view
  useEffect(() => {
    if (authToken || recentOrders.length === 0) return;
    fetch('/api/orders/status-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orders: recentOrders.map((o) => ({
          orderNumber: o.order_number,
          email: o.customer_email,
        })),
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data?.statuses) && data.statuses.length > 0) {
          onSessionOrdersReconciled?.(data.statuses);
        }
      })
      .catch(() => {});
  }, [authToken, mode]);

  // Real-time WebSocket order status synchronization for displayed orders (session, account, or looked-up)
  useEffect(() => {
    if (!latestOrderSync) return;
    setOrders((prev) =>
      prev.map((o) =>
        o.order_number === latestOrderSync.orderNumber ||
        (latestOrderSync.orderId && o.id === latestOrderSync.orderId)
          ? { ...o, status: latestOrderSync.status }
          : o
      )
    );

    setRecentlyUpdatedOrder(latestOrderSync.orderNumber);
    const timer = window.setTimeout(() => setRecentlyUpdatedOrder(null), 1800);
    return () => window.clearTimeout(timer);
  }, [latestOrderSync]);

  async function handleAuthSubmit(e: FormEvent) {
    e.preventDefault();
    setAuthError(null);
    setLoading(true);
    try {
      const endpoint = authTab === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body =
        authTab === 'login'
          ? { email, password }
          : { name, email, password, address, phone };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Authentication failed.');
        return;
      }
      onAuthSuccess(data.token, data.user);
    } catch {
      setAuthError('Network error during authentication.');
    } finally {
      setLoading(false);
    }
  }

  async function handleProfileSave(e: FormEvent) {
    e.preventDefault();
    if (!authToken) return;
    setProfileSaved(false);
    const res = await fetch('/api/auth/me', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        name: profileName,
        address: profileAddress,
        phone: profilePhone,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      onUserUpdated(data.user);
      setProfileSaved(true);
    }
  }

  async function handleOrderLookup(e: FormEvent) {
    e.preventDefault();
    setLookupError(null);
    const res = await fetch(
      `/api/orders?orderNumber=${encodeURIComponent(lookupOrderNum)}&email=${encodeURIComponent(lookupEmail)}`
    );
    const data = await res.json();
    if (!res.ok) {
      setLookupError(data.error || 'Order not found.');
      return;
    }
    if (Array.isArray(data.orders) && data.orders[0]) {
      onOrderDiscovered?.(data.orders[0]);
    }
    setOrders(data.orders);
  }

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-10 lg:px-10">
      <div className="border-b border-slate-200 pb-6">
        <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">
          {mode === 'orders' ? 'Order Tracking & History' : 'Customer Account & Profile'}
        </h1>
        <p className="mt-1.5 text-sm text-slate-600">
          {mode === 'orders'
            ? 'Review your verified order receipts or look up a shipment using your order number.'
            : 'Sign in or create an account to save your delivery details and access order history.'}
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Account / Auth Column */}
        <section className="lg:col-span-5">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            {user ? (
              <div>
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div>
                    <h2 className="text-base font-semibold text-[#0F172A]">{user.name}</h2>
                    <p className="text-xs text-slate-500">{user.email}</p>
                  </div>
                  <button
                    type="button"
                    onClick={onLogout}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Sign Out
                  </button>
                </div>

                <form onSubmit={handleProfileSave} className="mt-5 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700" htmlFor="prof-name">
                      Full Name
                    </label>
                    <input
                      id="prof-name"
                      type="text"
                      required
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700" htmlFor="prof-phone">
                      Phone Number
                    </label>
                    <input
                      id="prof-phone"
                      type="text"
                      value={profilePhone}
                      onChange={(e) => setProfilePhone(e.target.value)}
                      placeholder="+1 (555) 234-5678"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700" htmlFor="prof-address">
                      Default Shipping Address
                    </label>
                    <textarea
                      id="prof-address"
                      rows={2}
                      value={profileAddress}
                      onChange={(e) => setProfileAddress(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>
                  {profileSaved && (
                    <p className="flex items-center gap-1.5 text-xs font-medium text-[#16A34A]">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Profile saved</span>
                    </p>
                  )}
                  <button
                    type="submit"
                    className="w-full rounded-lg bg-[#0F172A] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#2563EB]"
                  >
                    Save Profile
                  </button>
                </form>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab('login');
                      setAuthError(null);
                    }}
                    className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                      authTab === 'login' ? 'bg-white text-[#0F172A] shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab('register');
                      setAuthError(null);
                    }}
                    className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                      authTab === 'register' ? 'bg-white text-[#0F172A] shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    Create Account
                  </button>
                </div>

                <form onSubmit={handleAuthSubmit} className="mt-5 space-y-4">
                  {authError && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-[#DC2626]">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{authError}</span>
                    </div>
                  )}

                  {authTab === 'register' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-700" htmlFor="auth-name">
                        Full Name
                      </label>
                      <input
                        id="auth-name"
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-slate-700" htmlFor="auth-email">
                      Email Address
                    </label>
                    <input
                      id="auth-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700" htmlFor="auth-password">
                      Password
                    </label>
                    <input
                      id="auth-password"
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>

                  {authTab === 'register' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-700" htmlFor="auth-addr">
                        Shipping Address (Optional)
                      </label>
                      <input
                        id="auth-addr"
                        type="text"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-lg bg-[#2563EB] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-60"
                  >
                    {loading
                      ? 'Authenticating...'
                      : authTab === 'login'
                        ? 'Sign In with JWT'
                        : 'Create Customer Account'}
                  </button>
                </form>
              </div>
            )}
          </div>
        </section>

        {/* Orders History & Lookup Column */}
        <section className="lg:col-span-7 space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-base font-semibold text-[#0F172A]">Look Up an Order</h2>
            <form onSubmit={handleOrderLookup} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <input
                type="text"
                required
                value={lookupOrderNum}
                onChange={(e) => setLookupOrderNum(e.target.value)}
                placeholder="Order # (e.g. SS-123456-789)"
                className="rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs focus:border-[#2563EB] focus:outline-none"
              />
              <input
                type="email"
                required
                value={lookupEmail}
                onChange={(e) => setLookupEmail(e.target.value)}
                placeholder="Customer email"
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-[#2563EB] focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-lg bg-[#0F172A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2563EB]"
              >
                Track Order
              </button>
            </form>
            {lookupError && <p className="mt-2 text-xs text-[#DC2626]">{lookupError}</p>}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-6 py-4">
              <h2 className="text-base font-semibold text-[#0F172A]">
                {user ? 'Your Orders' : 'Recent Session Orders'}
              </h2>
            </div>

            {orders.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm font-medium text-slate-700">No orders to display yet</p>
                <p className="mt-1 text-xs text-slate-500">
                  Place an order from the catalog or look up an existing order number above.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {orders.map((order) => {
                  const isSynced = recentlyUpdatedOrder === order.order_number;
                  const statusTone =
                    order.status === 'Delivered'
                      ? 'text-[#16A34A]'
                      : order.status === 'Cancelled'
                        ? 'text-[#DC2626]'
                        : order.status === 'Preparing Shipment'
                          ? 'text-[#D97706]'
                          : 'text-[#2563EB]';
                  return (
                  <div
                    key={order.id}
                    className={`p-6 transition-colors duration-300 ${isSynced ? 'bg-blue-50/60' : ''}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-mono font-semibold text-[#0F172A] tabular-nums">
                          {order.order_number}
                        </span>
                        <span aria-hidden="true" className="text-slate-300">·</span>
                        <span className={`text-xs font-semibold ${statusTone}`}>{order.status}</span>
                      </div>
                      <span className="text-xs text-slate-500 tabular-nums">
                        {formatTimestamp(order.created_at)}
                      </span>
                    </div>

                    <div className="mt-3 space-y-1.5">
                      {order.items?.map((item) => (
                        <div key={item.id} className="flex items-center justify-between text-xs text-slate-600">
                          <span>
                            {item.product_name} × {item.quantity}
                          </span>
                          <span className="font-mono tabular-nums">
                            {formatPrice(item.unit_price_cents * item.quantity)}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
                      <span className="text-slate-500 truncate max-w-sm">
                        Ship to: {order.shipping_address}
                      </span>
                      <span className="font-mono font-semibold text-[#0F172A] tabular-nums">
                        {formatPrice(order.total_cents)}
                      </span>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
