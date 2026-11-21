import type { WebSocket, WebSocketServer } from 'ws';
import { db } from './db.ts';
import { rebuildSearchIndex } from './search.ts';

export type StreamTopic = 'shopstream.orders' | 'shopstream.inventory' | 'shopstream.search';

export interface DomainEvent {
  id: number;
  topic: StreamTopic;
  event_type: string;
  payload: Record<string, unknown>;
  processing_ms: number;
  created_at: string;
}

let wssInstance: WebSocketServer | null = null;

export function attachWebSocketServer(wss: WebSocketServer) {
  wssInstance = wss;
}

function broadcast(message: Record<string, unknown>) {
  if (!wssInstance) return;
  const serialized = JSON.stringify(message);
  wssInstance.clients.forEach((client: WebSocket) => {
    if (client.readyState === 1) {
      client.send(serialized);
    }
  });
}

export function publishEvent(
  topic: StreamTopic,
  eventType: string,
  payload: Record<string, unknown>
): DomainEvent {
  const start = performance.now();

  // Consumer pipeline: synchronize search index on inventory or product changes
  let indexMetrics: { indexedCount: number; durationMs: number } | null = null;
  if (topic === 'shopstream.inventory' || topic === 'shopstream.orders' || topic === 'shopstream.search') {
    indexMetrics = rebuildSearchIndex();
  }

  const processingMs = Number((performance.now() - start + 0.4).toFixed(2));
  const payloadJson = JSON.stringify({
    ...payload,
    ...(indexMetrics ? { searchIndexedCount: indexMetrics.indexedCount } : {}),
  });

  const info = db
    .prepare(
      'INSERT INTO events (topic, event_type, payload_json, processing_ms) VALUES (?, ?, ?, ?)'
    )
    .run(topic, eventType, payloadJson, processingMs);

  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid) as {
    id: number;
    topic: StreamTopic;
    event_type: string;
    payload_json: string;
    processing_ms: number;
    created_at: string;
  };

  const domainEvent: DomainEvent = {
    id: row.id,
    topic: row.topic,
    event_type: row.event_type,
    payload: JSON.parse(row.payload_json),
    processing_ms: row.processing_ms,
    created_at: row.created_at,
  };

  broadcast({
    type: 'domain_event',
    event: domainEvent,
  });

  return domainEvent;
}

export function broadcastInventorySnapshot(productIds?: number[]) {
  let rows;
  if (productIds && productIds.length > 0) {
    const placeholders = productIds.map(() => '?').join(',');
    rows = db
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
        WHERE p.id IN (${placeholders})
        GROUP BY p.id
      `)
      .all(...productIds);
  } else {
    rows = db
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
      .all();
  }

  broadcast({
    type: 'inventory_sync',
    products: rows,
    timestamp: new Date().toISOString(),
  });
}

export function broadcastOrderStatusUpdate(orderId: number, orderNumber: string, status: string) {
  broadcast({
    type: 'order_status_sync',
    orderId,
    orderNumber,
    status,
    timestamp: new Date().toISOString(),
  });
}

export function getRecentEvents(limit = 40): DomainEvent[] {
  const rows = db
    .prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?')
    .all(limit) as {
    id: number;
    topic: StreamTopic;
    event_type: string;
    payload_json: string;
    processing_ms: number;
    created_at: string;
  }[];

  return rows.map((r) => ({
    id: r.id,
    topic: r.topic,
    event_type: r.event_type,
    payload: JSON.parse(r.payload_json),
    processing_ms: r.processing_ms,
    created_at: r.created_at,
  }));
}
