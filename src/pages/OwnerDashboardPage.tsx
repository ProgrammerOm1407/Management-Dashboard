import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  BarChart3,
  BedDouble,
  ClipboardList,
  ExternalLink,
  QrCode,
  Settings,
  Users,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { NavItem, WorkspaceShell } from '../components/WorkspaceShell';
import { AnalyticsPanel } from '../components/owner/AnalyticsPanel';
import { MenuManager } from '../components/owner/MenuManager';
import { OrdersOwnerPanel } from '../components/owner/OrdersOwnerPanel';
import { RoomsManager } from '../components/owner/RoomsManager';
import { StaffManager } from '../components/owner/StaffManager';
import { ShopSettingsPanel } from '../components/owner/ShopSettingsPanel';
import { QrCodePanel } from '../components/owner/QrCodePanel';
import { SalesRegisterPanel } from '../components/owner/SalesRegisterPanel';
import {
  subscribeMenuItems,
  subscribeRoomBookings,
  subscribeShopById,
  subscribeShopOrders,
  subscribeShopRooms,
  subscribeShopStaff,
} from '../lib/firestoreService';
import { formatCurrency } from '../lib/validation';
import { getEffectivePaymentMethod, getEffectivePaymentStatus } from '../lib/upi';
import { MenuItem, Order, Room, RoomBooking, Shop, StaffInvite } from '../types';

type OwnerTab = 'analytics' | 'sales' | 'orders' | 'menu' | 'rooms' | 'qrcode' | 'staff' | 'settings';

const ALL_OWNER_TABS: readonly OwnerTab[] = [
  'analytics',
  'sales',
  'orders',
  'menu',
  'rooms',
  'qrcode',
  'staff',
  'settings',
];

function parseOwnerTab(raw?: string): OwnerTab {
  if (raw && (ALL_OWNER_TABS as readonly string[]).includes(raw)) {
    return raw as OwnerTab;
  }
  return 'analytics';
}

export const OwnerDashboardPage: React.FC = () => {
  const { profile, signOutUser } = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { tab: routeTab } = useParams<{ tab?: string }>();
  const [searchParams] = useSearchParams();

  const targetShopId =
    profile?.role === 'super_admin'
      ? searchParams.get('shop') || profile.shop_id
      : profile?.shop_id || null;

  const [shop, setShop] = useState<Shop | null>(null);
  const [shopLoading, setShopLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<OwnerTab>(() => parseOwnerTab(routeTab));

  useEffect(() => {
    setActiveTab(parseOwnerTab(routeTab));
  }, [routeTab]);

  const handleSelectTab = (nextTab: OwnerTab) => {
    setActiveTab(nextTab);
    const nextPath = nextTab === 'analytics' ? '/dashboard' : `/dashboard/${nextTab}`;
    if (location.pathname !== nextPath) {
      navigate(`${nextPath}${location.search}`, { replace: false });
    }
  };

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);

  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersLive, setOrdersLive] = useState(false);
  const prevOrderTotalsRef = useRef<
    Record<string, { total: number; qty: number; payStatus: string }>
  >({});

  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<RoomBooking[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);

  const [staff, setStaff] = useState<StaffInvite[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);

  // Subscribe to Shop config
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

  // Subscribe to Menu Items
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

  // Subscribe to Real-Time Orders + Live Toast Notifications
  useEffect(() => {
    if (!shop?.id || !shop.modules?.orders) {
      setOrders([]);
      setOrdersLoading(false);
      setOrdersLive(false);
      return;
    }
    setOrdersLoading(true);
    const unsub = subscribeShopOrders(
      shop.id,
      (list, changes, isInitial) => {
        setOrders(list);
        setOrdersLoading(false);
        setOrdersLive(true);

        if (!isInitial && changes.length > 0) {
          changes.forEach((change) => {
            const nextQty = change.order.items.reduce((sum, i) => sum + i.quantity, 0);
            const nextPayStatus = getEffectivePaymentStatus(
              change.order.payment_status,
              change.order.status
            );
            const prevMeta = prevOrderTotalsRef.current[change.order.id];
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

            if (change.type === 'added') {
              pushToast(
                `New Order ${change.order.order_number}`,
                `${change.order.customer_name} (${change.order.table_or_room}) · ${formatCurrency(change.order.total_amount)}`,
                'success'
              );
            } else if (isAddOn) {
              pushToast(
                `Items Added to ${change.order.order_number}`,
                `${change.order.customer_name} (${change.order.table_or_room}) · Combined bill ${formatCurrency(change.order.total_amount)}`,
                'success'
              );
            } else if (isUpiSubmitted) {
              pushToast(
                `UPI Payment Submitted · ${change.order.order_number}`,
                `${change.order.table_or_room} · Full bill ${formatCurrency(change.order.total_amount)}${change.order.utr_number ? ` · UTR ${change.order.utr_number}` : ''}`,
                'success'
              );
            } else if (change.type === 'modified') {
              pushToast(
                `Order ${change.order.order_number} updated`,
                `Status is now ${change.order.status.toUpperCase()}`,
                'info'
              );
            }
          });
        }
        const nextTotals: Record<string, { total: number; qty: number; payStatus: string }> = {};
        list.forEach((o) => {
          nextTotals[o.id] = {
            total: o.total_amount,
            qty: o.items.reduce((sum, i) => sum + i.quantity, 0),
            payStatus: getEffectivePaymentStatus(o.payment_status, o.status),
          };
        });
        prevOrderTotalsRef.current = nextTotals;
      },
      () => {
        setOrdersLoading(false);
        setOrdersLive(false);
      }
    );
    return () => unsub();
  }, [shop?.id, shop?.modules?.orders, pushToast]);

  // Subscribe to Rooms & Bookings when Rooms module enabled
  useEffect(() => {
    if (!shop?.id || !shop.modules?.rooms) {
      setRooms([]);
      setBookings([]);
      setRoomsLoading(false);
      return;
    }
    setRoomsLoading(true);
    const unsubRooms = subscribeShopRooms(shop.id, (list) => {
      setRooms(list);
      setRoomsLoading(false);
    });
    const unsubBookings = subscribeRoomBookings(shop.id, (list) => {
      setBookings(list);
    });
    return () => {
      unsubRooms();
      unsubBookings();
    };
  }, [shop?.id, shop?.modules?.rooms]);

  // Subscribe to Staff roster
  useEffect(() => {
    if (!shop?.id || !shop.owner_email) {
      setStaff([]);
      setStaffLoading(false);
      return;
    }
    setStaffLoading(true);
    const unsub = subscribeShopStaff(shop.id, shop.owner_email, (list) => {
      setStaff(list);
      setStaffLoading(false);
    });
    return () => unsub();
  }, [shop?.id, shop?.owner_email]);

  // Dynamically hide disabled modules from sidebar & guard active tab
  const navItems: NavItem[] = useMemo(() => {
    if (!shop) return [];
    const pendingUpiCount =
      orders.filter((o) => o.payment_method === 'upi' && o.payment_status === 'verification_pending')
        .length +
      bookings.filter(
        (b) =>
          b.status !== 'cancelled' &&
          b.payment_method === 'upi' &&
          b.payment_status === 'verification_pending'
      ).length;

    const items: NavItem[] = [
      { id: 'analytics', label: 'Analytics', icon: BarChart3 },
      {
        id: 'sales',
        label: 'Sales Register',
        icon: Wallet,
        count: pendingUpiCount > 0 ? pendingUpiCount : undefined,
      },
    ];
    if (shop.modules?.orders) {
      const openCount = orders.filter((o) => o.status !== 'paid').length;
      items.push({ id: 'orders', label: 'Orders', icon: ClipboardList, count: openCount });
    }
    if (shop.modules?.menu) {
      items.push({ id: 'menu', label: 'Menu', icon: UtensilsCrossed, count: menuItems.length });
    }
    if (shop.modules?.rooms) {
      items.push({ id: 'rooms', label: 'Rooms', icon: BedDouble, count: rooms.length });
    }
    items.push({ id: 'qrcode', label: 'Storefront QR', icon: QrCode });
    items.push({ id: 'staff', label: 'Staff Management', icon: Users, count: staff.length });
    items.push({ id: 'settings', label: 'Shop Settings', icon: Settings });
    return items;
  }, [shop, orders, bookings, menuItems.length, rooms.length, staff.length]);

  useEffect(() => {
    if (!shop) return;
    const validIds = new Set(navItems.map((i) => i.id));
    if (!validIds.has(activeTab)) {
      setActiveTab('analytics');
      navigate(`/dashboard${location.search}`, { replace: true });
    }
  }, [shop, navItems, activeTab, navigate, location.search]);

  if (shopLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <p className="text-sm text-slate-600">Loading shop workspace...</p>
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 text-center">
          <h1 className="font-display text-lg font-semibold text-slate-900">
            No shop selected
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            {profile?.role === 'super_admin'
              ? 'Choose a tenant shop from the Super Admin directory to inspect its Owner Dashboard.'
              : 'Your owner account is not linked to an active shop.'}
          </p>
          <div className="mt-5 flex justify-center gap-3">
            {profile?.role === 'super_admin' && (
              <button
                type="button"
                onClick={() => navigate('/super-admin')}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                Back to Super Admin
              </button>
            )}
            <button
              type="button"
              onClick={() => void signOutUser()}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const tabTitleMap: Record<OwnerTab, string> = {
    analytics: 'Analytics',
    sales: 'Sales Register',
    orders: 'Live Orders',
    menu: 'Menu Catalog',
    rooms: 'Rooms & Bookings',
    qrcode: 'Storefront QR Code',
    staff: 'Staff Management',
    settings: 'Shop Settings',
  };

  return (
    <WorkspaceShell
      brandName={shop.name}
      brandLogoUrl={shop.logo_url}
      accentColor={shop.primary_color}
      roleLabel={profile?.role === 'super_admin' ? 'Super Admin (Owner View)' : 'Shop Owner'}
      userEmail={profile?.email || ''}
      navItems={navItems}
      activeNavId={activeTab}
      onSelectNav={(id) => handleSelectTab(id as OwnerTab)}
      breadcrumbSection={shop.name}
      breadcrumbCurrent={tabTitleMap[activeTab]}
      onSignOut={() => void signOutUser()}
      headerActions={
        <div className="flex items-center gap-2.5">
          {!shop.is_active && (
            <span className="text-xs font-medium text-red-700 hidden sm:inline">
              Storefront Suspended
            </span>
          )}
          <button
            type="button"
            onClick={() => navigate(`/s/${shop.slug}`)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Public Link
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
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
        ) : undefined
      }
    >
      {activeTab === 'analytics' && (
        <AnalyticsPanel
          shop={shop}
          orders={orders}
          loading={ordersLoading}
          onOpenStorefront={() => navigate(`/s/${shop.slug}`)}
        />
      )}

      {activeTab === 'sales' && (
        <SalesRegisterPanel
          shop={shop}
          orders={orders}
          bookings={bookings}
          loading={ordersLoading || roomsLoading}
        />
      )}

      {activeTab === 'orders' && shop.modules?.orders && (
        <OrdersOwnerPanel
          shop={shop}
          orders={orders}
          loading={ordersLoading}
          isLiveConnected={ordersLive}
          canOpenServerView={profile?.role === 'super_admin' || profile?.role === 'owner'}
          onOpenServerView={() =>
            navigate(profile?.role === 'super_admin' ? `/server?shop=${shop.id}` : '/server')
          }
        />
      )}

      {activeTab === 'menu' && shop.modules?.menu && (
        <MenuManager shop={shop} items={menuItems} loading={menuLoading} readOnly={false} />
      )}

      {activeTab === 'rooms' && shop.modules?.rooms && (
        <RoomsManager
          shop={shop}
          rooms={rooms}
          bookings={bookings}
          loading={roomsLoading}
        />
      )}

      {activeTab === 'qrcode' && (
        <QrCodePanel shop={shop} onOpenStorefront={() => navigate(`/s/${shop.slug}`)} />
      )}

      {activeTab === 'staff' && (
        <StaffManager shop={shop} staff={staff} loading={staffLoading} />
      )}

      {activeTab === 'settings' && (
        <ShopSettingsPanel
          shop={shop}
          onOpenStorefront={() => navigate(`/s/${shop.slug}`)}
          onOpenQrCode={() => handleSelectTab('qrcode')}
        />
      )}
    </WorkspaceShell>
  );
};
