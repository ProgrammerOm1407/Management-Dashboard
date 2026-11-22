import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  BedDouble,
  ClipboardList,
  Clock,
  Flame,
  History,
  LayoutGrid,
  List,
  Minus,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  UtensilsCrossed,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { NavItem, WorkspaceShell } from '../components/WorkspaceShell';
import { MenuManager } from '../components/owner/MenuManager';
import { FrontDeskPanel } from '../components/server/FrontDeskPanel';
import { PaymentVerificationSidebar } from '../components/PaymentVerificationSidebar';
import {
  cancelOrder,
  createShopOrder,
  subscribeMenuItems,
  subscribeRoomBookings,
  subscribeShopById,
  subscribeShopOrders,
  subscribeShopRooms,
  updateOrderStatus,
} from '../lib/firestoreService';
import { getTodayIso } from '../lib/dateUtils';
import { playNewOrderChime } from '../lib/sound';
import { getEffectivePaymentMethod, getEffectivePaymentStatus } from '../lib/upi';
import { formatCurrency, formatTimeAgo } from '../lib/validation';
import {
  KITCHEN_KANBAN_STAGES,
  MenuItem,
  NEXT_ORDER_STATUS,
  Order,
  OrderItem,
  OrderStatus,
  Room,
  RoomBooking,
  Shop,
} from '../types';

type ServerTab = 'orders' | 'front_desk' | 'menu';
type BoardFilter = 'all' | 'pending' | 'preparing' | 'ready' | 'urgent' | 'history';
type CardDensity = 'comfortable' | 'compact';

const SOUND_PREF_KEY = 'hostgrid_kitchen_sound';
const DENSITY_PREF_KEY = 'hostgrid_kitchen_density';

const STATUS_META: Record<
  OrderStatus,
  {
    label: string;
    headerColor: string;
    buttonStyle: string;
    nextActionLabel: string | null;
  }
> = {
  pending: {
    label: 'Pending',
    headerColor: 'text-amber-800',
    buttonStyle: 'bg-slate-900 hover:bg-slate-800 text-white',
    nextActionLabel: 'Start Preparing',
  },
  preparing: {
    label: 'Preparing',
    headerColor: 'text-blue-800',
    buttonStyle: 'bg-blue-700 hover:bg-blue-800 text-white',
    nextActionLabel: 'Mark Ready',
  },
  ready: {
    label: 'Ready for Pickup',
    headerColor: 'text-emerald-800',
    buttonStyle: 'bg-emerald-700 hover:bg-emerald-800 text-white',
    nextActionLabel: 'Mark Served',
  },
  served: {
    label: 'Served',
    headerColor: 'text-indigo-700',
    buttonStyle: 'bg-slate-900 hover:bg-slate-800 text-white',
    nextActionLabel: null,
  },
  paid: {
    label: 'Paid',
    headerColor: 'text-slate-500',
    buttonStyle: 'bg-slate-900 text-white',
    nextActionLabel: null,
  },
  cancelled: {
    label: 'Cancelled',
    headerColor: 'text-red-700',
    buttonStyle: 'bg-red-700 text-white',
    nextActionLabel: null,
  },
};

function getTimestampMs(ts: unknown): number | null {
  if (ts && typeof (ts as { toMillis?: () => number }).toMillis === 'function') {
    return (ts as { toMillis: () => number }).toMillis();
  }
  return null;
}

function formatElapsedMins(mins: number): string {
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

export const ServerPage: React.FC = () => {
  const { user, profile, signOutUser } = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Only Shop Owners and Super Admins can confirm or mark payments settled (also enforced in Firestore rules)
  const canSettlePayment = profile?.role === 'owner' || profile?.role === 'super_admin';

  const targetShopId =
    profile?.role === 'super_admin'
      ? searchParams.get('shop') || profile.shop_id
      : profile?.shop_id || null;

  const [shop, setShop] = useState<Shop | null>(null);
  const [shopLoading, setShopLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ServerTab>('orders');

  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [liveConnected, setLiveConnected] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Optimized KDS Controls
  const [boardFilter, setBoardFilter] = useState<BoardFilter>('all');
  const [kitchenSearch, setKitchenSearch] = useState('');
  const [selectedDishFilter, setSelectedDishFilter] = useState<string | null>(null);
  const [density, setDensity] = useState<CardDensity>(() => {
    try {
      const saved = window.localStorage.getItem(DENSITY_PREF_KEY);
      return saved === 'compact' ? 'compact' : 'comfortable';
    } catch {
      return 'comfortable';
    }
  });
  const [desktopPaymentDockOpen, setDesktopPaymentDockOpen] = useState(true);
  const [mobilePaymentDrawerOpen, setMobilePaymentDrawerOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const updateDensity = (next: CardDensity) => {
    setDensity(next);
    try {
      window.localStorage.setItem(DENSITY_PREF_KEY, next);
    } catch {
      // ignore storage errors
    }
  };

  // Audio chime + visual highlight for incoming orders
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    try {
      const saved = window.localStorage.getItem(SOUND_PREF_KEY);
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  const [highlightedIds, setHighlightedIds] = useState<Record<string, 'new' | 'added' | 'upi'>>({});
  const highlightTimersRef = useRef<Record<string, number>>({});
  const orderTotalsRef = useRef<
    Record<string, { total: number; qty: number; payStatus: string }>
  >({});

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);

  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomBookings, setRoomBookings] = useState<RoomBooking[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);

  // New Walk-In Order Drawer
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [tableOrRoom, setTableOrRoom] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [draftCart, setDraftCart] = useState<Record<string, number>>({});
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      Object.values(highlightTimersRef.current).forEach((id) => window.clearTimeout(id));
      highlightTimersRef.current = {};
    };
  }, []);

  const toggleSound = () => {
    setSoundEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SOUND_PREF_KEY, String(next));
      } catch {
        // ignore storage errors
      }
      if (next) {
        playNewOrderChime();
      }
      return next;
    });
  };

  useEffect(() => {
    if (!targetShopId) {
      setShopLoading(false);
      return;
    }
    setShopLoading(true);
    const unsub = subscribeShopById(
      targetShopId,
      (nextShop) => {
        setShop(nextShop);
        setShopLoading(false);
      },
      () => setShopLoading(false)
    );
    return () => unsub();
  }, [targetShopId]);

  useEffect(() => {
    if (!shop?.id || !shop.modules?.orders) {
      setOrders([]);
      setOrdersLoading(false);
      setLiveConnected(false);
      return;
    }
    setOrdersLoading(true);
    const unsub = subscribeShopOrders(
      shop.id,
      (list, changes, isInitial) => {
        setOrders(list);
        setOrdersLoading(false);
        setLiveConnected(true);
        if (!isInitial && changes.length > 0) {
          let playedChime = false;
          changes.forEach((change) => {
            if (change.order.status === 'cancelled') return;
            const orderId = change.order.id;
            const nextQty = change.order.items.reduce((sum, i) => sum + i.quantity, 0);
            const nextPayStatus = getEffectivePaymentStatus(
              change.order.payment_status,
              change.order.status
            );
            const prevMeta = orderTotalsRef.current[orderId];
            const isAddOn =
              change.type === 'modified' &&
              Boolean(prevMeta) &&
              (change.order.total_amount > prevMeta.total || nextQty > prevMeta.qty);
            const isUpiSubmitted =
              change.type === 'modified' &&
              Boolean(prevMeta) &&
              !isAddOn &&
              getEffectivePaymentMethod(change.order.payment_method) === 'upi' &&
              nextPayStatus === 'verification_pending' &&
              prevMeta.payStatus !== 'verification_pending';

            if (change.type === 'added' || isAddOn || isUpiSubmitted) {
              if (soundEnabledRef.current && !playedChime) {
                playNewOrderChime();
                playedChime = true;
              }
              setHighlightedIds((prev) => ({
                ...prev,
                [orderId]: isUpiSubmitted ? 'upi' : isAddOn ? 'added' : 'new',
              }));
              if (highlightTimersRef.current[orderId]) {
                window.clearTimeout(highlightTimersRef.current[orderId]);
              }
              highlightTimersRef.current[orderId] = window.setTimeout(() => {
                setHighlightedIds((prev) => {
                  const copy = { ...prev };
                  delete copy[orderId];
                  return copy;
                });
                delete highlightTimersRef.current[orderId];
              }, 12000);

              pushToast(
                isUpiSubmitted
                  ? `UPI Payment Submitted · ${change.order.order_number}`
                  : isAddOn
                    ? `Items Added to ${change.order.order_number}`
                    : `Incoming Order ${change.order.order_number}`,
                isUpiSubmitted
                  ? `${change.order.table_or_room} · Full bill ${formatCurrency(change.order.total_amount)}${change.order.utr_number ? ` · UTR ${change.order.utr_number}` : ''}`
                  : isAddOn
                    ? `${change.order.customer_name} · ${change.order.table_or_room} · New total ${formatCurrency(change.order.total_amount)}`
                    : `${change.order.customer_name} · ${change.order.table_or_room}`,
                'success'
              );
            }
          });
        }
        const nextSnapshotTotals: Record<
          string,
          { total: number; qty: number; payStatus: string }
        > = {};
        list.forEach((o) => {
          nextSnapshotTotals[o.id] = {
            total: o.total_amount,
            qty: o.items.reduce((sum, i) => sum + i.quantity, 0),
            payStatus: getEffectivePaymentStatus(o.payment_status, o.status),
          };
        });
        orderTotalsRef.current = nextSnapshotTotals;
      },
      () => {
        setOrdersLoading(false);
        setLiveConnected(false);
      }
    );
    return () => unsub();
  }, [shop?.id, shop?.modules?.orders, pushToast]);

  useEffect(() => {
    if (!shop?.id || !shop.modules?.menu) {
      setMenuItems([]);
      setMenuLoading(false);
      return;
    }
    setMenuLoading(true);
    const unsub = subscribeMenuItems(shop.id, (list) => {
      setMenuItems(list);
      setMenuLoading(false);
    });
    return () => unsub();
  }, [shop?.id, shop?.modules?.menu]);

  useEffect(() => {
    if (!shop?.id || !shop.modules?.rooms) {
      setRooms([]);
      setRoomBookings([]);
      setRoomsLoading(false);
      return;
    }
    setRoomsLoading(true);
    const unsubRooms = subscribeShopRooms(shop.id, (list) => {
      setRooms(list);
      setRoomsLoading(false);
    });
    const unsubBookings = subscribeRoomBookings(shop.id, (list) => {
      setRoomBookings(list);
    });
    return () => {
      unsubRooms();
      unsubBookings();
    };
  }, [shop?.id, shop?.modules?.rooms]);

  const navItems: NavItem[] = useMemo(() => {
    if (!shop) return [];
    const items: NavItem[] = [];
    if (shop.modules?.orders) {
      const activeKitchenCount = orders.filter(
        (o) => o.status === 'pending' || o.status === 'preparing' || o.status === 'ready'
      ).length;
      items.push({
        id: 'orders',
        label: 'Kitchen Board',
        icon: ClipboardList,
        count: activeKitchenCount,
      });
    }
    if (shop.modules?.rooms) {
      const todayIso = getTodayIso();
      const deskActionCount = roomBookings.filter(
        (b) =>
          b.status === 'pending' ||
          (b.check_in === todayIso && b.status === 'confirmed') ||
          (b.check_out === todayIso && b.status === 'checked_in')
      ).length;
      items.push({ id: 'front_desk', label: 'Front Desk', icon: BedDouble, count: deskActionCount });
    }
    if (shop.modules?.menu) {
      items.push({
        id: 'menu',
        label: 'Menu (Read-Only)',
        icon: UtensilsCrossed,
        count: menuItems.length,
      });
    }
    return items;
  }, [shop, orders, roomBookings, menuItems.length]);

  useEffect(() => {
    if (navItems.length > 0 && !navItems.some((n) => n.id === activeTab)) {
      setActiveTab(navItems[0].id as ServerTab);
    }
  }, [navItems, activeTab]);

  const availableMenu = useMemo(
    () =>
      menuItems.filter(
        (item) =>
          item.is_available &&
          (item.stock_count === undefined || item.stock_count === null || item.stock_count > 0)
      ),
    [menuItems]
  );

  const draftItems: OrderItem[] = useMemo(() => {
    return Object.entries(draftCart)
      .filter(([, qty]) => qty > 0)
      .map(([menuId, qty]) => {
        const found = menuItems.find((m) => m.id === menuId);
        if (!found) return null;
        return {
          menu_item_id: found.id,
          name: found.name,
          price: found.price,
          quantity: qty,
        };
      })
      .filter((x): x is OrderItem => x !== null);
  }, [draftCart, menuItems]);

  const draftTotal = useMemo(
    () => draftItems.reduce((sum, i) => sum + i.price * i.quantity, 0),
    [draftItems]
  );

  // Live Aggregated Prep Queue (Pending + Preparing) for Batch Cooking
  const prepQueue = useMemo(() => {
    const counts = new Map<string, { name: string; pendingQty: number; preparingQty: number }>();
    orders.forEach((order) => {
      if (order.status !== 'pending' && order.status !== 'preparing') return;
      order.items.forEach((item) => {
        const key = item.name.trim();
        const prev = counts.get(key) || { name: key, pendingQty: 0, preparingQty: 0 };
        if (order.status === 'pending') {
          prev.pendingQty += item.quantity;
        } else {
          prev.preparingQty += item.quantity;
        }
        counts.set(key, prev);
      });
    });
    return Array.from(counts.values())
      .map((entry) => ({
        ...entry,
        totalQty: entry.pendingQty + entry.preparingQty,
      }))
      .sort((a, b) => b.totalQty - a.totalQty || a.name.localeCompare(b.name));
  }, [orders]);

  // Clear dish filter automatically if all orders with that dish have moved to Ready/Served
  useEffect(() => {
    if (selectedDishFilter && !prepQueue.some((p) => p.name === selectedDishFilter)) {
      setSelectedDishFilter(null);
    }
  }, [prepQueue, selectedDishFilter]);

  const totalPrepUnits = useMemo(
    () => prepQueue.reduce((sum, item) => sum + item.totalQty, 0),
    [prepQueue]
  );

  const kitchenMetrics = useMemo(() => {
    let pendingCount = 0;
    let preparingCount = 0;
    let readyCount = 0;
    let servedCount = 0;
    let servedUpiPending = 0;
    let urgentCount = 0;
    let historyCount = 0;

    orders.forEach((o) => {
      if (o.status === 'paid' || o.status === 'cancelled') {
        historyCount += 1;
        return;
      }
      if (o.status === 'served') {
        servedCount += 1;
        const pMethod = getEffectivePaymentMethod(o.payment_method);
        const pStatus = getEffectivePaymentStatus(o.payment_status, o.status);
        if (pMethod === 'upi' && pStatus === 'verification_pending') {
          servedUpiPending += 1;
        }
        return;
      }
      if (o.status === 'pending') pendingCount += 1;
      if (o.status === 'preparing') preparingCount += 1;
      if (o.status === 'ready') readyCount += 1;

      const createdMs = getTimestampMs(o.created_at);
      if (createdMs !== null && nowMs - createdMs >= 10 * 60_000) {
        urgentCount += 1;
      }
    });

    return {
      pendingCount,
      preparingCount,
      readyCount,
      activeKitchenTotal: pendingCount + preparingCount + readyCount,
      servedCount,
      servedUpiPending,
      urgentCount,
      historyCount,
    };
  }, [orders, nowMs]);

  const searchFilteredOrders = useMemo(() => {
    const q = kitchenSearch.trim().toLowerCase();
    return orders.filter((o) => {
      if (selectedDishFilter) {
        const hasDish = o.items.some((item) => item.name.trim() === selectedDishFilter);
        if (!hasDish) return false;
      }
      if (!q) return true;
      return (
        o.order_number.toLowerCase().includes(q) ||
        o.table_or_room.toLowerCase().includes(q) ||
        o.customer_name.toLowerCase().includes(q) ||
        (o.customer_phone && o.customer_phone.toLowerCase().includes(q)) ||
        o.items.some((item) => item.name.toLowerCase().includes(q))
      );
    });
  }, [orders, kitchenSearch, selectedDishFilter]);

  const historyOrders = useMemo(
    () => searchFilteredOrders.filter((o) => o.status === 'paid' || o.status === 'cancelled'),
    [searchFilteredOrders]
  );

  const handleAdvanceStatus = async (order: Order) => {
    if (!shop) return;
    const nextStatus = NEXT_ORDER_STATUS[order.status];
    if (!nextStatus) return;

    if (nextStatus === 'paid' && !canSettlePayment) {
      pushToast(
        'Owner permission required',
        'Only the Shop Owner can mark bills as Paid.',
        'error'
      );
      return;
    }

    const alreadyPaid = getEffectivePaymentStatus(order.payment_status, order.status) === 'paid';
    setUpdatingOrderId(order.id);
    try {
      await updateOrderStatus(shop.id, order.id, nextStatus, alreadyPaid);
      pushToast(
        `${order.order_number} → ${STATUS_META[nextStatus].label}`,
        nextStatus === 'served'
          ? `${order.table_or_room} moved to Payment Verification sidebar.`
          : `${order.customer_name} (${order.table_or_room})`,
        'info'
      );
    } catch (err) {
      pushToast(
        'Status update failed',
        err instanceof Error ? err.message : 'Unable to update order.',
        'error'
      );
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const handleCancelPendingOrder = async (order: Order) => {
    if (!shop) return;
    setCancellingId(order.id);
    try {
      await cancelOrder(shop.id, order.id);
      setConfirmCancelId(null);
      pushToast(
        `${order.order_number} cancelled`,
        `Mistaken ticket for ${order.table_or_room} removed from kitchen queue.`,
        'info'
      );
    } catch (err) {
      pushToast(
        'Cancel failed',
        err instanceof Error ? err.message : 'Unable to cancel this order.',
        'error'
      );
    } finally {
      setCancellingId(null);
    }
  };

  const adjustDraftQty = (itemId: string, delta: number) => {
    setDraftCart((prev) => {
      const next = Math.max(0, Math.min(99, (prev[itemId] || 0) + delta));
      if (next === 0) {
        const copy = { ...prev };
        delete copy[itemId];
        return copy;
      }
      return { ...prev, [itemId]: next };
    });
  };

  const handleCreateServerOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shop) return;
    setOrderError(null);
    if (draftItems.length === 0) {
      setOrderError('Select at least one menu item for this order.');
      return;
    }

    setSubmittingOrder(true);
    try {
      const created = await createShopOrder(shop.id, {
        customer_name: customerName,
        customer_phone: customerPhone.trim() || null,
        table_or_room: tableOrRoom,
        items: draftItems,
        notes: orderNotes,
        source: 'server',
        created_by_uid: user?.uid || null,
      });
      pushToast(
        `Order ${created.order_number} created`,
        `Queued in Pending for ${customerName.trim()}.`,
        'success'
      );
      setCustomerName('');
      setCustomerPhone('');
      setTableOrRoom('');
      setOrderNotes('');
      setDraftCart({});
      setNewOrderOpen(false);
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : 'Failed to create order.');
    } finally {
      setSubmittingOrder(false);
    }
  };

  if (shopLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <p className="text-sm text-slate-600">Loading server workspace...</p>
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 text-center">
          <h1 className="font-display text-lg font-semibold text-slate-900">
            No shop workspace assigned
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Your server account must be linked to an active shop to access the order board.
          </p>
          <div className="mt-5 flex justify-center gap-3">
            {profile?.role === 'super_admin' && (
              <button
                type="button"
                onClick={() => navigate('/super-admin')}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg cursor-pointer"
              >
                Back to Super Admin
              </button>
            )}
            <button
              type="button"
              onClick={() => void signOutUser()}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const visibleColumns: OrderStatus[] =
    boardFilter === 'all' || boardFilter === 'urgent'
      ? KITCHEN_KANBAN_STAGES
      : boardFilter === 'history'
        ? []
        : [boardFilter];

  const isCompact = density === 'compact';

  return (
    <WorkspaceShell
      brandName={shop.name}
      brandLogoUrl={shop.logo_url}
      accentColor={shop.primary_color}
      roleLabel={
        profile?.role === 'super_admin'
          ? 'Super Admin (Staff View)'
          : profile?.role === 'owner'
            ? 'Shop Owner (Kitchen View)'
            : shop.modules?.rooms
              ? 'Server & Reception'
              : 'Server Staff'
      }
      userEmail={profile?.email || ''}
      navItems={navItems}
      activeNavId={activeTab}
      onSelectNav={(id) => setActiveTab(id as ServerTab)}
      breadcrumbSection={shop.name}
      breadcrumbCurrent={
        activeTab === 'orders'
          ? 'Kitchen Display Board'
          : activeTab === 'front_desk'
            ? 'Front Desk & Reception'
            : 'Menu Reference'
      }
      onSignOut={() => void signOutUser()}
      headerActions={
        shop.modules?.orders && activeTab === 'orders' ? (
          <div className="flex items-center gap-2">
            {/* Mobile/Tablet Payment Verification Drawer Trigger */}
            <button
              type="button"
              onClick={() => setMobilePaymentDrawerOpen(true)}
              className={`xl:hidden inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border whitespace-nowrap shrink-0 cursor-pointer ${
                kitchenMetrics.servedUpiPending > 0
                  ? 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100/70'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">Payment Verification</span>
              <span className="font-mono tabular-nums">{kitchenMetrics.servedCount}</span>
            </button>

            {/* Desktop Dock Toggle */}
            <button
              type="button"
              onClick={() => setDesktopPaymentDockOpen((prev) => !prev)}
              className={`hidden xl:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                kitchenMetrics.servedUpiPending > 0
                  ? 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100/70'
                  : desktopPaymentDockOpen
                    ? 'bg-slate-100 border-slate-300 text-slate-900 hover:bg-slate-200/70'
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span>Payment Verification</span>
              <span className="font-mono tabular-nums">({kitchenMetrics.servedCount})</span>
            </button>

            <button
              type="button"
              onClick={toggleSound}
              title={soundEnabled ? 'Mute incoming order chime' : 'Enable incoming order chime'}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {soundEnabled ? (
                <Volume2 className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <VolumeX className="w-3.5 h-3.5 text-slate-400" />
              )}
              <span className="hidden md:inline">{soundEnabled ? 'Chime On' : 'Muted'}</span>
            </button>

            <button
              type="button"
              disabled={!shop.is_active}
              onClick={() => {
                setOrderError(null);
                setNewOrderOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white rounded-lg hover:opacity-95 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              style={{ backgroundColor: shop.primary_color || '#0F172A' }}
            >
              <Plus className="w-4 h-4" />
              New Order
            </button>
          </div>
        ) : undefined
      }
      sidebarFooterExtra={
        profile?.role === 'super_admin' ? (
          <button
            type="button"
            onClick={() => navigate('/super-admin')}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Super Admin
          </button>
        ) : profile?.role === 'owner' ? (
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Owner Dashboard
          </button>
        ) : undefined
      }
    >
      {activeTab === 'orders' && shop.modules?.orders && (
        <div className="flex flex-col xl:flex-row items-start gap-5">
          {/* Primary Kitchen Kanban Workspace */}
          <div className="flex-1 min-w-0 w-full space-y-4">
            {/* Live KDS Header & Search */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <h2 className="font-display text-lg font-semibold text-slate-900">
                    Kitchen Kanban
                  </h2>
                  {liveConnected && (
                    <span className="text-xs font-medium text-emerald-700">
                      · FIFO queue synced
                    </span>
                  )}
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    · {kitchenMetrics.activeKitchenTotal} active
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Oldest tickets stay on top. Marking an order{' '}
                  <span className="font-medium text-slate-700">Served</span> hands it to Payment
                  Verification.
                </p>
              </div>

              <div className="flex items-center gap-2 w-full lg:w-auto">
                <div className="relative flex-1 lg:w-64">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={kitchenSearch}
                    onChange={(e) => setKitchenSearch(e.target.value)}
                    placeholder="Search table, order #, dish..."
                    className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                  />
                </div>

                {/* Density Toggle (Comfortable / Compact) */}
                <div
                  className="inline-flex items-center p-0.5 bg-slate-200/70 rounded-lg shrink-0"
                  role="group"
                  aria-label="Ticket density"
                >
                  <button
                    type="button"
                    onClick={() => updateDensity('comfortable')}
                    title="Comfortable view"
                    className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                      !isCompact
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => updateDensity('compact')}
                    title="Compact rush-hour view"
                    className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                      isCompact
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <List className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Interactive Batch-Cooking Prep Queue (Pending + Preparing Aggregated) */}
            {prepQueue.length > 0 && boardFilter !== 'history' && (
              <div className="bg-slate-900 text-white rounded-lg px-4 py-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    <Flame className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>Batch Prep Queue</span>
                    <span className="text-[11px] font-normal text-slate-400 hidden sm:inline">
                      · Click a dish to focus matching tickets
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {selectedDishFilter && (
                      <button
                        type="button"
                        onClick={() => setSelectedDishFilter(null)}
                        className="text-[11px] font-semibold text-amber-300 hover:text-amber-200 underline cursor-pointer"
                      >
                        Clear filter ({selectedDishFilter})
                      </button>
                    )}
                    <span className="font-mono text-[11px] text-slate-300 tabular-nums">
                      {totalPrepUnits} {totalPrepUnits === 1 ? 'portion' : 'portions'} ·{' '}
                      {prepQueue.length} {prepQueue.length === 1 ? 'dish' : 'dishes'}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {prepQueue.slice(0, 14).map((item) => {
                    const isSelected = selectedDishFilter === item.name;
                    return (
                      <button
                        key={item.name}
                        type="button"
                        onClick={() =>
                          setSelectedDishFilter((prev) => (prev === item.name ? null : item.name))
                        }
                        title={`${item.pendingQty} pending · ${item.preparingQty} preparing`}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-amber-400 text-slate-950 border-amber-300 font-semibold'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-700'
                        }`}
                      >
                        <span
                          className={`font-mono font-bold tabular-nums ${
                            isSelected ? 'text-slate-950' : 'text-amber-300'
                          }`}
                        >
                          {item.totalQty}×
                        </span>
                        <span>{item.name}</span>
                      </button>
                    );
                  })}
                  {prepQueue.length > 14 && (
                    <span className="text-[11px] text-slate-400 pl-1">
                      +{prepQueue.length - 14} more
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Stage Filter Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg overflow-x-auto max-w-full">
                {(
                  [
                    { id: 'all', label: `All Kitchen (${kitchenMetrics.activeKitchenTotal})` },
                    { id: 'pending', label: `Pending (${kitchenMetrics.pendingCount})` },
                    { id: 'preparing', label: `Preparing (${kitchenMetrics.preparingCount})` },
                    { id: 'ready', label: `Ready (${kitchenMetrics.readyCount})` },
                    {
                      id: 'urgent',
                      label:
                        kitchenMetrics.urgentCount > 0
                          ? `Urgent (${kitchenMetrics.urgentCount})`
                          : 'Urgent',
                    },
                    { id: 'history', label: `History (${kitchenMetrics.historyCount})` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setBoardFilter(tab.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      boardFilter === tab.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : tab.id === 'urgent' && kitchenMetrics.urgentCount > 0
                          ? 'text-red-700 font-semibold hover:text-red-800'
                          : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {ordersLoading ? (
              <div className="grid md:grid-cols-3 gap-4">
                {[1, 2, 3].map((col) => (
                  <div
                    key={col}
                    className="h-72 bg-white border border-slate-200 rounded-lg animate-pulse"
                  />
                ))}
              </div>
            ) : boardFilter === 'history' ? (
              /* Settled & Cancelled History Table */
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                    <History className="w-4 h-4 text-slate-500" />
                    <span>Paid & Cancelled Tickets</span>
                  </div>
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    {historyOrders.length} {historyOrders.length === 1 ? 'record' : 'records'}
                  </span>
                </div>
                {historyOrders.length === 0 ? (
                  <div className="p-10 text-center text-xs text-slate-500">
                    No settled or cancelled tickets yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/50 text-xs font-medium text-slate-500">
                          <th className="py-2.5 px-4">Order</th>
                          <th className="py-2.5 px-4">Table & Guest</th>
                          <th className="py-2.5 px-4">Items</th>
                          <th className="py-2.5 px-4">Status</th>
                          <th className="py-2.5 px-4 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-xs">
                        {historyOrders.map((o) => {
                          const createdDate =
                            o.created_at && typeof o.created_at.toDate === 'function'
                              ? o.created_at.toDate()
                              : null;
                          const isCancelled = o.status === 'cancelled';
                          const payMethod = getEffectivePaymentMethod(o.payment_method);
                          return (
                            <tr key={o.id} className="hover:bg-slate-50/60">
                              <td className="py-3 px-4 whitespace-nowrap">
                                <p
                                  className={`font-mono font-semibold tabular-nums ${
                                    isCancelled ? 'text-slate-400 line-through' : 'text-slate-900'
                                  }`}
                                >
                                  {o.order_number}
                                </p>
                                <p className="text-[11px] text-slate-400">
                                  {formatTimeAgo(createdDate)}
                                </p>
                              </td>
                              <td className="py-3 px-4">
                                <p className="font-medium text-slate-900">{o.table_or_room}</p>
                                <p className="text-slate-500">{o.customer_name}</p>
                              </td>
                              <td className="py-3 px-4 text-slate-600 max-w-xs truncate">
                                {o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                {isCancelled ? (
                                  <span className="font-semibold text-red-700">Cancelled</span>
                                ) : (
                                  <span className="font-semibold text-emerald-700">
                                    Paid · {payMethod === 'upi' ? 'UPI' : 'Cash'}
                                  </span>
                                )}
                              </td>
                              <td
                                className={`py-3 px-4 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                                  isCancelled ? 'text-slate-400 line-through' : 'text-slate-900'
                                }`}
                              >
                                {formatCurrency(o.total_amount)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : (
              /* Optimized 3-Column Pure Kitchen Kanban (Pending -> Preparing -> Ready) */
              <div
                className={`grid gap-4 items-start ${
                  visibleColumns.length === 1
                    ? 'grid-cols-1 max-w-2xl'
                    : 'grid-cols-1 md:grid-cols-3'
                }`}
              >
                {visibleColumns.map((stage) => {
                  const rawStageOrders = searchFilteredOrders.filter((o) => {
                    if (o.status !== stage) return false;
                    if (boardFilter !== 'urgent') return true;
                    const createdMs = getTimestampMs(o.created_at);
                    return createdMs !== null && nowMs - createdMs >= 10 * 60_000;
                  });

                  // FIFO oldest-first ordering so long-waiting tickets never get buried
                  const stageOrders = [...rawStageOrders].sort((a, b) => {
                    const tA = getTimestampMs(a.created_at) ?? 0;
                    const tB = getTimestampMs(b.created_at) ?? 0;
                    return tA - tB;
                  });

                  const columnUnits = stageOrders.reduce(
                    (sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0),
                    0
                  );
                  const meta = STATUS_META[stage];

                  return (
                    <div
                      key={stage}
                      className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col"
                    >
                      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between gap-2">
                        <h3 className={`font-display text-xs font-semibold ${meta.headerColor}`}>
                          {meta.label}
                        </h3>
                        <span className="font-mono text-[11px] font-semibold text-slate-600 tabular-nums whitespace-nowrap">
                          {stageOrders.length} {stageOrders.length === 1 ? 'ticket' : 'tickets'}
                          {columnUnits > 0 ? ` · ${columnUnits} items` : ''}
                        </span>
                      </div>

                      {stageOrders.length === 0 ? (
                        <div className="p-8 text-center text-xs text-slate-400">
                          {selectedDishFilter
                            ? `No ${meta.label.toLowerCase()} tickets with ${selectedDishFilter}`
                            : boardFilter === 'urgent'
                              ? `No urgent ${meta.label.toLowerCase()} tickets`
                              : `No ${meta.label.toLowerCase()} tickets`}
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-200">
                          {stageOrders.map((order) => {
                            const createdMs = getTimestampMs(order.created_at);
                            const waitMins =
                              createdMs !== null
                                ? Math.max(0, Math.floor((nowMs - createdMs) / 60_000))
                                : 0;
                            const isUpdating = updatingOrderId === order.id;
                            const highlightKind = highlightedIds[order.id];
                            const isNewHighlight = Boolean(highlightKind);
                            const isOverdue = waitMins >= 20;
                            const isAging = waitMins >= 10 && waitMins < 20;

                            return (
                              <div
                                key={order.id}
                                className={`${isCompact ? 'p-3 space-y-2' : 'p-4 space-y-3'} transition-colors duration-200 ${
                                  isNewHighlight
                                    ? 'bg-amber-50/75 ring-2 ring-inset ring-amber-400'
                                    : isOverdue
                                      ? 'bg-red-50/45'
                                      : isAging
                                        ? 'bg-amber-50/40'
                                        : 'bg-white'
                                }`}
                              >
                                {/* Ticket Header: Table / Order # / Elapsed Timer */}
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="text-sm font-bold text-slate-900">
                                        {order.table_or_room}
                                      </span>
                                      <span className="text-slate-300">·</span>
                                      <span className="font-mono text-xs font-semibold text-slate-600 tabular-nums">
                                        {order.order_number}
                                      </span>
                                      {isNewHighlight && (
                                        <span className="text-[11px] font-semibold text-amber-800">
                                          · {highlightKind === 'added' ? 'Add-on' : 'New'}
                                        </span>
                                      )}
                                    </div>
                                    {!isCompact && (
                                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 mt-0.5">
                                        <span className="truncate">{order.customer_name}</span>
                                        {order.customer_phone && (
                                          <a
                                            href={`tel:${order.customer_phone}`}
                                            className="inline-flex items-center gap-1 font-mono text-[11px] text-blue-700 hover:underline"
                                          >
                                            <Phone className="w-3 h-3" />
                                            {order.customer_phone}
                                          </a>
                                        )}
                                      </div>
                                    )}
                                  </div>

                                  <div className="text-right shrink-0">
                                    <span
                                      className={`inline-flex items-center gap-1 font-mono text-xs font-semibold tabular-nums ${
                                        isOverdue
                                          ? 'text-red-700'
                                          : isAging
                                            ? 'text-amber-700'
                                            : 'text-slate-600'
                                      }`}
                                    >
                                      <Clock className="w-3 h-3" />
                                      {formatElapsedMins(waitMins)}
                                    </span>
                                    {!isCompact && (
                                      <p className="font-mono text-[11px] text-slate-500 tabular-nums mt-0.5">
                                        {formatCurrency(order.total_amount)}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                {/* High-Readability Kitchen Line Items */}
                                <ul
                                  className={`${isCompact ? 'space-y-1 text-xs' : 'space-y-1.5 text-sm'} text-slate-800`}
                                >
                                  {order.items.map((item, idx) => {
                                    const isMatchedDish =
                                      selectedDishFilter !== null &&
                                      item.name.trim() === selectedDishFilter;
                                    return (
                                      <li
                                        key={`${item.menu_item_id}-${idx}`}
                                        className={`flex items-start gap-2 leading-snug rounded ${
                                          isMatchedDish
                                            ? 'bg-amber-100/80 px-1.5 py-0.5 -mx-1.5'
                                            : ''
                                        }`}
                                      >
                                        <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 tabular-nums shrink-0">
                                          {item.quantity}×
                                        </span>
                                        <span className="font-medium text-slate-900">
                                          {item.name}
                                        </span>
                                      </li>
                                    );
                                  })}
                                </ul>

                                {order.notes && (
                                  <p className="text-xs text-amber-950 bg-amber-50/80 border border-amber-200 rounded px-2.5 py-1.5 leading-relaxed">
                                    <span className="font-semibold">Note:</span> {order.notes}
                                  </p>
                                )}

                                {/* Primary 1-Click Stage Bump Action */}
                                {meta.nextActionLabel && (
                                  <button
                                    type="button"
                                    disabled={isUpdating}
                                    onClick={() => void handleAdvanceStatus(order)}
                                    className={`w-full inline-flex items-center justify-center gap-1.5 px-3 ${
                                      isCompact ? 'py-1.5' : 'py-2'
                                    } text-xs font-semibold rounded-lg transition-colors disabled:opacity-60 cursor-pointer ${meta.buttonStyle}`}
                                  >
                                    <span>{isUpdating ? 'Updating...' : meta.nextActionLabel}</span>
                                    <ArrowRight className="w-3.5 h-3.5" />
                                  </button>
                                )}

                                {/* Mistaken Pending Order Cancel Action */}
                                {order.status === 'pending' && (
                                  <div>
                                    {confirmCancelId === order.id ? (
                                      <div className="flex items-center gap-2 pt-0.5">
                                        <button
                                          type="button"
                                          disabled={cancellingId === order.id}
                                          onClick={() => void handleCancelPendingOrder(order)}
                                          className="flex-1 px-2.5 py-1.5 text-[11px] font-semibold text-white bg-red-700 hover:bg-red-800 disabled:opacity-60 rounded-md cursor-pointer"
                                        >
                                          {cancellingId === order.id
                                            ? 'Cancelling...'
                                            : 'Confirm Cancel'}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setConfirmCancelId(null)}
                                          className="px-2.5 py-1.5 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                                        >
                                          Keep
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => setConfirmCancelId(order.id)}
                                        className="w-full inline-flex items-center justify-center gap-1 text-[11px] font-medium text-slate-500 hover:text-red-700 py-0.5 transition-colors cursor-pointer"
                                      >
                                        <Ban className="w-3 h-3" />
                                        Cancel mistaken ticket
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Docked Payment Verification Sidebar (Desktop xl+) */}
          {desktopPaymentDockOpen && (
            <aside
              className="hidden xl:block w-[340px] 2xl:w-[376px] shrink-0 sticky top-20"
              aria-label="Payment Verification Sidebar"
            >
              <PaymentVerificationSidebar
                shop={shop}
                orders={orders}
                canSettlePayment={canSettlePayment}
                mode="docked"
                nowMs={nowMs}
                highlightedIds={highlightedIds}
              />
            </aside>
          )}
        </div>
      )}

      {activeTab === 'front_desk' && shop.modules?.rooms && (
        <FrontDeskPanel
          shop={shop}
          rooms={rooms}
          bookings={roomBookings}
          loading={roomsLoading}
          canSettlePayment={canSettlePayment}
        />
      )}

      {activeTab === 'menu' && shop.modules?.menu && (
        <MenuManager shop={shop} items={menuItems} loading={menuLoading} readOnly={true} />
      )}

      {/* Mobile/Tablet Slide-Over Payment Verification Drawer */}
      {shop.modules?.orders && (
        <PaymentVerificationSidebar
          shop={shop}
          orders={orders}
          canSettlePayment={canSettlePayment}
          mode="drawer"
          open={mobilePaymentDrawerOpen}
          onClose={() => setMobilePaymentDrawerOpen(false)}
          nowMs={nowMs}
          highlightedIds={highlightedIds}
        />
      )}

      {/* Server New Order Slide-Over Drawer */}
      {newOrderOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-[1px]"
            onClick={() => setNewOrderOpen(false)}
          />
          <div className="relative z-10 w-full max-w-lg bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Create Server Order
                </h2>
                <p className="text-xs text-slate-500">
                  Ticket will appear immediately in Pending across all screens.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNewOrderOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleCreateServerOrder(e)}
              className="flex-1 overflow-y-auto p-6 space-y-5"
            >
              {orderError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {orderError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Guest Name
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Walk-in Guest"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Table or Room
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={60}
                    value={tableOrRoom}
                    onChange={(e) => setTableOrRoom(e.target.value)}
                    placeholder="Table 5 / Room 204"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Guest Phone (Optional)
                </label>
                <input
                  type="tel"
                  maxLength={32}
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <p className="text-xs font-medium text-slate-700 mb-2">Select Menu Items</p>
                {availableMenu.length === 0 ? (
                  <p className="text-xs text-slate-500 p-4 border border-slate-200 rounded-lg">
                    No available menu items found. Ask the shop owner to add items to the menu.
                  </p>
                ) : (
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 max-h-72 overflow-y-auto">
                    {availableMenu.map((item) => {
                      const qty = draftCart[item.id] || 0;
                      return (
                        <div
                          key={item.id}
                          className="px-3.5 py-2.5 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate">
                              {item.name}
                            </p>
                            <p className="text-xs text-slate-500 font-mono tabular-nums">
                              {item.category} · {formatCurrency(item.price)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => adjustDraftQty(item.id, -1)}
                              disabled={qty === 0}
                              aria-label={`Decrease ${item.name}`}
                              className="w-7 h-7 rounded border border-slate-300 flex items-center justify-center text-slate-700 disabled:opacity-35 hover:bg-slate-50 cursor-pointer"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="w-5 text-center font-mono text-xs font-semibold tabular-nums">
                              {qty}
                            </span>
                            <button
                              type="button"
                              onClick={() => adjustDraftQty(item.id, 1)}
                              aria-label={`Increase ${item.name}`}
                              className="w-7 h-7 rounded border border-slate-300 flex items-center justify-center text-slate-700 hover:bg-slate-50 cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Kitchen Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  maxLength={300}
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  placeholder="Allergies, spice level, or delivery timing."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none resize-none"
                />
              </div>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs text-slate-500">Order Total</p>
                  <p className="font-mono text-lg font-semibold text-slate-900 tabular-nums">
                    {formatCurrency(draftTotal)}
                  </p>
                </div>
                <button
                  type="submit"
                  disabled={submittingOrder || draftItems.length === 0}
                  className="px-5 py-2.5 text-xs font-semibold text-white rounded-lg hover:opacity-95 disabled:opacity-50 cursor-pointer"
                  style={{ backgroundColor: shop.primary_color || '#0F172A' }}
                >
                  {submittingOrder ? 'Sending Ticket...' : 'Submit Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
};
