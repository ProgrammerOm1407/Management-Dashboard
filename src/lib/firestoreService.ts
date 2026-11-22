import {
  collection,
  deleteDoc,
  doc,
  DocumentChange,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError } from './firebase';
import {
  BookingStatus,
  DEFAULT_DISH_IMAGE,
  DEFAULT_SUITE_IMAGE,
  MenuItem,
  OperationType,
  Order,
  OrderItem,
  OrderSource,
  OrderStatus,
  OrderTracker,
  PaymentMethod,
  PaymentStatus,
  Room,
  RoomAvailability,
  RoomBooking,
  RoomStatus,
  Shop,
  ShopModules,
  ShopSlugRecord,
  ShopType,
  StaffInvite,
  SUPER_ADMIN_EMAIL,
  UserProfile,
} from '../types';
import { clampString, isSafeMediaUrl, isValidEmail, isValidHexColor, isValidSlug } from './validation';
import { addDaysIso, getTodayIso } from './dateUtils';
import { isValidUpiId } from './upi';

function generateOrderNumber(): string {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `ORD-${num}`;
}

// ---------------------------------------------------------------------------
// Profiles & Role Resolution
// ---------------------------------------------------------------------------
export async function resolveOrCreateUserProfile(
  uid: string,
  email: string,
  displayName: string
): Promise<{ profile: UserProfile | null; unprovisioned: boolean }> {
  const normalizedEmail = email.trim().toLowerCase();
  const profileRef = doc(db, 'profiles', uid);

  try {
    const existingSnap = await getDoc(profileRef);
    if (existingSnap.exists()) {
      return { profile: existingSnap.data() as UserProfile, unprovisioned: false };
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `profiles/${uid}`);
  }

  // Bootstrapped Super Admin
  if (normalizedEmail === SUPER_ADMIN_EMAIL) {
    const payload = {
      id: uid,
      full_name: clampString(displayName || 'Platform Super Admin', 100),
      email: normalizedEmail,
      role: 'super_admin' as const,
      shop_id: null,
      invite_id: null,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    };
    try {
      await setDoc(profileRef, payload);
      const created = await getDoc(profileRef);
      return { profile: created.data() as UserProfile, unprovisioned: false };
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `profiles/${uid}`);
    }
  }

  // Look up verified invitation by email
  let matchingInvite: StaffInvite | null = null;
  try {
    const q = query(collection(db, 'staff_invites'), where('email', '==', normalizedEmail));
    const snap = await getDocs(q);
    if (!snap.empty) {
      matchingInvite = snap.docs[0].data() as StaffInvite;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'staff_invites');
  }

  if (!matchingInvite) {
    return { profile: null, unprovisioned: true };
  }

  const profilePayload = {
    id: uid,
    full_name: clampString(displayName || matchingInvite.full_name, 100),
    email: normalizedEmail,
    role: matchingInvite.role,
    shop_id: matchingInvite.shop_id,
    invite_id: matchingInvite.id,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  };

  try {
    await setDoc(profileRef, profilePayload);
    if (matchingInvite.status === 'pending') {
      await updateDoc(doc(db, 'staff_invites', matchingInvite.id), {
        status: 'active',
        user_uid: uid,
        updated_at: serverTimestamp(),
      });
    }
    const created = await getDoc(profileRef);
    return { profile: created.data() as UserProfile, unprovisioned: false };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `profiles/${uid}`);
  }
}

// ---------------------------------------------------------------------------
// Shops (Super Admin & Tenant Configuration)
// ---------------------------------------------------------------------------
export function subscribeAllShops(
  onData: (shops: Shop[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(collection(db, 'shops'), orderBy('created_at', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => d.data() as Shop);
      onData(items);
    },
    (error) => {
      if (onError) onError(error);
      try {
        handleFirestoreError(error, OperationType.LIST, 'shops');
      } catch {
        // Logged via handleFirestoreError
      }
    }
  );
}

export function subscribeShopById(
  shopId: string,
  onData: (shop: Shop | null) => void,
  onError?: (err: Error) => void
): () => void {
  const ref = doc(db, 'shops', shopId);
  return onSnapshot(
    ref,
    (snapshot) => {
      onData(snapshot.exists() ? (snapshot.data() as Shop) : null);
    },
    (error) => {
      if (onError) onError(error);
      try {
        handleFirestoreError(error, OperationType.GET, `shops/${shopId}`);
      } catch {
        // Logged via handleFirestoreError
      }
    }
  );
}

export async function getShopSlugRecord(slug: string): Promise<ShopSlugRecord | null> {
  const cleanSlug = slug.trim().toLowerCase();
  if (!isValidSlug(cleanSlug)) return null;
  try {
    const snap = await getDoc(doc(db, 'shop_slugs', cleanSlug));
    return snap.exists() ? (snap.data() as ShopSlugRecord) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `shop_slugs/${cleanSlug}`);
  }
}

export function subscribeShopSlugRecord(
  slug: string,
  onData: (record: ShopSlugRecord | null) => void,
  onError?: (err: Error) => void
): () => void {
  const cleanSlug = slug.trim().toLowerCase();
  if (!isValidSlug(cleanSlug)) {
    onData(null);
    return () => {};
  }
  const ref = doc(db, 'shop_slugs', cleanSlug);
  return onSnapshot(
    ref,
    (snapshot) => {
      onData(snapshot.exists() ? (snapshot.data() as ShopSlugRecord) : null);
    },
    (error) => {
      if (onError) onError(error);
      try {
        handleFirestoreError(error, OperationType.GET, `shop_slugs/${cleanSlug}`);
      } catch {
        // Logged via handleFirestoreError
      }
    }
  );
}

export interface CreateShopInput {
  name: string;
  slug: string;
  type: ShopType;
  logo_url: string;
  primary_color: string;
  description: string;
  modules: ShopModules;
  owner_name: string;
  owner_email: string;
}

export async function createShopWithOwner(input: CreateShopInput): Promise<string> {
  const name = clampString(input.name, 100);
  const slug = input.slug.trim().toLowerCase();
  const ownerEmail = input.owner_email.trim().toLowerCase();
  const ownerName = clampString(input.owner_name || 'Shop Owner', 100);
  const logoUrl = input.logo_url.trim();
  const primaryColor = input.primary_color.trim();
  const description = clampString(input.description || '', 400);

  if (!name) throw new Error('Shop name is required.');
  if (!isValidSlug(slug)) throw new Error('Slug must be 2–64 lowercase letters, numbers, or hyphens.');
  if (!isValidEmail(ownerEmail)) throw new Error('Please enter a valid owner email address.');
  if (!isValidHexColor(primaryColor)) throw new Error('Primary color must be a valid hex value (e.g. #2563EB).');
  if (!isSafeMediaUrl(logoUrl)) throw new Error('Logo URL must start with https:// or http://.');

  // Verify slug uniqueness
  const slugRef = doc(db, 'shop_slugs', slug);
  try {
    const existingSlug = await getDoc(slugRef);
    if (existingSlug.exists()) {
      throw new Error(`The URL slug "/s/${slug}" is already taken. Choose another unique slug.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('already taken')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.GET, `shop_slugs/${slug}`);
  }

  const shopRef = doc(collection(db, 'shops'));
  const shopId = shopRef.id;
  const inviteRef = doc(collection(db, 'staff_invites'));
  const inviteId = inviteRef.id;

  const batch = writeBatch(db);
  batch.set(shopRef, {
    id: shopId,
    name,
    slug,
    type: input.type,
    logo_url: logoUrl,
    primary_color: primaryColor,
    description,
    is_active: true,
    modules: {
      menu: Boolean(input.modules.menu),
      orders: Boolean(input.modules.orders),
      rooms: Boolean(input.modules.rooms),
    },
    owner_email: ownerEmail,
    upi_id: null,
    upi_payee_name: name,
    accept_upi: false,
    accept_cash: true,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });

  batch.set(slugRef, {
    shop_id: shopId,
    name,
    slug,
    type: input.type,
    logo_url: logoUrl,
    primary_color: primaryColor,
    description,
    is_active: true,
    modules: {
      menu: Boolean(input.modules.menu),
      orders: Boolean(input.modules.orders),
      rooms: Boolean(input.modules.rooms),
    },
    upi_id: null,
    upi_payee_name: name,
    accept_upi: false,
    accept_cash: true,
    updated_at: serverTimestamp(),
  });

  batch.set(inviteRef, {
    id: inviteId,
    email: ownerEmail,
    full_name: ownerName,
    role: 'owner',
    shop_id: shopId,
    owner_email: ownerEmail,
    status: 'pending',
    user_uid: null,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });

  try {
    await batch.commit();
    return shopId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `shops/${shopId}`);
  }
}

export async function toggleShopActive(shop: Shop, isActive: boolean): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'shops', shop.id), {
    is_active: isActive,
    updated_at: serverTimestamp(),
  });
  batch.update(doc(db, 'shop_slugs', shop.slug), {
    is_active: isActive,
    updated_at: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `shops/${shop.id}`);
  }
}

export async function updateShopModules(shop: Shop, modules: ShopModules): Promise<void> {
  const cleanModules: ShopModules = {
    menu: Boolean(modules.menu),
    orders: Boolean(modules.orders),
    rooms: Boolean(modules.rooms),
  };
  const batch = writeBatch(db);
  batch.update(doc(db, 'shops', shop.id), {
    modules: cleanModules,
    updated_at: serverTimestamp(),
  });
  batch.update(doc(db, 'shop_slugs', shop.slug), {
    modules: cleanModules,
    updated_at: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `shops/${shop.id}`);
  }
}

export async function updateShopBranding(
  shop: Shop,
  updates: { name: string; logo_url: string; primary_color: string; description: string }
): Promise<void> {
  const name = clampString(updates.name, 100);
  const logoUrl = updates.logo_url.trim();
  const primaryColor = updates.primary_color.trim();
  const description = clampString(updates.description, 400);

  if (!name) throw new Error('Shop name cannot be empty.');
  if (!isValidHexColor(primaryColor)) throw new Error('Brand color must be a valid 6-digit hex code.');
  if (!isSafeMediaUrl(logoUrl)) throw new Error('Logo URL must use http:// or https://.');

  const batch = writeBatch(db);
  batch.update(doc(db, 'shops', shop.id), {
    name,
    logo_url: logoUrl,
    primary_color: primaryColor,
    description,
    updated_at: serverTimestamp(),
  });
  batch.update(doc(db, 'shop_slugs', shop.slug), {
    name,
    logo_url: logoUrl,
    primary_color: primaryColor,
    description,
    updated_at: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `shops/${shop.id}`);
  }
}

export interface ShopPaymentSettingsInput {
  accept_cash: boolean;
  accept_upi: boolean;
  upi_id: string;
  upi_payee_name: string;
}

export async function updateShopPaymentSettings(
  shop: Shop,
  input: ShopPaymentSettingsInput
): Promise<void> {
  const acceptCash = Boolean(input.accept_cash);
  const acceptUpi = Boolean(input.accept_upi);
  const rawUpiId = input.upi_id.trim();
  const rawPayeeName = clampString(input.upi_payee_name, 100);

  if (!acceptCash && !acceptUpi) {
    throw new Error('Enable at least one payment method (Cash or UPI).');
  }
  if (acceptUpi && !rawUpiId) {
    throw new Error('Enter your merchant UPI ID (e.g. mycafe@okicici) to enable UPI payments.');
  }
  if (rawUpiId && !isValidUpiId(rawUpiId)) {
    throw new Error('Enter a valid UPI ID in the format handle@bank (e.g. mycafe@okicici).');
  }

  const upiId: string | null = rawUpiId ? rawUpiId : null;
  const upiPayeeName: string | null = rawPayeeName ? rawPayeeName : shop.name;

  const batch = writeBatch(db);
  batch.update(doc(db, 'shops', shop.id), {
    accept_cash: acceptCash,
    accept_upi: acceptUpi,
    upi_id: upiId,
    upi_payee_name: upiPayeeName,
    updated_at: serverTimestamp(),
  });
  batch.update(doc(db, 'shop_slugs', shop.slug), {
    accept_cash: acceptCash,
    accept_upi: acceptUpi,
    upi_id: upiId,
    upi_payee_name: upiPayeeName,
    updated_at: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `shops/${shop.id}`);
  }
}

// ---------------------------------------------------------------------------
// Staff Management (Shop Owner & Super Admin)
// ---------------------------------------------------------------------------
export function subscribeShopStaff(
  shopId: string,
  ownerEmail: string,
  onData: (staff: StaffInvite[]) => void
): () => void {
  const q = query(
    collection(db, 'staff_invites'),
    where('owner_email', '==', ownerEmail.toLowerCase()),
    where('shop_id', '==', shopId)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs
        .map((d) => d.data() as StaffInvite)
        .sort((a, b) => {
          const tA = a.created_at instanceof Timestamp ? a.created_at.toMillis() : 0;
          const tB = b.created_at instanceof Timestamp ? b.created_at.toMillis() : 0;
          return tB - tA;
        });
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'staff_invites');
      } catch {
        // Logged
      }
    }
  );
}

export async function inviteServerToShop(
  shop: Shop,
  fullName: string,
  email: string
): Promise<void> {
  const cleanName = clampString(fullName, 100);
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanName) throw new Error('Staff full name is required.');
  if (!isValidEmail(cleanEmail)) throw new Error('Please provide a valid email address.');

  const ref = doc(collection(db, 'staff_invites'));
  try {
    await setDoc(ref, {
      id: ref.id,
      email: cleanEmail,
      full_name: cleanName,
      role: 'server',
      shop_id: shop.id,
      owner_email: shop.owner_email.toLowerCase(),
      status: 'pending',
      user_uid: null,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `staff_invites/${ref.id}`);
  }
}

export async function removeStaffInvite(inviteId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'staff_invites', inviteId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `staff_invites/${inviteId}`);
  }
}

// ---------------------------------------------------------------------------
// Menu Items (Owner CRUD; Server & Public Read)
// ---------------------------------------------------------------------------
export function subscribeMenuItems(
  shopId: string,
  onData: (items: MenuItem[]) => void
): () => void {
  const q = query(
    collection(db, 'shops', shopId, 'menu_items'),
    where('shop_id', '==', shopId)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs
        .map((d) => d.data() as MenuItem)
        .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, `shops/${shopId}/menu_items`);
      } catch {
        // Logged
      }
    }
  );
}

export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

export interface MenuItemInput {
  name: string;
  description: string;
  category: string;
  price: number;
  image_url: string;
  is_available: boolean;
  stock_count?: number | null;
  low_stock_threshold?: number;
}

function sanitizeStockFields(
  stockCountInput: number | null | undefined,
  thresholdInput: number | undefined
): { stockCount: number | null; lowStockThreshold: number } {
  let stockCount: number | null = null;
  if (stockCountInput !== null && stockCountInput !== undefined) {
    const parsed = Math.floor(Number(stockCountInput));
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 99999) {
      throw new Error('Inventory stock count must be a whole number between 0 and 99,999.');
    }
    stockCount = parsed;
  }

  let lowStockThreshold = DEFAULT_LOW_STOCK_THRESHOLD;
  if (thresholdInput !== undefined && thresholdInput !== null) {
    const parsedThreshold = Math.floor(Number(thresholdInput));
    if (!Number.isFinite(parsedThreshold) || parsedThreshold < 1 || parsedThreshold > 9999) {
      throw new Error('Low stock threshold must be a whole number between 1 and 9,999.');
    }
    lowStockThreshold = parsedThreshold;
  }

  return { stockCount, lowStockThreshold };
}

export async function createMenuItem(shopId: string, input: MenuItemInput): Promise<void> {
  const name = clampString(input.name, 100);
  const category = clampString(input.category, 60);
  const description = clampString(input.description, 400);
  const imageUrl = input.image_url.trim();
  const price = Number(input.price);

  if (!name) throw new Error('Item name is required.');
  if (!category) throw new Error('Category is required.');
  if (!Number.isFinite(price) || price < 0 || price > 100000) throw new Error('Price must be between 0 and 100,000.');
  if (!isSafeMediaUrl(imageUrl)) throw new Error('Image URL must use http:// or https://.');

  const { stockCount, lowStockThreshold } = sanitizeStockFields(
    input.stock_count,
    input.low_stock_threshold
  );
  const effectiveAvailable = stockCount === 0 ? false : Boolean(input.is_available);

  const ref = doc(collection(db, 'shops', shopId, 'menu_items'));
  try {
    await setDoc(ref, {
      id: ref.id,
      shop_id: shopId,
      name,
      description,
      category,
      price: Math.round(price * 100) / 100,
      image_url: imageUrl,
      is_available: effectiveAvailable,
      stock_count: stockCount,
      low_stock_threshold: lowStockThreshold,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `shops/${shopId}/menu_items/${ref.id}`);
  }
}

export async function updateMenuItem(
  shopId: string,
  itemId: string,
  input: MenuItemInput
): Promise<void> {
  const name = clampString(input.name, 100);
  const category = clampString(input.category, 60);
  const description = clampString(input.description, 400);
  const imageUrl = input.image_url.trim();
  const price = Number(input.price);

  if (!name) throw new Error('Item name is required.');
  if (!category) throw new Error('Category is required.');
  if (!Number.isFinite(price) || price < 0 || price > 100000) throw new Error('Invalid price.');
  if (!isSafeMediaUrl(imageUrl)) throw new Error('Image URL must use http:// or https://.');

  const { stockCount, lowStockThreshold } = sanitizeStockFields(
    input.stock_count,
    input.low_stock_threshold
  );
  const effectiveAvailable = stockCount === 0 ? false : Boolean(input.is_available);

  try {
    await updateDoc(doc(db, 'shops', shopId, 'menu_items', itemId), {
      name,
      description,
      category,
      price: Math.round(price * 100) / 100,
      image_url: imageUrl,
      is_available: effectiveAvailable,
      stock_count: stockCount,
      low_stock_threshold: lowStockThreshold,
      updated_at: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `shops/${shopId}/menu_items/${itemId}`);
  }
}

export async function updateMenuItemStock(
  shopId: string,
  itemId: string,
  stockCountInput: number | null,
  lowStockThresholdInput: number | undefined,
  currentAvailable: boolean,
  wasOutOfStockByCount: boolean
): Promise<{ stockCount: number | null; isAvailable: boolean }> {
  const { stockCount, lowStockThreshold } = sanitizeStockFields(
    stockCountInput,
    lowStockThresholdInput
  );

  let nextAvailable = currentAvailable;
  if (stockCount === 0) {
    nextAvailable = false;
  } else if (stockCount !== null && stockCount > 0 && wasOutOfStockByCount) {
    nextAvailable = true;
  } else if (stockCount === null && wasOutOfStockByCount) {
    nextAvailable = true;
  }

  try {
    await updateDoc(doc(db, 'shops', shopId, 'menu_items', itemId), {
      stock_count: stockCount,
      low_stock_threshold: lowStockThreshold,
      is_available: nextAvailable,
      updated_at: serverTimestamp(),
    });
    return { stockCount, isAvailable: nextAvailable };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `shops/${shopId}/menu_items/${itemId}`);
  }
}

export async function deleteMenuItem(shopId: string, itemId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'shops', shopId, 'menu_items', itemId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `shops/${shopId}/menu_items/${itemId}`);
  }
}

// ---------------------------------------------------------------------------
// Orders (Real-Time Stream, Server Create & Status Transitions, Public Guest Create)
// ---------------------------------------------------------------------------
export interface OrderRealtimeDelta {
  type: DocumentChange['type'];
  order: Order;
}

export function subscribeShopOrders(
  shopId: string,
  onData: (orders: Order[], changes: OrderRealtimeDelta[], isInitial: boolean) => void,
  onError?: (err: Error) => void
): () => void {
  let isInitial = true;
  const q = query(
    collection(db, 'shops', shopId, 'orders'),
    where('shop_id', '==', shopId)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const orders = snapshot.docs
        .map((d) => d.data() as Order)
        .sort((a, b) => {
          const tA = a.created_at instanceof Timestamp ? a.created_at.toMillis() : Date.now();
          const tB = b.created_at instanceof Timestamp ? b.created_at.toMillis() : Date.now();
          return tB - tA;
        });
      const changes: OrderRealtimeDelta[] = snapshot.docChanges().map((c) => ({
        type: c.type,
        order: c.doc.data() as Order,
      }));
      onData(orders, changes, isInitial);
      isInitial = false;
    },
    (error) => {
      if (onError) onError(error);
      try {
        handleFirestoreError(error, OperationType.LIST, `shops/${shopId}/orders`);
      } catch {
        // Logged
      }
    }
  );
}

export interface CreateOrderInput {
  order_number?: string;
  customer_name: string;
  table_or_room: string;
  items: OrderItem[];
  notes: string;
  source: OrderSource;
  created_by_uid: string | null;
  payment_method?: PaymentMethod;
  payment_status?: PaymentStatus;
  utr_number?: string | null;
}

export async function createShopOrder(shopId: string, input: CreateOrderInput): Promise<Order> {
  const customerName = clampString(input.customer_name, 100);
  const tableOrRoom = clampString(input.table_or_room, 60);
  const notes = clampString(input.notes || '', 300);

  if (!customerName) throw new Error('Customer name is required.');
  if (!tableOrRoom) throw new Error('Table or room number is required.');
  if (!input.items.length || input.items.length > 30) {
    throw new Error('Order must contain between 1 and 30 line items.');
  }

  const sanitizedItems: OrderItem[] = input.items.map((item) => ({
    menu_item_id: item.menu_item_id,
    name: clampString(item.name, 100),
    price: Math.round(Number(item.price) * 100) / 100,
    quantity: Math.min(99, Math.max(1, Math.floor(Number(item.quantity)))),
  }));

  const totalAmount =
    Math.round(
      sanitizedItems.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100
    ) / 100;

  const ref = doc(collection(db, 'shops', shopId, 'orders'));
  const trackerRef = doc(db, 'shops', shopId, 'order_trackers', ref.id);
  const orderNumber = input.order_number
    ? clampString(input.order_number, 32)
    : generateOrderNumber();

  const paymentMethod: PaymentMethod = input.payment_method === 'upi' ? 'upi' : 'cash';
  const paymentStatus: PaymentStatus =
    input.payment_status === 'verification_pending' ? 'verification_pending' : 'unpaid';
  const cleanUtr = input.utr_number ? clampString(input.utr_number, 64) : '';
  const utrNumber: string | null = cleanUtr ? cleanUtr : null;

  const payload = {
    id: ref.id,
    shop_id: shopId,
    order_number: orderNumber,
    customer_name: customerName,
    table_or_room: tableOrRoom,
    items: sanitizedItems,
    total_amount: totalAmount,
    status: 'pending' as OrderStatus,
    source: input.source,
    notes,
    created_by_uid: input.created_by_uid,
    payment_method: paymentMethod,
    payment_status: paymentStatus,
    utr_number: utrNumber,
    paid_at: null,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  };

  const trackerPayload = {
    id: ref.id,
    shop_id: shopId,
    order_number: orderNumber,
    table_or_room: tableOrRoom,
    items: sanitizedItems,
    total_amount: totalAmount,
    status: 'pending' as OrderStatus,
    payment_method: paymentMethod,
    payment_status: paymentStatus,
    paid_at: null,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  };

  try {
    const batch = writeBatch(db);
    batch.set(ref, payload);
    batch.set(trackerRef, trackerPayload);
    await batch.commit();
    return {
      ...payload,
      created_at: Timestamp.now(),
      updated_at: Timestamp.now(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `shops/${shopId}/orders/${ref.id}`);
  }
}

export async function updateOrderStatus(
  shopId: string,
  orderId: string,
  nextStatus: OrderStatus,
  alreadyPaid = false
): Promise<void> {
  const orderRef = doc(db, 'shops', shopId, 'orders', orderId);
  const trackerRef = doc(db, 'shops', shopId, 'order_trackers', orderId);
  const shouldMarkPaid = nextStatus === 'paid' && !alreadyPaid;
  const updateData = shouldMarkPaid
    ? {
        status: nextStatus,
        payment_status: 'paid' as PaymentStatus,
        paid_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      }
    : {
        status: nextStatus,
        updated_at: serverTimestamp(),
      };

  try {
    const trackerSnap = await getDoc(trackerRef);
    if (trackerSnap.exists()) {
      const batch = writeBatch(db);
      batch.update(orderRef, updateData);
      batch.update(trackerRef, updateData);
      await batch.commit();
    } else {
      await updateDoc(orderRef, updateData);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `shops/${shopId}/orders/${orderId}`);
  }
}

export async function confirmOrderPayment(shopId: string, orderId: string): Promise<void> {
  const orderRef = doc(db, 'shops', shopId, 'orders', orderId);
  const trackerRef = doc(db, 'shops', shopId, 'order_trackers', orderId);
  const updateData = {
    payment_status: 'paid' as PaymentStatus,
    paid_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  };
  try {
    const trackerSnap = await getDoc(trackerRef);
    if (trackerSnap.exists()) {
      const batch = writeBatch(db);
      batch.update(orderRef, updateData);
      batch.update(trackerRef, updateData);
      await batch.commit();
    } else {
      await updateDoc(orderRef, updateData);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `shops/${shopId}/orders/${orderId}`);
  }
}

export function subscribeOrderTracker(
  shopId: string,
  orderId: string,
  onData: (tracker: OrderTracker | null) => void,
  onError?: (err: Error) => void
): () => void {
  const ref = doc(db, 'shops', shopId, 'order_trackers', orderId);
  return onSnapshot(
    ref,
    (snapshot) => {
      onData(snapshot.exists() ? (snapshot.data() as OrderTracker) : null);
    },
    (error) => {
      if (onError) onError(error);
      try {
        handleFirestoreError(error, OperationType.GET, `shops/${shopId}/order_trackers/${orderId}`);
      } catch {
        // Logged
      }
    }
  );
}

export async function getOrderTracker(
  shopId: string,
  orderId: string
): Promise<OrderTracker | null> {
  try {
    const snap = await getDoc(doc(db, 'shops', shopId, 'order_trackers', orderId));
    return snap.exists() ? (snap.data() as OrderTracker) : null;
  } catch {
    return null;
  }
}

export function mergeOrderItems(existingItems: OrderItem[], addedItems: OrderItem[]): OrderItem[] {
  const merged: OrderItem[] = existingItems.map((item) => ({
    menu_item_id: item.menu_item_id,
    name: clampString(item.name, 100),
    price: Math.round(Number(item.price) * 100) / 100,
    quantity: Math.min(99, Math.max(1, Math.floor(Number(item.quantity)))),
  }));

  for (const incoming of addedItems) {
    const cleanPrice = Math.round(Number(incoming.price) * 100) / 100;
    const cleanQty = Math.min(99, Math.max(1, Math.floor(Number(incoming.quantity))));
    const matchIdx = merged.findIndex(
      (m) => m.menu_item_id === incoming.menu_item_id && m.price === cleanPrice
    );
    if (matchIdx >= 0) {
      merged[matchIdx] = {
        ...merged[matchIdx],
        quantity: Math.min(99, merged[matchIdx].quantity + cleanQty),
      };
    } else {
      merged.push({
        menu_item_id: incoming.menu_item_id,
        name: clampString(incoming.name, 100),
        price: cleanPrice,
        quantity: cleanQty,
      });
    }
  }

  return merged;
}

export interface AppendGuestOrderInput {
  existingTracker: OrderTracker;
  addedItems: OrderItem[];
  combinedNotes: string;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  utr_number: string | null;
}

export async function appendItemsToGuestOrder(
  shopId: string,
  input: AppendGuestOrderInput
): Promise<OrderTracker> {
  if (!input.addedItems.length) {
    throw new Error('Add at least one menu item to update your order.');
  }
  if (input.existingTracker.status === 'paid') {
    throw new Error('This order has already been settled.');
  }

  const mergedItems = mergeOrderItems(input.existingTracker.items, input.addedItems);
  if (mergedItems.length > 30) {
    throw new Error(
      'This combined order has reached the 30 unique item limit. Please place a separate order.'
    );
  }

  const combinedTotal =
    Math.round(mergedItems.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100;
  const cleanNotes = clampString(input.combinedNotes || '', 300);
  const paymentMethod: PaymentMethod = input.payment_method === 'upi' ? 'upi' : 'cash';
  const paymentStatus: PaymentStatus =
    input.payment_status === 'verification_pending' ? 'verification_pending' : 'unpaid';
  const cleanUtr = input.utr_number ? clampString(input.utr_number, 64) : '';
  const utrNumber: string | null = cleanUtr ? cleanUtr : null;

  const orderId = input.existingTracker.id;
  const orderRef = doc(db, 'shops', shopId, 'orders', orderId);
  const trackerRef = doc(db, 'shops', shopId, 'order_trackers', orderId);

  try {
    const batch = writeBatch(db);
    batch.update(orderRef, {
      items: mergedItems,
      total_amount: combinedTotal,
      status: 'pending' as OrderStatus,
      notes: cleanNotes,
      payment_method: paymentMethod,
      payment_status: paymentStatus,
      utr_number: utrNumber,
      paid_at: null,
      updated_at: serverTimestamp(),
    });
    batch.update(trackerRef, {
      items: mergedItems,
      total_amount: combinedTotal,
      status: 'pending' as OrderStatus,
      payment_method: paymentMethod,
      payment_status: paymentStatus,
      paid_at: null,
      updated_at: serverTimestamp(),
    });
    await batch.commit();

    return {
      ...input.existingTracker,
      items: mergedItems,
      total_amount: combinedTotal,
      status: 'pending',
      payment_method: paymentMethod,
      payment_status: paymentStatus,
      paid_at: null,
      updated_at: Timestamp.now(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `shops/${shopId}/orders/${orderId}`);
  }
}

export interface SubmitGuestOrderPaymentInput {
  existingTracker: OrderTracker;
  payment_method: PaymentMethod;
  utr_number?: string | null;
}

export async function submitGuestOrderPayment(
  shopId: string,
  input: SubmitGuestOrderPaymentInput
): Promise<OrderTracker> {
  if (input.existingTracker.status === 'paid' || input.existingTracker.payment_status === 'paid') {
    throw new Error('This bill has already been marked paid.');
  }

  const paymentMethod: PaymentMethod = input.payment_method === 'upi' ? 'upi' : 'cash';
  const paymentStatus: PaymentStatus =
    paymentMethod === 'upi' ? 'verification_pending' : 'unpaid';
  const cleanUtr =
    paymentMethod === 'upi' && input.utr_number ? clampString(input.utr_number, 64) : '';
  const utrNumber: string | null = cleanUtr ? cleanUtr : null;

  const orderId = input.existingTracker.id;
  const orderRef = doc(db, 'shops', shopId, 'orders', orderId);
  const trackerRef = doc(db, 'shops', shopId, 'order_trackers', orderId);

  try {
    const batch = writeBatch(db);
    batch.update(orderRef, {
      payment_method: paymentMethod,
      payment_status: paymentStatus,
      utr_number: utrNumber,
      paid_at: null,
      updated_at: serverTimestamp(),
    });
    batch.update(trackerRef, {
      payment_method: paymentMethod,
      payment_status: paymentStatus,
      paid_at: null,
      updated_at: serverTimestamp(),
    });
    await batch.commit();

    return {
      ...input.existingTracker,
      payment_method: paymentMethod,
      payment_status: paymentStatus,
      paid_at: null,
      updated_at: Timestamp.now(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `shops/${shopId}/orders/${orderId}`);
  }
}

// ---------------------------------------------------------------------------
// Rooms & Bookings (Owner-Only Management)
// ---------------------------------------------------------------------------
export function subscribeShopRooms(
  shopId: string,
  onData: (rooms: Room[]) => void
): () => void {
  const q = query(
    collection(db, 'shops', shopId, 'rooms'),
    where('shop_id', '==', shopId)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs
        .map((d) => d.data() as Room)
        .sort((a, b) => a.room_number.localeCompare(b.room_number));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, `shops/${shopId}/rooms`);
      } catch {
        // Logged
      }
    }
  );
}

export interface RoomInput {
  room_number: string;
  title: string;
  room_type: string;
  nightly_rate: number;
  capacity: number;
  status: RoomStatus;
  amenities: string[];
  image_url: string;
}

export async function createRoom(shopId: string, input: RoomInput): Promise<void> {
  const roomNumber = clampString(input.room_number, 24);
  const title = clampString(input.title, 100);
  const roomType = clampString(input.room_type, 60);
  const rate = Math.round(Number(input.nightly_rate) * 100) / 100;
  const capacity = Math.min(20, Math.max(1, Math.floor(Number(input.capacity))));
  const amenities = input.amenities
    .map((a) => clampString(a, 60))
    .filter(Boolean)
    .slice(0, 10);
  const imageUrl = input.image_url.trim();

  if (!roomNumber || !title) throw new Error('Room number and title are required.');
  if (!isSafeMediaUrl(imageUrl)) throw new Error('Image URL must use http:// or https://.');

  const ref = doc(collection(db, 'shops', shopId, 'rooms'));
  try {
    await setDoc(ref, {
      id: ref.id,
      shop_id: shopId,
      room_number: roomNumber,
      title,
      room_type: roomType || 'Standard',
      nightly_rate: Number.isFinite(rate) && rate >= 0 ? rate : 0,
      capacity,
      status: input.status,
      amenities,
      image_url: imageUrl,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `shops/${shopId}/rooms/${ref.id}`);
  }
}

export async function updateRoom(
  shopId: string,
  roomId: string,
  input: RoomInput
): Promise<void> {
  const roomNumber = clampString(input.room_number, 24);
  const title = clampString(input.title, 100);
  const roomType = clampString(input.room_type, 60);
  const rate = Math.round(Number(input.nightly_rate) * 100) / 100;
  const capacity = Math.min(20, Math.max(1, Math.floor(Number(input.capacity))));
  const amenities = input.amenities
    .map((a) => clampString(a, 60))
    .filter(Boolean)
    .slice(0, 10);
  const imageUrl = input.image_url.trim();

  if (!isSafeMediaUrl(imageUrl)) throw new Error('Image URL must use http:// or https://.');

  try {
    await updateDoc(doc(db, 'shops', shopId, 'rooms', roomId), {
      room_number: roomNumber,
      title,
      room_type: roomType || 'Standard',
      nightly_rate: Number.isFinite(rate) && rate >= 0 ? rate : 0,
      capacity,
      status: input.status,
      amenities,
      image_url: imageUrl,
      updated_at: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `shops/${shopId}/rooms/${roomId}`);
  }
}

export async function updateRoomStatus(
  shopId: string,
  roomId: string,
  status: RoomStatus
): Promise<void> {
  try {
    await updateDoc(doc(db, 'shops', shopId, 'rooms', roomId), {
      status,
      updated_at: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `shops/${shopId}/rooms/${roomId}`);
  }
}

export async function deleteRoom(shopId: string, roomId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'shops', shopId, 'rooms', roomId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `shops/${shopId}/rooms/${roomId}`);
  }
}

export function subscribeRoomAvailability(
  shopId: string,
  onData: (slots: RoomAvailability[]) => void
): () => void {
  const q = query(
    collection(db, 'shops', shopId, 'room_availability'),
    where('shop_id', '==', shopId)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => d.data() as RoomAvailability);
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, `shops/${shopId}/room_availability`);
      } catch {
        // Logged
      }
    }
  );
}

export function subscribeRoomBookings(
  shopId: string,
  onData: (bookings: RoomBooking[]) => void
): () => void {
  const q = query(
    collection(db, 'shops', shopId, 'room_bookings'),
    where('shop_id', '==', shopId)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs
        .map((d) => d.data() as RoomBooking)
        .sort((a, b) => {
          const tA = a.created_at instanceof Timestamp ? a.created_at.toMillis() : Date.now();
          const tB = b.created_at instanceof Timestamp ? b.created_at.toMillis() : Date.now();
          return tB - tA;
        });
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, `shops/${shopId}/room_bookings`);
      } catch {
        // Logged
      }
    }
  );
}

export interface BookingInput {
  room_id: string;
  room_number: string;
  guest_name: string;
  guest_contact: string;
  check_in: string;
  check_out: string;
  total_price: number;
  notes: string;
  initial_status?: 'pending' | 'confirmed';
  payment_method?: PaymentMethod;
  payment_status?: PaymentStatus;
  utr_number?: string | null;
}

export async function createRoomBooking(
  shopId: string,
  input: BookingInput
): Promise<RoomBooking> {
  const guestName = clampString(input.guest_name, 100);
  const guestContact = clampString(input.guest_contact, 120);
  const checkIn = clampString(input.check_in, 20);
  const checkOut = clampString(input.check_out, 20);
  const roomNumber = clampString(input.room_number, 24);
  const notes = clampString(input.notes || '', 300);

  if (!guestName) throw new Error('Guest name is required.');
  if (!guestContact) throw new Error('Guest phone or contact is required.');
  if (!checkIn || !checkOut || checkOut <= checkIn) {
    throw new Error('Check-out date must be after the check-in date.');
  }

  const ref = doc(collection(db, 'shops', shopId, 'room_bookings'));
  const availRef = doc(db, 'shops', shopId, 'room_availability', ref.id);
  const status: BookingStatus = input.initial_status === 'pending' ? 'pending' : 'confirmed';
  const totalPrice = Math.max(0, Math.round(Number(input.total_price) * 100) / 100);
  const paymentMethod: PaymentMethod = input.payment_method === 'upi' ? 'upi' : 'cash';
  const paymentStatus: PaymentStatus =
    input.payment_status === 'verification_pending' ? 'verification_pending' : 'unpaid';
  const cleanUtr = input.utr_number ? clampString(input.utr_number, 64) : '';
  const utrNumber: string | null = cleanUtr ? cleanUtr : null;

  const payload = {
    id: ref.id,
    shop_id: shopId,
    room_id: input.room_id,
    room_number: roomNumber,
    guest_name: guestName,
    guest_contact: guestContact,
    check_in: checkIn,
    check_out: checkOut,
    status,
    total_price: totalPrice,
    notes,
    payment_method: paymentMethod,
    payment_status: paymentStatus,
    utr_number: utrNumber,
    paid_at: null,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  };

  const availabilityPayload = {
    id: ref.id,
    shop_id: shopId,
    room_id: input.room_id,
    check_in: checkIn,
    check_out: checkOut,
    status,
    updated_at: serverTimestamp(),
  };

  try {
    const batch = writeBatch(db);
    batch.set(ref, payload);
    batch.set(availRef, availabilityPayload);
    await batch.commit();
    return {
      ...payload,
      created_at: Timestamp.now(),
      updated_at: Timestamp.now(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `shops/${shopId}/room_bookings/${ref.id}`);
  }
}

export async function confirmBookingPayment(shopId: string, bookingId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'shops', shopId, 'room_bookings', bookingId), {
      payment_status: 'paid' as PaymentStatus,
      paid_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `shops/${shopId}/room_bookings/${bookingId}`);
  }
}

export async function updateBookingStatus(
  shopId: string,
  bookingId: string,
  status: BookingStatus,
  roomId?: string
): Promise<void> {
  const bookingRef = doc(db, 'shops', shopId, 'room_bookings', bookingId);
  const availRef = doc(db, 'shops', shopId, 'room_availability', bookingId);
  try {
    const availSnap = await getDoc(availRef);
    const batch = writeBatch(db);
    batch.update(bookingRef, {
      status,
      updated_at: serverTimestamp(),
    });
    if (availSnap.exists()) {
      batch.update(availRef, {
        status,
        updated_at: serverTimestamp(),
      });
    }
    if (roomId && (status === 'checked_in' || status === 'checked_out')) {
      batch.update(doc(db, 'shops', shopId, 'rooms', roomId), {
        status: status === 'checked_in' ? 'occupied' : 'available',
        updated_at: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `shops/${shopId}/room_bookings/${bookingId}`);
  }
}

// ---------------------------------------------------------------------------
// Sample Venue Bootstrapper (Explicit Super Admin Action for Fast Exploration)
// ---------------------------------------------------------------------------
export async function seedSampleVenue(ownerEmail: string): Promise<string> {
  const uniqueSuffix = Math.floor(100 + Math.random() * 900);
  const slug = `malabar-courtyard-${uniqueSuffix}`;
  const shopId = await createShopWithOwner({
    name: 'Malabar Courtyard Cafe & Suites',
    slug,
    type: 'both',
    logo_url: '',
    primary_color: '#1D4ED8',
    description:
      'Specialty South Indian filter coffee bar, artisanal bistro kitchen, and sunlit boutique suites.',
    modules: { menu: true, orders: true, rooms: true },
    owner_name: 'Malabar Courtyard Manager',
    owner_email: ownerEmail,
  });

  const menuSamples: MenuItemInput[] = [
    {
      name: 'Chikmagalur Filter Kaapi',
      category: 'Chai & Coffee',
      description: 'Slow-dripped estate Arabica roast frothed in traditional brass davara.',
      price: 140,
      image_url: DEFAULT_DISH_IMAGE,
      is_available: true,
      stock_count: 28,
      low_stock_threshold: 8,
    },
    {
      name: 'Adrak Elaichi Masala Chai',
      category: 'Chai & Coffee',
      description: 'Assam CTC brewed with crushed ginger, green cardamom, and whole milk.',
      price: 110,
      image_url: '',
      is_available: true,
      stock_count: null,
      low_stock_threshold: 5,
    },
    {
      name: 'Paneer Tikka Sourdough Melt',
      category: 'Kitchen',
      description: 'Char-grilled malai paneer, mint chutney, and aged cheddar on toasted levain.',
      price: 320,
      image_url: DEFAULT_DISH_IMAGE,
      is_available: true,
      stock_count: 14,
      low_stock_threshold: 5,
    },
    {
      name: 'Avocado & Gunpowder Tartine',
      category: 'Kitchen',
      description: 'Country sourdough, smashed avocado, roasted milagai podi, and toasted sesame.',
      price: 340,
      image_url: '',
      is_available: true,
      stock_count: 3,
      low_stock_threshold: 5,
    },
    {
      name: 'Cardamom Jaggery Bun',
      category: 'Bakery',
      description: 'Warm laminated brioche spiral glazed with organic palm jaggery and elaichi.',
      price: 160,
      image_url: '',
      is_available: false,
      stock_count: 0,
      low_stock_threshold: 6,
    },
    {
      name: 'Kokum Yuzu Cooler',
      category: 'Cold Bar',
      description: 'Konkan kokum reduction layered with sparkling botanical tonic and fresh mint.',
      price: 190,
      image_url: '',
      is_available: true,
      stock_count: 18,
      low_stock_threshold: 5,
    },
  ];

  const createdMenuIds: { id: string; name: string; price: number }[] = [];
  for (const item of menuSamples) {
    const ref = doc(collection(db, 'shops', shopId, 'menu_items'));
    await setDoc(ref, {
      id: ref.id,
      shop_id: shopId,
      ...item,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
    createdMenuIds.push({ id: ref.id, name: item.name, price: item.price });
  }

  const roomSamples: RoomInput[] = [
    {
      room_number: '201',
      title: 'Verandah King Suite',
      room_type: 'King Suite',
      nightly_rate: 5500,
      capacity: 2,
      status: 'available',
      amenities: ['Rain Shower', 'Filter Coffee Bar', 'Courtyard View', 'Fiber Wi-Fi'],
      image_url: DEFAULT_SUITE_IMAGE,
    },
    {
      room_number: '204',
      title: 'Teak Loft Double',
      room_type: 'Double Queen',
      nightly_rate: 6800,
      capacity: 4,
      status: 'occupied',
      amenities: ['Private Balcony', 'Soaking Tub', 'Work Desk'],
      image_url: DEFAULT_SUITE_IMAGE,
    },
    {
      room_number: '302',
      title: 'Sunlit Corner Studio',
      room_type: 'Studio',
      nightly_rate: 4200,
      capacity: 2,
      status: 'available',
      amenities: ['Floor-to-Ceiling Glass', 'Smart TV', 'Khadi Linens'],
      image_url: '',
    },
  ];

  const createdRooms: { id: string; room_number: string; nightly_rate: number }[] = [];
  for (const r of roomSamples) {
    const ref = doc(collection(db, 'shops', shopId, 'rooms'));
    await setDoc(ref, {
      id: ref.id,
      shop_id: shopId,
      ...r,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
    createdRooms.push({ id: ref.id, room_number: r.room_number, nightly_rate: r.nightly_rate });
  }

  // Enable sample UPI + Cash payment settings on the seeded venue
  const seedPayBatch = writeBatch(db);
  seedPayBatch.update(doc(db, 'shops', shopId), {
    accept_cash: true,
    accept_upi: true,
    upi_id: 'malabarcourtyard@okaxis',
    upi_payee_name: 'Malabar Courtyard Cafe & Suites',
    updated_at: serverTimestamp(),
  });
  seedPayBatch.update(doc(db, 'shop_slugs', slug), {
    accept_cash: true,
    accept_upi: true,
    upi_id: 'malabarcourtyard@okaxis',
    upi_payee_name: 'Malabar Courtyard Cafe & Suites',
    updated_at: serverTimestamp(),
  });
  await seedPayBatch.commit();

  // Seed realistic starter room bookings (1 checked-in today paid via UPI, 1 pending UPI verification)
  const todayIso = getTodayIso();
  const plusTwoIso = addDaysIso(todayIso, 2);
  const plusThreeIso = addDaysIso(todayIso, 3);
  const plusFiveIso = addDaysIso(todayIso, 5);

  if (createdRooms[1]) {
    const inHouse = await createRoomBooking(shopId, {
      room_id: createdRooms[1].id,
      room_number: createdRooms[1].room_number,
      guest_name: 'Ananya Iyer',
      guest_contact: '+91 98450 22194',
      check_in: todayIso,
      check_out: plusTwoIso,
      total_price: createdRooms[1].nightly_rate * 2,
      notes: 'Early check-in approved, airport transfer completed.',
      initial_status: 'confirmed',
      payment_method: 'upi',
      payment_status: 'verification_pending',
      utr_number: '432589104421',
    });
    await updateBookingStatus(shopId, inHouse.id, 'checked_in', createdRooms[1].id);
    await confirmBookingPayment(shopId, inHouse.id);
  }

  if (createdRooms[0]) {
    await createRoomBooking(shopId, {
      room_id: createdRooms[0].id,
      room_number: createdRooms[0].room_number,
      guest_name: 'Siddharth Deshmukh',
      guest_contact: '+91 98201 77412',
      check_in: plusThreeIso,
      check_out: plusFiveIso,
      total_price: createdRooms[0].nightly_rate * 2,
      notes: 'Requesting high-floor quiet suite if available.',
      initial_status: 'pending',
      payment_method: 'upi',
      payment_status: 'verification_pending',
      utr_number: '432699210874',
    });
  }

  // Create starter orders so analytics charts, live queue, and Sales Register show Cash vs UPI data
  const starterOrders: {
    customer_name: string;
    table_or_room: string;
    picks: [number, number][];
    status: OrderStatus;
    payment_method: PaymentMethod;
    payment_status: PaymentStatus;
    utr_number?: string;
    confirmPaid?: boolean;
  }[] = [
    {
      customer_name: 'Aarav Sharma',
      table_or_room: 'Table 4',
      picks: [
        [0, 2],
        [2, 1],
      ],
      status: 'paid',
      payment_method: 'upi',
      payment_status: 'verification_pending',
      utr_number: '432611908234',
      confirmPaid: true,
    },
    {
      customer_name: 'Ananya Iyer',
      table_or_room: 'Room 204',
      picks: [
        [1, 2],
        [3, 1],
        [4, 2],
      ],
      status: 'paid',
      payment_method: 'cash',
      payment_status: 'unpaid',
      confirmPaid: true,
    },
    {
      customer_name: 'Rohan Kulkarni',
      table_or_room: 'Table 7',
      picks: [
        [2, 2],
        [5, 2],
      ],
      status: 'ready',
      payment_method: 'upi',
      payment_status: 'verification_pending',
      utr_number: '432677309182',
      confirmPaid: true,
    },
    {
      customer_name: 'Meera Nair',
      table_or_room: 'Counter 2',
      picks: [
        [0, 1],
        [4, 1],
      ],
      status: 'preparing',
      payment_method: 'upi',
      payment_status: 'verification_pending',
      utr_number: '432688451209',
    },
    {
      customer_name: 'Vikram Mehta',
      table_or_room: 'Table 1',
      picks: [
        [1, 1],
        [2, 1],
        [5, 1],
      ],
      status: 'pending',
      payment_method: 'cash',
      payment_status: 'unpaid',
    },
  ];

  for (const ord of starterOrders) {
    const items: OrderItem[] = ord.picks.map(([idx, qty]) => ({
      menu_item_id: createdMenuIds[idx].id,
      name: createdMenuIds[idx].name,
      price: createdMenuIds[idx].price,
      quantity: qty,
    }));
    const created = await createShopOrder(shopId, {
      customer_name: ord.customer_name,
      table_or_room: ord.table_or_room,
      items,
      notes: '',
      source: 'guest',
      created_by_uid: null,
      payment_method: ord.payment_method,
      payment_status: ord.payment_status,
      utr_number: ord.utr_number || null,
    });
    if (ord.confirmPaid) {
      await confirmOrderPayment(shopId, created.id);
    }
    if (ord.status !== 'pending') {
      await updateOrderStatus(shopId, created.id, ord.status, Boolean(ord.confirmPaid));
    }
  }

  return shopId;
}
