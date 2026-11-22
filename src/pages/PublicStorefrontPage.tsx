import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Award,
  Ban,
  Banknote,
  BedDouble,
  CalendarDays,
  Check,
  CheckCircle2,
  ChefHat,
  Clock,
  Minus,
  Plus,
  QrCode,
  Receipt,
  ShieldCheck,
  ShoppingBag,
  Store,
  UserCheck,
  Users,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import {
  appendItemsToGuestOrder,
  cancelOrder,
  createRoomBooking,
  createShopOrder,
  getOrderTracker,
  registerShopCustomer,
  submitGuestOrderPayment,
  subscribeCustomerOrders,
  subscribeMenuItems,
  subscribeOrderTracker,
  subscribeRoomAvailability,
  subscribeShopCustomer,
  subscribeShopRooms,
  subscribeShopSlugRecord,
} from '../lib/firestoreService';
import {
  addDaysIso,
  dateRangesOverlap,
  diffNights,
  formatShortDate,
  getTodayIso,
  isActiveBookingStatus,
} from '../lib/dateUtils';
import {
  generateDraftReference,
  getEffectivePaymentMethod,
  getEffectivePaymentStatus,
  isShopCashEnabled,
  isShopUpiEnabled,
} from '../lib/upi';
import {
  formatCurrency,
  formatIndianMobile,
  getShopTypeLabel,
  validateCustomerName,
  validateIndianMobile,
  validateTableOrRoom,
} from '../lib/validation';
import {
  MenuItem,
  Order,
  ORDER_STATUS_FLOW,
  OrderItem,
  OrderStatus,
  OrderTracker,
  PaymentMethod,
  Room,
  RoomAvailability,
  RoomBooking,
  ShopCustomer,
  ShopSlugRecord,
} from '../types';
import { SafeImage } from '../components/SafeImage';
import { UpiPaymentBox } from '../components/UpiPaymentBox';
import { CustomerAccountDrawer } from '../components/CustomerAccountDrawer';
import { useAuth } from '../context/AuthContext';
import {
  deserializeOrderTracker,
  getGuestSessionsKey,
  getStorefrontStateKey,
  GuestOrderSession,
  readGuestSessions,
  readLegacyActiveOrderId,
  readStorefrontState,
  serializeOrderTracker,
  writeGuestSessions,
  writeLegacyActiveOrderId,
  writeStorefrontState,
} from '../lib/storefrontStorage';

function normalizeTableParam(raw: string): string {
  const trimmed = raw.trim().slice(0, 60);
  if (!trimmed) return '';
  return /^\d+$/.test(trimmed) ? `Table ${trimmed}` : trimmed;
}

function normalizeMatchKey(val: string): string {
  return val.trim().replace(/\s+/g, ' ').toLowerCase();
}

const TRACKER_STEPS: {
  status: OrderStatus;
  label: string;
  headline: string;
  detail: string;
}[] = [
  {
    status: 'pending',
    label: 'Pending',
    headline: 'Order sent to kitchen',
    detail: 'Your order is in the queue and will be picked up shortly.',
  },
  {
    status: 'preparing',
    label: 'Preparing',
    headline: 'Kitchen is preparing your order',
    detail: 'Our team is freshly preparing your items right now.',
  },
  {
    status: 'ready',
    label: 'Ready',
    headline: 'Your order is ready',
    detail: 'Dishes are plated and on their way to your table.',
  },
  {
    status: 'served',
    label: 'Served',
    headline: 'Served — enjoy your meal',
    detail: 'Everything has been delivered to your table.',
  },
  {
    status: 'paid',
    label: 'Paid',
    headline: 'Bill settled — thank you',
    detail: 'Thanks for dining with us. You can place a new order anytime.',
  },
];

export const PublicStorefrontPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const scannedTable = useMemo(
    () => normalizeTableParam(searchParams.get('table') || ''),
    [searchParams]
  );
  const { user, signInWithGoogle, signOutUser, authError } = useAuth();

  const [shop, setShop] = useState<ShopSlugRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [menuLoaded, setMenuLoaded] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [availabilitySlots, setAvailabilitySlots] = useState<RoomAvailability[]>([]);
  const [activeSection, setActiveSection] = useState<'menu' | 'rooms'>('menu');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [hydratedShopId, setHydratedShopId] = useState<string | null>(null);

  // Per-Restaurant Customer Account & Rewards State
  const [customerProfile, setCustomerProfile] = useState<ShopCustomer | null>(null);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [customerOrders, setCustomerOrders] = useState<Order[]>([]);
  const [accountDrawerOpen, setAccountDrawerOpen] = useState(false);
  const [registerOnOrder, setRegisterOnOrder] = useState(true);

  // Guest Order Cart & Payment
  const [cart, setCart] = useState<Record<string, number>>({});
  const [trayOpen, setTrayOpen] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [tableOrRoom, setTableOrRoom] = useState(scannedTable);
  const [notes, setNotes] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [tableError, setTableError] = useState<string | null>(null);
  const [orderPaymentMethod, setOrderPaymentMethod] = useState<PaymentMethod>('cash');
  const [orderUtr, setOrderUtr] = useState('');
  const [draftOrderRef, setDraftOrderRef] = useState<string>(() => generateDraftReference('ORD'));
  const [confirmingOrderStep, setConfirmingOrderStep] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Live Real-Time Order Tracker & Repeat-Order Session Memory
  const [guestSessions, setGuestSessions] = useState<GuestOrderSession[]>([]);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [liveTracker, setLiveTracker] = useState<OrderTracker | null>(null);
  const [matchedSavedTracker, setMatchedSavedTracker] = useState<OrderTracker | null>(null);
  const [trackerViewOpen, setTrackerViewOpen] = useState(false);

  // Mistaken-Order Pending Self-Cancel State
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [cancellingOrder, setCancellingOrder] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // End-of-Meal Full-Bill Settlement State (triggered when customer clicks "Pay Now")
  const [payNowOpen, setPayNowOpen] = useState(false);
  const [submittingSettlement, setSubmittingSettlement] = useState(false);
  const [settlementError, setSettlementError] = useState<string | null>(null);
  const [editingSettlement, setEditingSettlement] = useState(false);
  const [cashConfirmedNotice, setCashConfirmedNotice] = useState(false);

  // Guest Room Booking Search, Request & Payment Flow
  const todayIso = useMemo(() => getTodayIso(), []);
  const [checkInDate, setCheckInDate] = useState<string>(todayIso);
  const [checkOutDate, setCheckOutDate] = useState<string>(() => addDaysIso(todayIso, 1));
  const [minGuests, setMinGuests] = useState<number>(1);
  const [bookingRoom, setBookingRoom] = useState<Room | null>(null);
  const [bookingGuestName, setBookingGuestName] = useState('');
  const [bookingGuestPhone, setBookingGuestPhone] = useState('');
  const [bookingNameError, setBookingNameError] = useState<string | null>(null);
  const [bookingPhoneError, setBookingPhoneError] = useState<string | null>(null);
  const [bookingNotes, setBookingNotes] = useState('');
  const [bookingPaymentMethod, setBookingPaymentMethod] = useState<PaymentMethod>('cash');
  const [bookingUtr, setBookingUtr] = useState('');
  const [draftBookingRef, setDraftBookingRef] = useState<string>(() =>
    generateDraftReference('BK')
  );
  const [submittingBooking, setSubmittingBooking] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [confirmedBooking, setConfirmedBooking] = useState<RoomBooking | null>(null);

  const upiEnabled = useMemo(() => (shop ? isShopUpiEnabled(shop) : false), [shop]);
  const cashEnabled = useMemo(() => (shop ? isShopCashEnabled(shop) : true), [shop]);

  useEffect(() => {
    const defaultMethod: PaymentMethod = cashEnabled ? 'cash' : upiEnabled ? 'upi' : 'cash';
    setOrderPaymentMethod((prev) => {
      if (prev === 'upi' && !upiEnabled) return defaultMethod;
      if (prev === 'cash' && !cashEnabled && upiEnabled) return 'upi';
      return prev;
    });
    setBookingPaymentMethod((prev) => {
      if (prev === 'upi' && !upiEnabled) return defaultMethod;
      if (prev === 'cash' && !cashEnabled && upiEnabled) return 'upi';
      return prev;
    });
  }, [cashEnabled, upiEnabled]);

  useEffect(() => {
    if (scannedTable) {
      setTableOrRoom(scannedTable);
    }
  }, [scannedTable]);

  useEffect(() => {
    if (!slug) {
      setNotFound(true);
      setLoading(false);
      setHydratedShopId(null);
      return;
    }
    setLoading(true);
    setNotFound(false);
    setHydratedShopId(null);
    let initializedShopId: string | null = null;

    const unsub = subscribeShopSlugRecord(
      slug,
      (record) => {
        if (!record) {
          setNotFound(true);
          setShop(null);
          setLoading(false);
          return;
        }
        setNotFound(false);
        setShop(record);
        setLoading(false);

        if (initializedShopId !== record.shop_id) {
          initializedShopId = record.shop_id;
          const savedSessions = readGuestSessions(record.shop_id);
          const savedState = readStorefrontState(record.shop_id);
          setGuestSessions(savedSessions);

          // Resolve initial section while honoring shop modules and persisted tab
          if (!record.modules.menu && record.modules.rooms) {
            setActiveSection('rooms');
          } else if (record.modules.menu && !record.modules.rooms) {
            setActiveSection('menu');
          } else if (savedState?.activeSection) {
            setActiveSection(savedState.activeSection);
          } else {
            setActiveSection('menu');
          }

          // Hydrate cart, category, notes, and payment preference
          setCart(savedState?.cart || {});
          setSelectedCategory(savedState?.selectedCategory || 'All');
          setNotes(savedState?.notes || '');
          if (savedState?.orderPaymentMethod) {
            setOrderPaymentMethod(savedState.orderPaymentMethod);
          }

          // Match scanned QR table to existing table session if available
          const tableMatchedSession = scannedTable
            ? savedSessions.find(
                (s) => normalizeMatchKey(s.tableOrRoom) === normalizeMatchKey(scannedTable)
              ) || null
            : null;

          // Resolve table context: explicit ?table= URL overrides persisted value
          const resolvedTable =
            scannedTable ||
            savedState?.tableOrRoom ||
            savedSessions[0]?.tableOrRoom ||
            '';
          setTableOrRoom(resolvedTable);

          const resolvedGuestName =
            savedState?.guestName ||
            tableMatchedSession?.customerName ||
            savedSessions[0]?.customerName ||
            '';
          setGuestName(resolvedGuestName);
          setGuestPhone(savedState?.guestPhone || '');

          // Resolve active order ID & cached tracker snapshot for instant reload recovery
          const savedOrderBelongsToDifferentScannedTable = Boolean(
            scannedTable &&
              savedState?.lastTrackerSnapshot?.table_or_room &&
              normalizeMatchKey(savedState.lastTrackerSnapshot.table_or_room) !==
                normalizeMatchKey(scannedTable)
          );

          const restoredOrderId =
            tableMatchedSession?.orderId ||
            (!savedOrderBelongsToDifferentScannedTable ? savedState?.activeOrderId : null) ||
            (!scannedTable ? savedSessions[0]?.orderId : null) ||
            (!scannedTable ? readLegacyActiveOrderId(record.shop_id) : null);

          if (restoredOrderId) {
            setActiveOrderId(restoredOrderId);
            const cachedTracker =
              savedState?.lastTrackerSnapshot &&
              savedState.lastTrackerSnapshot.id === restoredOrderId
                ? deserializeOrderTracker(savedState.lastTrackerSnapshot, record.shop_id)
                : null;
            if (cachedTracker) {
              setLiveTracker(cachedTracker);
            }
            setTrackerViewOpen(
              Boolean(
                savedState?.trackerViewOpen &&
                  savedState.activeOrderId === restoredOrderId &&
                  !savedOrderBelongsToDifferentScannedTable
              )
            );
          } else {
            setActiveOrderId(null);
            setLiveTracker(null);
            setTrackerViewOpen(false);
          }

          // Restore room search dates if still valid today
          if (
            savedState?.checkInDate &&
            savedState.checkOutDate &&
            savedState.checkInDate >= todayIso &&
            savedState.checkOutDate > savedState.checkInDate
          ) {
            setCheckInDate(savedState.checkInDate);
            setCheckOutDate(savedState.checkOutDate);
          }
          if (savedState?.minGuests) {
            setMinGuests(savedState.minGuests);
          }

          setHydratedShopId(record.shop_id);
        } else {
          setActiveSection((prev) => {
            if (prev === 'menu' && !record.modules.menu && record.modules.rooms) return 'rooms';
            if (prev === 'rooms' && !record.modules.rooms && record.modules.menu) return 'menu';
            return prev;
          });
        }
      },
      () => {
        setNotFound(true);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [slug]);

  useEffect(() => {
    if (!shop?.shop_id || !shop.is_active) return;
    setMenuLoaded(false);
    const unsubs: (() => void)[] = [];
    if (shop.modules.menu) {
      unsubs.push(
        subscribeMenuItems(shop.shop_id, (items) => {
          setMenuItems(items);
          setMenuLoaded(true);
        })
      );
    }
    if (shop.modules.rooms) {
      unsubs.push(subscribeShopRooms(shop.shop_id, setRooms));
      unsubs.push(subscribeRoomAvailability(shop.shop_id, setAvailabilitySlots));
    }
    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [shop?.shop_id, shop?.is_active, shop?.modules.menu, shop?.modules.rooms]);

  // Subscribe to Per-Restaurant Customer Profile & Personal Order History when signed in
  useEffect(() => {
    if (!shop?.shop_id || !user?.uid || !user.emailVerified) {
      setCustomerProfile(null);
      setCustomerOrders([]);
      setCustomerLoading(false);
      return;
    }

    setCustomerLoading(true);
    const unsubProfile = subscribeShopCustomer(
      shop.shop_id,
      user.uid,
      (profileDoc) => {
        setCustomerProfile(profileDoc);
        setCustomerLoading(false);
        if (profileDoc) {
          setGuestName(profileDoc.full_name);
          setGuestPhone(formatIndianMobile(profileDoc.mobile_number));
          setNameError(null);
          setPhoneError(null);
        }
      },
      () => setCustomerLoading(false)
    );

    const unsubOrders = subscribeCustomerOrders(shop.shop_id, user.uid, (ordersList) => {
      setCustomerOrders(ordersList);
    });

    return () => {
      unsubProfile();
      unsubOrders();
    };
  }, [shop?.shop_id, user?.uid, user?.emailVerified]);

  // Auto-recover an active unpaid member order across devices if no local active order is set
  useEffect(() => {
    if (!shop?.shop_id || hydratedShopId !== shop.shop_id || activeOrderId) return;
    const openOrders = customerOrders.filter(
      (o) => o.status !== 'paid' && o.status !== 'cancelled'
    );
    if (openOrders.length === 0) return;
    const matched = scannedTable
      ? openOrders.find(
          (o) => normalizeMatchKey(o.table_or_room) === normalizeMatchKey(scannedTable)
        )
      : openOrders[0];
    if (matched) {
      setActiveOrderId(matched.id);
    }
  }, [shop?.shop_id, hydratedShopId, activeOrderId, customerOrders, scannedTable]);

  // Persist customer cart, table context, and active order state after initial hydration
  useEffect(() => {
    if (!shop?.shop_id || hydratedShopId !== shop.shop_id) return;
    writeStorefrontState(shop.shop_id, {
      cart,
      guestName,
      guestPhone,
      tableOrRoom,
      notes,
      orderPaymentMethod,
      activeSection,
      selectedCategory,
      activeOrderId,
      trackerViewOpen: Boolean(trackerViewOpen && activeOrderId),
      lastTrackerSnapshot: serializeOrderTracker(liveTracker),
      checkInDate,
      checkOutDate,
      minGuests,
    });
    writeLegacyActiveOrderId(shop.shop_id, activeOrderId);
  }, [
    shop?.shop_id,
    hydratedShopId,
    cart,
    guestName,
    guestPhone,
    tableOrRoom,
    notes,
    orderPaymentMethod,
    activeSection,
    selectedCategory,
    activeOrderId,
    trackerViewOpen,
    liveTracker,
    checkInDate,
    checkOutDate,
    minGuests,
  ]);

  // Keep cart, table context, and active order synced across open browser tabs for this venue
  useEffect(() => {
    if (!shop?.shop_id || hydratedShopId !== shop.shop_id) return;
    const stateKey = getStorefrontStateKey(shop.shop_id);
    const sessionsKey = getGuestSessionsKey(shop.shop_id);

    const handleStorage = (event: StorageEvent) => {
      if (event.key === sessionsKey) {
        setGuestSessions(readGuestSessions(shop.shop_id));
      } else if (event.key === stateKey) {
        const synced = readStorefrontState(shop.shop_id);
        if (!synced) return;
        setCart(synced.cart);
        setGuestName(synced.guestName);
        setGuestPhone(synced.guestPhone || '');
        if (!scannedTable && synced.tableOrRoom) {
          setTableOrRoom(synced.tableOrRoom);
        }
        setNotes(synced.notes);
        setActiveOrderId(synced.activeOrderId);
        setTrackerViewOpen(synced.trackerViewOpen);
        if (synced.lastTrackerSnapshot && synced.lastTrackerSnapshot.id === synced.activeOrderId) {
          const restored = deserializeOrderTracker(synced.lastTrackerSnapshot, shop.shop_id);
          if (restored) {
            setLiveTracker((prev) => (prev && prev.id === restored.id ? prev : restored));
          }
        } else if (!synced.activeOrderId) {
          setLiveTracker(null);
        }
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [shop?.shop_id, hydratedShopId, scannedTable]);

  // Subscribe to real-time OrderTracker document for the guest's active order
  useEffect(() => {
    if (!shop?.shop_id || !activeOrderId) {
      setLiveTracker(null);
      return;
    }
    const unsub = subscribeOrderTracker(
      shop.shop_id,
      activeOrderId,
      (tracker) => {
        if (!tracker) {
          setLiveTracker(null);
          setActiveOrderId(null);
          setTrackerViewOpen(false);
          setGuestSessions((prev) => {
            const next = prev.filter((s) => s.orderId !== activeOrderId);
            if (next.length !== prev.length) {
              writeGuestSessions(shop.shop_id, next);
            }
            return next;
          });
          return;
        }
        setLiveTracker(tracker);
        setTableOrRoom((prev) => prev || scannedTable || tracker.table_or_room);
      },
      () => {
        // Keep last known tracker state on transient disconnect
      }
    );
    return () => unsub();
  }, [shop?.shop_id, activeOrderId, scannedTable]);

  // Match active session / same table against saved guest sessions for this shop
  const activeSession = useMemo(
    () => guestSessions.find((s) => s.orderId === activeOrderId) || null,
    [guestSessions, activeOrderId]
  );

  const matchingSession = useMemo(() => {
    const nameKey = normalizeMatchKey(guestName);
    const tableKey = normalizeMatchKey(tableOrRoom);
    if (!tableKey) return null;

    if (nameKey) {
      const exactMatch = guestSessions.find(
        (s) =>
          normalizeMatchKey(s.customerName) === nameKey &&
          normalizeMatchKey(s.tableOrRoom) === tableKey
      );
      if (exactMatch) return exactMatch;
    }

    if (activeSession && normalizeMatchKey(activeSession.tableOrRoom) === tableKey) {
      return activeSession;
    }

    return guestSessions.find((s) => normalizeMatchKey(s.tableOrRoom) === tableKey) || null;
  }, [guestSessions, activeSession, guestName, tableOrRoom]);

  useEffect(() => {
    if (!shop?.shop_id || !matchingSession) {
      setMatchedSavedTracker(null);
      return;
    }
    if (liveTracker && liveTracker.id === matchingSession.orderId) {
      setMatchedSavedTracker(liveTracker);
      return;
    }
    let cancelled = false;
    void getOrderTracker(shop.shop_id, matchingSession.orderId).then((tracker) => {
      if (!cancelled) {
        setMatchedSavedTracker(tracker);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [shop?.shop_id, matchingSession, liveTracker]);

  const combiningTracker = useMemo(() => {
    const tableKey = normalizeMatchKey(tableOrRoom);
    if (
      tableKey &&
      liveTracker &&
      liveTracker.status !== 'paid' &&
      liveTracker.status !== 'cancelled' &&
      normalizeMatchKey(liveTracker.table_or_room) === tableKey
    ) {
      return liveTracker;
    }
    if (!matchingSession) return null;
    const candidate =
      liveTracker && liveTracker.id === matchingSession.orderId
        ? liveTracker
        : matchedSavedTracker && matchedSavedTracker.id === matchingSession.orderId
          ? matchedSavedTracker
          : null;
    if (!candidate || candidate.status === 'paid' || candidate.status === 'cancelled') return null;
    return candidate;
  }, [tableOrRoom, matchingSession, liveTracker, matchedSavedTracker]);

  const availableItems = useMemo(
    () =>
      menuItems.filter(
        (m) => m.is_available && (m.stock_count === undefined || m.stock_count === null || m.stock_count > 0)
      ),
    [menuItems]
  );

  const categories = useMemo(() => {
    const set = new Set<string>();
    availableItems.forEach((i) => set.add(i.category));
    return ['All', ...Array.from(set).sort()];
  }, [availableItems]);

  // Reconcile persisted cart quantities & category once live menu items load
  useEffect(() => {
    if (!menuLoaded || !shop?.shop_id || hydratedShopId !== shop.shop_id) return;

    setCart((prev) => {
      const entries = Object.entries(prev);
      if (entries.length === 0) return prev;
      let changed = false;
      const next: Record<string, number> = {};
      for (const [id, qty] of entries) {
        const found = menuItems.find((m) => m.id === id);
        if (!found || !found.is_available) {
          changed = true;
          continue;
        }
        const maxAllowed =
          typeof found.stock_count === 'number'
            ? Math.min(99, Math.max(0, found.stock_count))
            : 99;
        if (maxAllowed <= 0) {
          changed = true;
          continue;
        }
        const clamped = Math.min(maxAllowed, Math.max(0, qty));
        if (clamped !== qty) {
          changed = true;
        }
        if (clamped > 0) {
          next[id] = clamped;
        }
      }
      return changed ? next : prev;
    });

    if (selectedCategory !== 'All' && !categories.includes(selectedCategory)) {
      setSelectedCategory('All');
    }
  }, [menuLoaded, menuItems, categories, selectedCategory, shop?.shop_id, hydratedShopId]);

  const filteredMenu = useMemo(() => {
    if (selectedCategory === 'All') return availableItems;
    return availableItems.filter((i) => i.category === selectedCategory);
  }, [availableItems, selectedCategory]);

  const cartItems: OrderItem[] = useMemo(() => {
    return Object.entries(cart)
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => {
        const found = menuItems.find((m) => m.id === id);
        if (!found) return null;
        return {
          menu_item_id: found.id,
          name: found.name,
          price: found.price,
          quantity: qty,
        };
      })
      .filter((x): x is OrderItem => x !== null);
  }, [cart, menuItems]);

  const cartCount = useMemo(
    () => cartItems.reduce((sum, i) => sum + i.quantity, 0),
    [cartItems]
  );
  const cartTotal = useMemo(
    () => cartItems.reduce((sum, i) => sum + i.price * i.quantity, 0),
    [cartItems]
  );

  // Room availability filtering for chosen Check-In & Check-Out dates
  const stayNights = useMemo(
    () => Math.max(0, diffNights(checkInDate, checkOutDate)),
    [checkInDate, checkOutDate]
  );

  const bookedRoomIdsForDates = useMemo(() => {
    const blocked = new Set<string>();
    if (stayNights <= 0) return blocked;
    availabilitySlots.forEach((slot) => {
      if (
        isActiveBookingStatus(slot.status) &&
        dateRangesOverlap(checkInDate, checkOutDate, slot.check_in, slot.check_out)
      ) {
        blocked.add(slot.room_id);
      }
    });
    return blocked;
  }, [availabilitySlots, checkInDate, checkOutDate, stayNights]);

  const availableRoomsForDates = useMemo(() => {
    return rooms.filter((room) => {
      if (room.status === 'maintenance') return false;
      if (room.capacity < minGuests) return false;
      if (bookedRoomIdsForDates.has(room.id)) return false;
      return true;
    });
  }, [rooms, minGuests, bookedRoomIdsForDates]);

  const updateCartQty = (id: string, delta: number) => {
    const found = menuItems.find((m) => m.id === id);
    const maxAllowed =
      found && typeof found.stock_count === 'number' ? Math.min(99, Math.max(0, found.stock_count)) : 99;
    setCart((prev) => {
      const next = Math.max(0, Math.min(maxAllowed, (prev[id] || 0) + delta));
      if (next === 0) {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      }
      return { ...prev, [id]: next };
    });
  };

  const handleSelectOrderToTrack = (ord: Order) => {
    setActiveOrderId(ord.id);
    setLiveTracker({
      id: ord.id,
      shop_id: ord.shop_id,
      order_number: ord.order_number,
      table_or_room: ord.table_or_room,
      items: ord.items,
      total_amount: ord.total_amount,
      status: ord.status,
      payment_method: ord.payment_method,
      payment_status: ord.payment_status,
      paid_at: ord.paid_at ?? null,
      created_at: ord.created_at,
      updated_at: ord.updated_at,
    });
    setPayNowOpen(false);
    setConfirmCancelOpen(false);
    setCancelError(null);
    setTrackerViewOpen(true);
  };

  const openOrderTray = () => {
    setSubmitError(null);
    setNameError(null);
    setPhoneError(null);
    setTableError(null);
    setConfirmingOrderStep(false);
    setDraftOrderRef(generateDraftReference('ORD'));
    setOrderUtr('');
    if (customerProfile) {
      setGuestName(customerProfile.full_name);
      setGuestPhone(formatIndianMobile(customerProfile.mobile_number));
    }
    if (
      liveTracker &&
      liveTracker.status !== 'paid' &&
      liveTracker.status !== 'cancelled' &&
      activeSession
    ) {
      if (!customerProfile && !guestName.trim()) {
        setGuestName(activeSession.customerName);
      }
      if (!tableOrRoom.trim()) {
        setTableOrRoom(scannedTable || activeSession.tableOrRoom);
      }
    }
    setOrderPaymentMethod((prev) => {
      if (prev === 'upi' && upiEnabled) return 'upi';
      if (prev === 'cash' && cashEnabled) return 'cash';
      return cashEnabled ? 'cash' : upiEnabled ? 'upi' : 'cash';
    });
    setTrayOpen(true);
  };

  const handleOrderTraySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!shop || cartItems.length === 0) return;
    setSubmitError(null);

    const rawName = customerProfile ? customerProfile.full_name : guestName;
    const rawPhone = customerProfile ? customerProfile.mobile_number : guestPhone;

    const nameCheck = validateCustomerName(rawName);
    const mobileCheck = validateIndianMobile(rawPhone);
    const tableCheck = validateTableOrRoom(tableOrRoom);

    setNameError(nameCheck.valid ? null : nameCheck.error || 'Please enter your real full name.');
    setPhoneError(
      mobileCheck.valid ? null : mobileCheck.error || 'Please enter a valid Indian mobile number.'
    );
    setTableError(
      tableCheck.valid ? null : tableCheck.error || 'Please enter a valid table or room number.'
    );

    if (!nameCheck.valid || !mobileCheck.valid || !tableCheck.valid) {
      setSubmitError('Please fix the highlighted details before continuing.');
      return;
    }

    if (!customerProfile) {
      setGuestName(nameCheck.value);
      setGuestPhone(formatIndianMobile(mobileCheck.value));
    }
    setTableOrRoom(tableCheck.value);

    if (!confirmingOrderStep) {
      setConfirmingOrderStep(true);
      return;
    }
    void handleConfirmPlaceOrder();
  };

  const handleConfirmPlaceOrder = async () => {
    if (!shop || cartItems.length === 0) return;
    setSubmitError(null);

    const rawName = customerProfile ? customerProfile.full_name : guestName;
    const rawPhone = customerProfile ? customerProfile.mobile_number : guestPhone;
    const nameCheck = validateCustomerName(rawName);
    const mobileCheck = validateIndianMobile(rawPhone);
    const tableCheck = validateTableOrRoom(tableOrRoom);

    if (!nameCheck.valid || !mobileCheck.valid || !tableCheck.valid) {
      setNameError(nameCheck.valid ? null : nameCheck.error || 'Please enter your real full name.');
      setPhoneError(
        mobileCheck.valid ? null : mobileCheck.error || 'Please enter a valid Indian mobile number.'
      );
      setTableError(
        tableCheck.valid ? null : tableCheck.error || 'Please enter a valid table or room number.'
      );
      setConfirmingOrderStep(false);
      setSubmitError('Please provide valid name, mobile number, and table/room details.');
      return;
    }

    setSubmitting(true);
    try {
      // Auto-register signed-in Google customer for this restaurant if opted in
      if (user && user.emailVerified && user.email && !customerProfile && registerOnOrder) {
        try {
          await registerShopCustomer(shop.shop_id, {
            uid: user.uid,
            email: user.email,
            full_name: nameCheck.value,
            mobile_number: mobileCheck.value,
          });
        } catch {
          // Do not block order placement if profile already exists
        }
      }

      // Food orders accumulate on one open tab; full-bill Cash/UPI payment unlocks when ready to leave.
      if (combiningTracker) {
        const freshTracker =
          (await getOrderTracker(shop.shop_id, combiningTracker.id)) || combiningTracker;

        if (freshTracker.status !== 'paid' && freshTracker.status !== 'cancelled') {
          const baseSession: GuestOrderSession = matchingSession || {
            orderId: freshTracker.id,
            orderNumber: freshTracker.order_number,
            customerName: nameCheck.value,
            tableOrRoom: freshTracker.table_or_room,
            notes: '',
            utrNumber: null,
          };

          const addedSummary = cartItems.map((i) => `${i.quantity}x ${i.name}`).join(', ');
          const noteSegments: string[] = [];
          if (baseSession.notes.trim()) {
            noteSegments.push(baseSession.notes.trim());
          }
          noteSegments.push(`[+Added: ${addedSummary}]`);
          if (notes.trim()) {
            noteSegments.push(notes.trim());
          }
          const combinedNotes = noteSegments.join(' | ').slice(0, 300);

          const updatedTracker = await appendItemsToGuestOrder(shop.shop_id, {
            existingTracker: freshTracker,
            addedItems: cartItems,
            combinedNotes,
            payment_method: 'cash',
            payment_status: 'unpaid',
            utr_number: null,
          });

          const updatedSession: GuestOrderSession = {
            ...baseSession,
            notes: combinedNotes,
            utrNumber: null,
          };
          const nextSessions = [
            updatedSession,
            ...guestSessions.filter((s) => s.orderId !== updatedSession.orderId),
          ];
          setGuestSessions(nextSessions);
          writeGuestSessions(shop.shop_id, nextSessions);

          setLiveTracker(updatedTracker);
          setActiveOrderId(updatedTracker.id);
          setCart({});
          setNotes('');
          setOrderUtr('');
          setConfirmingOrderStep(false);
          setConfirmCancelOpen(false);
          setCancelError(null);
          setPayNowOpen(false);
          setSettlementError(null);
          setEditingSettlement(false);
          setCashConfirmedNotice(false);
          setDraftOrderRef(generateDraftReference('ORD'));
          setTrayOpen(false);
          setTrackerViewOpen(true);
          return;
        }
      }

      const created = await createShopOrder(shop.shop_id, {
        order_number: draftOrderRef,
        customer_name: nameCheck.value,
        customer_phone: mobileCheck.value,
        table_or_room: tableCheck.value,
        items: cartItems,
        notes,
        source: 'guest',
        created_by_uid: user?.uid || null,
        payment_method: 'cash',
        payment_status: 'unpaid',
        utr_number: null,
      });

      const newSession: GuestOrderSession = {
        orderId: created.id,
        orderNumber: created.order_number,
        customerName: created.customer_name,
        tableOrRoom: created.table_or_room,
        notes: created.notes,
        utrNumber: null,
      };
      const nextSessions = [
        newSession,
        ...guestSessions.filter((s) => s.orderId !== created.id),
      ];
      setGuestSessions(nextSessions);
      writeGuestSessions(shop.shop_id, nextSessions);

      setLiveTracker({
        id: created.id,
        shop_id: created.shop_id,
        order_number: created.order_number,
        table_or_room: created.table_or_room,
        items: created.items,
        total_amount: created.total_amount,
        status: created.status,
        payment_method: 'cash',
        payment_status: 'unpaid',
        paid_at: null,
        created_at: null,
        updated_at: null,
      });
      setActiveOrderId(created.id);
      writeLegacyActiveOrderId(shop.shop_id, created.id);

      setCart({});
      setGuestName(created.customer_name);
      setGuestPhone(formatIndianMobile(created.customer_phone));
      setTableOrRoom(scannedTable || created.table_or_room);
      setNotes('');
      setOrderUtr('');
      setConfirmingOrderStep(false);
      setConfirmCancelOpen(false);
      setCancelError(null);
      setPayNowOpen(false);
      setSettlementError(null);
      setEditingSettlement(false);
      setCashConfirmedNotice(false);
      setDraftOrderRef(generateDraftReference('ORD'));
      setTrayOpen(false);
      setTrackerViewOpen(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unable to submit your order.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGuestCancelPendingOrder = async () => {
    if (!shop || !liveTracker) return;
    if (
      liveTracker.status !== 'pending' ||
      getEffectivePaymentStatus(liveTracker.payment_status, liveTracker.status) !== 'unpaid'
    ) {
      setCancelError('The kitchen has already started preparing your order. Please ask staff.');
      return;
    }
    setCancelError(null);
    setCancellingOrder(true);
    try {
      await cancelOrder(shop.shop_id, liveTracker.id);
      setConfirmCancelOpen(false);
      setPayNowOpen(false);
      const remaining = guestSessions.filter((s) => s.orderId !== liveTracker.id);
      setGuestSessions(remaining);
      writeGuestSessions(shop.shop_id, remaining);
    } catch (err) {
      setCancelError(
        err instanceof Error
          ? err.message
          : 'Unable to cancel now — kitchen may have already started preparing.'
      );
    } finally {
      setCancellingOrder(false);
    }
  };

  const handleSettleOrderPayment = async (method: PaymentMethod) => {
    if (!shop || !liveTracker) return;
    setSettlementError(null);
    setSubmittingSettlement(true);
    try {
      const effectiveMethod: PaymentMethod = method === 'upi' && upiEnabled ? 'upi' : 'cash';
      const trimmedUtr = effectiveMethod === 'upi' ? orderUtr.trim() || null : null;

      const updated = await submitGuestOrderPayment(shop.shop_id, {
        existingTracker: liveTracker,
        payment_method: effectiveMethod,
        utr_number: trimmedUtr,
      });

      setLiveTracker(updated);
      setEditingSettlement(false);
      setCashConfirmedNotice(effectiveMethod === 'cash');

      const nextSessions = guestSessions.map((s) =>
        s.orderId === liveTracker.id ? { ...s, utrNumber: trimmedUtr } : s
      );
      if (nextSessions.length > 0) {
        setGuestSessions(nextSessions);
        writeGuestSessions(shop.shop_id, nextSessions);
      }
    } catch (err) {
      setSettlementError(
        err instanceof Error ? err.message : 'Unable to submit payment details. Please try again.'
      );
    } finally {
      setSubmittingSettlement(false);
    }
  };

  const handlePlaceAnotherOrder = () => {
    setPayNowOpen(false);
    setEditingSettlement(false);
    setConfirmCancelOpen(false);
    setCancelError(null);
    setTrackerViewOpen(false);
    setActiveSection('menu');
    if ((liveTracker?.status === 'paid' || liveTracker?.status === 'cancelled') && shop) {
      const remaining = guestSessions.filter((s) => s.orderId !== liveTracker.id);
      setGuestSessions(remaining);
      writeGuestSessions(shop.shop_id, remaining);
      setActiveOrderId(null);
      setLiveTracker(null);
      writeLegacyActiveOrderId(shop.shop_id, null);
    } else if (activeSession) {
      setGuestName(activeSession.customerName);
      setTableOrRoom(scannedTable || activeSession.tableOrRoom);
    }
  };

  const openRoomBookingRequest = (room: Room) => {
    setBookingRoom(room);
    setConfirmedBooking(null);
    setBookingError(null);
    setBookingNameError(null);
    setBookingPhoneError(null);
    setBookingUtr('');
    if (customerProfile) {
      setBookingGuestName(customerProfile.full_name);
      setBookingGuestPhone(formatIndianMobile(customerProfile.mobile_number));
    }
    setDraftBookingRef(generateDraftReference('BK'));
    setBookingPaymentMethod(cashEnabled ? 'cash' : upiEnabled ? 'upi' : 'cash');
  };

  const handleSubmitRoomBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shop || !bookingRoom) return;
    setBookingError(null);

    const nameCheck = validateCustomerName(bookingGuestName);
    const mobileCheck = validateIndianMobile(bookingGuestPhone);
    setBookingNameError(
      nameCheck.valid ? null : nameCheck.error || 'Please enter your real full name.'
    );
    setBookingPhoneError(
      mobileCheck.valid
        ? null
        : mobileCheck.error || 'Please enter a valid 10-digit Indian mobile number.'
    );
    if (!nameCheck.valid || !mobileCheck.valid) {
      setBookingError('Please provide your real full name and a valid Indian mobile number.');
      return;
    }

    const nights = diffNights(checkInDate, checkOutDate);
    if (nights <= 0) {
      setBookingError('Check-out date must be at least 1 night after check-in.');
      return;
    }

    if (bookedRoomIdsForDates.has(bookingRoom.id)) {
      setBookingError(
        'This room was just reserved for those dates. Please pick different dates or another room.'
      );
      return;
    }

    const totalPrice = Math.round(nights * bookingRoom.nightly_rate * 100) / 100;
    const effectiveMethod: PaymentMethod =
      bookingPaymentMethod === 'upi' && upiEnabled ? 'upi' : 'cash';
    const effectivePaymentStatus =
      effectiveMethod === 'upi' ? 'verification_pending' : 'unpaid';

    setSubmittingBooking(true);
    try {
      const created = await createRoomBooking(shop.shop_id, {
        room_id: bookingRoom.id,
        room_number: bookingRoom.room_number,
        guest_name: nameCheck.value,
        guest_contact: mobileCheck.value,
        check_in: checkInDate,
        check_out: checkOutDate,
        total_price: totalPrice,
        notes: bookingNotes,
        initial_status: 'pending',
        payment_method: effectiveMethod,
        payment_status: effectivePaymentStatus,
        utr_number: effectiveMethod === 'upi' ? bookingUtr.trim() || null : null,
      });
      setConfirmedBooking(created);
      if (!customerProfile) {
        setBookingGuestName('');
        setBookingGuestPhone('');
      }
      setBookingNotes('');
      setBookingUtr('');
    } catch (err) {
      setBookingError(
        err instanceof Error ? err.message : 'Unable to submit booking request. Please try again.'
      );
    } finally {
      setSubmittingBooking(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <p className="text-sm text-slate-600">Loading storefront...</p>
      </div>
    );
  }

  if (notFound || !shop) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8 text-center">
          <Store className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <h1 className="font-display text-xl font-bold text-slate-900">Storefront not found</h1>
          <p className="mt-2 text-sm text-slate-600">
            We couldn’t find a venue at <span className="font-mono">/s/{slug}</span>.
          </p>
          <Link
            to="/login"
            className="mt-6 inline-flex items-center px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
          >
            Staff Sign In
          </Link>
        </div>
      </div>
    );
  }

  if (!shop.is_active) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8 text-center">
          <div
            className="w-11 h-11 rounded-lg mx-auto mb-4 flex items-center justify-center text-white font-display font-bold text-lg"
            style={{ backgroundColor: shop.primary_color }}
          >
            {shop.name.slice(0, 1).toUpperCase()}
          </div>
          <h1 className="font-display text-xl font-bold text-slate-900">{shop.name}</h1>
          <p className="mt-2 text-sm text-slate-600">
            This storefront is currently paused by platform administration. Please check back later.
          </p>
        </div>
      </div>
    );
  }

  const accent = shop.primary_color || '#2563EB';
  const canOrder = shop.modules.menu && shop.modules.orders;
  const hasBothMenuAndRooms = shop.modules.menu && shop.modules.rooms;
  const activeStepIndex = liveTracker ? ORDER_STATUS_FLOW.indexOf(liveTracker.status) : 0;
  const activeStepMeta =
    TRACKER_STEPS[Math.max(0, Math.min(TRACKER_STEPS.length - 1, activeStepIndex))];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Accent Top Hairline */}
      <div className="h-1.5 w-full" style={{ backgroundColor: accent }} />

      {/* Clean 3-Zone Top Bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4 sm:gap-6">
          <div className="flex items-center gap-3 min-w-0">
            {shop.logo_url ? (
              <SafeImage
                src={shop.logo_url}
                alt={shop.name}
                accentColor={accent}
                className="w-9 h-9 rounded-lg object-cover border border-slate-200 shrink-0"
              />
            ) : (
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-display font-bold text-base shrink-0"
                style={{ backgroundColor: accent }}
              >
                {shop.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <span className="font-display font-bold text-base sm:text-lg text-slate-900 truncate">
              {shop.name}
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            {shop.modules.menu && (
              <button
                type="button"
                onClick={() => {
                  setTrackerViewOpen(false);
                  setActiveSection('menu');
                }}
                className={`whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  activeSection === 'menu' && !trackerViewOpen
                    ? 'text-slate-900 font-semibold'
                    : 'hover:text-slate-900'
                }`}
              >
                Food Menu
              </button>
            )}
            {shop.modules.rooms && (
              <button
                type="button"
                onClick={() => {
                  setTrackerViewOpen(false);
                  setActiveSection('rooms');
                }}
                className={`whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  activeSection === 'rooms' && !trackerViewOpen
                    ? 'text-slate-900 font-semibold'
                    : 'hover:text-slate-900'
                }`}
              >
                Book a Room
              </button>
            )}
            <Link
              to="/login"
              className="hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              Staff Login
            </Link>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setAccountDrawerOpen(true)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                customerProfile
                  ? 'bg-slate-50 border-slate-300 text-slate-900 hover:bg-slate-100'
                  : user && user.emailVerified
                    ? 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100/70'
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {customerProfile ? (
                <>
                  <Award className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span className="max-w-[90px] truncate">
                    {customerProfile.full_name.split(' ')[0]}
                  </span>
                  <span className="hidden sm:inline font-mono text-[11px] text-slate-500 tabular-nums">
                    · {customerProfile.reward_points || 0} pts
                  </span>
                </>
              ) : user && user.emailVerified ? (
                <>
                  <UserCheck className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden sm:inline">Complete Signup</span>
                  <span className="sm:hidden">Register</span>
                </>
              ) : (
                <>
                  <UserCheck className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden sm:inline">Member Login</span>
                  <span className="sm:hidden">Login</span>
                </>
              )}
            </button>

            {canOrder ? (
              <button
                type="button"
                onClick={openOrderTray}
                className="inline-flex items-center gap-2 px-3.5 sm:px-4 py-2 text-xs font-semibold text-white rounded-lg hover:opacity-95 whitespace-nowrap shrink-0 cursor-pointer"
                style={{ backgroundColor: accent }}
              >
                <ShoppingBag className="w-4 h-4" />
                <span>Order</span>
                <span className="font-mono tabular-nums">({cartCount})</span>
              </button>
            ) : (
              <Link
                to="/login"
                className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                Staff Login
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Active Live Order Banner when browsing menu */}
      {liveTracker && !trackerViewOpen && liveTracker.status !== 'cancelled' && (() => {
        const bannerPayStatus = getEffectivePaymentStatus(
          liveTracker.payment_status,
          liveTracker.status
        );
        const isUnpaidServed =
          liveTracker.status === 'served' &&
          bannerPayStatus !== 'paid' &&
          bannerPayStatus !== 'verification_pending';

        return (
          <div className={isUnpaidServed ? 'bg-amber-950 text-amber-50' : 'bg-slate-900 text-white'}>
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`w-2 h-2 rounded-full animate-pulse shrink-0 ${
                    isUnpaidServed ? 'bg-amber-400' : 'bg-emerald-400'
                  }`}
                />
                <span className="font-mono font-semibold shrink-0">{liveTracker.order_number}</span>
                <span className={isUnpaidServed ? 'text-amber-100 truncate' : 'text-slate-300 truncate'}>
                  {liveTracker.table_or_room} · {formatCurrency(liveTracker.total_amount)} ·{' '}
                  <strong className="text-white">
                    {isUnpaidServed ? 'Served · Please pay before leaving' : activeStepMeta.label}
                  </strong>
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setPayNowOpen(false);
                    setTrackerViewOpen(true);
                  }}
                  className="inline-flex items-center gap-1 font-medium text-slate-200 hover:text-white whitespace-nowrap cursor-pointer"
                >
                  Track Live
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                {liveTracker.status !== 'paid' && bannerPayStatus !== 'paid' && (
                  <button
                    type="button"
                    onClick={() => {
                      setSettlementError(null);
                      setCashConfirmedNotice(false);
                      setPayNowOpen(true);
                      setTrackerViewOpen(true);
                    }}
                    className="px-3 py-1.5 text-xs font-semibold text-white rounded-md hover:opacity-95 whitespace-nowrap cursor-pointer"
                    style={{ backgroundColor: isUnpaidServed ? '#D97706' : accent }}
                  >
                    Pay Now
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Storefront Intro & Dual-Module Mode Switch */}
      {!trackerViewOpen && (
        <section className="bg-white border-b border-slate-200">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-7 sm:py-9 flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <p className="text-xs font-medium text-slate-500">
                {getShopTypeLabel(shop.type)} · Open for guests
                {canOrder ? ' · Live ordering' : ''}
                {shop.modules.rooms ? ' · Instant room requests' : ''}
                {tableOrRoom.trim() ? ` · ${tableOrRoom.trim()}` : ''}
              </p>
              <h1 className="mt-2 font-display text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                {shop.name}
              </h1>
              {shop.description && (
                <p className="mt-2 text-sm sm:text-base text-slate-600 max-w-2xl leading-relaxed">
                  {shop.description}
                </p>
              )}
            </div>

            {hasBothMenuAndRooms && (
              <div className="inline-flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg self-start md:self-auto shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveSection('menu')}
                  className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    activeSection === 'menu'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <UtensilsCrossed className="w-3.5 h-3.5" />
                  Food Menu
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSection('rooms')}
                  className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    activeSection === 'rooms'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <BedDouble className="w-3.5 h-3.5" />
                  Book a Room
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Main Guest Content */}
      <main
        className={`flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 ${
          canOrder && cartCount > 0 && !trackerViewOpen && activeSection === 'menu' ? 'pb-28' : ''
        }`}
      >
        {/* Live Real-Time Order Tracker View */}
        {trackerViewOpen && liveTracker ? (
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="p-6 sm:p-7 border-b border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
                        {liveTracker.order_number}
                      </span>
                      {liveTracker.status === 'cancelled' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700">
                          <Ban className="w-3.5 h-3.5" />
                          Cancelled
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                          Live tracker
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {shop.name} · {liveTracker.table_or_room}
                    </p>
                  </div>
                  <span
                    className={`font-mono text-lg font-semibold tabular-nums ${
                      liveTracker.status === 'cancelled'
                        ? 'text-slate-400 line-through'
                        : 'text-slate-900'
                    }`}
                  >
                    {formatCurrency(liveTracker.total_amount)}
                  </span>
                </div>

                {liveTracker.status === 'cancelled' ? (
                  <div className="mt-5 flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-red-100 text-red-700 flex items-center justify-center shrink-0">
                      <Ban className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="font-display text-lg font-bold text-slate-900">
                        Order cancelled
                      </h2>
                      <p className="text-sm text-slate-600 mt-0.5">
                        This order has been cancelled and removed from the kitchen queue. No
                        payment is due.
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mt-5 flex items-start gap-3">
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0"
                        style={{ backgroundColor: accent }}
                      >
                        {liveTracker.status === 'paid' || liveTracker.status === 'served' ? (
                          <CheckCircle2 className="w-5 h-5" />
                        ) : liveTracker.status === 'preparing' ? (
                          <ChefHat className="w-5 h-5" />
                        ) : (
                          <Clock className="w-5 h-5" />
                        )}
                      </div>
                      <div>
                        <h2 className="font-display text-lg font-bold text-slate-900">
                          {activeStepMeta.headline}
                        </h2>
                        <p className="text-sm text-slate-600 mt-0.5">{activeStepMeta.detail}</p>
                      </div>
                    </div>

                    {/* Live 5-Step Progress Stepper */}
                    <div className="mt-6 pt-6 border-t border-slate-200">
                      <ol className="grid grid-cols-5 gap-2">
                        {TRACKER_STEPS.map((step, idx) => {
                          const isDone = idx < activeStepIndex;
                          const isCurrent = idx === activeStepIndex;
                          return (
                            <li key={step.status} className="flex flex-col items-center text-center">
                              <div
                                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono font-semibold border transition-colors ${
                                  isDone
                                    ? 'bg-emerald-600 border-emerald-600 text-white'
                                    : isCurrent
                                      ? 'text-white border-transparent'
                                      : 'bg-slate-50 border-slate-300 text-slate-400'
                                }`}
                                style={isCurrent ? { backgroundColor: accent } : undefined}
                              >
                                {isDone ? <Check className="w-3.5 h-3.5" /> : idx + 1}
                              </div>
                              <span
                                className={`mt-2 text-[11px] sm:text-xs font-medium leading-tight ${
                                  isCurrent
                                    ? 'text-slate-900 font-semibold'
                                    : isDone
                                      ? 'text-emerald-700'
                                      : 'text-slate-400'
                                }`}
                              >
                                {step.label}
                              </span>
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  </>
                )}
              </div>

              {/* Itemized Receipt */}
              <div className="p-6 sm:p-7 bg-slate-50/50 space-y-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <Receipt className="w-4 h-4 text-slate-500" />
                  <span>Order Receipt</span>
                </div>

                <ul className="divide-y divide-slate-200 bg-white border border-slate-200 rounded-lg">
                  {liveTracker.items.map((item, idx) => (
                    <li
                      key={`${item.menu_item_id}-${idx}`}
                      className="px-4 py-3 flex items-center justify-between gap-3 text-sm"
                    >
                      <div className="min-w-0">
                        <span className="font-mono text-xs font-semibold text-slate-900 mr-2 tabular-nums">
                          {item.quantity}×
                        </span>
                        <span className="text-slate-800">{item.name}</span>
                      </div>
                      <span className="font-mono text-sm text-slate-900 tabular-nums shrink-0">
                        {formatCurrency(item.price * item.quantity)}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="flex items-center justify-between pt-2">
                  <span className="text-sm font-medium text-slate-600">Total Amount</span>
                  <span className="font-mono text-lg font-bold text-slate-900 tabular-nums">
                    {formatCurrency(liveTracker.total_amount)}
                  </span>
                </div>

                {(() => {
                  if (liveTracker.status === 'cancelled') {
                    return (
                      <div className="pt-3 border-t border-slate-200 text-xs text-slate-500">
                        This order was cancelled. No charge applies.
                      </div>
                    );
                  }

                  const pMethod = getEffectivePaymentMethod(liveTracker.payment_method);
                  const pStatus = getEffectivePaymentStatus(
                    liveTracker.payment_status,
                    liveTracker.status
                  );

                  if (pStatus === 'paid' || liveTracker.status === 'paid') {
                    return (
                      <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-3 text-xs">
                        <span className="text-slate-500">Payment</span>
                        <span className="font-semibold text-emerald-700">
                          Confirmed by Owner · Paid via {pMethod === 'upi' ? 'UPI' : 'Cash'}
                        </span>
                      </div>
                    );
                  }

                  const upiPendingVerification =
                    pMethod === 'upi' && pStatus === 'verification_pending';

                  if (upiPendingVerification && !editingSettlement) {
                    return (
                      <div className="pt-4 border-t border-slate-200">
                        <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 space-y-2.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-amber-950">
                              UPI Payment Submitted · Awaiting Owner Verification
                            </span>
                            <span className="font-mono font-semibold text-amber-900 tabular-nums">
                              {formatCurrency(liveTracker.total_amount)}
                            </span>
                          </div>
                          <p className="text-amber-900/80 leading-relaxed">
                            The shop owner has been notified to verify your UPI transfer
                            {activeSession?.utrNumber
                              ? ` (UTR: ${activeSession.utrNumber})`
                              : ''}
                            . Please show this screen at the counter if needed — your receipt will
                            automatically update to Paid once confirmed.
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setOrderPaymentMethod('upi');
                              setOrderUtr(activeSession?.utrNumber || '');
                              setPayNowOpen(true);
                              setEditingSettlement(true);
                            }}
                            className="text-xs font-semibold text-amber-900 underline hover:opacity-80 cursor-pointer"
                          >
                            Update UTR or switch payment method
                          </button>
                        </div>
                      </div>
                    );
                  }

                  if (!payNowOpen) {
                    const isServedUnpaid = liveTracker.status === 'served';
                    return (
                      <div className="pt-3 border-t border-slate-200 space-y-2.5 text-xs">
                        {isServedUnpaid && (
                          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2.5 text-amber-950">
                            <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
                            <div>
                              <p className="font-semibold">
                                Your meal is served · Please pay before leaving
                              </p>
                              <p className="text-[11px] text-amber-900/80 mt-0.5">
                                Tap <strong>Pay Now</strong> below to settle your full bill via{' '}
                                {cashEnabled && upiEnabled
                                  ? 'Cash or UPI'
                                  : upiEnabled
                                    ? 'UPI'
                                    : 'Cash'}
                                .
                              </p>
                            </div>
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-slate-500">Payment Status</span>
                          <span className="font-semibold text-slate-800">Unpaid · Open Bill</span>
                        </div>
                        {!isServedUnpaid && (
                          <p className="text-[11px] text-slate-500 leading-relaxed">
                            Keep ordering as much as you like — all items stay on this single unpaid
                            bill. Tap <strong className="text-slate-700">Pay Now</strong> below when
                            you are ready to leave to pay the full amount via{' '}
                            {cashEnabled && upiEnabled
                              ? 'Cash or UPI'
                              : upiEnabled
                                ? 'UPI'
                                : 'Cash'}
                            .
                          </p>
                        )}
                      </div>
                    );
                  }

                  return (
                    <div className="pt-4 border-t border-slate-200 space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold text-slate-900">
                            Settle Full Bill ({liveTracker.items.reduce((s, i) => s + i.quantity, 0)}{' '}
                            items)
                          </p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Choose Cash or UPI to pay your entire aggregated table bill at once.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setPayNowOpen(false);
                            setEditingSettlement(false);
                            setSettlementError(null);
                          }}
                          className="text-xs font-medium text-slate-500 hover:text-slate-800 whitespace-nowrap cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>

                      {settlementError && (
                        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                          {settlementError}
                        </div>
                      )}

                      <div className="space-y-3">
                        <div
                          className={`grid gap-2.5 ${
                            cashEnabled && upiEnabled ? 'grid-cols-2' : 'grid-cols-1'
                          }`}
                        >
                          {cashEnabled && (
                            <button
                              type="button"
                              onClick={() => {
                                setOrderPaymentMethod('cash');
                                setSettlementError(null);
                              }}
                              className={`px-3 py-2.5 text-left rounded-lg border transition-colors cursor-pointer ${
                                orderPaymentMethod === 'cash'
                                  ? 'border-slate-900 bg-slate-900 text-white'
                                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <Banknote className="w-4 h-4 shrink-0" />
                                <span className="text-xs font-semibold">Pay Cash at Counter</span>
                              </div>
                            </button>
                          )}
                          {upiEnabled && (
                            <button
                              type="button"
                              onClick={() => {
                                setOrderPaymentMethod('upi');
                                setSettlementError(null);
                                setCashConfirmedNotice(false);
                              }}
                              className={`px-3 py-2.5 text-left rounded-lg border transition-colors cursor-pointer ${
                                orderPaymentMethod === 'upi'
                                  ? 'border-slate-900 bg-slate-900 text-white'
                                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <QrCode className="w-4 h-4 shrink-0" />
                                <span className="text-xs font-semibold">Pay via UPI</span>
                              </div>
                            </button>
                          )}
                        </div>

                        {orderPaymentMethod === 'upi' && upiEnabled && shop.upi_id ? (
                          <div className="space-y-3">
                            <UpiPaymentBox
                              upiId={shop.upi_id}
                              payeeName={shop.upi_payee_name || shop.name}
                              amount={liveTracker.total_amount}
                              orderRef={liveTracker.order_number}
                              utrNumber={orderUtr}
                              onUtrChange={setOrderUtr}
                              accentColor={accent}
                            />
                            <button
                              type="button"
                              disabled={submittingSettlement}
                              onClick={() => void handleSettleOrderPayment('upi')}
                              className="w-full py-2.5 px-4 text-xs font-semibold text-white rounded-lg hover:opacity-95 disabled:opacity-60 cursor-pointer"
                              style={{ backgroundColor: accent }}
                            >
                              {submittingSettlement
                                ? 'Submitting Payment...'
                                : `I Have Paid ${formatCurrency(liveTracker.total_amount)}`}
                            </button>
                          </div>
                        ) : (
                          <div className="p-3.5 rounded-lg bg-white border border-slate-200 space-y-3 text-xs">
                            {cashConfirmedNotice ? (
                              <p className="text-emerald-700 font-medium leading-relaxed">
                                Cash payment selected for{' '}
                                <span className="font-mono font-semibold tabular-nums">
                                  {formatCurrency(liveTracker.total_amount)}
                                </span>
                                . Please pay at the counter or with your server for{' '}
                                <span className="font-mono font-semibold">
                                  {liveTracker.order_number}
                                </span>
                                .
                              </p>
                            ) : (
                              <>
                                <p className="text-slate-600 leading-relaxed">
                                  Pay the full combined total of{' '}
                                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                                    {formatCurrency(liveTracker.total_amount)}
                                  </span>{' '}
                                  in Cash at the counter or to your server when you are ready to
                                  leave.
                                </p>
                                <button
                                  type="button"
                                  disabled={submittingSettlement}
                                  onClick={() => void handleSettleOrderPayment('cash')}
                                  className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg cursor-pointer"
                                >
                                  {submittingSettlement
                                    ? 'Updating...'
                                    : `Confirm Cash · ${formatCurrency(liveTracker.total_amount)}`}
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {(() => {
                const isCancelled = liveTracker.status === 'cancelled';
                const pStatus = getEffectivePaymentStatus(
                  liveTracker.payment_status,
                  liveTracker.status
                );
                const isBillSettled = liveTracker.status === 'paid' || pStatus === 'paid';
                const isUpiPending =
                  getEffectivePaymentMethod(liveTracker.payment_method) === 'upi' &&
                  pStatus === 'verification_pending';
                const canSelfCancel = liveTracker.status === 'pending' && pStatus === 'unpaid';
                const showPayNowButton =
                  !isCancelled && !isBillSettled && !isUpiPending && !payNowOpen;

                return (
                  <div className="border-t border-slate-200 bg-white">
                    {canSelfCancel && (
                      <div className="px-5 pt-4 pb-1">
                        {cancelError && (
                          <div className="mb-2.5 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                            {cancelError}
                          </div>
                        )}
                        {confirmCancelOpen ? (
                          <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
                            <span className="font-medium text-red-900">
                              Ordered by mistake? Cancel {liveTracker.order_number} before the
                              kitchen starts cooking.
                            </span>
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                disabled={cancellingOrder}
                                onClick={() => void handleGuestCancelPendingOrder()}
                                className="px-3 py-1.5 font-semibold text-white bg-red-700 hover:bg-red-800 disabled:opacity-60 rounded-md whitespace-nowrap cursor-pointer"
                              >
                                {cancellingOrder ? 'Cancelling...' : 'Yes, Cancel Order'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setConfirmCancelOpen(false);
                                  setCancelError(null);
                                }}
                                className="px-3 py-1.5 font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                              >
                                Keep
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                            <span>Ordered by mistake? You can cancel while still Pending.</span>
                            <button
                              type="button"
                              onClick={() => {
                                setCancelError(null);
                                setConfirmCancelOpen(true);
                              }}
                              className="font-semibold text-red-700 hover:underline whitespace-nowrap cursor-pointer"
                            >
                              Cancel Order
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="p-5 flex flex-col sm:flex-row items-center justify-between gap-3">
                      <p className="text-xs text-slate-500">
                        {isCancelled
                          ? 'Ready to order again? Browse the menu anytime.'
                          : isBillSettled
                            ? 'Bill settled. Start a new order anytime.'
                            : 'Want to order more? New items combine into this unpaid bill.'}
                      </p>
                      <div className="w-full sm:w-auto flex flex-col sm:flex-row items-center gap-2.5 shrink-0">
                        <button
                          type="button"
                          onClick={handlePlaceAnotherOrder}
                          className={`w-full sm:w-auto px-4 py-2.5 text-xs font-semibold rounded-lg whitespace-nowrap cursor-pointer ${
                            showPayNowButton
                              ? 'text-slate-700 bg-white border border-slate-300 hover:bg-slate-50'
                              : 'text-white hover:opacity-95'
                          }`}
                          style={showPayNowButton ? undefined : { backgroundColor: accent }}
                        >
                          {isCancelled
                            ? 'Start Fresh Order'
                            : isBillSettled
                              ? 'Place Another Order'
                              : 'Add More Items'}
                        </button>

                        {showPayNowButton && (
                          <button
                            type="button"
                            onClick={() => {
                              setSettlementError(null);
                              setCashConfirmedNotice(false);
                              setEditingSettlement(false);
                              setPayNowOpen(true);
                            }}
                            className="w-full sm:w-auto px-5 py-2.5 text-xs font-semibold text-white rounded-lg hover:opacity-95 whitespace-nowrap cursor-pointer"
                            style={{ backgroundColor: accent }}
                          >
                            Pay Now · {formatCurrency(liveTracker.total_amount)}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        ) : (
          <>
            {/* FOOD MENU TAB */}
            {activeSection === 'menu' && shop.modules.menu && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <h2 className="font-display text-xl font-semibold text-slate-900">Food Menu</h2>
                  {categories.length > 1 && (
                    <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg overflow-x-auto max-w-full">
                      {categories.map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setSelectedCategory(cat)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            selectedCategory === cat
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {filteredMenu.length === 0 ? (
                  <div className="bg-white border border-slate-200 rounded-lg py-16 px-6 text-center">
                    <UtensilsCrossed className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                    <p className="text-sm font-medium text-slate-900">Menu items coming soon</p>
                    <p className="text-xs text-slate-500 mt-1">
                      This venue has not published available menu offerings yet.
                    </p>
                  </div>
                ) : (
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {filteredMenu.map((item) => {
                      const qty = cart[item.id] || 0;
                      return (
                        <article
                          key={item.id}
                          className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col"
                        >
                          <SafeImage
                            src={item.image_url}
                            alt={item.name}
                            fallbackIcon="menu"
                            fallbackLabel={item.category}
                            accentColor={accent}
                            className="w-full h-44 object-cover border-b border-slate-100"
                          />
                          <div className="p-4 flex-1 flex flex-col justify-between gap-4">
                            <div>
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-xs text-slate-500">{item.category}</p>
                                  <h3 className="font-display text-base font-semibold text-slate-900 mt-0.5">
                                    {item.name}
                                  </h3>
                                </div>
                                <span className="font-mono text-sm font-semibold text-slate-900 tabular-nums shrink-0">
                                  {formatCurrency(item.price)}
                                </span>
                              </div>
                              {item.description && (
                                <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                                  {item.description}
                                </p>
                              )}
                            </div>

                            {canOrder && (
                              <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                                {qty === 0 ? (
                                  <button
                                    type="button"
                                    onClick={() => updateCartQty(item.id, 1)}
                                    className="w-full py-2 px-3 text-xs font-semibold text-white rounded-lg hover:opacity-95 transition-opacity cursor-pointer"
                                    style={{ backgroundColor: accent }}
                                  >
                                    Add to Order
                                  </button>
                                ) : (
                                  <div className="w-full flex items-center justify-between gap-2">
                                    <button
                                      type="button"
                                      onClick={() => updateCartQty(item.id, -1)}
                                      aria-label={`Remove one ${item.name}`}
                                      className="w-8 h-8 rounded-lg border border-slate-300 flex items-center justify-center text-slate-700 hover:bg-slate-50 cursor-pointer"
                                    >
                                      <Minus className="w-3.5 h-3.5" />
                                    </button>
                                    <span className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                                      {qty} in order
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => updateCartQty(item.id, 1)}
                                      aria-label={`Add one ${item.name}`}
                                      className="w-8 h-8 rounded-lg border border-slate-300 flex items-center justify-center text-slate-700 hover:bg-slate-50 cursor-pointer"
                                    >
                                      <Plus className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* BOOK A ROOM TAB */}
            {activeSection === 'rooms' && shop.modules.rooms && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                  <div>
                    <h2 className="font-display text-xl font-semibold text-slate-900">
                      Book a Room
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Choose your stay dates to view real-time availability and request an instant
                      booking.
                    </p>
                  </div>
                  {stayNights > 0 && (
                    <p className="text-xs font-mono text-slate-600 tabular-nums">
                      {availableRoomsForDates.length} of {rooms.length}{' '}
                      {rooms.length === 1 ? 'room' : 'rooms'} available · {stayNights}{' '}
                      {stayNights === 1 ? 'night' : 'nights'}
                    </p>
                  )}
                </div>

                {/* Date Range & Capacity Filter Bar */}
                <div className="bg-white border border-slate-200 rounded-lg p-4 sm:p-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-4 items-end">
                    <div className="lg:col-span-4">
                      <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 mb-1.5">
                        <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
                        Check-In Date
                      </label>
                      <input
                        type="date"
                        min={todayIso}
                        value={checkInDate}
                        onChange={(e) => {
                          const nextIn = e.target.value;
                          setCheckInDate(nextIn);
                          if (checkOutDate <= nextIn) {
                            setCheckOutDate(addDaysIso(nextIn, 1));
                          }
                        }}
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                      />
                    </div>

                    <div className="lg:col-span-4">
                      <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 mb-1.5">
                        <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
                        Check-Out Date
                      </label>
                      <input
                        type="date"
                        min={addDaysIso(checkInDate, 1)}
                        value={checkOutDate}
                        onChange={(e) => setCheckOutDate(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                      />
                    </div>

                    <div className="lg:col-span-2">
                      <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 mb-1.5">
                        <Users className="w-3.5 h-3.5 text-slate-400" />
                        Guests
                      </label>
                      <select
                        value={minGuests}
                        onChange={(e) => setMinGuests(Number(e.target.value))}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none cursor-pointer"
                      >
                        <option value={1}>1+ Guest</option>
                        <option value={2}>2+ Guests</option>
                        <option value={3}>3+ Guests</option>
                        <option value={4}>4+ Guests</option>
                      </select>
                    </div>

                    <div className="lg:col-span-2 text-left lg:text-right">
                      <p className="text-xs text-slate-500">Selected Stay</p>
                      <p className="font-mono text-sm font-semibold text-slate-900 tabular-nums mt-0.5">
                        {stayNights > 0
                          ? `${formatShortDate(checkInDate)} – ${formatShortDate(checkOutDate)}`
                          : 'Select valid dates'}
                      </p>
                    </div>
                  </div>
                </div>

                {stayNights <= 0 ? (
                  <div className="bg-white border border-slate-200 rounded-lg py-12 px-6 text-center">
                    <p className="text-sm font-medium text-slate-900">
                      Please select a check-out date after check-in
                    </p>
                  </div>
                ) : rooms.length === 0 ? (
                  <div className="bg-white border border-slate-200 rounded-lg py-16 px-6 text-center">
                    <BedDouble className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                    <p className="text-sm font-medium text-slate-900">No rooms listed yet</p>
                  </div>
                ) : availableRoomsForDates.length === 0 ? (
                  <div className="bg-white border border-slate-200 rounded-lg py-14 px-6 text-center">
                    <BedDouble className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                    <h3 className="text-base font-semibold text-slate-900">
                      No rooms available for these dates
                    </h3>
                    <p className="mt-1.5 text-sm text-slate-600 max-w-md mx-auto">
                      All matching rooms are already reserved between{' '}
                      <span className="font-mono">{formatShortDate(checkInDate)}</span> and{' '}
                      <span className="font-mono">{formatShortDate(checkOutDate)}</span>. Try
                      adjusting your check-in dates or guest count.
                    </p>
                  </div>
                ) : (
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {availableRoomsForDates.map((room) => {
                      const stayTotal = room.nightly_rate * stayNights;
                      return (
                        <article
                          key={room.id}
                          className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col"
                        >
                          <SafeImage
                            src={room.image_url}
                            alt={room.title}
                            fallbackIcon="room"
                            fallbackLabel={`Room ${room.room_number}`}
                            accentColor={accent}
                            className="w-full h-48 object-cover border-b border-slate-100"
                          />
                          <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                            <div>
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-xs text-slate-500 font-mono">
                                    Room {room.room_number} · {room.room_type}
                                  </p>
                                  <h3 className="font-display text-base font-semibold text-slate-900 mt-0.5">
                                    {room.title}
                                  </h3>
                                </div>
                                <span className="font-mono text-sm font-semibold text-slate-900 tabular-nums shrink-0">
                                  {formatCurrency(room.nightly_rate)}
                                  <span className="text-[11px] font-normal text-slate-500">/nt</span>
                                </span>
                              </div>
                              <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                                Up to {room.capacity} guests
                                {room.amenities.length > 0 ? ` · ${room.amenities.join(' · ')}` : ''}
                              </p>
                            </div>

                            <div className="pt-3.5 border-t border-slate-100 space-y-3">
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-emerald-700 font-semibold">
                                  Available for your dates
                                </span>
                                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                                  {formatCurrency(stayTotal)} ({stayNights}{' '}
                                  {stayNights === 1 ? 'nt' : 'nts'})
                                </span>
                              </div>

                              <button
                                type="button"
                                onClick={() => openRoomBookingRequest(room)}
                                className="w-full py-2.5 px-4 text-xs font-semibold text-white rounded-lg hover:opacity-95 transition-opacity cursor-pointer"
                                style={{ backgroundColor: accent }}
                              >
                                Request Booking
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Compact Mobile-First Floating Bottom Cart Bar (Menu Mode) */}
      {canOrder &&
        cartCount > 0 &&
        !trayOpen &&
        !trackerViewOpen &&
        activeSection === 'menu' && (
          <div className="fixed bottom-4 inset-x-4 sm:left-1/2 sm:-translate-x-1/2 sm:w-full sm:max-w-md z-30">
            <button
              type="button"
              onClick={openOrderTray}
              className="w-full px-4 py-3 rounded-xl shadow-lg text-white flex items-center justify-between gap-4 hover:opacity-95 transition-opacity cursor-pointer"
              style={{ backgroundColor: accent }}
            >
              <div className="flex items-center gap-2.5 text-left">
                <ShoppingBag className="w-4 h-4 shrink-0" />
                <span className="text-xs font-semibold">
                  {cartCount} {cartCount === 1 ? 'item' : 'items'}
                </span>
                <span className="text-white/60">·</span>
                <span className="font-mono text-sm font-bold tabular-nums">
                  {formatCurrency(cartTotal)}
                </span>
              </div>
              <span className="inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap">
                View Order
                <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </button>
          </div>
        )}

      {/* Live Guest Order Slide-Over */}
      {trayOpen && canOrder && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-[1px]"
            onClick={() => setTrayOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h2 className="font-display text-base font-semibold text-slate-900">
                  {confirmingOrderStep ? 'Review & Confirm Order' : 'Your Order'}
                </h2>
                {cartItems.length > 0 && !confirmingOrderStep && (
                  <button
                    type="button"
                    onClick={() => setCart({})}
                    className="text-xs font-medium text-slate-500 hover:text-red-600 transition-colors cursor-pointer"
                  >
                    Clear tray
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setConfirmingOrderStep(false);
                  setTrayOpen(false);
                }}
                className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {cartItems.length === 0 ? (
              <div className="p-8 flex-1 flex flex-col items-center justify-center text-center">
                <ShoppingBag className="w-8 h-8 text-slate-300 mb-3" />
                <p className="text-sm font-medium text-slate-900">Your tray is empty</p>
                <p className="text-xs text-slate-500 mt-1">
                  Add items from the menu to place a live order directly to the kitchen.
                </p>
                {liveTracker && liveTracker.status !== 'cancelled' && (
                  <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        setTrayOpen(false);
                        setPayNowOpen(false);
                        setTrackerViewOpen(true);
                      }}
                      className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                    >
                      Track {liveTracker.order_number}
                    </button>
                    {liveTracker.status !== 'paid' &&
                      getEffectivePaymentStatus(liveTracker.payment_status, liveTracker.status) !==
                        'paid' && (
                        <button
                          type="button"
                          onClick={() => {
                            setTrayOpen(false);
                            setSettlementError(null);
                            setCashConfirmedNotice(false);
                            setPayNowOpen(true);
                            setTrackerViewOpen(true);
                          }}
                          className="px-4 py-2 text-xs font-semibold text-white rounded-lg cursor-pointer"
                          style={{ backgroundColor: accent }}
                        >
                          Pay Now · {formatCurrency(liveTracker.total_amount)}
                        </button>
                      )}
                  </div>
                )}
              </div>
            ) : (
              <form
                onSubmit={handleOrderTraySubmit}
                className="flex-1 overflow-y-auto p-6 space-y-5"
              >
                {submitError && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                    {submitError}
                  </div>
                )}

                {confirmingOrderStep ? (
                  /* 2-Step Confirmation Gate: Prevents accidental kitchen tickets */
                  (() => {
                    const combinedBillTotal = combiningTracker
                      ? combiningTracker.total_amount + cartTotal
                      : cartTotal;
                    return (
                      <div className="space-y-5">
                        <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2.5 text-xs text-amber-950">
                          <ShieldCheck className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
                          <div>
                            <p className="font-semibold">
                              Double-check before sending to the kitchen
                            </p>
                            <p className="text-amber-900/80 mt-0.5 leading-relaxed">
                              You can cancel while your order is Pending, but once the kitchen
                              starts preparing it, cancellation is locked.
                            </p>
                          </div>
                        </div>

                        <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-2 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-slate-500">Customer</span>
                            <span className="font-semibold text-slate-900">
                              {(customerProfile ? customerProfile.full_name : guestName).trim()}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-slate-500">Verified Mobile</span>
                            <span className="font-mono text-slate-900 tabular-nums">
                              {formatIndianMobile(
                                customerProfile ? customerProfile.mobile_number : guestPhone
                              )}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-slate-500">Table / Room</span>
                            <span className="font-mono font-semibold text-slate-900">
                              {tableOrRoom.trim()}
                            </span>
                          </div>
                          {combiningTracker && (
                            <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-200">
                              <span className="text-slate-500">Merging into</span>
                              <span className="font-mono font-semibold text-blue-800">
                                {combiningTracker.order_number}
                              </span>
                            </div>
                          )}
                          {notes.trim() && (
                            <div className="pt-1.5 border-t border-slate-200">
                              <span className="text-slate-500">Notes: </span>
                              <span className="text-slate-800">{notes.trim()}</span>
                            </div>
                          )}
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-semibold text-slate-700">
                            Items Sending Now ({cartCount})
                          </p>
                          <ul className="divide-y divide-slate-200 border border-slate-200 rounded-lg bg-white">
                            {cartItems.map((item) => (
                              <li
                                key={item.menu_item_id}
                                className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                              >
                                <span className="text-slate-800">
                                  <span className="font-mono font-semibold text-slate-900 mr-1.5 tabular-nums">
                                    {item.quantity}×
                                  </span>
                                  {item.name}
                                </span>
                                <span className="font-mono font-medium text-slate-900 tabular-nums">
                                  {formatCurrency(item.price * item.quantity)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="pt-4 border-t border-slate-200 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-slate-600">
                              {combiningTracker ? 'New Combined Running Bill' : 'Total Order Bill'}
                            </span>
                            <span className="font-mono text-lg font-bold text-slate-900 tabular-nums">
                              {formatCurrency(combinedBillTotal)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2.5">
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => setConfirmingOrderStep(false)}
                              className="px-4 py-2.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
                            >
                              Edit Items
                            </button>
                            <button
                              type="submit"
                              disabled={submitting}
                              className="flex-1 px-4 py-2.5 text-xs font-semibold text-white rounded-lg hover:opacity-95 disabled:opacity-60 cursor-pointer"
                              style={{ backgroundColor: accent }}
                            >
                              {submitting
                                ? 'Sending to Kitchen...'
                                : combiningTracker
                                  ? `Confirm & Add to ${combiningTracker.order_number}`
                                  : 'Confirm & Send to Kitchen'}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <>
                    {combiningTracker && (
                      <div className="p-3.5 rounded-lg bg-blue-50/80 border border-blue-200 space-y-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-blue-950">
                            Adding to Active Order {combiningTracker.order_number}
                          </span>
                          <span className="font-mono font-semibold text-blue-800 tabular-nums">
                            {combiningTracker.table_or_room}
                          </span>
                        </div>
                        <p className="text-blue-900/80 leading-relaxed">
                          These items will merge into your single running table bill — pay
                          everything at once after your meal is served.
                        </p>
                        <div className="pt-1.5 border-t border-blue-200/80 space-y-1 font-mono tabular-nums">
                          <div className="flex items-center justify-between text-blue-900">
                            <span>
                              Previous bill (
                              {combiningTracker.items.reduce((s, i) => s + i.quantity, 0)} items)
                            </span>
                            <span>{formatCurrency(combiningTracker.total_amount)}</span>
                          </div>
                          <div className="flex items-center justify-between text-blue-900">
                            <span>Adding now ({cartCount} items)</span>
                            <span>+{formatCurrency(cartTotal)}</span>
                          </div>
                          <div className="flex items-center justify-between font-bold text-slate-900 pt-1 border-t border-blue-200/80">
                            <span>Combined Running Total</span>
                            <span>{formatCurrency(combiningTracker.total_amount + cartTotal)}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    <ul className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                      {cartItems.map((item) => (
                        <li
                          key={item.menu_item_id}
                          className="px-3.5 py-3 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate">
                              {item.name}
                            </p>
                            <p className="text-xs font-mono text-slate-500 tabular-nums">
                              {formatCurrency(item.price)} each
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => updateCartQty(item.menu_item_id, -1)}
                              className="w-7 h-7 rounded border border-slate-300 flex items-center justify-center text-slate-700 cursor-pointer"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="font-mono text-xs font-semibold w-5 text-center tabular-nums">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => updateCartQty(item.menu_item_id, 1)}
                              className="w-7 h-7 rounded border border-slate-300 flex items-center justify-center text-slate-700 cursor-pointer"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>

                    <div className="space-y-3.5">
                      {/* Member Status Banner / Verified Member Details */}
                      {customerProfile ? (
                        <div className="p-3.5 rounded-lg bg-emerald-50/70 border border-emerald-200 space-y-1.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 font-semibold text-emerald-950">
                              <Award className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                              <span>{customerProfile.full_name}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setAccountDrawerOpen(true)}
                              className="text-xs font-medium text-emerald-800 hover:underline cursor-pointer"
                            >
                              Edit / Account
                            </button>
                          </div>
                          <div className="flex items-center justify-between text-emerald-900/80 font-mono tabular-nums">
                            <span>{formatIndianMobile(customerProfile.mobile_number)}</span>
                            <span>{customerProfile.reward_points || 0} reward pts</span>
                          </div>
                        </div>
                      ) : !user ? (
                        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-3 text-xs">
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-800">
                              Returning customer at {shop.name}?
                            </p>
                            <p className="text-[11px] text-slate-500">
                              Sign in to auto-fill details & earn reward points.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setAccountDrawerOpen(true)}
                            className="px-3 py-1.5 text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            Sign In / Register
                          </button>
                        </div>
                      ) : null}

                      {!customerProfile && (
                        <>
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              Your Full Name <span className="text-red-600">*</span>
                            </label>
                            <input
                              type="text"
                              required
                              maxLength={80}
                              value={guestName}
                              onChange={(e) => {
                                setGuestName(e.target.value);
                                if (nameError) setNameError(null);
                              }}
                              placeholder="Aarav Sharma"
                              className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none ${
                                nameError
                                  ? 'border-red-400 focus:border-red-500 bg-red-50/30'
                                  : 'border-slate-300 focus:border-blue-600'
                              }`}
                            />
                            {nameError && (
                              <p className="mt-1 text-[11px] text-red-600">{nameError}</p>
                            )}
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              Mobile Number (India +91) <span className="text-red-600">*</span>
                            </label>
                            <input
                              type="tel"
                              required
                              maxLength={20}
                              value={guestPhone}
                              onChange={(e) => {
                                setGuestPhone(e.target.value);
                                if (phoneError) setPhoneError(null);
                              }}
                              placeholder="+91 98201 44512"
                              className={`w-full px-3 py-2 text-sm font-mono border rounded-lg focus:outline-none ${
                                phoneError
                                  ? 'border-red-400 focus:border-red-500 bg-red-50/30'
                                  : 'border-slate-300 focus:border-blue-600'
                              }`}
                            />
                            {phoneError ? (
                              <p className="mt-1 text-[11px] text-red-600">{phoneError}</p>
                            ) : (
                              <p className="mt-1 text-[11px] text-slate-500">
                                Required for bill confirmation (10-digit number starting with 6–9).
                              </p>
                            )}
                          </div>
                        </>
                      )}

                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Table or Room Number <span className="text-red-600">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          maxLength={60}
                          value={tableOrRoom}
                          onChange={(e) => {
                            setTableOrRoom(e.target.value);
                            if (tableError) setTableError(null);
                          }}
                          placeholder="Table 4 / Room 201"
                          className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none ${
                            tableError
                              ? 'border-red-400 focus:border-red-500 bg-red-50/30'
                              : 'border-slate-300 focus:border-blue-600'
                          }`}
                        />
                        {tableError && (
                          <p className="mt-1 text-[11px] text-red-600">{tableError}</p>
                        )}
                      </div>

                      {user && user.emailVerified && !customerProfile && (
                        <label className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-50 border border-slate-200 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={registerOnOrder}
                            onChange={(e) => setRegisterOnOrder(e.target.checked)}
                            className="mt-0.5 rounded border-slate-300"
                          />
                          <span className="text-xs text-slate-700 leading-relaxed">
                            Save me as a registered <strong className="text-slate-900">{shop.name}</strong>{' '}
                            member for 1-click repeat ordering & reward points.
                          </span>
                        </label>
                      )}

                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Special Instructions (Optional)
                        </label>
                        <textarea
                          rows={2}
                          maxLength={300}
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder="Less sugar, extra chutney, allergies..."
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none resize-none"
                        />
                      </div>
                    </div>

                    {/* Deferred End-of-Meal Billing Notice */}
                    {(() => {
                      const combinedBillTotal = combiningTracker
                        ? combiningTracker.total_amount + cartTotal
                        : cartTotal;

                      return (
                        <>
                          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-relaxed">
                            <span className="font-semibold text-slate-800">
                              Pay when ready to leave:{' '}
                            </span>
                            Orders stay unpaid while you dine. Add as many rounds as you like, then
                            tap <strong className="text-slate-800">Pay Now</strong> to settle your
                            full combined bill via{' '}
                            {cashEnabled && upiEnabled
                              ? 'Cash or UPI'
                              : upiEnabled
                                ? 'UPI'
                                : 'Cash'}
                            .
                          </div>

                          <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
                            <div>
                              <p className="text-xs text-slate-500">
                                {combiningTracker ? 'Combined Running Bill' : 'Order Total'}
                              </p>
                              <p className="font-mono text-lg font-semibold text-slate-900 tabular-nums">
                                {formatCurrency(combinedBillTotal)}
                              </p>
                            </div>
                            <button
                              type="submit"
                              disabled={submitting}
                              className="px-5 py-2.5 text-xs font-semibold text-white rounded-lg hover:opacity-95 disabled:opacity-60 whitespace-nowrap cursor-pointer"
                              style={{ backgroundColor: accent }}
                            >
                              Review & Confirm
                            </button>
                          </div>
                        </>
                      );
                    })()}
                  </>
                )}
              </form>
            )}
          </div>
        </div>
      )}

      {/* Guest Room Booking Request Slide-Over */}
      {bookingRoom && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-[1px]"
            onClick={() => setBookingRoom(null)}
          />
          <div className="relative z-10 w-full max-w-md bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  {confirmedBooking ? 'Booking Request Sent' : 'Request Room Booking'}
                </h2>
                <p className="text-xs text-slate-500">
                  Room {bookingRoom.room_number} · {bookingRoom.title}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBookingRoom(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {confirmedBooking ? (
              <div className="p-6 flex-1 flex flex-col justify-between">
                <div className="space-y-5 pt-4">
                  <div className="text-center">
                    <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
                    <h3 className="font-display text-lg font-bold text-slate-900">
                      Reservation Request Received
                    </h3>
                    <p className="mt-1.5 text-sm text-slate-600">
                      Thank you, {confirmedBooking.guest_name}. Our front desk at {shop.name} has
                      received your request and will confirm shortly.
                    </p>
                  </div>

                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 text-xs">
                    <div className="px-4 py-3 flex items-center justify-between">
                      <span className="text-slate-500">Room</span>
                      <span className="font-mono font-semibold text-slate-900">
                        Room {confirmedBooking.room_number} · {bookingRoom.room_type}
                      </span>
                    </div>
                    <div className="px-4 py-3 flex items-center justify-between">
                      <span className="text-slate-500">Stay Dates</span>
                      <span className="font-mono text-slate-900 tabular-nums">
                        {formatShortDate(confirmedBooking.check_in)} →{' '}
                        {formatShortDate(confirmedBooking.check_out)}
                      </span>
                    </div>
                    <div className="px-4 py-3 flex items-center justify-between">
                      <span className="text-slate-500">Status</span>
                      <span className="font-semibold text-amber-700">
                        Pending Desk Confirmation
                      </span>
                    </div>
                    <div className="px-4 py-3 flex items-center justify-between">
                      <span className="text-slate-500">Payment</span>
                      {getEffectivePaymentMethod(confirmedBooking.payment_method) === 'upi' ? (
                        <span className="font-semibold text-amber-700">
                          UPI · Verification Pending
                        </span>
                      ) : (
                        <span className="font-medium text-slate-800">Pay Cash at Counter</span>
                      )}
                    </div>
                    {confirmedBooking.utr_number && (
                      <div className="px-4 py-3 flex items-center justify-between">
                        <span className="text-slate-500">UTR Reference</span>
                        <span className="font-mono text-slate-900 tabular-nums">
                          {confirmedBooking.utr_number}
                        </span>
                      </div>
                    )}
                    <div className="px-4 py-3 flex items-center justify-between">
                      <span className="text-slate-500">Total Stay</span>
                      <span className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                        {formatCurrency(confirmedBooking.total_price)}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setConfirmedBooking(null);
                    setBookingRoom(null);
                  }}
                  className="w-full py-2.5 px-4 text-xs font-semibold text-white rounded-lg hover:opacity-95 cursor-pointer"
                  style={{ backgroundColor: accent }}
                >
                  Done
                </button>
              </div>
            ) : (
              <form
                onSubmit={(e) => void handleSubmitRoomBooking(e)}
                className="flex-1 overflow-y-auto p-6 space-y-5"
              >
                {bookingError && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                    {bookingError}
                  </div>
                )}

                {/* Stay Price Summary */}
                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/70 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Check-In → Check-Out</span>
                    <span className="font-mono font-medium text-slate-900 tabular-nums">
                      {formatShortDate(checkInDate)} → {formatShortDate(checkOutDate)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">
                      {formatCurrency(bookingRoom.nightly_rate)} × {stayNights}{' '}
                      {stayNights === 1 ? 'night' : 'nights'}
                    </span>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">
                      {formatCurrency(bookingRoom.nightly_rate * stayNights)}
                    </span>
                  </div>
                </div>

                <div className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Full Name <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={80}
                      value={bookingGuestName}
                      onChange={(e) => {
                        setBookingGuestName(e.target.value);
                        if (bookingNameError) setBookingNameError(null);
                      }}
                      placeholder="Priya Nair"
                      className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none ${
                        bookingNameError
                          ? 'border-red-400 focus:border-red-500 bg-red-50/30'
                          : 'border-slate-300 focus:border-blue-600'
                      }`}
                    />
                    {bookingNameError && (
                      <p className="mt-1 text-[11px] text-red-600">{bookingNameError}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Mobile Number (India +91) <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="tel"
                      required
                      maxLength={20}
                      value={bookingGuestPhone}
                      onChange={(e) => {
                        setBookingGuestPhone(e.target.value);
                        if (bookingPhoneError) setBookingPhoneError(null);
                      }}
                      placeholder="+91 98201 44512"
                      className={`w-full px-3 py-2 text-sm font-mono border rounded-lg focus:outline-none ${
                        bookingPhoneError
                          ? 'border-red-400 focus:border-red-500 bg-red-50/30'
                          : 'border-slate-300 focus:border-blue-600'
                      }`}
                    />
                    {bookingPhoneError ? (
                      <p className="mt-1 text-[11px] text-red-600">{bookingPhoneError}</p>
                    ) : (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Special Requests (Optional)
                    </label>
                    <textarea
                      rows={2}
                      maxLength={300}
                      value={bookingNotes}
                      onChange={(e) => setBookingNotes(e.target.value)}
                      placeholder="Estimated arrival time, extra pillow, airport pickup..."
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none resize-none"
                    />
                  </div>
                </div>

                {/* Payment Method Selection */}
                <div className="space-y-3 pt-2 border-t border-slate-200">
                  <p className="text-xs font-semibold text-slate-800">Payment Method</p>
                  <div
                    className={`grid gap-2.5 ${
                      cashEnabled && upiEnabled ? 'grid-cols-2' : 'grid-cols-1'
                    }`}
                  >
                    {cashEnabled && (
                      <button
                        type="button"
                        onClick={() => setBookingPaymentMethod('cash')}
                        className={`px-3 py-2.5 text-left rounded-lg border transition-colors cursor-pointer ${
                          bookingPaymentMethod === 'cash'
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Banknote className="w-4 h-4 shrink-0" />
                          <span className="text-xs font-semibold">Pay Cash at Counter</span>
                        </div>
                      </button>
                    )}
                    {upiEnabled && (
                      <button
                        type="button"
                        onClick={() => setBookingPaymentMethod('upi')}
                        className={`px-3 py-2.5 text-left rounded-lg border transition-colors cursor-pointer ${
                          bookingPaymentMethod === 'upi'
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <QrCode className="w-4 h-4 shrink-0" />
                          <span className="text-xs font-semibold">Pay via UPI</span>
                        </div>
                      </button>
                    )}
                  </div>

                  {bookingPaymentMethod === 'upi' && upiEnabled && shop.upi_id && stayNights > 0 && (
                    <UpiPaymentBox
                      upiId={shop.upi_id}
                      payeeName={shop.upi_payee_name || shop.name}
                      amount={bookingRoom.nightly_rate * stayNights}
                      orderRef={draftBookingRef}
                      utrNumber={bookingUtr}
                      onUtrChange={setBookingUtr}
                      accentColor={accent}
                    />
                  )}
                </div>

                <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs text-slate-500">Total Stay</p>
                    <p className="font-mono text-lg font-semibold text-slate-900 tabular-nums">
                      {formatCurrency(bookingRoom.nightly_rate * stayNights)}
                    </p>
                  </div>
                  <button
                    type="submit"
                    disabled={submittingBooking || stayNights <= 0}
                    className="px-5 py-2.5 text-xs font-semibold text-white rounded-lg hover:opacity-95 disabled:opacity-60 whitespace-nowrap cursor-pointer"
                    style={{ backgroundColor: accent }}
                  >
                    {submittingBooking
                      ? 'Submitting...'
                      : bookingPaymentMethod === 'upi' && upiEnabled
                        ? 'I Have Paid'
                        : 'Submit Booking Request'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Per-Restaurant Member Account & Rewards Drawer */}
      <CustomerAccountDrawer
        open={accountDrawerOpen}
        onClose={() => setAccountDrawerOpen(false)}
        shop={shop}
        user={user}
        customer={customerProfile}
        customerLoading={customerLoading}
        customerOrders={customerOrders}
        authError={authError}
        onSignInWithGoogle={signInWithGoogle}
        onSignOut={signOutUser}
        onSelectOrderToTrack={handleSelectOrderToTrack}
        accentColor={accent}
      />

      <footer className="bg-white border-t border-slate-200 py-5 px-4 sm:px-6 lg:px-8 text-center text-xs text-slate-500">
        {shop.name} · Powered by HostGrid
      </footer>
    </div>
  );
};
