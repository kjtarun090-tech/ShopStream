export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string;
  product_count?: number;
}

export interface Product {
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
  relevanceScore?: number;
}

export interface ProductReview {
  id: number;
  product_id: number;
  reviewer_name: string;
  rating: number;
  comment: string;
  created_at: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface OrderItem {
  id: number;
  order_id: number;
  product_id: number;
  product_name: string;
  sku: string;
  quantity: number;
  unit_price_cents: number;
}

export interface Order {
  id: number;
  order_number: string;
  user_id: number | null;
  customer_name: string;
  customer_email: string;
  shipping_address: string;
  status: string;
  total_cents: number;
  created_at: string;
  items: OrderItem[];
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: 'customer' | 'admin';
  address: string;
  phone: string;
}

export interface DomainEvent {
  id: number;
  topic: 'shopstream.orders' | 'shopstream.inventory' | 'shopstream.search';
  event_type: string;
  payload: Record<string, unknown>;
  processing_ms: number;
  created_at: string;
}

export interface AdminStats {
  totalProducts: number;
  totalUnits: number;
  lowStockCount: number;
  outOfStockCount: number;
  totalOrders: number;
  totalRevenueCents: number;
}
