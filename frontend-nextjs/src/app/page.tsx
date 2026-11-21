"use client";

import { useEffect, useState } from "react";

interface Product {
  id: number;
  sku: string;
  name: string;
  description: string;
  category_name: string;
  price_cents: number;
  stock: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function StorefrontPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE}/api/products?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((data) => setProducts(data.items || []))
      .catch(() => {});

    return () => controller.abort();
  }, [query]);

  useEffect(() => {
    const wsUrl = API_BASE.replace(/^http/, "ws") + "/ws";
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "inventory_sync" && Array.isArray(msg.updates)) {
        setProducts((prev) =>
          prev.map((p) => {
            const match = msg.updates.find((u: { product_id: number; new_stock: number }) => u.product_id === p.id);
            return match ? { ...p, stock: match.new_stock } : p;
          })
        );
      }
    };
    return () => ws.close();
  }, []);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex items-center justify-between border-b border-slate-200 pb-6">
        <span className="text-xl font-bold tracking-tight">ShopStream</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Search products (e.g. "bluetoth headphone")...'
          className="w-80 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm"
        />
      </header>

      <section className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-3">
        {products.map((product) => (
          <article key={product.id} className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-xs text-slate-500">
              {product.category_name} · <span className="font-mono">{product.sku}</span>
            </p>
            <h2 className="mt-1 text-base font-semibold">{product.name}</h2>
            <p className="mt-1 text-sm text-slate-600">{product.description}</p>
            <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
              <span className="font-mono text-sm font-semibold tabular-nums">
                ${(product.price_cents / 100).toFixed(2)}
              </span>
              <span className="text-xs font-medium text-emerald-700 tabular-nums">
                {product.stock} available
              </span>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
