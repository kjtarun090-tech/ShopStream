import { useEffect, useState, type FormEvent } from 'react';
import { Minus, Plus, X, Package, CheckCircle2, AlertCircle } from 'lucide-react';
import type { Product, ProductReview, User } from '../types';
import { formatPrice, formatTimestamp, getStockIndicator } from '../lib/format';
import { StarRating, StarRatingInput } from './StarRating';

interface ProductDetailModalProps {
  product: Product | null;
  cartQuantity: number;
  user: User | null;
  authToken: string | null;
  onClose: () => void;
  onAddToCart: (product: Product, quantity: number) => void;
  onReviewSubmitted: () => void;
}

export function ProductDetailModal({
  product,
  cartQuantity,
  user,
  authToken,
  onClose,
  onAddToCart,
  onReviewSubmitted,
}: ProductDetailModalProps) {
  const [qty, setQty] = useState(1);
  const [imageError, setImageError] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'reviews'>('overview');

  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [ratingAvg, setRatingAvg] = useState<number>(0);
  const [reviewCount, setReviewCount] = useState<number>(0);
  const [loadingReviews, setLoadingReviews] = useState(false);

  // Review submission state
  const [reviewerName, setReviewerName] = useState(user?.name || '');
  const [newRating, setNewRating] = useState<number>(5);
  const [comment, setComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewNotice, setReviewNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (user?.name) {
      setReviewerName((prev) => prev || user.name);
    }
  }, [user]);

  useEffect(() => {
    if (!product) return;
    setQty(1);
    setImageError(false);
    setActiveTab('overview');
    setReviewNotice(null);
    setRatingAvg(Number(product.rating_avg ?? 0));
    setReviewCount(Number(product.review_count ?? 0));

    setLoadingReviews(true);
    fetch(`/api/products/${product.id}/reviews`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setReviews(data.reviews ?? []);
          setRatingAvg(Number(data.rating_avg ?? 0));
          setReviewCount(Number(data.review_count ?? 0));
        }
      })
      .catch(() => {})
      .finally(() => setLoadingReviews(false));
  }, [product?.id]);

  if (!product) return null;

  const remainingAddable = Math.max(0, product.stock - cartQuantity);
  const clampedQty = Math.min(Math.max(1, qty), Math.max(1, remainingAddable));
  const stockInfo = getStockIndicator(product.stock, product.low_stock_threshold);

  async function handleSubmitReview(e: FormEvent) {
    e.preventDefault();
    if (!product) return;
    setReviewNotice(null);
    setSubmittingReview(true);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      const res = await fetch(`/api/products/${product.id}/reviews`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          reviewerName,
          rating: newRating,
          comment,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setReviewNotice({ type: 'err', text: data.error || 'Could not submit review.' });
        return;
      }

      setReviews((prev) => [data.review, ...prev]);
      setRatingAvg(Number(data.rating_avg ?? 0));
      setReviewCount(Number(data.review_count ?? 0));
      setComment('');
      setNewRating(5);
      setReviewNotice({ type: 'ok', text: 'Your rating and review have been published.' });
      onReviewSubmitted();
    } catch {
      setReviewNotice({ type: 'err', text: 'Network error while submitting review.' });
    } finally {
      setSubmittingReview(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdp-title"
      onClick={onClose}
    >
      <div
        className="relative grid max-h-[90vh] w-full max-w-4xl grid-cols-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl md:grid-cols-2"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close product details"
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white/90 text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>

        <div className="bg-[#F1F5F9]">
          <div className="aspect-[4/3] h-full w-full">
            {imageError ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-8 text-slate-500">
                <Package className="h-10 w-10 text-slate-400" aria-hidden="true" />
                <span className="text-sm font-medium">{product.name}</span>
              </div>
            ) : (
              <img
                src={product.image_url}
                alt={product.name}
                referrerPolicy="no-referrer"
                onError={() => setImageError(true)}
                className="h-full w-full object-cover"
              />
            )}
          </div>
        </div>

        <div className="flex max-h-[90vh] flex-col justify-between overflow-hidden p-6 md:p-8">
          <div className="flex-1 overflow-y-auto pr-1">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="font-medium text-slate-700">{product.category_name}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{product.sku}</span>
            </div>

            <h2 id="pdp-title" className="mt-2 pr-8 text-2xl font-bold tracking-tight text-[#0F172A]">
              {product.name}
            </h2>

            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-baseline gap-3">
                <span className="text-xl font-semibold text-[#0F172A] tabular-nums">
                  {formatPrice(product.price_cents)}
                </span>
                <span className={`text-xs font-medium tabular-nums ${stockInfo.toneClass}`}>
                  {stockInfo.label}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setActiveTab('reviews')}
                className="rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
              >
                <StarRating rating={ratingAvg} reviewCount={reviewCount} size="md" />
              </button>
            </div>

            {/* Segmented switch between Product Overview and Customer Reviews */}
            <div className="mt-5 flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setActiveTab('overview')}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  activeTab === 'overview'
                    ? 'bg-white text-[#0F172A] shadow-sm'
                    : 'text-slate-600 hover:text-[#0F172A]'
                }`}
              >
                Overview
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('reviews')}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap tabular-nums ${
                  activeTab === 'reviews'
                    ? 'bg-white text-[#0F172A] shadow-sm'
                    : 'text-slate-600 hover:text-[#0F172A]'
                }`}
              >
                Reviews ({reviewCount})
              </button>
            </div>

            {activeTab === 'overview' ? (
              <div className="mt-5">
                <p className="text-sm leading-relaxed text-slate-600">{product.description}</p>

                <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-100 pt-5 text-xs">
                  <div>
                    <dt className="text-slate-500">Real-Time Stock</dt>
                    <dd className="mt-1 font-mono font-medium text-[#0F172A] tabular-nums">
                      {product.stock} units
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">In Your Cart</dt>
                    <dd className="mt-1 font-mono font-medium text-[#0F172A] tabular-nums">
                      {cartQuantity} units
                    </dd>
                  </div>
                </dl>
              </div>
            ) : (
              <div className="mt-5 space-y-5">
                <form
                  onSubmit={handleSubmitReview}
                  className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#0F172A]">Rate this product</span>
                    <StarRatingInput value={newRating} onChange={setNewRating} />
                  </div>

                  <div>
                    <label htmlFor="review-name" className="sr-only">
                      Your Name
                    </label>
                    <input
                      id="review-name"
                      type="text"
                      required
                      minLength={2}
                      value={reviewerName}
                      onChange={(e) => setReviewerName(e.target.value)}
                      placeholder="Your name (e.g. Alex M.)"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="review-comment" className="sr-only">
                      Review comment
                    </label>
                    <textarea
                      id="review-comment"
                      rows={2}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Share your experience with build quality, performance, or fit..."
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>

                  {reviewNotice && (
                    <p
                      className={`flex items-center gap-1.5 text-xs font-medium ${
                        reviewNotice.type === 'ok' ? 'text-[#16A34A]' : 'text-[#DC2626]'
                      }`}
                    >
                      {reviewNotice.type === 'ok' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      )}
                      <span>{reviewNotice.text}</span>
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={submittingReview}
                    className="w-full rounded-lg bg-[#0F172A] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#2563EB] disabled:opacity-50"
                  >
                    {submittingReview ? 'Submitting Review...' : 'Submit Review'}
                  </button>
                </form>

                <div className="divide-y divide-slate-100">
                  {loadingReviews ? (
                    <p className="py-4 text-center text-xs text-slate-500">Loading reviews...</p>
                  ) : reviews.length === 0 ? (
                    <p className="py-4 text-center text-xs text-slate-500">
                      No reviews yet. Be the first to rate this product.
                    </p>
                  ) : (
                    reviews.map((rev) => (
                      <div key={rev.id} className="py-3 first:pt-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-[#0F172A]">
                            {rev.reviewer_name}
                          </span>
                          <span className="text-[11px] text-slate-400 tabular-nums">
                            {formatTimestamp(rev.created_at)}
                          </span>
                        </div>
                        <div className="mt-1">
                          <StarRating rating={rev.rating} reviewCount={1} size="sm" showEmptyText={false} />
                        </div>
                        {rev.comment && (
                          <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{rev.comment}</p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 flex items-center gap-3 border-t border-slate-100 pt-5">
            <div className="flex items-center rounded-lg border border-slate-200 bg-white">
              <button
                type="button"
                aria-label="Decrease quantity"
                disabled={clampedQty <= 1 || remainingAddable === 0}
                onClick={() => setQty((prev) => Math.max(1, prev - 1))}
                className="flex h-10 w-10 items-center justify-center text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <Minus className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <span className="w-10 text-center font-mono text-sm font-medium tabular-nums">
                {remainingAddable === 0 ? 0 : clampedQty}
              </span>
              <button
                type="button"
                aria-label="Increase quantity"
                disabled={clampedQty >= remainingAddable || remainingAddable === 0}
                onClick={() => setQty((prev) => Math.min(remainingAddable, prev + 1))}
                className="flex h-10 w-10 items-center justify-center text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            <button
              type="button"
              disabled={remainingAddable === 0}
              onClick={() => {
                onAddToCart(product, clampedQty);
                onClose();
              }}
              className="flex-1 rounded-lg bg-[#0F172A] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#2563EB] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 whitespace-nowrap"
            >
              {product.stock <= 0
                ? 'Out of Stock'
                : remainingAddable === 0
                  ? 'Maximum Stock in Cart'
                  : `Add to Cart — ${formatPrice(product.price_cents * clampedQty)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
