import { useState } from 'react';
import { Package } from 'lucide-react';
import type { Product } from '../types';
import { formatPrice, getStockIndicator } from '../lib/format';
import { StarRating } from './StarRating';

interface ProductCardProps {
  product: Product;
  cartQuantity: number;
  recentlySynced?: boolean;
  onSelect: (product: Product) => void;
  onAddToCart: (product: Product) => void;
}

export function ProductCard({
  product,
  cartQuantity,
  recentlySynced = false,
  onSelect,
  onAddToCart,
}: ProductCardProps) {
  const [imageError, setImageError] = useState(false);
  const stockInfo = getStockIndicator(product.stock, product.low_stock_threshold);
  const maxReached = cartQuantity >= product.stock;
  const isOut = product.stock <= 0;

  return (
    <article
      className={`group flex flex-col justify-between rounded-xl border bg-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
        recentlySynced ? 'border-[#2563EB] ring-2 ring-[#2563EB]/15' : 'border-slate-200'
      }`}
    >
      <div>
        <button
          type="button"
          onClick={() => onSelect(product)}
          className="block w-full overflow-hidden rounded-t-xl bg-[#F1F5F9] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
        >
          <div className="aspect-[4/3] w-full overflow-hidden">
            {imageError ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-100 px-4 text-center text-slate-500">
                <Package className="h-8 w-8 text-slate-400" aria-hidden="true" />
                <span className="text-xs font-medium text-slate-600">{product.name}</span>
              </div>
            ) : (
              <img
                src={product.image_url}
                alt={product.name}
                referrerPolicy="no-referrer"
                onError={() => setImageError(true)}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              />
            )}
          </div>
        </button>

        <div className="p-5 pb-3">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="font-medium text-slate-700">{product.category_name}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{product.sku}</span>
          </div>

          <button
            type="button"
            onClick={() => onSelect(product)}
            className="mt-1.5 block text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] rounded-sm"
          >
            <h3 className="text-base font-semibold leading-snug text-[#0F172A] group-hover:text-[#2563EB] transition-colors">
              {product.name}
            </h3>
          </button>

          <div className="mt-2">
            <button
              type="button"
              onClick={() => onSelect(product)}
              className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] rounded-sm"
            >
              <StarRating
                rating={Number(product.rating_avg ?? 0)}
                reviewCount={Number(product.review_count ?? 0)}
                size="sm"
              />
            </button>
          </div>

          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-600">
            {product.description}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-slate-100 px-5 py-4">
        <div>
          <div className="text-[15px] font-semibold text-[#0F172A] tabular-nums">
            {formatPrice(product.price_cents)}
          </div>
          <div className={`mt-0.5 text-xs font-medium tabular-nums ${stockInfo.toneClass}`}>
            {stockInfo.label}
          </div>
        </div>

        <button
          type="button"
          disabled={isOut || maxReached}
          onClick={() => onAddToCart(product)}
          className="rounded-lg bg-[#0F172A] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#2563EB] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
        >
          {isOut ? 'Unavailable' : maxReached ? 'Max in Cart' : 'Add to Cart'}
        </button>
      </div>
    </article>
  );
}
