import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BedDouble,
  CheckCircle2,
  ClipboardList,
  Minus,
  Plus,
  QrCode,
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
import {
  confirmOrderPayment,
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
  MenuItem,
  NEXT_ORDER_STATUS,
  Order,
  ORDER_STATUS_FLOW,
  OrderItem,
  OrderStatus,
  Room,
  RoomBooking,
  Shop,
} from '../types';

type ServerTab = 'orders' | 'front_desk' | 'menu';

const SOUND_PREF_KEY = 'hostgrid_kitchen_sound';

const STATUS_META: Record<
  OrderStatus,
  { label: string; headerColor: string; nextActionLabel: string | null }
> = {
  pending: {
    label: 'Pending',
    headerColor: 'text-amber-700',
    nextActionLabel: 'Start Preparing',
  },
  preparing: {
    label: 'Preparing',
    headerColor: 'text-blue-700',
    nextActionLabel: 'Mark Ready',
  },
  ready: {
    label: 'Ready',
    headerColor: 'text-emerald-700',
    nextActionLabel: 'Mark Served',
  },
  served: {
    label: 'Served',
    headerColor: 'text-indigo-700',
    nextActionLabel: 'Mark Paid',
  },
  paid: {
    label: 'Paid',
    headerColor: 'text-slate-500',
    nextActionLabel: null,
  },
};

export const ServerPage: React.FC = () => {
  const { user, profile, signOutUser } = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

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
  const [confirmingPaymentId, setConfirmingPaymentId] = useState<string | null>(null);
  const [mobileStageFilter, setMobileStageFilter] = useState<'all' | OrderStatus>('all');

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
      const openTickets = orders.filter((o) => o.status !== 'paid').length;
      items.push({ id: 'orders', label: 'Kitchen Board', icon: ClipboardList, count: openTickets });
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

  const pendingUpiOrdersCount = useMemo(
    () =>
      orders.filter(
        (o) =>
          getEffectivePaymentMethod(o.payment_method) === 'upi' &&
          getEffectivePaymentStatus(o.payment_status, o.status) === 'verification_pending'
      ).length,
    [orders]
  );

  const handleAdvanceStatus = async (order: Order) => {
    if (!shop) return;
    const nextStatus = NEXT_ORDER_STATUS[order.status];
    if (!nextStatus) return;

    const alreadyPaid = getEffectivePaymentStatus(order.payment_status, order.status) === 'paid';
    setUpdatingOrderId(order.id);
    try {
      await updateOrderStatus(shop.id, order.id, nextStatus, alreadyPaid);
      pushToast(
        `${order.order_number} → ${STATUS_META[nextStatus].label}`,
        `${order.customer_name} (${order.table_or_room})`,
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

  const handleConfirmOrderPaid = async (order: Order) => {
    if (!shop) return;
    setConfirmingPaymentId(order.id);
    try {
      if (order.status === 'served') {
        await updateOrderStatus(shop.id, order.id, 'paid', false);
      } else {
        await confirmOrderPayment(shop.id, order.id);
      }
      const methodLabel =
        getEffectivePaymentMethod(order.payment_method) === 'upi' ? 'UPI' : 'Cash';
      pushToast(
        `Payment Confirmed (${methodLabel})`,
        `${order.order_number} · ${formatCurrency(order.total_amount)} settled.`,
        'success'
      );
    } catch (err) {
      pushToast(
        'Payment verification failed',
        err instanceof Error ? err.message : 'Unable to confirm payment.',
        'error'
      );
    } finally {
      setConfirmingPaymentId(null);
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

  const visibleColumns =
    mobileStageFilter === 'all' ? ORDER_STATUS_FLOW : [mobileStageFilter];

  return (
    <WorkspaceShell
      brandName={shop.name}
      brandLogoUrl={shop.logo_url}
      accentColor={shop.primary_color}
      roleLabel={
        profile?.role === 'super_admin'
          ? 'Super Admin (Staff View)'
          : profile?.role === 'owner'
            ? 'Shop Owner (Staff View)'
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
          ? 'Kitchen & Order Board'
          : activeTab === 'front_desk'
            ? 'Front Desk & Reception'
            : 'Menu Reference'
      }
      onSignOut={() => void signOutUser()}
      headerActions={
        shop.modules?.orders && activeTab === 'orders' ? (
          <div className="flex items-center gap-2">
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
              <span className="hidden sm:inline">{soundEnabled ? 'Chime On' : 'Muted'}</span>
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
        <div className="space-y-5">
          {/* Live Header & Stage Filter */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  Real-Time Kitchen Board
                </h2>
                {liveConnected && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    Realtime connected
                  </span>
                )}
                {pendingUpiOrdersCount > 0 && (
                  <span className="text-xs font-semibold text-amber-800">
                    · {pendingUpiOrdersCount} UPI{' '}
                    {pendingUpiOrdersCount === 1 ? 'payment' : 'payments'} to verify
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Advance tickets along Pending → Preparing → Ready → Served → Paid. Updates stream
                live to guests and the Owner Dashboard.
              </p>
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg overflow-x-auto self-start lg:self-auto max-w-full">
              {(['all', ...ORDER_STATUS_FLOW] as const).map((stage) => (
                <button
                  key={stage}
                  type="button"
                  onClick={() => setMobileStageFilter(stage)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap capitalize cursor-pointer ${
                    mobileStageFilter === stage
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {stage}
                </button>
              ))}
            </div>
          </div>

          {ordersLoading ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              {[1, 2, 3, 4, 5].map((col) => (
                <div
                  key={col}
                  className="h-64 bg-white border border-slate-200 rounded-lg animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div
              className={`grid gap-4 items-start ${
                visibleColumns.length === 1
                  ? 'grid-cols-1 max-w-2xl'
                  : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'
              }`}
            >
              {visibleColumns.map((stage) => {
                const stageOrders = orders.filter((o) => o.status === stage);
                const meta = STATUS_META[stage];
                return (
                  <div
                    key={stage}
                    className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col"
                  >
                    <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between">
                      <h3 className={`font-display text-xs font-semibold ${meta.headerColor}`}>
                        {meta.label}
                      </h3>
                      <span className="font-mono text-xs text-slate-500 tabular-nums">
                        {stageOrders.length}
                      </span>
                    </div>

                    {stageOrders.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-400">
                        No {meta.label.toLowerCase()} orders
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-200">
                        {stageOrders.map((order) => {
                          const createdDate =
                            order.created_at && typeof order.created_at.toDate === 'function'
                              ? order.created_at.toDate()
                              : null;
                          const isUpdating = updatingOrderId === order.id;
                          const isConfirmingPay = confirmingPaymentId === order.id;
                          const highlightKind = highlightedIds[order.id];
                          const isNewHighlight = Boolean(highlightKind);
                          const payMethod = getEffectivePaymentMethod(order.payment_method);
                          const payStatus = getEffectivePaymentStatus(
                            order.payment_status,
                            order.status
                          );
                          const needsUpiVerify =
                            payMethod === 'upi' && payStatus === 'verification_pending';
                          return (
                            <div
                              key={order.id}
                              className={`p-4 space-y-3 transition-colors duration-300 ${
                                isNewHighlight
                                  ? 'bg-amber-50/70 ring-2 ring-inset ring-amber-400'
                                  : needsUpiVerify
                                    ? 'bg-amber-50/35'
                                    : ''
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                                      {order.order_number}
                                    </p>
                                    {isNewHighlight && (
                                      <span className="text-[11px] font-semibold text-amber-700">
                                        {highlightKind === 'upi'
                                          ? 'UPI Paid'
                                          : highlightKind === 'added'
                                            ? 'Items Added'
                                            : 'New'}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-sm font-medium text-slate-900 truncate mt-0.5">
                                    {order.customer_name}
                                  </p>
                                  <p className="text-xs text-slate-500">
                                    {order.table_or_room} · {formatTimeAgo(createdDate)}
                                  </p>
                                </div>
                                <span className="font-mono text-xs font-semibold text-slate-900 tabular-nums shrink-0">
                                  {formatCurrency(order.total_amount)}
                                </span>
                              </div>

                              <ul className="space-y-1 text-xs text-slate-700 pt-1">
                                {order.items.map((item, idx) => (
                                  <li
                                    key={`${item.menu_item_id}-${idx}`}
                                    className="flex items-center justify-between gap-2"
                                  >
                                    <span className="truncate">
                                      <span className="font-mono font-semibold text-slate-900 mr-1.5 tabular-nums">
                                        {item.quantity}x
                                      </span>
                                      {item.name}
                                    </span>
                                  </li>
                                ))}
                              </ul>

                              {order.notes && (
                                <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5">
                                  Note: {order.notes}
                                </p>
                              )}

                              {/* Payment Verification & Status */}
                              {needsUpiVerify ? (
                                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 space-y-2">
                                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                                    <QrCode className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                                    <span>Verify UPI Payment</span>
                                  </div>
                                  <p className="font-mono text-[11px] text-amber-800 break-all tabular-nums">
                                    UTR: {order.utr_number || 'Not provided'}
                                  </p>
                                  <button
                                    type="button"
                                    disabled={isConfirmingPay}
                                    onClick={() => void handleConfirmOrderPaid(order)}
                                    className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:opacity-60 rounded-md transition-colors cursor-pointer"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    {isConfirmingPay ? 'Confirming...' : 'Confirm Paid'}
                                  </button>
                                </div>
                              ) : payStatus === 'paid' ? (
                                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-emerald-700 font-semibold">
                                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                  <span>Paid via {payMethod === 'upi' ? 'UPI' : 'Cash'}</span>
                                  {order.utr_number && (
                                    <span className="font-mono font-normal text-slate-500">
                                      · UTR {order.utr_number}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <p className="text-[11px] text-slate-500">
                                  Cash at Counter · Unpaid
                                </p>
                              )}

                              {meta.nextActionLabel && (
                                <button
                                  type="button"
                                  disabled={isUpdating}
                                  onClick={() => void handleAdvanceStatus(order)}
                                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
                                >
                                  <span>{isUpdating ? 'Updating...' : meta.nextActionLabel}</span>
                                  <ArrowRight className="w-3.5 h-3.5" />
                                </button>
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
      )}

      {activeTab === 'front_desk' && shop.modules?.rooms && (
        <FrontDeskPanel
          shop={shop}
          rooms={rooms}
          bookings={roomBookings}
          loading={roomsLoading}
        />
      )}

      {activeTab === 'menu' && shop.modules?.menu && (
        <MenuManager shop={shop} items={menuItems} loading={menuLoading} readOnly={true} />
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
