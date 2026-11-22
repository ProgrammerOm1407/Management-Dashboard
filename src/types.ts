import { Timestamp } from 'firebase/firestore';

export type UserRole = 'super_admin' | 'owner' | 'server';
export type ShopType = 'cafe' | 'restaurant' | 'hotel' | 'both';
export type OrderStatus = 'pending' | 'preparing' | 'ready' | 'served' | 'paid' | 'cancelled';
export type OrderSource = 'server' | 'guest';
export type RoomStatus = 'available' | 'occupied' | 'maintenance';
export type BookingStatus = 'pending' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled';
export type PaymentMethod = 'cash' | 'upi';
export type PaymentStatus = 'unpaid' | 'verification_pending' | 'paid';

export interface ShopModules {
  menu: boolean;
  orders: boolean;
  rooms: boolean;
}

export interface Shop {
  id: string;
  name: string;
  slug: string;
  type: ShopType;
  logo_url: string;
  primary_color: string;
  description: string;
  is_active: boolean;
  modules: ShopModules;
  owner_email: string;
  upi_id?: string | null;
  upi_payee_name?: string | null;
  accept_upi?: boolean;
  accept_cash?: boolean;
  created_at: Timestamp | null;
  updated_at: Timestamp | null;
}

export interface ShopSlugRecord {
  shop_id: string;
  name: string;
  slug: string;
  type: ShopType;
  logo_url: string;
  primary_color: string;
  description: string;
  is_active: boolean;
  modules: ShopModules;
  upi_id?: string | null;
  upi_payee_name?: string | null;
  accept_upi?: boolean;
  accept_cash?: boolean;
  updated_at: Timestamp | null;
}

export interface UserProfile {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  shop_id: string | null;
  invite_id: string | null;
  created_at: Timestamp | null;
  updated_at: Timestamp | null;
}

export interface StaffInvite {
  id: string;
  email: string;
  full_name: string;
  role: 'owner' | 'server';
  shop_id: string;
  owner_email: string;
  status: 'pending' | 'active';
  user_uid: string | null;
  created_at: Timestamp | null;
  updated_at: Timestamp | null;
}

export interface MenuItem {
  id: string;
  shop_id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  image_url: string;
  is_available: boolean;
  stock_count?: number | null;
  low_stock_threshold?: number;
  created_at: Timestamp | null;
  updated_at: Timestamp | null;
}

export interface OrderItem {
  menu_item_id: string;
  name: string;
  price: number;
  quantity: number;
}

export interface Order {
  id: string;
  shop_id: string;
  order_number: string;
  customer_name: string;
  customer_phone?: string | null;
  table_or_room: string;
  items: OrderItem[];
  total_amount: number;
  status: OrderStatus;
  source: OrderSource;
  notes: string;
  created_by_uid: string | null;
  payment_method?: PaymentMethod;
  payment_status?: PaymentStatus;
  utr_number?: string | null;
  paid_at?: Timestamp | null;
  created_at: Timestamp | null;
  updated_at: Timestamp | null;
}

export interface OrderTracker {
  id: string;
  shop_id: string;
  order_number: string;
  table_or_room: string;
  items: OrderItem[];
  total_amount: number;
  status: OrderStatus;
  payment_method?: PaymentMethod;
  payment_status?: PaymentStatus;
  paid_at?: Timestamp | null;
  created_at: Timestamp | null;
  updated_at: Timestamp | null;
}

export interface ShopCustomer {
  id: string;
  shop_id: string;
  full_name: string;
  mobile_number: string;
  email: string;
  reward_points: number;
  total_orders: number;
  total_spent: number;
  last_order_at: Timestamp | null;
  created_at: Timestamp | null;
  updated_at: Timestamp | null;
}

export interface Room {
  id: string;
  shop_id: string;
  room_number: string;
  title: string;
  room_type: string;
  nightly_rate: number;
  capacity: number;
  status: RoomStatus;
  amenities: string[];
  image_url: string;
  created_at: Timestamp | null;
  updated_at: Timestamp | null;
}

export interface RoomBooking {
  id: string;
  shop_id: string;
  room_id: string;
  room_number: string;
  guest_name: string;
  guest_contact: string;
  check_in: string;
  check_out: string;
  status: BookingStatus;
  total_price: number;
  notes: string;
  payment_method?: PaymentMethod;
  payment_status?: PaymentStatus;
  utr_number?: string | null;
  paid_at?: Timestamp | null;
  created_at: Timestamp | null;
  updated_at: Timestamp | null;
}

export interface RoomAvailability {
  id: string;
  shop_id: string;
  room_id: string;
  check_in: string;
  check_out: string;
  status: BookingStatus;
  updated_at: Timestamp | null;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export const SUPER_ADMIN_EMAIL = 'programmerom2006@gmail.com';

export const DEFAULT_HERO_IMAGE = '/src/assets/images/hospitality_cafe_hero_1795324939063.jpg';
export const DEFAULT_DISH_IMAGE = '/src/assets/images/culinary_dish_plate_1795324938671.jpg';
export const DEFAULT_SUITE_IMAGE = '/src/assets/images/boutique_hotel_suite_1795324939826.jpg';

export const ORDER_STATUS_FLOW: OrderStatus[] = ['pending', 'preparing', 'ready', 'served', 'paid'];
export const KITCHEN_KANBAN_STAGES: OrderStatus[] = ['pending', 'preparing', 'ready'];
export const KITCHEN_ACTIVE_STAGES: OrderStatus[] = ['pending', 'preparing', 'ready', 'served'];

export const NEXT_ORDER_STATUS: Record<OrderStatus, OrderStatus | null> = {
  pending: 'preparing',
  preparing: 'ready',
  ready: 'served',
  served: 'paid',
  paid: null,
  cancelled: null,
};
