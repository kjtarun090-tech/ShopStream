import { useState } from 'react';
import { Star } from 'lucide-react';

interface StarRatingDisplayProps {
  rating: number;
  reviewCount: number;
  size?: 'sm' | 'md';
  showEmptyText?: boolean;
}

export function StarRating({
  rating,
  reviewCount,
  size = 'sm',
  showEmptyText = true,
}: StarRatingDisplayProps) {
  const starSizeClass = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const textSizeClass = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <div
      className="flex items-center gap-1.5"
      aria-label={
        reviewCount > 0
          ? `Rated ${rating.toFixed(1)} out of 5 stars based on ${reviewCount} reviews`
          : 'No reviews yet'
      }
    >
      <div className="flex items-center gap-0.5" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((starIndex) => {
          const fillRatio = Math.max(0, Math.min(1, rating - (starIndex - 1)));
          return (
            <span key={starIndex} className={`relative inline-block ${starSizeClass}`}>
              <Star className={`${starSizeClass} text-slate-200 fill-slate-200`} />
              {fillRatio > 0 && (
                <span
                  className="absolute inset-y-0 left-0 overflow-hidden"
                  style={{ width: `${Math.round(fillRatio * 100)}%` }}
                >
                  <Star className={`${starSizeClass} text-[#F59E0B] fill-[#F59E0B]`} />
                </span>
              )}
            </span>
          );
        })}
      </div>

      {reviewCount > 0 ? (
        <span className={`${textSizeClass} text-slate-600 tabular-nums`}>
          <span className="font-semibold text-[#0F172A]">{rating.toFixed(1)}</span>
          <span className="mx-1 text-slate-300" aria-hidden="true">
            ·
          </span>
          <span>
            {reviewCount} {reviewCount === 1 ? 'review' : 'reviews'}
          </span>
        </span>
      ) : (
        showEmptyText && (
          <span className={`${textSizeClass} text-slate-400`}>No reviews yet</span>
        )
      )}
    </div>
  );
}

interface StarRatingInputProps {
  value: number;
  onChange: (rating: number) => void;
}

export function StarRatingInput({ value, onChange }: StarRatingInputProps) {
  const [hovered, setHovered] = useState<number>(0);
  const activeValue = hovered || value;

  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Select star rating">
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= activeValue;
        return (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={`${star} ${star === 1 ? 'star' : 'stars'}`}
            onMouseEnter={() => setHovered(star)}
            onMouseLeave={() => setHovered(0)}
            onClick={() => onChange(star)}
            className="rounded p-1 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
          >
            <Star
              className={`h-5 w-5 transition-colors ${
                filled ? 'fill-[#F59E0B] text-[#F59E0B]' : 'fill-slate-100 text-slate-300'
              }`}
              aria-hidden="true"
            />
          </button>
        );
      })}
      <span className="ml-2 font-mono text-xs font-medium text-slate-600 tabular-nums">
        {activeValue} / 5
      </span>
    </div>
  );
}
