import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Minus, Plus, Trash2, X } from 'lucide-react';
import type { CartItem, Order, User } from '../types';
import { formatPrice } from '../lib/format';

interface CartDrawerProps {
  open: boolean;
  items: CartItem[];
  user: User | null;
  authToken: string | null;
  onClose: () => void;
  onUpdateQuantity: (productId: number, quantity: number) => void;
  onRemoveItem: (productId: number) => void;
  onOrderSuccess: (order: Order) => void;
}

export function CartDrawer({
  open,
  items,
  user,
  authToken,
  onClose,
  onUpdateQuantity,
  onRemoveItem,
  onOrderSuccess,
}: CartDrawerProps) {
  const [customerName, setCustomerName] = useState(user?.name || '');
  const [customerEmail, setCustomerEmail] = useState(user?.email || '');
  const [shippingAddress, setShippingAddress] = useState(user?.address || '');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmedOrder, setConfirmedOrder] = useState<Order | null>(null);

  useEffect(() => {
    if (user) {
      setCustomerName((prev) => prev || user.name);
      setCustomerEmail((prev) => prev || user.email);
      setShippingAddress((prev) => prev || user.address);
    }
  }, [user]);

  if (!open) return null;

  const subtotalCents = items.reduce((sum, item) => sum + item.product.price_cents * item.quantity, 0);
  const hasStockConflict = items.some((item) => item.quantity > item.product.stock || item.product.stock <= 0);

  async function handleCheckout(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          customerName,
          customerEmail,
          shippingAddress,
          items: items.map((item) => ({
            productId: item.product.id,
            quantity: item.quantity,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (Array.isArray(data.conflicts) && data.conflicts.length > 0) {
          const summary = data.conflicts
            .map(
              (c: { productName: string; available: number; requested: number }) =>
                `${c.productName}: requested ${c.requested}, only ${c.available} available`
            )
            .join('; ');
          setErrorMsg(`Stock updated before checkout: ${summary}`);
        } else {
          setErrorMsg(data.error || 'Checkout could not be completed.');
        }
        return;
      }

      const completed: Order = { ...data.order, items: data.items };
      setConfirmedOrder(completed);
      onOrderSuccess(completed);
    } catch {
      setErrorMsg('Network error while placing order. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Shopping cart and checkout"
      onClick={onClose}
    >
      <aside
        className="flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-[#0F172A]">
            {confirmedOrder ? 'Order Confirmed' : 'Shopping Cart'}
          </h2>
          <button
            type="button"
            onClick={() => {
              setConfirmedOrder(null);
              setErrorMsg(null);
              onClose();
            }}
            aria-label="Close cart drawer"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {confirmedOrder ? (
          <div className="flex flex-1 flex-col justify-between overflow-y-auto p-6">
            <div>
              <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#16A34A]" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-[#0F172A]">
                    Order {confirmedOrder.order_number} Confirmed
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Inventory has been atomically reserved and synchronized across all storefront channels.
                  </p>
                </div>
              </div>

              <div className="mt-6 space-y-3 border-t border-slate-100 pt-5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Receipt Summary
                </h3>
                {confirmedOrder.items.map((line) => (
                  <div key={line.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">
                      {line.product_name} × {line.quantity}
                    </span>
                    <span className="font-mono font-medium text-[#0F172A] tabular-nums">
                      {formatPrice(line.unit_price_cents * line.quantity)}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-sm font-semibold text-[#0F172A]">
                  <span>Total Charged</span>
                  <span className="font-mono tabular-nums">{formatPrice(confirmedOrder.total_cents)}</span>
                </div>
              </div>

              <div className="mt-6 border-t border-slate-100 pt-5 text-xs text-slate-600 space-y-1">
                <p>
                  <span className="font-medium text-slate-800">Status:</span> {confirmedOrder.status}
                </p>
                <p>
                  <span className="font-medium text-slate-800">Recipient:</span> {confirmedOrder.customer_name} (
                  {confirmedOrder.customer_email})
                </p>
                <p>
                  <span className="font-medium text-slate-800">Destination:</span> {confirmedOrder.shipping_address}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setConfirmedOrder(null);
                onClose();
              }}
              className="mt-6 w-full rounded-lg bg-[#0F172A] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#2563EB]"
            >
              Continue Shopping
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
            <p className="text-sm font-medium text-[#0F172A]">Your cart is empty</p>
            <p className="mt-1 text-xs text-slate-500">
              Browse the catalog to add hardware with live stock verification.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-[#0F172A] hover:bg-slate-50"
            >
              Browse Products
            </button>
          </div>
        ) : (
          <form onSubmit={handleCheckout} className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {errorMsg && (
                <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-[#DC2626]">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="divide-y divide-slate-100">
                {items.map(({ product, quantity }) => {
                  const exceedsStock = quantity > product.stock;
                  return (
                    <div key={product.id} className="flex gap-4 py-4 first:pt-0">
                      <img
                        src={product.image_url}
                        alt={product.name}
                        referrerPolicy="no-referrer"
                        className="h-16 w-20 shrink-0 rounded-lg bg-[#F1F5F9] object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="truncate text-sm font-semibold text-[#0F172A]">
                            {product.name}
                          </h3>
                          <button
                            type="button"
                            onClick={() => onRemoveItem(product.id)}
                            aria-label={`Remove ${product.name}`}
                            className="text-slate-400 hover:text-[#DC2626]"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                        <p className="mt-0.5 font-mono text-xs text-slate-500 tabular-nums">
                          {formatPrice(product.price_cents)} · {product.stock} in stock
                        </p>
                        {exceedsStock && (
                          <p className="mt-1 text-xs font-medium text-[#DC2626]">
                            Only {product.stock} left — reduce quantity to proceed
                          </p>
                        )}
                        <div className="mt-2.5 flex items-center justify-between">
                          <div className="flex items-center rounded-md border border-slate-200">
                            <button
                              type="button"
                              aria-label={`Decrease ${product.name} quantity`}
                              onClick={() => onUpdateQuantity(product.id, quantity - 1)}
                              className="flex h-7 w-7 items-center justify-center text-slate-600 hover:bg-slate-50"
                            >
                              <Minus className="h-3 w-3" aria-hidden="true" />
                            </button>
                            <span className="w-8 text-center font-mono text-xs font-medium tabular-nums">
                              {quantity}
                            </span>
                            <button
                              type="button"
                              aria-label={`Increase ${product.name} quantity`}
                              disabled={quantity >= product.stock}
                              onClick={() => onUpdateQuantity(product.id, quantity + 1)}
                              className="flex h-7 w-7 items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                            >
                              <Plus className="h-3 w-3" aria-hidden="true" />
                            </button>
                          </div>
                          <span className="font-mono text-sm font-semibold text-[#0F172A] tabular-nums">
                            {formatPrice(product.price_cents * quantity)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-3 border-t border-slate-200 pt-5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Shipping Details
                </h3>
                <div>
                  <label className="block text-xs font-medium text-slate-700" htmlFor="checkout-name">
                    Full Name
                  </label>
                  <input
                    id="checkout-name"
                    type="text"
                    required
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Alex Morgan"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-[#0F172A] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/15"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700" htmlFor="checkout-email">
                    Email Address
                  </label>
                  <input
                    id="checkout-email"
                    type="email"
                    required
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="alex@example.com"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-[#0F172A] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/15"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700" htmlFor="checkout-address">
                    Delivery Address
                  </label>
                  <textarea
                    id="checkout-address"
                    required
                    rows={2}
                    value={shippingAddress}
                    onChange={(e) => setShippingAddress(e.target.value)}
                    placeholder="742 Evergreen Terrace, Suite 4B, Seattle, WA 98101"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-[#0F172A] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/15"
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 p-6">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">Total (Free Express Delivery)</span>
                <span className="font-mono text-lg font-bold text-[#0F172A] tabular-nums">
                  {formatPrice(subtotalCents)}
                </span>
              </div>
              <button
                type="submit"
                disabled={submitting || hasStockConflict}
                className="mt-4 w-full rounded-lg bg-[#2563EB] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {submitting ? 'Validating Inventory & Placing Order...' : 'Place Order'}
              </button>
            </div>
          </form>
        )}
      </aside>
    </div>
  );
}
