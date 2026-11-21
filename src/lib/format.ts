export function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

export function formatTimestamp(isoOrSql: string): string {
  const normalized = isoOrSql.includes('T') ? isoOrSql : `${isoOrSql.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return isoOrSql;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

export function getStockIndicator(stock: number, threshold: number): {
  label: string;
  toneClass: string;
} {
  if (stock <= 0) {
    return {
      label: 'Out of stock',
      toneClass: 'text-[#DC2626]',
    };
  }
  if (stock <= threshold) {
    return {
      label: `Low stock · ${stock} left`,
      toneClass: 'text-[#D97706]',
    };
  }
  return {
    label: `${stock} available`,
    toneClass: 'text-[#16A34A]',
  };
}
