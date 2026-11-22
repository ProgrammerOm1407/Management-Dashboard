import {
  ORDER_STATUS_FLOW,
  OrderItem,
  OrderStatus,
  OrderTracker,
  PaymentMethod,
  PaymentStatus,
} from '../types';

export interface GuestOrderSession {
  orderId: string;
  orderNumber: string;
  customerName: string;
  tableOrRoom: string;
  notes: string;
  utrNumber: string | null;
  updatedAt?: number;
}

export interface SerializedOrderTracker {
  id: string;
  shop_id: string;
  order_number: string;
  table_or_room: string;
  items: OrderItem[];
  total_amount: number;
  status: OrderStatus;
  payment_method?: PaymentMethod;
  payment_status?: PaymentStatus;
}

export interface PersistedStorefrontState {
  version: 1;
  updatedAt: number;
  cart: Record<string, number>;
  guestName: string;
  guestPhone?: string;
  tableOrRoom: string;
  notes: string;
  orderPaymentMethod: PaymentMethod;
  activeSection: 'menu' | 'rooms';
  selectedCategory: string;
  activeOrderId: string | null;
  trackerViewOpen: boolean;
  lastTrackerSnapshot: SerializedOrderTracker | null;
  checkInDate?: string;
  checkOutDate?: string;
  minGuests?: number;
}

const STATE_KEY_PREFIX = 'hostgrid_storefront_state_';
const SESSIONS_KEY_PREFIX = 'hostgrid_guest_sessions_';
const LEGACY_ORDER_KEY_PREFIX = 'hostgrid_active_order_';

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours for idle cart / table drafts
const SESSION_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours for active orders & running tabs

export function getStorefrontStateKey(shopId: string): string {
  return `${STATE_KEY_PREFIX}${shopId}`;
}

export function getGuestSessionsKey(shopId: string): string {
  return `${SESSIONS_KEY_PREFIX}${shopId}`;
}

function safeGetItem(key: string): string | null {
  try {
    const val = window.localStorage.getItem(key);
    if (val !== null) return val;
  } catch {
    // Fallback to sessionStorage below
  }
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  let wroteLocal = false;
  try {
    window.localStorage.setItem(key, value);
    wroteLocal = true;
  } catch {
    // Ignore localStorage failure (private browsing / quota)
  }
  if (!wroteLocal) {
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      // Ignore sessionStorage failure
    }
  }
}

function safeRemoveItem(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function isValidOrderStatus(val: unknown): val is OrderStatus {
  return (
    typeof val === 'string' &&
    (ORDER_STATUS_FLOW.includes(val as OrderStatus) || val === 'cancelled')
  );
}

function sanitizeCart(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, number> = {};
  for (const [id, qty] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof id === 'string' && id.trim() && typeof qty === 'number' && Number.isFinite(qty)) {
      const clamped = Math.min(99, Math.max(0, Math.floor(qty)));
      if (clamped > 0) {
        result[id] = clamped;
      }
    }
  }
  return result;
}

function sanitizeOrderItems(raw: unknown): OrderItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item): item is OrderItem =>
        Boolean(
          item &&
            typeof item === 'object' &&
            typeof (item as OrderItem).menu_item_id === 'string' &&
            typeof (item as OrderItem).name === 'string' &&
            typeof (item as OrderItem).price === 'number' &&
            typeof (item as OrderItem).quantity === 'number' &&
            (item as OrderItem).quantity > 0
        )
    )
    .map((item) => ({
      menu_item_id: item.menu_item_id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
    }));
}

export function serializeOrderTracker(tracker: OrderTracker | null): SerializedOrderTracker | null {
  if (!tracker) return null;
  return {
    id: tracker.id,
    shop_id: tracker.shop_id,
    order_number: tracker.order_number,
    table_or_room: tracker.table_or_room,
    items: tracker.items,
    total_amount: tracker.total_amount,
    status: tracker.status,
    payment_method: tracker.payment_method,
    payment_status: tracker.payment_status,
  };
}

export function deserializeOrderTracker(
  raw: unknown,
  expectedShopId: string
): OrderTracker | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<SerializedOrderTracker>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.order_number !== 'string' ||
    typeof candidate.table_or_room !== 'string' ||
    typeof candidate.total_amount !== 'number' ||
    !isValidOrderStatus(candidate.status)
  ) {
    return null;
  }
  if (candidate.shop_id && candidate.shop_id !== expectedShopId) {
    return null;
  }
  const items = sanitizeOrderItems(candidate.items);
  return {
    id: candidate.id,
    shop_id: expectedShopId,
    order_number: candidate.order_number,
    table_or_room: candidate.table_or_room,
    items,
    total_amount: candidate.total_amount,
    status: candidate.status,
    payment_method:
      candidate.payment_method === 'upi' || candidate.payment_method === 'cash'
        ? candidate.payment_method
        : undefined,
    payment_status:
      candidate.payment_status === 'paid' ||
      candidate.payment_status === 'verification_pending' ||
      candidate.payment_status === 'unpaid'
        ? candidate.payment_status
        : undefined,
    paid_at: null,
    created_at: null,
    updated_at: null,
  };
}

export function readGuestSessions(shopId: string): GuestOrderSession[] {
  const raw = safeGetItem(getGuestSessionsKey(shopId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter((x): x is GuestOrderSession => {
      if (
        !x ||
        typeof x !== 'object' ||
        typeof x.orderId !== 'string' ||
        typeof x.customerName !== 'string' ||
        typeof x.tableOrRoom !== 'string'
      ) {
        return false;
      }
      if (typeof x.updatedAt === 'number' && now - x.updatedAt > SESSION_TTL_MS) {
        return false;
      }
      return true;
    });
  } catch {
    return [];
  }
}

export function writeGuestSessions(shopId: string, sessions: GuestOrderSession[]): void {
  const now = Date.now();
  const stamped = sessions.slice(0, 12).map((session) => ({
    ...session,
    updatedAt: session.updatedAt || now,
  }));
  safeSetItem(getGuestSessionsKey(shopId), JSON.stringify(stamped));
}

export function readLegacyActiveOrderId(shopId: string): string | null {
  try {
    return window.sessionStorage.getItem(`${LEGACY_ORDER_KEY_PREFIX}${shopId}`);
  } catch {
    return null;
  }
}

export function writeLegacyActiveOrderId(shopId: string, orderId: string | null): void {
  const key = `${LEGACY_ORDER_KEY_PREFIX}${shopId}`;
  if (!orderId) {
    safeRemoveItem(key);
    return;
  }
  try {
    window.sessionStorage.setItem(key, orderId);
  } catch {
    // ignore
  }
}

export function readStorefrontState(shopId: string): PersistedStorefrontState | null {
  const raw = safeGetItem(getStorefrontStateKey(shopId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedStorefrontState>;
    if (!parsed || typeof parsed !== 'object') return null;

    const updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now();
    const age = Date.now() - updatedAt;
    const hasActiveOrder = typeof parsed.activeOrderId === 'string' && parsed.activeOrderId.length > 0;

    if (!hasActiveOrder && age > DRAFT_TTL_MS) {
      safeRemoveItem(getStorefrontStateKey(shopId));
      return null;
    }
    if (hasActiveOrder && age > SESSION_TTL_MS) {
      safeRemoveItem(getStorefrontStateKey(shopId));
      return null;
    }

    const restoredTracker = deserializeOrderTracker(parsed.lastTrackerSnapshot, shopId);

    return {
      version: 1,
      updatedAt,
      cart: sanitizeCart(parsed.cart),
      guestName: typeof parsed.guestName === 'string' ? parsed.guestName.slice(0, 100) : '',
      guestPhone: typeof parsed.guestPhone === 'string' ? parsed.guestPhone.slice(0, 32) : '',
      tableOrRoom: typeof parsed.tableOrRoom === 'string' ? parsed.tableOrRoom.slice(0, 60) : '',
      notes: typeof parsed.notes === 'string' ? parsed.notes.slice(0, 300) : '',
      orderPaymentMethod: parsed.orderPaymentMethod === 'upi' ? 'upi' : 'cash',
      activeSection: parsed.activeSection === 'rooms' ? 'rooms' : 'menu',
      selectedCategory:
        typeof parsed.selectedCategory === 'string' && parsed.selectedCategory.trim()
          ? parsed.selectedCategory
          : 'All',
      activeOrderId: hasActiveOrder ? parsed.activeOrderId! : null,
      trackerViewOpen: Boolean(parsed.trackerViewOpen && hasActiveOrder),
      lastTrackerSnapshot: restoredTracker ? serializeOrderTracker(restoredTracker) : null,
      checkInDate: typeof parsed.checkInDate === 'string' ? parsed.checkInDate : undefined,
      checkOutDate: typeof parsed.checkOutDate === 'string' ? parsed.checkOutDate : undefined,
      minGuests:
        typeof parsed.minGuests === 'number' && parsed.minGuests >= 1 && parsed.minGuests <= 4
          ? parsed.minGuests
          : undefined,
    };
  } catch {
    return null;
  }
}

export function writeStorefrontState(
  shopId: string,
  state: Omit<PersistedStorefrontState, 'version' | 'updatedAt'>
): void {
  const payload: PersistedStorefrontState = {
    ...state,
    version: 1,
    updatedAt: Date.now(),
  };
  safeSetItem(getStorefrontStateKey(shopId), JSON.stringify(payload));
}
