import { db } from './db.ts';

export interface IndexedProduct {
  id: number;
  sku: string;
  name: string;
  slug: string;
  description: string;
  category_id: number;
  category_name: string;
  category_slug: string;
  price_cents: number;
  stock: number;
  low_stock_threshold: number;
  image_url: string;
  featured: number;
  updated_at: string;
  rating_avg: number;
  review_count: number;
}

let productIndex: IndexedProduct[] = [];
let vocabulary: Set<string> = new Set();

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function damerauLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost);
      }
    }
  }
  return dp[m][n];
}

export function rebuildSearchIndex(): { indexedCount: number; durationMs: number } {
  const start = performance.now();
  const rows = db
    .prepare(`
      SELECT
        p.*,
        c.name AS category_name,
        c.slug AS category_slug,
        ROUND(COALESCE(AVG(r.rating), 0), 1) AS rating_avg,
        COUNT(r.id) AS review_count
      FROM products p
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN product_reviews r ON r.product_id = p.id
      GROUP BY p.id
      ORDER BY p.featured DESC, p.id ASC
    `)
    .all() as IndexedProduct[];

  productIndex = rows;
  const vocab = new Set<string>();
  for (const row of rows) {
    for (const token of tokenize(`${row.name} ${row.category_name} ${row.description} ${row.sku}`)) {
      vocab.add(token);
    }
  }
  vocabulary = vocab;
  return {
    indexedCount: rows.length,
    durationMs: Number((performance.now() - start).toFixed(2)),
  };
}

export interface SearchQuery {
  q?: string;
  category?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  inStockOnly?: boolean;
}

export interface SearchResponse {
  items: (IndexedProduct & { relevanceScore: number })[];
  total: number;
  queryTimeMs: number;
  correctedQuery: string | null;
}

export function searchCatalog(params: SearchQuery): SearchResponse {
  const start = performance.now();
  if (productIndex.length === 0) {
    rebuildSearchIndex();
  }

  const rawQuery = (params.q ?? '').trim();
  const queryTokens = tokenize(rawQuery);
  const correctedTokens: string[] = [];
  let hadCorrection = false;

  for (const qt of queryTokens) {
    if (vocabulary.has(qt)) {
      correctedTokens.push(qt);
      continue;
    }
    let bestWord = qt;
    let bestDist = Infinity;
    const maxAllowed = qt.length <= 4 ? 1 : 2;
    for (const word of vocabulary) {
      if (Math.abs(word.length - qt.length) > 3) continue;
      // Prefix boost for partial words like "headphone" -> "headphones"
      if (word.startsWith(qt) || qt.startsWith(word)) {
        bestWord = word;
        bestDist = 0;
        break;
      }
      const dist = damerauLevenshtein(qt, word);
      if (dist <= maxAllowed && dist < bestDist) {
        bestDist = dist;
        bestWord = word;
      }
    }
    if (bestWord !== qt) hadCorrection = true;
    correctedTokens.push(bestWord);
  }

  let results: (IndexedProduct & { relevanceScore: number })[] = [];

  for (const item of productIndex) {
    if (params.category && params.category !== 'all' && item.category_slug !== params.category) {
      continue;
    }
    if (params.minPriceCents !== undefined && item.price_cents < params.minPriceCents) {
      continue;
    }
    if (params.maxPriceCents !== undefined && item.price_cents > params.maxPriceCents) {
      continue;
    }
    if (params.inStockOnly && item.stock <= 0) {
      continue;
    }

    if (queryTokens.length === 0) {
      results.push({ ...item, relevanceScore: item.featured ? 2 : 1 });
      continue;
    }

    const nameTokens = tokenize(item.name);
    const catTokens = tokenize(item.category_name);
    const descTokens = tokenize(item.description);
    const skuLower = item.sku.toLowerCase();

    let score = 0;
    let matchedTokens = 0;

    for (let idx = 0; idx < queryTokens.length; idx++) {
      const qt = queryTokens[idx];
      const ct = correctedTokens[idx];
      let tokenScore = 0;

      if (skuLower.includes(qt)) {
        tokenScore = Math.max(tokenScore, 12);
      }

      for (const nt of nameTokens) {
        if (nt === qt || nt === ct) {
          tokenScore = Math.max(tokenScore, 10);
        } else if (nt.startsWith(qt) || nt.startsWith(ct)) {
          tokenScore = Math.max(tokenScore, 7.5);
        } else {
          const maxDist = qt.length <= 4 ? 1 : 2;
          const dist = damerauLevenshtein(qt, nt);
          if (dist <= maxDist) {
            tokenScore = Math.max(tokenScore, 6 - dist * 1.5);
          }
        }
      }

      for (const catT of catTokens) {
        if (catT === qt || catT === ct || catT.startsWith(qt)) {
          tokenScore = Math.max(tokenScore, 5);
        }
      }

      for (const dt of descTokens) {
        if (dt === qt || dt === ct) {
          tokenScore = Math.max(tokenScore, 3);
        } else if (qt.length > 4 && damerauLevenshtein(qt, dt) <= 1) {
          tokenScore = Math.max(tokenScore, 2);
        }
      }

      if (tokenScore > 0) {
        matchedTokens += 1;
        score += tokenScore;
      }
    }

    if (matchedTokens > 0) {
      // Bonus when all search terms match
      const coverageBonus = matchedTokens === queryTokens.length ? 5 : 0;
      results.push({ ...item, relevanceScore: Number((score + coverageBonus).toFixed(2)) });
    }
  }

  results.sort((a, b) => b.relevanceScore - a.relevanceScore || b.featured - a.featured || a.id - b.id);

  return {
    items: results,
    total: results.length,
    queryTimeMs: Number((performance.now() - start).toFixed(2)),
    correctedQuery: hadCorrection && results.length > 0 ? correctedTokens.join(' ') : null,
  };
}
